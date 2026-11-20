import {
  DEFAULT_TARGET_LANGUAGE,
  SPEAKING_LIMITS,
  SPEAKING_RECORD_VERSION,
  computeFluencyMetrics,
  transcriptFromSegments,
  type AssessmentRequest,
  type ReviewedSegment,
  type SpeakingAttempt,
  type SpeakingMode,
  type SpeakingPrompt,
  type TargetDurationSeconds,
  type TranscriptionResult,
} from '@ldg/shared';

/**
 * Turns a transcription into reviewable segments. Each segment keeps its
 * timestamps when the learner corrects its text, so feedback can still point
 * at the right moment in the recording.
 */
export function segmentsForReview(result: TranscriptionResult, recordingDurationMs: number): ReviewedSegment[] {
  const clip = (text: string) => text.trim().slice(0, SPEAKING_LIMITS.maxSegmentChars);
  if (result.segments.length > 0) {
    return result.segments.slice(0, SPEAKING_LIMITS.maxSegments).map((segment) => ({
      id: segment.id,
      startMs: segment.startMs,
      endMs: segment.endMs,
      recognizedText: clip(segment.text),
      text: clip(segment.text),
    }));
  }
  const text = clip(result.text);
  return text ? [{ id: '1', startMs: 0, endMs: Math.max(0, Math.round(recordingDurationMs)), recognizedText: text, text }] : [];
}

export function editSegment(segments: readonly ReviewedSegment[], id: string, text: string): ReviewedSegment[] {
  return segments.map((segment) => (segment.id === id ? { ...segment, text: text.slice(0, SPEAKING_LIMITS.maxSegmentChars) } : segment));
}

export function restoreSegment(segments: readonly ReviewedSegment[], id: string): ReviewedSegment[] {
  return segments.map((segment) => (segment.id === id ? { ...segment, text: segment.recognizedText } : segment));
}

export function isEdited(segment: ReviewedSegment): boolean {
  return segment.text.trim() !== segment.recognizedText.trim();
}

export interface ReviewSummary {
  readonly words: number;
  readonly characters: number;
  readonly edited: number;
  /** Why the transcript can't be assessed yet, or null. */
  readonly problem: string | null;
}

export function summarizeReview(segments: readonly ReviewedSegment[]): ReviewSummary {
  const transcript = transcriptFromSegments(segments);
  const words = transcript ? transcript.split(/\s+/).length : 0;
  let problem: string | null = null;
  if (words < SPEAKING_LIMITS.minWords) {
    problem = `Feedback needs at least ${SPEAKING_LIMITS.minWords} words; this transcript has ${words}. Record a longer answer.`;
  } else if (transcript.length > SPEAKING_LIMITS.maxTranscriptChars) {
    problem = `The transcript is longer than ${SPEAKING_LIMITS.maxTranscriptChars.toLocaleString()} characters.`;
  }
  return { words, characters: transcript.length, edited: segments.filter(isEdited).length, problem };
}

export interface AttemptInput {
  readonly id: string;
  readonly prompt: SpeakingPrompt;
  readonly mode: SpeakingMode;
  readonly targetDurationSeconds: TargetDurationSeconds;
  readonly recordingDurationMs: number;
  readonly recordingType: string;
  readonly transcription: TranscriptionResult;
  readonly segments: readonly ReviewedSegment[];
  readonly now: number;
}

/** The attempt as saved once the learner confirms the transcript (before feedback). */
export function createAttempt(input: AttemptInput): SpeakingAttempt {
  const segments = input.segments.filter((segment) => segment.text.trim() !== '' || segment.recognizedText.trim() !== '');
  return {
    id: input.id,
    version: SPEAKING_RECORD_VERSION,
    language: DEFAULT_TARGET_LANGUAGE,
    prompt: input.prompt,
    mode: input.mode,
    targetDurationSeconds: input.targetDurationSeconds,
    recordingDurationMs: Math.round(input.recordingDurationMs),
    transcript: {
      segments,
      words: input.transcription.words,
      model: input.transcription.model,
      detectedLanguage: input.transcription.detectedLanguage,
    },
    // Timing comes from Whisper's acoustic timestamps; word counts and fillers from the confirmed text.
    fluency: computeFluencyMetrics({
      words: input.transcription.words,
      segments,
      transcript: transcriptFromSegments(segments),
      recordingDurationMs: input.recordingDurationMs,
    }),
    assessment: null,
    exerciseResponses: [],
    recording: { stored: false, mimeType: input.recordingType },
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function toAssessmentRequest(attempt: SpeakingAttempt): AssessmentRequest {
  return {
    prompt: attempt.prompt,
    mode: attempt.mode,
    targetDurationSeconds: attempt.targetDurationSeconds,
    recordingDurationMs: Math.min(attempt.recordingDurationMs, SPEAKING_LIMITS.maxRecordingMs),
    segments: attempt.transcript.segments
      .filter((segment) => segment.text.trim() !== '')
      .map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text: text.trim() })),
  };
}
