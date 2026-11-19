import type { TimedWord, TranscriptSegment } from '../contracts/transcription.js';
import type { SubtitleCue } from './subtitles.js';
import { tokenizeForComparison, type ComparisonToken } from './text-compare.js';

/**
 * Turns an automatic transcription into dictation-sized cues.
 *
 * Whisper segments are acoustic chunks (up to ~30 s) that often break
 * mid-sentence, which makes poor dictation lines. When word timestamps are
 * available we re-cut the full text into sentences (splitting overly long
 * ones), and time each sentence from the words it contains. Without word
 * timestamps the segments are used as they are; we never invent timing.
 *
 * Word timestamps are aligned to the text with a greedy, linear-time matcher
 * (small look-ahead), because both come from the same model output and are
 * almost always in the same order. The O(n·m) dictation aligner would be far
 * too heavy for an hour of speech.
 */

export const DEFAULT_MAX_WORDS_PER_CUE = 28;

export interface TranscriptCueInput {
  /** Full transcript text; used only when there are no segments. */
  readonly text?: string;
  readonly segments: readonly TranscriptSegment[];
  readonly words: readonly TimedWord[];
  /** Media duration, used to time a text-only transcript. */
  readonly durationMs?: number | null;
}

const LOOK_AHEAD = 6;
/** Words after which a period rarely ends a sentence. */
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'mt', 'fig', 'approx']);
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
const CLAUSE_BREAK = /^[,;:—–]/;

interface TimedToken extends ComparisonToken {
  startMs: number | null;
  endMs: number | null;
}

function numberCues(cues: Array<Omit<SubtitleCue, 'id'>>): SubtitleCue[] {
  return cues.map((cue, index) => ({ id: String(index + 1), ...cue }));
}

function segmentCues(segments: readonly TranscriptSegment[]): SubtitleCue[] {
  return numberCues(
    segments
      .map((segment) => ({ startMs: segment.startMs, endMs: Math.max(segment.endMs, segment.startMs), text: segment.text.trim() }))
      .filter((cue) => cue.text !== ''),
  );
}

/** Greedy in-order alignment of word timestamps onto text tokens. Unmatched tokens stay untimed. */
function alignWords(tokens: TimedToken[], words: readonly TimedWord[]): void {
  const wordTokens: Array<{ normalized: string; startMs: number; endMs: number }> = [];
  for (const word of words) {
    // One provider "word" can hold several of our tokens (e.g. "well-known").
    for (const token of tokenizeForComparison(word.text, { ignoreBracketed: false })) {
      wordTokens.push({ normalized: token.normalized, startMs: word.startMs, endMs: word.endMs });
    }
  }

  let i = 0;
  let j = 0;
  while (i < tokens.length && j < wordTokens.length) {
    const token = tokens[i] as TimedToken;
    const word = wordTokens[j] as (typeof wordTokens)[number];
    if (token.normalized !== word.normalized) {
      let skipWords = 0;
      let skipTokens = 0;
      for (let k = 1; k <= LOOK_AHEAD && j + k < wordTokens.length; k += 1) {
        if (wordTokens[j + k]?.normalized === token.normalized) {
          skipWords = k;
          break;
        }
      }
      for (let k = 1; k <= LOOK_AHEAD && i + k < tokens.length; k += 1) {
        if (tokens[i + k]?.normalized === word.normalized) {
          skipTokens = k;
          break;
        }
      }
      if (skipWords > 0 && (skipTokens === 0 || skipWords <= skipTokens)) {
        j += skipWords; // Extra words the text doesn't contain (fillers, hallucinations).
        continue;
      }
      if (skipTokens > 0) {
        i += skipTokens; // Text the words don't cover; those tokens stay untimed.
        continue;
      }
      // Neither side resyncs nearby: treat as the same word spelled differently.
    }
    token.startMs = word.startMs;
    token.endMs = word.endMs;
    i += 1;
    j += 1;
  }
}

/** Offsets in `text` where a sentence ends (exclusive), skipping abbreviations and initials. */
function sentenceEnds(text: string, tokens: readonly TimedToken[]): number[] {
  const byEnd = new Map(tokens.map((token) => [token.end, token]));
  const ends: number[] = [];
  for (const match of text.matchAll(SENTENCE_END)) {
    const before = byEnd.get(match.index);
    if (match[0].startsWith('.') && before) {
      const isInitialism = before.text.includes('.') || before.normalized.length === 1;
      if (isInitialism || ABBREVIATIONS.has(before.normalized)) continue;
    }
    ends.push(match.index + match[0].length);
  }
  return ends;
}

/** Splits [from, to) token ranges longer than `maxWords`, preferring clause breaks. */
function splitLong(text: string, tokens: readonly TimedToken[], from: number, to: number, maxWords: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = from;
  while (to - start > maxWords) {
    let cut = start + maxWords;
    // Latest clause break that keeps both sides reasonably long.
    for (let index = start + maxWords - 1; index >= start + Math.ceil(maxWords / 3); index -= 1) {
      const token = tokens[index] as TimedToken;
      if (CLAUSE_BREAK.test(text.slice(token.end))) {
        cut = index + 1;
        break;
      }
    }
    ranges.push([start, cut]);
    start = cut;
  }
  ranges.push([start, to]);
  return ranges;
}

function expandLeft(text: string, offset: number): number {
  let index = offset;
  while (index > 0 && !/\s/.test(text[index - 1] ?? ' ')) index -= 1;
  return index;
}

function expandRight(text: string, offset: number): number {
  let index = offset;
  while (index < text.length && !/\s/.test(text[index] ?? ' ')) index += 1;
  return index;
}

export function buildTranscriptCues(
  input: TranscriptCueInput,
  options: { maxWordsPerCue?: number } = {},
): SubtitleCue[] {
  const maxWords = Math.max(4, options.maxWordsPerCue ?? DEFAULT_MAX_WORDS_PER_CUE);
  const { segments, words } = input;

  const text =
    segments.length > 0
      ? segments
          .map((segment) => segment.text.trim())
          .filter(Boolean)
          .join(' ')
      : (input.text ?? '').trim();
  if (text === '') return [];

  if (words.length === 0) {
    if (segments.length > 0) return segmentCues(segments);
    return [{ id: '1', startMs: 0, endMs: Math.max(0, Math.round(input.durationMs ?? 0)), text }];
  }

  const tokens: TimedToken[] = tokenizeForComparison(text, { ignoreBracketed: false }).map((token) => ({
    ...token,
    startMs: null,
    endMs: null,
  }));
  if (tokens.length === 0) return segmentCues(segments);
  alignWords(tokens, words);

  // Token ranges per sentence, then per cue.
  const ranges: Array<[number, number]> = [];
  let sentenceStart = 0;
  let tokenIndex = 0;
  for (const end of [...sentenceEnds(text, tokens), Number.POSITIVE_INFINITY]) {
    while (tokenIndex < tokens.length && (tokens[tokenIndex] as TimedToken).start < end) tokenIndex += 1;
    if (tokenIndex > sentenceStart) {
      ranges.push(...splitLong(text, tokens, sentenceStart, tokenIndex, maxWords));
      sentenceStart = tokenIndex;
    }
  }

  const cues: Array<Omit<SubtitleCue, 'id'>> = [];
  ranges.forEach(([from, to], rangeIndex) => {
    const first = tokens[from] as TimedToken;
    const last = tokens[to - 1] as TimedToken;
    const nextFirst = tokens[to];
    const textStart = expandLeft(text, first.start);
    const textEnd = nextFirst ? Math.min(expandRight(text, last.end), expandLeft(text, nextFirst.start)) : text.length;

    let startMs: number | null = null;
    let endMs: number | null = null;
    for (let index = from; index < to; index += 1) {
      const token = tokens[index] as TimedToken;
      if (token.startMs !== null) startMs = startMs === null ? token.startMs : Math.min(startMs, token.startMs);
      if (token.endMs !== null) endMs = endMs === null ? token.endMs : Math.max(endMs, token.endMs);
    }

    const previousEnd = cues[rangeIndex - 1]?.endMs ?? 0;
    if (startMs === null || endMs === null) {
      // No timed words: span the gap up to the next timed word.
      let nextTimed: number | null = null;
      for (let index = to; index < tokens.length && nextTimed === null; index += 1) nextTimed = tokens[index]?.startMs ?? null;
      startMs = previousEnd;
      endMs = Math.max(previousEnd, nextTimed ?? previousEnd);
    }
    // Keep cues ordered even if the provider's word timings wobble.
    const previousStart = cues[rangeIndex - 1]?.startMs ?? 0;
    startMs = Math.max(startMs, previousStart);
    cues.push({ startMs, endMs: Math.max(endMs, startMs), text: text.slice(textStart, textEnd).trim() });
  });

  return numberCues(cues.filter((cue) => cue.text !== ''));
}
