import {
  WRITING_LIMITS,
  modelWritingCorrectionSchema,
  type ModelWritingCorrection,
  type WritingCorrection,
} from '../contracts/writing.js';

/**
 * Evidence verification for AI writing feedback. A correction is shown only
 * if its `original` occurs in the submitted text, it really changes
 * something, and it doesn't overlap a correction already kept. Offsets come
 * from the text itself, so annotations always point at what the learner
 * wrote.
 */

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '‚': "'", '‛': "'", '“': '"', '”': '"', '„': '"', '′': "'" };

interface NormalizedText {
  readonly text: string;
  /** For each character of `text`, its index in the original. */
  readonly map: number[];
}

/** Collapses whitespace runs and unifies quote styles, remembering where each character came from. */
function normalizeWithMap(source: string): NormalizedText {
  let text = '';
  const map: number[] = [];
  let pendingSpace = -1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] as string;
    if (/\s/.test(char)) {
      if (text.length > 0 && pendingSpace === -1) pendingSpace = index;
      continue;
    }
    if (pendingSpace !== -1) {
      text += ' ';
      map.push(pendingSpace);
      pendingSpace = -1;
    }
    text += QUOTES[char] ?? char;
    map.push(index);
  }
  return { text, map };
}

const normalizeForComparison = (value: string) => normalizeWithMap(value).text;

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

const overlaps = (a: TextRange, b: TextRange) => a.start < b.end && b.start < a.end;

/** Every place `quote` occurs in `text` (whitespace- and quote-style-insensitive), as original offsets. */
export function findQuoteRanges(quote: string, text: string): TextRange[] {
  const haystack = normalizeWithMap(text);
  const needle = normalizeForComparison(quote);
  if (needle.length === 0) return [];
  const ranges: TextRange[] = [];
  let from = 0;
  for (;;) {
    const found = haystack.text.indexOf(needle, from);
    if (found === -1) break;
    const start = haystack.map[found] as number;
    const end = (haystack.map[found + needle.length - 1] as number) + 1;
    ranges.push({ start, end });
    from = found + 1;
  }
  return ranges;
}

export interface WritingCorrectionVerification {
  readonly corrections: WritingCorrection[];
  readonly discarded: number;
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * - Unparseable items, quotes not in the text and "corrections" that change
 *   nothing (or only spacing) are discarded.
 * - Overlapping corrections: the first one (the model lists the most
 *   important first) wins; the rest are discarded.
 * - A stylistic `suggestion` can't be a high learning priority: priorities
 *   above medium are lowered, because the original was acceptable.
 * - Kept corrections are numbered in reading order.
 */
export function verifyWritingCorrections(raw: readonly unknown[], text: string, max: number = WRITING_LIMITS.maxCorrections): WritingCorrectionVerification {
  const kept: Array<ModelWritingCorrection & TextRange> = [];
  let discarded = 0;

  for (const item of raw) {
    const parsed = modelWritingCorrectionSchema.safeParse(item);
    if (!parsed.success) {
      discarded += 1;
      continue;
    }
    const correction = parsed.data;
    if (normalizeForComparison(correction.original) === normalizeForComparison(correction.correction)) {
      discarded += 1;
      continue;
    }
    const range = findQuoteRanges(correction.original, text).find((candidate) => !kept.some((existing) => overlaps(existing, candidate)));
    if (!range || kept.length >= max) {
      discarded += 1;
      continue;
    }
    const priority = correction.kind === 'suggestion' && correction.priority === 'high' ? 'medium' : correction.priority;
    kept.push({ ...correction, priority, ...range });
  }

  const corrections = kept
    .sort((a, b) => a.start - b.start)
    .map((correction, index) => ({ ...correction, id: `c${index + 1}` }));
  return { corrections, discarded };
}

export interface AnnotatedPiece {
  readonly text: string;
  readonly correctionId: string | null;
}

/** The submitted text split into plain pieces and corrected spans, for inline annotation. */
export function annotateText(text: string, corrections: readonly Pick<WritingCorrection, 'id' | 'start' | 'end'>[]): AnnotatedPiece[] {
  const pieces: AnnotatedPiece[] = [];
  let cursor = 0;
  for (const correction of [...corrections].sort((a, b) => a.start - b.start)) {
    if (correction.start < cursor || correction.end > text.length) continue;
    if (correction.start > cursor) pieces.push({ text: text.slice(cursor, correction.start), correctionId: null });
    pieces.push({ text: text.slice(correction.start, correction.end), correctionId: correction.id });
    cursor = correction.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), correctionId: null });
  return pieces;
}

/** The learner's text with every verified correction applied (errors only, or all), for comparison. */
export function applyCorrections(text: string, corrections: readonly WritingCorrection[], include: 'errors' | 'all'): string {
  let result = '';
  let cursor = 0;
  for (const correction of [...corrections].sort((a, b) => a.start - b.start)) {
    if (include === 'errors' && correction.kind !== 'error') continue;
    if (correction.start < cursor) continue;
    result += text.slice(cursor, correction.start) + correction.correction;
    cursor = correction.end;
  }
  return result + text.slice(cursor);
}

export function sortByPriority<T extends Pick<WritingCorrection, 'priority' | 'start'>>(corrections: readonly T[]): T[] {
  return [...corrections].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.start - b.start);
}
