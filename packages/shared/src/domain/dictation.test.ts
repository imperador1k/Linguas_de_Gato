import { describe, expect, it } from 'vitest';
import type { DictationAttempt, DictationRecord } from '../contracts/listening-records.js';
import { listeningSessionSchema } from '../contracts/listening-records.js';
import {
  MAX_ATTEMPTS_PER_LINE,
  appendDictationAttempt,
  formatAccuracy,
  summarizeDictation,
  summarizeLine,
} from './dictation.js';

const attempt = (accuracy: number, submittedAt = 1): DictationAttempt => ({
  submittedAt,
  answer: 'x',
  wordErrorRate: 1 - accuracy,
  accuracy,
  referenceWords: 3,
});

const base = { sessionId: 's1', cueId: '1', referenceText: 'one two three' };

describe('appendDictationAttempt', () => {
  it('creates a record for the first attempt', () => {
    const record = appendDictationAttempt(undefined, { ...base, attempt: attempt(0.5, 10) });
    expect(record).toEqual({ ...base, attempts: [attempt(0.5, 10)], updatedAt: 10 });
  });

  it('appends to the history of the same reference', () => {
    const first = appendDictationAttempt(undefined, { ...base, attempt: attempt(0.5) });
    const second = appendDictationAttempt(first, { ...base, attempt: attempt(1, 2) });
    expect(second.attempts.map((item) => item.accuracy)).toEqual([0.5, 1]);
  });

  it('resets history when the reference text changed', () => {
    const first = appendDictationAttempt(undefined, { ...base, attempt: attempt(0.5) });
    const second = appendDictationAttempt(first, { ...base, referenceText: 'new text', attempt: attempt(1, 2) });
    expect(second.attempts).toHaveLength(1);
  });

  it('keeps only the most recent attempts', () => {
    let record: DictationRecord | undefined;
    for (let index = 0; index < MAX_ATTEMPTS_PER_LINE + 5; index += 1) {
      record = appendDictationAttempt(record, { ...base, attempt: attempt(0.1, index) });
    }
    expect(record?.attempts).toHaveLength(MAX_ATTEMPTS_PER_LINE);
    expect(record?.attempts[0]?.submittedAt).toBe(5);
  });
});

describe('summarizeLine and summarizeDictation', () => {
  const cues = [
    { id: '1', text: 'one two three' },
    { id: '2', text: 'four five' },
    { id: '3', text: 'six' },
  ];
  const records: DictationRecord[] = [
    { ...base, attempts: [attempt(0.4), attempt(0.9), attempt(0.6)], updatedAt: 1 },
    { sessionId: 's1', cueId: '2', referenceText: 'stale text', attempts: [attempt(1)], updatedAt: 1 },
  ];

  it('summarises a line with its latest and best accuracy', () => {
    expect(summarizeLine(records[0], 'one two three')).toEqual({ attempts: 3, latestAccuracy: 0.6, bestAccuracy: 0.9 });
    expect(summarizeLine(undefined, 'x')).toBeNull();
  });

  it('ignores stale records and averages latest accuracies', () => {
    expect(summarizeDictation(cues, records)).toEqual({ practisedLines: 1, totalLines: 3, averageLatestAccuracy: 0.6 });
  });

  it('reports null average when nothing has been practised', () => {
    expect(summarizeDictation(cues, []).averageLatestAccuracy).toBeNull();
  });
});

describe('formatAccuracy', () => {
  it('rounds and clamps', () => {
    expect(formatAccuracy(0.876)).toBe('88%');
    expect(formatAccuracy(1.2)).toBe('100%');
    expect(formatAccuracy(-1)).toBe('0%');
  });
});

describe('listeningSessionSchema', () => {
  const valid = {
    id: 'abc',
    version: 1,
    language: 'en',
    title: 'Podcast',
    source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
    transcript: null,
    playback: { positionSeconds: 0, playbackRate: 1 },
    loop: null,
    durationSeconds: null,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
  };

  it('accepts a valid session', () => {
    expect(listeningSessionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects corrupt records', () => {
    expect(listeningSessionSchema.safeParse({ ...valid, version: 99 }).success).toBe(false);
    expect(listeningSessionSchema.safeParse({ ...valid, source: { kind: 'youtube', videoId: 'bad' } }).success).toBe(false);
    expect(listeningSessionSchema.safeParse({ ...valid, playback: { positionSeconds: -1, playbackRate: 1 } }).success).toBe(
      false,
    );
  });
});
