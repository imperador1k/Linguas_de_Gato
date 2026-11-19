import { describe, expect, it } from 'vitest';
import { detectSubtitleFormat, findActiveCueIndex, parseSubtitleTimestamp, parseSubtitles } from './subtitles.js';

describe('parseSubtitleTimestamp', () => {
  it.each([
    ['00:00:01,000', 1_000],
    ['01:02:03,456', 3_723_456],
    ['00:01:02.500', 62_500],
    ['01:02.345', 62_345],
    ['00:00:01,5', 1_500],
    ['10:00:00.000', 36_000_000],
  ])('parses %s', (input, expected) => {
    expect(parseSubtitleTimestamp(input)).toBe(expected);
  });

  it.each(['', '1:2:3', '00:60:00,000', '00:00:61,000', 'abc', '00:00:01'])('rejects %s', (input) => {
    expect(parseSubtitleTimestamp(input)).toBeNull();
  });
});

describe('detectSubtitleFormat', () => {
  it('detects WebVTT by header, including with a BOM', () => {
    expect(detectSubtitleFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nHi')).toBe('vtt');
    expect(detectSubtitleFormat('﻿WEBVTT - title\n')).toBe('vtt');
  });

  it('falls back to SRT', () => {
    expect(detectSubtitleFormat('1\n00:00:01,000 --> 00:00:02,000\nHi')).toBe('srt');
  });
});

describe('parseSubtitles — SRT', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    'Hello there.',
    '',
    '2',
    '00:00:04,000 --> 00:00:06,000',
    '<i>This is</i> a <b>second</b> line',
    'that wraps.',
    '',
    '3',
    '00:00:07,000 --> 00:00:08,000',
    '{\\an8}Fish &amp; chips',
    '',
  ].join('\r\n');

  it('parses cues, strips markup, decodes entities and normalises CRLF', () => {
    const result = parseSubtitles(srt);
    expect(result.format).toBe('srt');
    expect(result.skippedBlocks).toBe(0);
    expect(result.cues).toEqual([
      { id: '1', startMs: 1_000, endMs: 3_500, text: 'Hello there.' },
      { id: '2', startMs: 4_000, endMs: 6_000, text: 'This is a second line\nthat wraps.' },
      { id: '3', startMs: 7_000, endMs: 8_000, text: 'Fish & chips' },
    ]);
  });

  it('skips malformed blocks and reports them', () => {
    const broken = [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      'Valid.',
      '',
      '2',
      'not a timing line',
      'Orphan text',
      '',
      '3',
      '00:00:05,000 --> 00:00:04,000',
      'End before start.',
      '',
      '4',
      '00:00:06,000 --> 00:00:07,000',
      '',
    ].join('\n');

    const result = parseSubtitles(broken);
    expect(result.cues).toHaveLength(1);
    expect(result.skippedBlocks).toBe(3);
  });

  it('sorts cues by start time and re-numbers them', () => {
    const unordered = ['2', '00:00:05,000 --> 00:00:06,000', 'Later', '', '1', '00:00:01,000 --> 00:00:02,000', 'Earlier'].join(
      '\n',
    );
    const { cues } = parseSubtitles(unordered);
    expect(cues.map((cue) => [cue.id, cue.text])).toEqual([
      ['1', 'Earlier'],
      ['2', 'Later'],
    ]);
  });

  it('returns no cues for empty input', () => {
    expect(parseSubtitles('').cues).toEqual([]);
    expect(parseSubtitles('\n\n  \n').cues).toEqual([]);
  });
});

describe('parseSubtitles — WebVTT', () => {
  const vtt = [
    '﻿WEBVTT Kind: captions',
    '',
    'NOTE This is a comment',
    'spanning lines',
    '',
    'STYLE',
    '::cue { color: yellow }',
    '',
    'intro',
    '00:01.000 --> 00:04.000 align:start position:10%',
    '<v Speaker>Welcome back</v> to the <c.highlight>show</c>.',
    '',
    '00:00:05.250 --> 00:00:07.000',
    'Karaoke <00:00:05.500>timing <00:00:06.000>tags',
    '',
  ].join('\n');

  it('ignores header, NOTE and STYLE blocks, and strips voice/class/timestamp tags', () => {
    const result = parseSubtitles(vtt);
    expect(result.format).toBe('vtt');
    expect(result.skippedBlocks).toBe(0);
    expect(result.cues).toEqual([
      { id: '1', startMs: 1_000, endMs: 4_000, text: 'Welcome back to the show.' },
      { id: '2', startMs: 5_250, endMs: 7_000, text: 'Karaoke timing tags' },
    ]);
  });

  it('uses the format hint when there is no WEBVTT header', () => {
    const result = parseSubtitles('00:00:01.000 --> 00:00:02.000\nNo header', 'vtt');
    expect(result.format).toBe('vtt');
    expect(result.cues).toHaveLength(1);
  });
});

describe('findActiveCueIndex', () => {
  const cues = [
    { id: '1', startMs: 1_000, endMs: 2_000, text: 'a' },
    { id: '2', startMs: 2_000, endMs: 4_000, text: 'b' },
    { id: '3', startMs: 6_000, endMs: 7_000, text: 'c' },
  ];

  it.each([
    [0, -1],
    [999, -1],
    [1_000, 0],
    [1_999, 0],
    [2_000, 1],
    [3_999, 1],
    [4_000, -1],
    [5_000, -1],
    [6_500, 2],
    [7_000, -1],
    [100_000, -1],
  ])('at %ims returns %i', (time, expected) => {
    expect(findActiveCueIndex(cues, time)).toBe(expected);
  });

  it('handles an empty list', () => {
    expect(findActiveCueIndex([], 1_000)).toBe(-1);
  });
});
