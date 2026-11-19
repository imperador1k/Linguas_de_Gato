import { describe, expect, it } from 'vitest';
import { contentMatchesExtension, detectMediaContainer } from './media-signature.js';

function bytes(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') out.push(...Array.from(part, (char) => char.charCodeAt(0)));
    else out.push(...part);
  }
  while (out.length < 64) out.push(0);
  return Uint8Array.from(out);
}

const samples = {
  wav: bytes('RIFF', [0x24, 0, 0, 0], 'WAVEfmt '),
  flac: bytes('fLaC', [0, 0, 0, 0x22]),
  ogg: bytes('OggS', [0, 2]),
  webm: bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f]),
  mp4: bytes([0, 0, 0, 0x20], 'ftypisom'),
  m4a: bytes([0, 0, 0, 0x20], 'ftypM4A '),
  id3: bytes('ID3', [4, 0, 0]),
  mp3Frame: bytes([0xff, 0xfb, 0x90, 0x64]),
  mpeg: bytes([0, 0, 1, 0xba, 0x44]),
} as const;

describe('detectMediaContainer', () => {
  it.each([
    ['wav', samples.wav, 'wav'],
    ['flac', samples.flac, 'flac'],
    ['ogg', samples.ogg, 'ogg'],
    ['webm', samples.webm, 'webm'],
    ['mp4', samples.mp4, 'mp4'],
    ['m4a', samples.m4a, 'mp4'],
    ['ID3-tagged mp3', samples.id3, 'mp3'],
    ['bare mp3 frame', samples.mp3Frame, 'mp3'],
    ['mpeg program stream', samples.mpeg, 'mpeg'],
  ])('detects %s', (_label, input, expected) => {
    expect(detectMediaContainer(input)).toBe(expected);
  });

  it.each([
    ['empty input', new Uint8Array()],
    ['a PDF', bytes('%PDF-1.7')],
    ['a Windows executable', bytes('MZ', [0x90, 0])],
    ['a ZIP archive', bytes('PK', [3, 4])],
    ['plain text', bytes('hello world, not audio')],
    ['a RIFF that is not WAVE (AVI)', bytes('RIFF', [0, 0, 0, 0], 'AVI ')],
    ['an invalid MPEG frame header', bytes([0xff, 0xe8, 0, 0])],
  ])('rejects %s', (_label, input) => {
    expect(detectMediaContainer(input)).toBeNull();
  });
});

describe('contentMatchesExtension', () => {
  it('accepts content that matches the extension', () => {
    expect(contentMatchesExtension('mp3', samples.id3)).toBe(true);
    expect(contentMatchesExtension('mpga', samples.mp3Frame)).toBe(true);
    expect(contentMatchesExtension('m4a', samples.m4a)).toBe(true);
    expect(contentMatchesExtension('mpeg', samples.mpeg)).toBe(true);
    expect(contentMatchesExtension('flac', samples.flac)).toBe(true);
  });

  it('rejects renamed files and unknown extensions', () => {
    expect(contentMatchesExtension('mp3', samples.wav)).toBe(false);
    expect(contentMatchesExtension('wav', bytes('%PDF'))).toBe(false);
    expect(contentMatchesExtension('mkv', samples.webm)).toBe(false);
  });
});
