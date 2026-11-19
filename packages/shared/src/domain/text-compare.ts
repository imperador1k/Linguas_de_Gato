/**
 * Word-level comparison of a learner's transcription against a reference,
 * used by dictation. Pure and deterministic.
 *
 * Normalisation rules (chosen for dictation, where only what is *heard* counts):
 * - Case, whitespace, line breaks and surrounding punctuation are ignored.
 * - Apostrophe variants (’ ʼ ‘ `) are unified. Contractions stay single words
 *   and are NOT expanded: "I'm" ≠ "I am", because the distinction is audible
 *   and meaningful for a learner.
 * - Hyphens, dashes and slashes separate words ("well-known" = "well known").
 * - Periods inside abbreviations are dropped ("U.S." = "US"); decimal points,
 *   clock times and thousands separators between digits are kept or unified.
 * - Bracketed sound descriptions ("[Music]", "(laughs)") and ♪ are ignored by
 *   default, because subtitles use them for non-speech.
 *
 * Not handled (documented limitations): number words vs digits ("twenty" vs
 * "20"), British vs American spelling, and homophones. Spelling-level
 * differences are flagged as near misses rather than forgiven.
 */

export interface ComparisonToken {
  /** The word exactly as written in the source text. */
  readonly text: string;
  /** The form used for matching. */
  readonly normalized: string;
  /** Offsets into the NFC-normalised source text. */
  readonly start: number;
  readonly end: number;
}

export interface TokenizeOptions {
  /** Skip "[…]", "(…)" and "♪" spans. Defaults to true. */
  readonly ignoreBracketed?: boolean;
}

export type AlignmentStep =
  | { readonly type: 'match' | 'substitution'; readonly referenceIndex: number; readonly hypothesisIndex: number }
  | { readonly type: 'deletion'; readonly referenceIndex: number }
  | { readonly type: 'insertion'; readonly hypothesisIndex: number };

export type ComparisonOp =
  | { readonly type: 'match'; readonly reference: ComparisonToken; readonly hypothesis: ComparisonToken }
  | {
      readonly type: 'substitution';
      readonly reference: ComparisonToken;
      readonly hypothesis: ComparisonToken;
      /** A spelling-level slip (e.g. "recieve" for "receive", "dont" for "don't"). */
      readonly nearMiss: boolean;
    }
  /** A reference word the learner missed. */
  | { readonly type: 'deletion'; readonly reference: ComparisonToken }
  /** A word the learner wrote that is not in the reference. */
  | { readonly type: 'insertion'; readonly hypothesis: ComparisonToken };

export interface ComparisonCounts {
  readonly matches: number;
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
  readonly referenceWords: number;
  readonly hypothesisWords: number;
}

export interface TextComparison {
  readonly reference: readonly ComparisonToken[];
  readonly hypothesis: readonly ComparisonToken[];
  readonly alignment: readonly ComparisonOp[];
  readonly counts: ComparisonCounts;
  /** (S + D + I) / N. Can exceed 1 when the answer has many extra words. */
  readonly wordErrorRate: number;
  /** max(0, 1 − WER), in [0, 1]. */
  readonly accuracy: number;
  readonly isExactMatch: boolean;
}

/** Guards the O(n·m) alignment against pathological input. */
export const MAX_COMPARISON_TOKENS = 5000;

const APOSTROPHE_CLASS = "['’ʼ‘`´]";
const APOSTROPHES = new RegExp(APOSTROPHE_CLASS, 'g');
const WORD_CHAR = '[\\p{L}\\p{N}\\p{M}]';
// A word is a run of letters/digits joined by internal apostrophes, periods
// before another word character (abbreviations, decimals), or commas/colons
// between digits (1,000 · 10:30). Hyphens are deliberately not connectors.
const WORD_PATTERN = new RegExp(
  WORD_CHAR + '+(?:(?:' + APOSTROPHE_CLASS + '|\\.(?=' + WORD_CHAR + ')|(?<=\\p{N})[,:](?=\\p{N}))' + WORD_CHAR + '+)*',
  'gu',
);
const BRACKETED = /\[[^\]\n]*\]|\([^)\n]*\)|♪/g;

export function normalizeWord(word: string): string {
  return word
    .normalize('NFC')
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .replace(/(?<!\p{N})\.|\.(?!\p{N})/gu, '')
    .replace(/(?<=\p{N}),(?=\p{N})/gu, '');
}

export function tokenizeForComparison(text: string, options: TokenizeOptions = {}): ComparisonToken[] {
  const source = text.normalize('NFC');
  // Blank out ignored spans with spaces of equal length so offsets stay valid.
  const scanned =
    options.ignoreBracketed === false ? source : source.replace(BRACKETED, (span) => ' '.repeat(span.length));

  const tokens: ComparisonToken[] = [];
  for (const match of scanned.matchAll(WORD_PATTERN)) {
    const start = match.index;
    const raw = match[0];
    const normalized = normalizeWord(raw);
    if (normalized === '') continue;
    tokens.push({ text: source.slice(start, start + raw.length), normalized, start, end: start + raw.length });
  }
  return tokens;
}

/** Character-level Levenshtein distance (two-row dynamic programming). */
export function wordDistance(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

function isNearMiss(reference: string, hypothesis: string): boolean {
  const length = Math.max(Array.from(reference).length, Array.from(hypothesis).length);
  if (length < 2) return false;
  const allowed = length <= 4 ? 1 : 2;
  return wordDistance(reference, hypothesis) <= allowed;
}

/**
 * Minimal word alignment (Levenshtein with unit costs) with a deterministic
 * backtrace. Ties prefer the diagonal (match/substitution), then deletion,
 * then insertion, which keeps substituted words paired in the output.
 */
export function alignSequences(reference: readonly string[], hypothesis: readonly string[]): AlignmentStep[] {
  const n = reference.length;
  const m = hypothesis.length;
  if (n > MAX_COMPARISON_TOKENS || m > MAX_COMPARISON_TOKENS) {
    throw new RangeError(`Texts longer than ${MAX_COMPARISON_TOKENS} words cannot be compared.`);
  }

  const width = m + 1;
  const cost = new Uint32Array((n + 1) * width);
  for (let i = 0; i <= n; i += 1) cost[i * width] = i;
  for (let j = 0; j <= m; j += 1) cost[j] = j;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diagonal = (cost[(i - 1) * width + (j - 1)] ?? 0) + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1);
      const deletion = (cost[(i - 1) * width + j] ?? 0) + 1;
      const insertion = (cost[i * width + (j - 1)] ?? 0) + 1;
      cost[i * width + j] = Math.min(diagonal, deletion, insertion);
    }
  }

  const steps: AlignmentStep[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = cost[i * width + j] ?? 0;
    if (i > 0 && j > 0) {
      const same = reference[i - 1] === hypothesis[j - 1];
      if ((cost[(i - 1) * width + (j - 1)] ?? 0) + (same ? 0 : 1) === here) {
        steps.push({ type: same ? 'match' : 'substitution', referenceIndex: i - 1, hypothesisIndex: j - 1 });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && (cost[(i - 1) * width + j] ?? 0) + 1 === here) {
      steps.push({ type: 'deletion', referenceIndex: i - 1 });
      i -= 1;
      continue;
    }
    steps.push({ type: 'insertion', hypothesisIndex: j - 1 });
    j -= 1;
  }
  return steps.reverse();
}

export function compareTexts(reference: string, hypothesis: string, options: TokenizeOptions = {}): TextComparison {
  const referenceTokens = tokenizeForComparison(reference, options);
  const hypothesisTokens = tokenizeForComparison(hypothesis, options);
  const steps = alignSequences(
    referenceTokens.map((token) => token.normalized),
    hypothesisTokens.map((token) => token.normalized),
  );

  let matches = 0;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;

  const alignment = steps.map((step): ComparisonOp => {
    switch (step.type) {
      case 'match':
      case 'substitution': {
        const ref = referenceTokens[step.referenceIndex] as ComparisonToken;
        const hyp = hypothesisTokens[step.hypothesisIndex] as ComparisonToken;
        if (step.type === 'match') {
          matches += 1;
          return { type: 'match', reference: ref, hypothesis: hyp };
        }
        substitutions += 1;
        return { type: 'substitution', reference: ref, hypothesis: hyp, nearMiss: isNearMiss(ref.normalized, hyp.normalized) };
      }
      case 'deletion':
        deletions += 1;
        return { type: 'deletion', reference: referenceTokens[step.referenceIndex] as ComparisonToken };
      case 'insertion':
        insertions += 1;
        return { type: 'insertion', hypothesis: hypothesisTokens[step.hypothesisIndex] as ComparisonToken };
    }
  });

  const referenceWords = referenceTokens.length;
  const errors = substitutions + deletions + insertions;
  // With nothing to hear, any written word is an error and silence is perfect.
  const wordErrorRate = referenceWords === 0 ? (insertions > 0 ? 1 : 0) : errors / referenceWords;

  return {
    reference: referenceTokens,
    hypothesis: hypothesisTokens,
    alignment,
    counts: { matches, substitutions, deletions, insertions, referenceWords, hypothesisWords: hypothesisTokens.length },
    wordErrorRate,
    accuracy: Math.max(0, 1 - wordErrorRate),
    isExactMatch: errors === 0,
  };
}
