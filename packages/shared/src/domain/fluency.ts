import type { FluencyMetrics, PauseEvent } from '../contracts/speaking.js';
import type { TimedWord } from '../contracts/transcription.js';
import { tokenizeForComparison } from './text-compare.js';

/**
 * Deterministic fluency indicators from transcript timing. These are
 * measurements, not judgements, and they have known limits:
 * - Whisper often omits hesitations ("um", "uh"), so filler counts are a floor.
 * - Word timestamps are estimates; a "pause" can include a very slow word.
 * - Nothing here says anything about pronunciation, accent or intonation.
 */

export const PAUSE_THRESHOLD_MS = 1_000;
export const LONG_PAUSE_THRESHOLD_MS = 2_500;
/** Below this much timed speech, words per minute is too noisy to report. */
export const MIN_SPEECH_FOR_RATE_MS = 5_000;

/** Single-word hesitation markers. "like" is excluded: it's usually a real word. */
const FILLER_WORDS = new Set(['um', 'uh', 'er', 'erm', 'uhm', 'ah', 'hmm', 'mm', 'mhm']);
/** Discourse markers that are often, but not always, fillers. */
const FILLER_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ['you', 'know'],
  ['i', 'mean'],
];

export interface FluencyInput {
  readonly words: readonly TimedWord[];
  readonly segments: readonly { readonly startMs: number; readonly endMs: number; readonly text: string }[];
  /** The confirmed (learner-reviewed) transcript. */
  readonly transcript: string;
  readonly recordingDurationMs: number;
}

interface Span {
  readonly startMs: number;
  readonly endMs: number;
}

function gapsBetween(spans: readonly Span[]): PauseEvent[] {
  const gaps: PauseEvent[] = [];
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1] as Span;
    const current = spans[index] as Span;
    const durationMs = current.startMs - previous.endMs;
    if (durationMs >= PAUSE_THRESHOLD_MS) gaps.push({ startMs: previous.endMs, endMs: current.startMs, durationMs });
  }
  return gaps;
}

type Token = { readonly normalized: string; readonly text: string };

function countRepetitions(tokens: readonly Token[]): { count: number; examples: string[] } {
  const examples: string[] = [];
  let count = 0;
  const record = (example: string) => {
    count += 1;
    if (examples.length < 5) examples.push(example);
  };
  for (let index = 1; index < tokens.length; index += 1) {
    const current = tokens[index] as Token;
    const previous = tokens[index - 1] as Token;
    // Immediate word repetition: "I I think", "the the".
    if (current.normalized === previous.normalized) {
      record(`${previous.text} ${current.text}`);
      continue;
    }
    // Repeated two-word chunk, counted at its second occurrence: "I think I think".
    const chunkFirst = tokens[index - 3];
    const chunkSecond = tokens[index - 2];
    if (chunkFirst && chunkSecond && chunkFirst.normalized === previous.normalized && chunkSecond.normalized === current.normalized) {
      record(`${chunkFirst.text} ${chunkSecond.text} ${previous.text} ${current.text}`);
    }
  }
  return { count, examples };
}

function countFillers(tokens: readonly { normalized: string }[]): FluencyMetrics['fillers'] {
  const counts = new Map<string, number>();
  const add = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = (tokens[index] as { normalized: string }).normalized;
    if (FILLER_WORDS.has(token)) {
      add(token);
      continue;
    }
    for (const [first, second] of FILLER_PHRASES) {
      if (token === first && tokens[index + 1]?.normalized === second) add(`${first} ${second}`);
    }
  }
  const items = [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, 12);
  return { count: items.reduce((sum, item) => sum + item.count, 0), items };
}

export function computeFluencyMetrics(input: FluencyInput): FluencyMetrics {
  const tokens = tokenizeForComparison(input.transcript, { ignoreBracketed: false });

  // Timing comes from words when available (finer), otherwise from segments.
  const words = input.words.filter((word) => word.endMs >= word.startMs);
  const segments = input.segments.filter((segment) => segment.text.trim() !== '' && segment.endMs >= segment.startMs);
  const timingSource: FluencyMetrics['timingSource'] = words.length >= 2 ? 'words' : segments.length > 0 ? 'segments' : 'none';
  const spans: readonly Span[] = timingSource === 'words' ? words : timingSource === 'segments' ? segments : [];

  const first = spans[0];
  const last = spans[spans.length - 1];
  const speakingTimeMs = first && last ? Math.max(0, last.endMs - first.startMs) : 0;

  const gaps = gapsBetween(spans);
  const longest = [...gaps].sort((a, b) => b.durationMs - a.durationMs || a.startMs - b.startMs).slice(0, 5);

  return {
    wordCount: tokens.length,
    speakingTimeMs,
    recordingDurationMs: Math.max(0, Math.round(input.recordingDurationMs)),
    wordsPerMinute:
      speakingTimeMs >= MIN_SPEECH_FOR_RATE_MS && tokens.length > 0
        ? Math.round((tokens.length / (speakingTimeMs / 60_000)) * 10) / 10
        : null,
    timingSource,
    pauses: {
      thresholdMs: PAUSE_THRESHOLD_MS,
      longThresholdMs: LONG_PAUSE_THRESHOLD_MS,
      count: gaps.length,
      longCount: gaps.filter((gap) => gap.durationMs >= LONG_PAUSE_THRESHOLD_MS).length,
      totalMs: gaps.reduce((sum, gap) => sum + gap.durationMs, 0),
      longestMs: longest[0]?.durationMs ?? 0,
      longest: longest.sort((a, b) => a.startMs - b.startMs),
    },
    repetitions: countRepetitions(tokens),
    fillers: countFillers(tokens),
  };
}
