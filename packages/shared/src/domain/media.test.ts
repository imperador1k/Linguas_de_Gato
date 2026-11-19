import { describe, expect, it } from 'vitest';
import {
  MEDIA_ACCEPT_ATTRIBUTE,
  TRANSCRIPTION_ACCEPT_ATTRIBUTE,
  formatBytes,
  getFileExtension,
  validateMediaFile,
  validateSubtitleFile,
} from './media.js';

const MB = 1024 ** 2;

describe('getFileExtension', () => {
  it.each([
    ['lecture.mp3', 'mp3'],
    ['Interview.Final.WAV', 'wav'],
    ['noext', null],
    ['.hidden', null],
    ['trailing.', null],
  ])('%s → %s', (name, expected) => {
    expect(getFileExtension(name)).toBe(expected);
  });
});

describe('validateMediaFile', () => {
  it.each([
    ['talk.mp3', 'audio/mpeg', 'audio'],
    ['talk.wav', 'audio/wav', 'audio'],
    ['talk.wav', 'audio/x-wav', 'audio'],
    ['talk.m4a', 'audio/x-m4a', 'audio'],
    ['talk.m4a', '', 'audio'],
    ['film.mp4', 'video/mp4', 'video'],
    ['film.webm', 'video/webm', 'video'],
    ['voice.webm', 'audio/webm', 'audio'],
    ['clip.MP4', 'application/octet-stream', 'video'],
  ])('accepts %s (%s) as %s', (name, type, kind) => {
    const result = validateMediaFile({ name, type, size: 3 * MB });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe(kind);
  });

  it.each([
    [{ name: 'notes.pdf', type: 'application/pdf', size: MB }, 'unsupported-format'],
    [{ name: 'movie.mkv', type: 'video/x-matroska', size: MB }, 'unsupported-format'],
    [{ name: 'noextension', type: 'audio/mpeg', size: MB }, 'unsupported-format'],
    [{ name: 'fake.mp3', type: 'application/x-msdownload', size: MB }, 'mime-mismatch'],
    [{ name: 'fake.mp3', type: 'video/mp4', size: MB }, 'mime-mismatch'],
    [{ name: 'empty.mp3', type: 'audio/mpeg', size: 0 }, 'empty'],
  ])('rejects %o as %s', (file, reason) => {
    const result = validateMediaFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe(reason);
  });

  it('accepts Groq-only formats for transcription but not for playback', () => {
    expect(validateMediaFile({ name: 'talk.flac', type: 'audio/flac', size: MB }).ok).toBe(true);
    expect(validateMediaFile({ name: 'talk.ogg', type: 'audio/ogg', size: MB }).ok).toBe(true);
    const mpegPlayback = validateMediaFile({ name: 'old.mpeg', type: 'video/mpeg', size: MB });
    expect(mpegPlayback.ok).toBe(false);
    const mpegTranscription = validateMediaFile({ name: 'old.mpeg', type: 'video/mpeg', size: MB }, { purpose: 'transcription' });
    expect(mpegTranscription.ok).toBe(true);
    const mkv = validateMediaFile({ name: 'film.mkv', type: '', size: MB }, { purpose: 'transcription' });
    expect(!mkv.ok && mkv.error.message).toContain('for transcription');
  });

  it('lists every Groq format in the transcription accept attribute', () => {
    for (const extension of ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm']) {
      expect(TRANSCRIPTION_ACCEPT_ATTRIBUTE.split(',')).toContain(`.${extension}`);
    }
    expect(MEDIA_ACCEPT_ATTRIBUTE.split(',')).not.toContain('.mpeg');
  });

  it('enforces the size limit', () => {
    const result = validateMediaFile({ name: 'long.mp3', type: 'audio/mpeg', size: 30 * MB }, { maxBytes: 25 * MB });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('too-large');
      expect(result.error.message).toContain('25 MB');
    }
  });
});

describe('validateSubtitleFile', () => {
  it.each([
    ['episode.srt', 'application/x-subrip', 'srt'],
    ['episode.srt', '', 'srt'],
    ['episode.vtt', 'text/vtt', 'vtt'],
    ['episode.VTT', 'text/plain', 'vtt'],
  ])('accepts %s (%s)', (name, type, format) => {
    expect(validateSubtitleFile({ name, type, size: 2_000 })).toEqual({ ok: true, value: format });
  });

  it.each([
    [{ name: 'episode.txt', type: 'text/plain', size: 10 }, 'unsupported-format'],
    [{ name: 'episode.srt', type: 'image/png', size: 10 }, 'mime-mismatch'],
    [{ name: 'episode.srt', type: '', size: 0 }, 'empty'],
    [{ name: 'episode.vtt', type: 'text/vtt', size: 6 * MB }, 'too-large'],
  ])('rejects %o as %s', (file, reason) => {
    const result = validateSubtitleFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe(reason);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [25 * MB, '25 MB'],
    [2 * 1024 ** 3, '2 GB'],
    [-1, '0 B'],
  ])('%i → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
