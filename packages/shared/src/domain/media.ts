import { err, ok, type Result } from './result.js';

export type MediaKind = 'audio' | 'video';

export interface MediaFormat {
  readonly extension: string;
  readonly label: string;
  /** Kind assumed when the browser does not tell us more. */
  readonly kind: MediaKind;
  readonly mimeTypes: readonly string[];
  /** Plays in current desktop browsers through <video>/<audio>. */
  readonly playable: boolean;
  /** Accepted by Groq speech-to-text (https://console.groq.com/docs/speech-to-text). */
  readonly transcribable: boolean;
}

export const MEDIA_FORMATS: readonly MediaFormat[] = [
  { extension: 'mp3', label: 'MP3', kind: 'audio', mimeTypes: ['audio/mpeg', 'audio/mp3'], playable: true, transcribable: true },
  {
    extension: 'wav',
    label: 'WAV',
    kind: 'audio',
    mimeTypes: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
    playable: true,
    transcribable: true,
  },
  {
    extension: 'm4a',
    label: 'M4A',
    kind: 'audio',
    mimeTypes: ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
    playable: true,
    transcribable: true,
  },
  { extension: 'mp4', label: 'MP4', kind: 'video', mimeTypes: ['video/mp4', 'audio/mp4'], playable: true, transcribable: true },
  { extension: 'webm', label: 'WebM', kind: 'video', mimeTypes: ['video/webm', 'audio/webm'], playable: true, transcribable: true },
  { extension: 'flac', label: 'FLAC', kind: 'audio', mimeTypes: ['audio/flac', 'audio/x-flac'], playable: true, transcribable: true },
  {
    extension: 'ogg',
    label: 'OGG',
    kind: 'audio',
    mimeTypes: ['audio/ogg', 'application/ogg', 'audio/vorbis', 'audio/opus', 'video/ogg'],
    playable: true,
    transcribable: true,
  },
  { extension: 'mpga', label: 'MPGA', kind: 'audio', mimeTypes: ['audio/mpeg', 'audio/mpga'], playable: true, transcribable: true },
  // MPEG-1/2 program streams rarely play in browsers, but Groq can transcribe them.
  { extension: 'mpeg', label: 'MPEG', kind: 'video', mimeTypes: ['video/mpeg', 'audio/mpeg'], playable: false, transcribable: true },
];

export type MediaPurpose = 'playback' | 'transcription';

export function mediaFormatsFor(purpose: MediaPurpose): readonly MediaFormat[] {
  return MEDIA_FORMATS.filter((format) => (purpose === 'playback' ? format.playable : format.transcribable));
}

/** Conservative default that matches Groq's free-tier attachment limit. */
export const DEFAULT_TRANSCRIPTION_MAX_BYTES = 25 * 1024 ** 2;
/** Groq's highest documented upload limit (dev tier). Larger values are refused at startup. */
export const MAX_CONFIGURABLE_TRANSCRIPTION_BYTES = 100 * 1024 ** 2;

export type SubtitleFileFormat = 'srt' | 'vtt';

export const SUBTITLE_EXTENSIONS: readonly SubtitleFileFormat[] = ['srt', 'vtt'];

const SUBTITLE_MIME_TYPES = ['text/plain', 'text/vtt', 'application/x-subrip', 'text/srt', 'application/srt'];

/** Some platforms (notably Windows) report no MIME type or a generic one. */
const GENERIC_MIME_TYPES = ['', 'application/octet-stream'];

export const MAX_LOCAL_MEDIA_BYTES = 2 * 1024 ** 3;
export const MAX_SUBTITLE_BYTES = 5 * 1024 ** 2;

/** The subset of `File` that validation needs; keeps this module DOM-free. */
export interface FileDescriptor {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export type FileRejectionReason = 'unsupported-format' | 'mime-mismatch' | 'empty' | 'too-large';

export interface FileRejection {
  readonly reason: FileRejectionReason;
  readonly message: string;
}

export interface AcceptedMediaFile {
  readonly format: MediaFormat;
  readonly kind: MediaKind;
}

export function getFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export function mediaFormatLabel(purpose: MediaPurpose): string {
  return mediaFormatsFor(purpose)
    .map((format) => format.label)
    .join(', ');
}

/** Value for an `<input type="file" accept>` attribute. */
export function mediaAcceptAttribute(purpose: MediaPurpose): string {
  return mediaFormatsFor(purpose)
    .map((format) => `.${format.extension}`)
    .join(',');
}

export const SUPPORTED_MEDIA_LABEL = mediaFormatLabel('playback');
export const MEDIA_ACCEPT_ATTRIBUTE = mediaAcceptAttribute('playback');
export const TRANSCRIPTION_MEDIA_LABEL = mediaFormatLabel('transcription');
export const TRANSCRIPTION_ACCEPT_ATTRIBUTE = mediaAcceptAttribute('transcription');
export const SUBTITLE_ACCEPT_ATTRIBUTE = SUBTITLE_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export function validateMediaFile(
  file: FileDescriptor,
  options: { maxBytes?: number; purpose?: MediaPurpose } = {},
): Result<AcceptedMediaFile, FileRejection> {
  const purpose = options.purpose ?? 'playback';
  const maxBytes = options.maxBytes ?? MAX_LOCAL_MEDIA_BYTES;
  const extension = getFileExtension(file.name);
  const format = mediaFormatsFor(purpose).find((candidate) => candidate.extension === extension);

  if (!format) {
    return err({
      reason: 'unsupported-format',
      message: `This file type isn't supported${purpose === 'transcription' ? ' for transcription' : ''}. Use ${mediaFormatLabel(purpose)}.`,
    });
  }

  const mimeType = file.type.toLowerCase();
  if (!GENERIC_MIME_TYPES.includes(mimeType) && !format.mimeTypes.includes(mimeType)) {
    return err({
      reason: 'mime-mismatch',
      message: `The file reports type "${mimeType}", which doesn't match its .${format.extension} extension.`,
    });
  }

  if (file.size === 0) {
    return err({ reason: 'empty', message: 'This file is empty.' });
  }

  if (file.size > maxBytes) {
    return err({
      reason: 'too-large',
      message: `This file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`,
    });
  }

  const kind: MediaKind = mimeType.startsWith('audio/') ? 'audio' : format.kind;
  return ok({ format, kind });
}

export function validateSubtitleFile(file: FileDescriptor): Result<SubtitleFileFormat, FileRejection> {
  const extension = getFileExtension(file.name);
  const format = SUBTITLE_EXTENSIONS.find((candidate) => candidate === extension);

  if (!format) {
    return err({ reason: 'unsupported-format', message: 'Subtitles must be an .srt or .vtt file.' });
  }

  const mimeType = file.type.toLowerCase();
  if (!GENERIC_MIME_TYPES.includes(mimeType) && !SUBTITLE_MIME_TYPES.includes(mimeType)) {
    return err({
      reason: 'mime-mismatch',
      message: `The file reports type "${mimeType}", which isn't a subtitle format.`,
    });
  }

  if (file.size === 0) {
    return err({ reason: 'empty', message: 'This subtitle file is empty.' });
  }

  if (file.size > MAX_SUBTITLE_BYTES) {
    return err({
      reason: 'too-large',
      message: `This subtitle file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_SUBTITLE_BYTES)}.`,
    });
  }

  return ok(format);
}
