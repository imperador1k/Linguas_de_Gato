import { tokenizeForComparison } from './text-compare.js';

/**
 * Locates quoted words in a segmented transcript. Shared by every feature
 * that must ground AI output in what was actually said (speaking feedback,
 * listening exercises): a quote counts only if it occurs as a contiguous run
 * of words, compared after the dictation normalisation (case, punctuation and
 * apostrophe style don't matter).
 */

export interface EvidenceSegment {
  readonly id: string;
  readonly startMs: number;
  /** Optional: when present, spans report where the quote ends in time. */
  readonly endMs?: number;
  readonly text: string;
}

export interface QuoteLocation {
  readonly segmentId: string;
  readonly startMs: number;
}

export interface QuoteSpan extends QuoteLocation {
  /** Every segment the quote touches, in order (a quote may cross a boundary). */
  readonly segmentIds: readonly string[];
  /** End of the last touched segment, when segments carry an end time. */
  readonly endMs: number | null;
}

export interface FlatToken {
  readonly normalized: string;
  readonly segmentIndex: number;
}

export function flattenTranscript(segments: readonly EvidenceSegment[]): FlatToken[] {
  const tokens: FlatToken[] = [];
  segments.forEach((segment, segmentIndex) => {
    for (const token of tokenizeForComparison(segment.text, { ignoreBracketed: false })) {
      tokens.push({ normalized: token.normalized, segmentIndex });
    }
  });
  return tokens;
}

/**
 * Finds `quote` in the transcript. When it occurs more than once, a match
 * starting in `preferredSegmentId` wins, so the model's own pointer is
 * honoured when it is right. Null when the words were never said.
 */
export function locateQuoteSpan(
  quote: string,
  segments: readonly EvidenceSegment[],
  preferredSegmentId?: string,
  flat: readonly FlatToken[] = flattenTranscript(segments),
): QuoteSpan | null {
  const needle = tokenizeForComparison(quote, { ignoreBracketed: false }).map((token) => token.normalized);
  if (needle.length === 0) return null;

  let fallback: number | null = null;
  let chosen: number | null = null;
  for (let start = 0; start + needle.length <= flat.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (flat[start + offset]?.normalized !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (segments[(flat[start] as FlatToken).segmentIndex]?.id === preferredSegmentId) {
      chosen = start;
      break;
    }
    fallback ??= start;
  }

  const start = chosen ?? fallback;
  if (start === null) return null;
  const firstIndex = (flat[start] as FlatToken).segmentIndex;
  const lastIndex = (flat[start + needle.length - 1] as FlatToken).segmentIndex;
  const touched = segments.slice(firstIndex, lastIndex + 1);
  const first = touched[0] as EvidenceSegment;
  const last = touched[touched.length - 1] as EvidenceSegment;
  return {
    segmentId: first.id,
    startMs: first.startMs,
    segmentIds: touched.map((segment) => segment.id),
    endMs: last.endMs ?? null,
  };
}

/** Where a quote starts, or null. */
export function locateQuote(
  quote: string,
  segments: readonly EvidenceSegment[],
  preferredSegmentId?: string,
  flat?: readonly FlatToken[],
): QuoteLocation | null {
  const span = locateQuoteSpan(quote, segments, preferredSegmentId, flat);
  return span ? { segmentId: span.segmentId, startMs: span.startMs } : null;
}
