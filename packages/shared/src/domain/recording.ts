import { baseMimeType } from './media.js';

/**
 * Picks a MediaRecorder format that the transcription pipeline (M2) accepts.
 * Browsers differ: Chromium and Firefox record WebM/Opus, Safari records MP4/AAC.
 * Every candidate maps to an extension whose container the server's content
 * check recognises (WebM → EBML header, MP4 → `ftyp`, OGG → `OggS`).
 */

export interface RecordingFormat {
  /** Passed to `new MediaRecorder(stream, { mimeType })`. */
  readonly mimeType: string;
  /** Sent with the upload; codec parameters stripped. */
  readonly uploadType: string;
  readonly extension: 'webm' | 'm4a' | 'ogg';
}

export const RECORDING_FORMAT_CANDIDATES: readonly RecordingFormat[] = [
  { mimeType: 'audio/webm;codecs=opus', uploadType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/webm', uploadType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/mp4;codecs=mp4a.40.2', uploadType: 'audio/mp4', extension: 'm4a' },
  { mimeType: 'audio/mp4', uploadType: 'audio/mp4', extension: 'm4a' },
  { mimeType: 'audio/ogg;codecs=opus', uploadType: 'audio/ogg', extension: 'ogg' },
];

/** First supported candidate, or null when the browser supports none of them. */
export function chooseRecordingFormat(isTypeSupported: (mimeType: string) => boolean): RecordingFormat | null {
  for (const candidate of RECORDING_FORMAT_CANDIDATES) {
    try {
      if (isTypeSupported(candidate.mimeType)) return candidate;
    } catch {
      // Some implementations throw for unknown types instead of returning false.
    }
  }
  return null;
}

/**
 * Maps what a recorder actually produced (`recorder.mimeType`, possibly with
 * codecs, possibly `video/webm` for audio-only streams) to a format we can
 * upload. Null for anything the pipeline can't accept.
 */
export function formatFromRecordedType(type: string): RecordingFormat | null {
  switch (baseMimeType(type)) {
    case 'audio/webm':
    case 'video/webm':
      return { mimeType: type, uploadType: 'audio/webm', extension: 'webm' };
    case 'audio/mp4':
    case 'video/mp4':
    case 'audio/x-m4a':
      return { mimeType: type, uploadType: 'audio/mp4', extension: 'm4a' };
    case 'audio/ogg':
    case 'application/ogg':
      return { mimeType: type, uploadType: 'audio/ogg', extension: 'ogg' };
    default:
      return null;
  }
}
