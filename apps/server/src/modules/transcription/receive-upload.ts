import { createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { MultipartFile, MultipartValue } from '@fastify/multipart';
import {
  MEDIA_SIGNATURE_BYTES,
  contentMatchesExtension,
  formatBytes,
  getFileExtension,
  transcriptionOptionsSchema,
  validateMediaFile,
  type TranscriptionOptions,
} from '@ldg/shared';
import type { FastifyRequest } from 'fastify';
import { AppError, parseInput } from '../../errors.js';
import { UPLOAD_DIR_PREFIX } from './temp-uploads.js';

export interface ReceivedUpload {
  readonly filePath: string;
  /** Safe name for the provider: fixed stem, validated extension. */
  readonly providerFileName: string;
  readonly mimeType: string;
  readonly extension: string;
  readonly sizeBytes: number;
  readonly options: TranscriptionOptions;
  /** Idempotent; deletes the private temp directory. */
  cleanup(): Promise<void>;
}

export interface ReceiveUploadOptions {
  readonly maxBytes: number;
  /** Parent directory for per-request temp directories (os.tmpdir() in production). */
  readonly tempRoot: string;
}

const ALLOWED_FIELDS = new Set(['model', 'language']);

function tooLarge(maxBytes: number): AppError {
  return new AppError('PAYLOAD_TOO_LARGE', `The file is larger than the ${formatBytes(maxBytes)} transcription limit.`, 413);
}

/** Errors thrown by @fastify/multipart / busboy carry these codes. */
function mapMultipartError(error: unknown, maxBytes: number): unknown {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  switch (code) {
    case 'FST_REQ_FILE_TOO_LARGE':
      return tooLarge(maxBytes);
    case 'FST_FILES_LIMIT':
      return AppError.validation('Send one file at a time.');
    case 'FST_FIELDS_LIMIT':
    case 'FST_PARTS_LIMIT':
      return AppError.validation('The upload contains unexpected form fields.');
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
    case 'FST_NO_FORM_DATA':
      return new AppError('UNSUPPORTED_MEDIA_TYPE', 'Send the file as multipart/form-data.', 415);
    default:
      return error;
  }
}

function readFields(fields: MultipartFile['fields']): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, entry] of Object.entries(fields)) {
    if (name === 'file') continue;
    const single = Array.isArray(entry) ? entry : [entry];
    if (!ALLOWED_FIELDS.has(name) || single.length !== 1) {
      throw AppError.validation('The upload contains unexpected form fields.', [{ path: name, message: 'Not allowed' }]);
    }
    const value = single[0] as MultipartValue | MultipartFile | undefined;
    if (!value || value.type !== 'field' || typeof value.value !== 'string') {
      throw AppError.validation('The upload contains unexpected form fields.', [{ path: name, message: 'Must be text' }]);
    }
    values[name] = value.value;
  }
  return values;
}

async function readHeader(filePath: string): Promise<Uint8Array> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MEDIA_SIGNATURE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MEDIA_SIGNATURE_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Streams the single `file` part of a multipart request into a private temp
 * directory and validates it. Text fields (`model`, `language`) must precede
 * the file in the form. On any failure the temp directory is removed before
 * the error propagates; on success the caller must call `cleanup()`.
 */
export async function receiveTranscriptionUpload(
  request: FastifyRequest,
  { maxBytes, tempRoot }: ReceiveUploadOptions,
): Promise<ReceivedUpload> {
  if (!request.isMultipart()) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Send the file as multipart/form-data.', 415);
  }

  let part: MultipartFile | undefined;
  try {
    part = await request.file({ limits: { fileSize: maxBytes, files: 1, fields: ALLOWED_FIELDS.size, parts: 4, fieldSize: 64 } });
  } catch (error) {
    throw mapMultipartError(error, maxBytes);
  }
  if (!part) throw AppError.validation('Attach an audio or video file in the "file" field.');

  // Until the stream is consumed, busboy holds the request open: drain it on early rejection.
  const reject = (error: unknown): never => {
    part?.file.resume();
    throw error;
  };

  if (part.fieldname !== 'file') reject(AppError.validation('Attach the media in a field named "file".'));
  const options = (() => {
    try {
      return parseInput(transcriptionOptionsSchema, readFields(part.fields), 'Transcription options');
    } catch (error) {
      return reject(error);
    }
  })();

  // Extension and MIME type are checked against an allow-list before anything is written.
  const validation = validateMediaFile(
    { name: part.filename, type: part.mimetype, size: 1 },
    { purpose: 'transcription', maxBytes },
  );
  if (!validation.ok) {
    const code = validation.error.reason === 'too-large' ? 413 : 415;
    reject(new AppError(code === 413 ? 'PAYLOAD_TOO_LARGE' : 'UNSUPPORTED_MEDIA_TYPE', validation.error.message, code));
  }
  const extension = getFileExtension(part.filename) as string;

  // A fresh private directory per request: unpredictable name, no user-controlled path segments.
  const directory = await mkdtemp(join(tempRoot, UPLOAD_DIR_PREFIX));
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await rm(directory, { recursive: true, force: true });
  };
  const filePath = join(directory, `upload.${extension}`);

  try {
    try {
      await pipeline(part.file, createWriteStream(filePath, { flags: 'wx', mode: 0o600 }));
    } catch (error) {
      throw mapMultipartError(error, maxBytes);
    }
    if (part.file.truncated) throw tooLarge(maxBytes);

    const { size } = await stat(filePath);
    if (size === 0) throw AppError.validation('The file is empty.');
    if (size > maxBytes) throw tooLarge(maxBytes);

    if (!contentMatchesExtension(extension, await readHeader(filePath))) {
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        `This file's content doesn't look like ${extension.toUpperCase()} audio or video. It may be renamed or damaged.`,
        415,
      );
    }

    return {
      filePath,
      providerFileName: `audio.${extension}`,
      // Already validated against the allow-list for this extension (or empty/generic).
      mimeType: part.mimetype || 'application/octet-stream',
      extension,
      sizeBytes: size,
      options,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
