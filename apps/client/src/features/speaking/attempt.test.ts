import { assessmentRequestSchema, speakingAttemptSchema, type TranscriptionResult } from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { createAttempt, editSegment, isEdited, restoreSegment, segmentsForReview, summarizeReview, toAssessmentRequest } from './attempt';
import { PROMPT_LIBRARY, toSpeakingPrompt } from './prompt-library';

const result: TranscriptionResult = {
  provider: 'groq',
  model: 'whisper-large-v3-turbo',
  requestedLanguage: 'en',
  detectedLanguage: 'English',
  durationSeconds: 20,
  text: 'I prefer working from home because I can concentrate better. On the other hand I miss my colleagues sometimes and the coffee breaks we used to have together.',
  segments: [
    { id: '1', startMs: 0, endMs: 6000, text: 'I prefer working from home because I can concentrate better.', avgLogprob: -0.2, noSpeechProb: 0.01 },
    {
      id: '2',
      startMs: 8500,
      endMs: 16_000,
      text: 'On the other hand I miss my collics sometimes and the coffee breaks we used to have together.',
      avgLogprob: -0.4,
      noSpeechProb: 0.02,
    },
  ],
  words: [
    { text: 'I', startMs: 0, endMs: 300 },
    { text: 'prefer', startMs: 300, endMs: 800 },
    { text: 'better', startMs: 5500, endMs: 6000 },
    { text: 'On', startMs: 8500, endMs: 8700 },
    { text: 'together', startMs: 15_500, endMs: 16_000 },
  ],
};

describe('transcript review', () => {
  it('keeps segment timestamps and the recognised text alongside the editable text', () => {
    const segments = segmentsForReview(result, 20_000);
    expect(segments[1]).toEqual({
      id: '2',
      startMs: 8500,
      endMs: 16_000,
      recognizedText: result.segments[1]!.text,
      text: result.segments[1]!.text,
    });
  });

  it('falls back to one segment spanning the recording when there are no segments', () => {
    expect(segmentsForReview({ ...result, segments: [] }, 20_000)).toEqual([
      { id: '1', startMs: 0, endMs: 20_000, recognizedText: result.text, text: result.text },
    ]);
    expect(segmentsForReview({ ...result, segments: [], text: '' }, 20_000)).toEqual([]);
  });

  it('corrects a recognition error without moving the segment in time, and can restore it', () => {
    const segments = segmentsForReview(result, 20_000);
    const corrected = editSegment(segments, '2', segments[1]!.text.replace('collics', 'colleagues'));
    expect(corrected[1]).toMatchObject({ startMs: 8500, endMs: 16_000 });
    expect(isEdited(corrected[1]!)).toBe(true);
    expect(isEdited(corrected[0]!)).toBe(false);
    expect(summarizeReview(corrected).edited).toBe(1);
    expect(restoreSegment(corrected, '2')[1]?.text).toBe(result.segments[1]!.text);
  });

  it('flags transcripts too short for feedback', () => {
    const segments = editSegment(segmentsForReview(result, 20_000), '2', '');
    const summary = summarizeReview(editSegment(segments, '1', 'Just a few words.'));
    expect(summary.problem).toMatch(/at least 20 words/);
    expect(summarizeReview(segmentsForReview(result, 20_000)).problem).toBeNull();
  });
});

describe('createAttempt and toAssessmentRequest', () => {
  const prompt = toSpeakingPrompt(PROMPT_LIBRARY[2]!);

  it('saves the confirmed transcript, the acoustic word timings and deterministic fluency', () => {
    const segments = editSegment(segmentsForReview(result, 20_000), '2', 'On the other hand I miss my colleagues sometimes and the coffee breaks we used to have together.');
    const attempt = createAttempt({
      id: 'a1',
      prompt,
      mode: 'guided',
      targetDurationSeconds: 60,
      recordingDurationMs: 20_400.7,
      recordingType: 'audio/webm',
      transcription: result,
      segments,
      now: 1234,
    });

    expect(speakingAttemptSchema.safeParse(attempt).success).toBe(true);
    expect(attempt.transcript.words).toEqual(result.words);
    expect(attempt.recording).toEqual({ stored: false, mimeType: 'audio/webm' });
    expect(attempt.recordingDurationMs).toBe(20_401);
    expect(attempt.fluency.timingSource).toBe('words');
    expect(attempt.fluency.wordCount).toBe(28);
    // The fixture has only five timed words, so three gaps exceed 2.5 s, including "better" (6.0 s) → "On" (8.5 s).
    expect(attempt.fluency.pauses.longCount).toBe(3);
    expect(attempt.fluency.pauses.longest).toContainEqual({ startMs: 6000, endMs: 8500, durationMs: 2500 });

    const request = toAssessmentRequest(attempt);
    expect(assessmentRequestSchema.safeParse(request).success).toBe(true);
    expect(request.segments[1]?.text).toContain('colleagues');
    expect(request.segments[1]).not.toHaveProperty('recognizedText');
  });

  it('leaves out segments the learner emptied', () => {
    const segments = segmentsForReview(result, 20_000);
    const attempt = createAttempt({
      id: 'a2',
      prompt,
      mode: 'free',
      targetDurationSeconds: 30,
      recordingDurationMs: 20_000,
      recordingType: 'audio/webm',
      transcription: result,
      segments: editSegment(segments, '1', ''),
      now: 1,
    });
    expect(toAssessmentRequest(attempt).segments.map((segment) => segment.id)).toEqual(['2']);
  });
});
