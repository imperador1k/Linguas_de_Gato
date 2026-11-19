import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { TranscriptionResult } from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { IndexedDbListeningRepository } from '../storage/indexed-db-listening-repository';
import { MemoryListeningRepository } from '../storage/memory-listening-repository';
import { NoSpeechError, createTranscribedSession, describeTranscriptSource, transcriptFromResult } from './transcribed-session';

const accepted = {
  format: { extension: 'mp3', label: 'MP3', kind: 'audio', mimeTypes: ['audio/mpeg'], playable: true, transcribable: true },
  kind: 'audio',
} as const;

const file = new File(['fake-audio-bytes'], 'lecture.mp3', { type: 'audio/mpeg', lastModified: 7 });

const result: TranscriptionResult = {
  provider: 'groq',
  model: 'whisper-large-v3-turbo',
  requestedLanguage: 'en',
  detectedLanguage: 'English',
  durationSeconds: 6.5,
  text: 'I arrived late. The meeting had already started.',
  segments: [
    { id: '1', startMs: 0, endMs: 6000, text: 'I arrived late. The meeting had already started.', avgLogprob: -0.2, noSpeechProb: 0.01 },
  ],
  words: [
    { text: 'I', startMs: 100, endMs: 300 },
    { text: 'arrived', startMs: 300, endMs: 800 },
    { text: 'late.', startMs: 800, endMs: 1300 },
    { text: 'The', startMs: 2000, endMs: 2200 },
    { text: 'meeting', startMs: 2200, endMs: 2700 },
    { text: 'had', startMs: 2700, endMs: 2900 },
    { text: 'already', startMs: 2900, endMs: 3400 },
    { text: 'started.', startMs: 3400, endMs: 4100 },
  ],
};

describe('transcriptFromResult', () => {
  it('builds sentence cues and a summary that records how the transcript was made', () => {
    const { summary, content } = transcriptFromResult(result, 'lecture.mp3', 1234);
    expect(content.cues).toEqual([
      { id: '1', startMs: 100, endMs: 1300, text: 'I arrived late.' },
      { id: '2', startMs: 2000, endMs: 4100, text: 'The meeting had already started.' },
    ]);
    expect(content.words).toHaveLength(8);
    expect(content.segments).toHaveLength(1);
    expect(summary).toEqual({
      fileName: 'lecture.mp3',
      format: 'whisper',
      cueCount: 2,
      skippedBlocks: 0,
      generated: {
        provider: 'groq',
        model: 'whisper-large-v3-turbo',
        requestedLanguage: 'en',
        detectedLanguage: 'English',
        createdAt: 1234,
      },
    });
    expect(describeTranscriptSource(summary)).toBe('Automatic transcript (fast, English)');
  });

  it('refuses a transcription without speech', () => {
    expect(() => transcriptFromResult({ ...result, text: '  ', segments: [], words: [] }, 'x.mp3', 1)).toThrow(NoSpeechError);
  });
});

describe('createTranscribedSession', () => {
  it('creates a persistent session with its transcript that survives a reload', async () => {
    const factory = new IDBFactory();
    const first = await IndexedDbListeningRepository.open(factory);
    const session = await createTranscribedSession(first, file, accepted, result, 5000);
    first.close();

    // A fresh connection is what a page reload sees.
    const reopened = await IndexedDbListeningRepository.open(factory);
    const stored = await reopened.getSession(session.id);
    expect(stored).toMatchObject({
      title: 'lecture.mp3',
      durationSeconds: 6.5,
      source: { kind: 'file', fileName: 'lecture.mp3', mediaStored: false },
      transcript: { format: 'whisper', cueCount: 2, generated: { model: 'whisper-large-v3-turbo' } },
    });
    const transcript = await reopened.getTranscript(session.id);
    expect(transcript?.cues.map((cue) => cue.text)).toEqual(['I arrived late.', 'The meeting had already started.']);
    expect(transcript?.words?.[1]).toEqual({ text: 'arrived', startMs: 300, endMs: 800 });
    expect(transcript?.segments?.[0]?.avgLogprob).toBe(-0.2);
    // The media is never copied by default (M1 rule).
    expect(await reopened.getMedia(session.id)).toBeNull();
    reopened.close();
  });

  it('creates nothing when there is no speech', async () => {
    const repository = new MemoryListeningRepository();
    await expect(createTranscribedSession(repository, file, accepted, { ...result, text: '', segments: [], words: [] })).rejects.toThrow(
      NoSpeechError,
    );
    expect(await repository.listSessions()).toEqual([]);
  });

  it('works with a transcript that has segments but no word timestamps', async () => {
    const repository = new MemoryListeningRepository();
    const session = await createTranscribedSession(repository, file, accepted, { ...result, words: [] });
    const transcript = await repository.getTranscript(session.id);
    expect(transcript?.cues).toEqual([{ id: '1', startMs: 0, endMs: 6000, text: result.text }]);
    expect(transcript?.words).toEqual([]);
  });
});
