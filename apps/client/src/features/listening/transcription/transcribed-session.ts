import {
  buildTranscriptCues,
  type AcceptedMediaFile,
  type ListeningSession,
  type TranscriptionResult,
  type TranscriptSummary,
} from '@ldg/shared';
import type { ListeningRepository, TranscriptContent } from '../storage/listening-repository';
import { newFileSession } from '../storage/listening-storage';

/** The provider returned no usable speech; nothing is created. */
export class NoSpeechError extends Error {
  override readonly name = 'NoSpeechError';

  constructor() {
    super('No speech was found in this recording, so there is nothing to practise with.');
  }
}

export interface TranscriptFromResult {
  readonly summary: TranscriptSummary;
  readonly content: TranscriptContent;
}

/**
 * Converts a transcription into the M1 transcript shapes: dictation-sized cues
 * plus the provider's segment and word timings, kept for later features.
 */
export function transcriptFromResult(result: TranscriptionResult, mediaFileName: string, now: number): TranscriptFromResult {
  const cues = buildTranscriptCues({
    text: result.text,
    segments: result.segments,
    words: result.words,
    durationMs: result.durationSeconds === null ? null : result.durationSeconds * 1000,
  });
  if (cues.length === 0) throw new NoSpeechError();

  return {
    summary: {
      fileName: mediaFileName,
      format: 'whisper',
      cueCount: cues.length,
      skippedBlocks: 0,
      generated: {
        provider: result.provider,
        model: result.model,
        requestedLanguage: result.requestedLanguage,
        detectedLanguage: result.detectedLanguage,
        createdAt: now,
      },
    },
    content: { cues, segments: result.segments, words: result.words },
  };
}

/**
 * Creates a persistent session for a freshly transcribed file, transcript
 * included, in one storage transaction. The media itself follows the M1 rule:
 * it is not copied into the browser unless the learner opts in later.
 */
export async function createTranscribedSession(
  repository: ListeningRepository,
  file: File,
  accepted: AcceptedMediaFile,
  result: TranscriptionResult,
  now = Date.now(),
): Promise<ListeningSession> {
  const { summary, content } = transcriptFromResult(result, file.name, now);
  const session: ListeningSession = {
    ...newFileSession(file, accepted, now),
    transcript: summary,
    durationSeconds: result.durationSeconds,
  };
  await repository.createSession(session, content);
  return session;
}

/** Short learner-facing description of how a transcript was produced. */
export function describeTranscriptSource(summary: TranscriptSummary): string {
  if (summary.format !== 'whisper' || !summary.generated) return summary.fileName;
  const model = summary.generated.model === 'whisper-large-v3' ? 'higher accuracy' : 'fast';
  const language = summary.generated.detectedLanguage ?? (summary.generated.requestedLanguage === 'en' ? 'English' : null);
  return `Automatic transcript (${model}${language ? `, ${language}` : ''})`;
}
