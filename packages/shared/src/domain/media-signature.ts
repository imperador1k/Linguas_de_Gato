/**
 * Detects an audio/video container from the first bytes of a file, so the
 * server can reject files whose content doesn't match their extension
 * (renamed documents, executables, truncated uploads) before sending them
 * to a provider. It is a sanity check, not a full decoder: a file that
 * passes can still be damaged, and the provider then reports the error.
 */

export type MediaContainer = 'mp3' | 'wav' | 'flac' | 'ogg' | 'webm' | 'mp4' | 'mpeg';

/** How many leading bytes `detectMediaContainer` needs to see. */
export const MEDIA_SIGNATURE_BYTES = 64;

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function isMpegAudioFrame(bytes: Uint8Array, offset = 0): boolean {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  if (first === undefined || second === undefined) return false;
  // 11-bit frame sync, then a valid MPEG version (not "reserved") and layer.
  return first === 0xff && (second & 0xe0) === 0xe0 && (second & 0x18) !== 0x08 && (second & 0x06) !== 0x00;
}

export function detectMediaContainer(bytes: Uint8Array): MediaContainer | null {
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return 'wav';
  if (ascii(bytes, 0, 'fLaC')) return 'flac';
  if (ascii(bytes, 0, 'OggS')) return 'ogg';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (ascii(bytes, 4, 'ftyp')) return 'mp4';
  // MPEG program stream pack header or video sequence header.
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && (bytes[3] === 0xba || bytes[3] === 0xb3)) return 'mpeg';
  // ID3v2 tags precede MP3 frames (and, rarely, FLAC); treat as MP3-family audio.
  if (ascii(bytes, 0, 'ID3')) return 'mp3';
  if (isMpegAudioFrame(bytes)) return 'mp3';
  return null;
}

/** Containers acceptable for each file extension. */
const EXPECTED: Readonly<Record<string, readonly MediaContainer[]>> = {
  mp3: ['mp3'],
  mpga: ['mp3'],
  mpeg: ['mpeg', 'mp3'],
  wav: ['wav'],
  flac: ['flac', 'mp3'],
  ogg: ['ogg'],
  webm: ['webm'],
  mp4: ['mp4'],
  m4a: ['mp4'],
};

export function contentMatchesExtension(extension: string, bytes: Uint8Array): boolean {
  const detected = detectMediaContainer(bytes);
  return detected !== null && (EXPECTED[extension] ?? []).includes(detected);
}
