import { describe, expect, it } from 'vitest';
import type { SpeakingAttempt } from '@ldg/shared';
import { StorageError } from '@/lib/storage/indexed-db';
import { getVolatileMedia } from '@/lib/volatile-media';
import { MemorySpeakingRepository } from './memory-speaking-repository';
import { forgetRecording, recallRecording, recordingIssueOf, saveAttemptWithRecording } from './speaking-storage';

function attempt(id: string): SpeakingAttempt {
  return {
    id,
    version: 1,
    language: 'en',
    prompt: { source: 'custom', promptId: null, title: 'My job interview', instructions: 'Describe your strengths.', points: [], category: 'work', level: null },
    mode: 'free',
    targetDurationSeconds: 60,
    recordingDurationMs: 30_000,
    transcript: { segments: [{ id: '1', startMs: 0, endMs: 5000, recognizedText: 'I am good.', text: 'I am good.' }], words: [], model: 'whisper-large-v3-turbo', detectedLanguage: 'English' },
    fluency: {
      wordCount: 3,
      speakingTimeMs: 5000,
      recordingDurationMs: 30_000,
      wordsPerMinute: 36,
      timingSource: 'segments',
      pauses: { thresholdMs: 1000, longThresholdMs: 2500, count: 0, longCount: 0, totalMs: 0, longestMs: 0, longest: [] },
      repetitions: { count: 0, examples: [] },
      fillers: { count: 0, items: [] },
    },
    assessment: null,
    exerciseResponses: [],
    recording: { stored: false, mimeType: 'audio/webm' },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('saveAttemptWithRecording', () => {
  it('keeps the recording with the attempt by default choice', async () => {
    const repository = new MemorySpeakingRepository();
    const blob = new Blob(['voice']);
    const saved = await saveAttemptWithRecording(repository, attempt('a'), blob, true);
    expect(saved).toMatchObject({ kept: true, issue: null, attempt: { recording: { stored: true } } });
    expect(await repository.getRecording('a')).toBe(blob);
    expect(getVolatileMedia().some((item) => item.key === 'speaking:a')).toBe(false);
    forgetRecording('a');
  });

  it('keeps an unsaved recording only in this tab, and warns before a reload loses it', async () => {
    const repository = new MemorySpeakingRepository();
    await saveAttemptWithRecording(repository, attempt('b'), new Blob(['voice']), false);
    expect(await repository.getRecording('b')).toBeNull();
    expect(recallRecording('b')).not.toBeNull();
    expect(getVolatileMedia()).toContainEqual({ key: 'speaking:b', kind: 'speaking', label: 'Recording: My job interview', path: '/speaking/attempts/b' });
    forgetRecording('b');
    expect(getVolatileMedia().some((item) => item.key === 'speaking:b')).toBe(false);
  });

  it('saves the transcript even when the recording does not fit', async () => {
    const repository = new MemorySpeakingRepository();
    const put = repository.putAttempt.bind(repository);
    repository.putAttempt = (value, recording) => (recording ? Promise.reject(new StorageError('quota')) : put(value));
    const saved = await saveAttemptWithRecording(repository, attempt('c'), new Blob(['voice']), true);
    expect(saved).toMatchObject({ kept: false, issue: 'quota' });
    expect((await repository.getAttempt('c'))?.transcript.segments).toHaveLength(1);
    expect(recordingIssueOf('c')).toBe('quota');
    forgetRecording('c');
  });
});
