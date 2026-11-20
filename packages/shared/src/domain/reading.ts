import {
  READING_LIMITS,
  READING_WORDS_PER_MINUTE,
  modelReadingQuestionSchema,
  type ReadingAnswer,
  type ReadingQuestion,
  type ReadingQuestionSet,
  type ReadingQuestionType,
  type ReadingVocabularySuggestion,
} from '../contracts/reading.js';
import { countWords } from '../contracts/writing.js';
import { tokenizeForComparison } from './text-compare.js';
import { flattenTranscript, locateQuoteSpan, type EvidenceSegment } from './transcript-evidence.js';
import { findQuoteRanges } from './writing-evidence.js';

/**
 * Reading logic: preparing imported text, estimating reading time, finding
 * the sentence around a selection, and verifying that AI-written questions
 * and vocabulary suggestions are grounded in the text.
 */

export function estimateReadingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / READING_WORDS_PER_MINUTE));
}

/**
 * Splits pasted text into paragraphs: blank lines separate paragraphs; if
 * there are none, single line breaks do. Whitespace inside a paragraph is
 * collapsed. Very long paragraphs are split at sentence boundaries so each
 * stays within the stored limit.
 */
export function splitParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (normalized === '') return [];
  const blocks = /\n\s*\n/.test(normalized) ? normalized.split(/\n\s*\n+/) : normalized.split(/\n+/);
  const paragraphs: string[] = [];
  for (const block of blocks) {
    const clean = block.replace(/\s+/g, ' ').trim();
    if (clean === '') continue;
    if (clean.length <= READING_LIMITS.maxParagraphChars) {
      paragraphs.push(clean);
      continue;
    }
    let current = '';
    for (const sentence of clean.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [clean]) {
      if ((current + sentence).length > READING_LIMITS.maxParagraphChars && current !== '') {
        paragraphs.push(current.trim());
        current = '';
      }
      current += sentence.length > READING_LIMITS.maxParagraphChars ? sentence.slice(0, READING_LIMITS.maxParagraphChars) : sentence;
    }
    if (current.trim() !== '') paragraphs.push(current.trim());
  }
  return paragraphs;
}

export interface ImportedTextCheck {
  readonly paragraphs: string[];
  readonly wordCount: number;
  /** Null when the text can be saved; otherwise why not. */
  readonly problem: string | null;
}

export function checkImportedText(text: string): ImportedTextCheck {
  const paragraphs = splitParagraphs(text);
  const wordCount = countWords(paragraphs.join(' '));
  let problem: string | null = null;
  if (text.length > READING_LIMITS.maxTextChars) problem = `The text is longer than ${READING_LIMITS.maxTextChars.toLocaleString('en')} characters. Split it into parts.`;
  else if (wordCount < READING_LIMITS.minWords) problem = `Paste at least ${READING_LIMITS.minWords} words.`;
  else if (paragraphs.length > READING_LIMITS.maxParagraphs) problem = `The text has more than ${READING_LIMITS.maxParagraphs} paragraphs. Split it into parts.`;
  return { paragraphs, wordCount, problem };
}

// --- Selection context ------------------------------------------------------------------

/**
 * The sentence (or sentences, if the selection crosses a boundary) of
 * `paragraph` containing the character range [start, end).
 */
export function sentenceAround(paragraph: string, start: number, end: number): string {
  const pieces = [...paragraph.matchAll(/[^.!?]+(?:[.!?]+["'’”)\]]*)?\s*/g)].map((match) => ({ start: match.index, end: match.index + match[0].length, text: match[0] }));
  const touched = pieces.filter((piece) => piece.end > start && piece.start < Math.max(end, start + 1));
  return (touched.length > 0 ? touched.map((piece) => piece.text).join('') : paragraph).trim();
}

const tokens = (text: string) => tokenizeForComparison(text, { ignoreBracketed: false }).map((token) => token.normalized);

/** True when `needle` occurs in `haystack` as contiguous words (case and punctuation ignored). */
export function containsWords(haystack: string, needle: string): boolean {
  const target = tokens(needle);
  const source = tokens(haystack);
  if (target.length === 0) return false;
  outer: for (let index = 0; index + target.length <= source.length; index += 1) {
    for (let offset = 0; offset < target.length; offset += 1) if (source[index + offset] !== target[offset]) continue outer;
    return true;
  }
  return false;
}

// --- Verification of generated content ---------------------------------------------------------

/** Keeps only vocabulary suggestions whose expression occurs in the text. */
export function verifyReadingVocabulary(
  suggestions: readonly ReadingVocabularySuggestion[],
  paragraphs: readonly string[],
): { vocabulary: ReadingVocabularySuggestion[]; discarded: number } {
  const text = paragraphs.join('\n');
  const seen = new Set<string>();
  const vocabulary = suggestions.filter((item) => {
    const key = tokens(item.expression).join(' ');
    if (key === '' || seen.has(key) || !containsWords(text, item.expression)) return false;
    seen.add(key);
    return true;
  });
  return { vocabulary, discarded: suggestions.length - vocabulary.length };
}

export const MIN_READING_EVIDENCE_WORDS = 3;
/** An answer this long that occurs verbatim in the text only tests copying. */
const COPY_ANSWER_WORDS = 6;

const toSegments = (paragraphs: readonly string[]): EvidenceSegment[] => paragraphs.map((text, index) => ({ id: `p${index + 1}`, startMs: index, text }));

/**
 * A question survives only if its structure is consistent, every cited
 * paragraph exists, its evidence quote occurs word for word in the text, and
 * its answer isn't a long sentence copied straight from the text (which would
 * test matching, not understanding). References come from the verified span.
 */
export function verifyReadingQuestions(
  raw: readonly unknown[],
  paragraphs: readonly string[],
  options: { readonly types: readonly ReadingQuestionType[]; readonly maxQuestions: number },
): { questions: ReadingQuestion[]; discarded: number } {
  const segments = toSegments(paragraphs);
  const flat = flattenTranscript(segments);
  const fullText = paragraphs.join('\n');
  const allowed = new Set(options.types);
  const seen = new Set<string>();
  const questions: ReadingQuestion[] = [];
  let discarded = 0;

  for (const item of raw) {
    const parsed = modelReadingQuestionSchema.safeParse(item);
    if (!parsed.success || !allowed.has(parsed.data.type)) {
      discarded += 1;
      continue;
    }
    const question = parsed.data;
    const reject = () => {
      discarded += 1;
    };
    if (question.paragraphNumbers.some((number) => number > paragraphs.length)) {
      reject();
      continue;
    }
    if (tokens(question.evidenceQuote).length < MIN_READING_EVIDENCE_WORDS) {
      reject();
      continue;
    }
    const preferred = question.paragraphNumbers[0] ? `p${question.paragraphNumbers[0]}` : undefined;
    const span = locateQuoteSpan(question.evidenceQuote, segments, preferred, flat);
    if (!span) {
      reject();
      continue;
    }
    const key = tokens(question.question).join(' ');
    if (seen.has(key)) {
      reject();
      continue;
    }
    const paragraphIndex = Number(span.segmentId.slice(1)) - 1;
    const range = span.segmentIds.length === 1 ? (findQuoteRanges(question.evidenceQuote, paragraphs[paragraphIndex] ?? '')[0] ?? null) : null;
    const isCopy = (answer: string) => tokens(answer).length >= COPY_ANSWER_WORDS && containsWords(fullText, answer);
    const base = {
      id: `q${questions.length + 1}`,
      type: question.type,
      question: question.question,
      explanation: question.explanation,
      evidenceQuote: question.evidenceQuote,
      paragraphIndex,
      start: range?.start ?? null,
      end: range?.end ?? null,
    };

    if (question.format === 'multiple_choice') {
      const { options: choices, correctOptionIndex: index } = question;
      const distinct = new Set(choices.map((choice) => tokens(choice).join(' '))).size === choices.length;
      if (choices.length < 3 || index === null || index >= choices.length || !distinct || isCopy(choices[index] ?? '')) {
        reject();
        continue;
      }
      questions.push({ ...base, format: 'multiple_choice', options: [...choices], correctOptionIndex: index });
    } else {
      if (question.acceptedAnswers.length === 0 || question.acceptedAnswers.every(isCopy)) {
        reject();
        continue;
      }
      questions.push({ ...base, format: 'short_answer', acceptedAnswers: question.acceptedAnswers.filter((answer) => !isCopy(answer)) });
    }
    seen.add(key);
    if (questions.length >= options.maxQuestions) break;
  }
  return { questions, discarded };
}

// --- Answers --------------------------------------------------------------------------------

export type ReadingOutcome = 'correct' | 'partly' | 'incorrect' | 'unanswered' | 'unrated';

export function readingOutcome(question: ReadingQuestion, answer: ReadingAnswer | undefined): ReadingOutcome {
  if (!answer || answer.format !== question.format) return 'unanswered';
  if (answer.format === 'multiple_choice' && question.format === 'multiple_choice') return answer.selectedIndex === question.correctOptionIndex ? 'correct' : 'incorrect';
  if (answer.format === 'short_answer') return answer.text.trim() === '' ? 'unanswered' : (answer.selfAssessment ?? 'unrated');
  return 'unanswered';
}

export function summarizeReadingResults(set: Pick<ReadingQuestionSet, 'questions' | 'answers'>) {
  const byQuestion = new Map(set.answers.map((answer) => [answer.questionId, answer]));
  const counts = { correct: 0, partly: 0, incorrect: 0, unanswered: 0, unrated: 0 };
  for (const question of set.questions) counts[readingOutcome(question, byQuestion.get(question.id))] += 1;
  return { total: set.questions.length, answered: set.questions.length - counts.unanswered, ...counts };
}

/** Records an answer; locked after submission except a short answer's self-assessment. */
export function withReadingAnswer(set: ReadingQuestionSet, answer: ReadingAnswer, now: number): ReadingQuestionSet {
  const question = set.questions.find((candidate) => candidate.id === answer.questionId);
  if (!question || question.format !== answer.format) return set;
  if (set.submittedAt !== null) {
    if (answer.format !== 'short_answer') return set;
    const previous = set.answers.find((candidate) => candidate.questionId === answer.questionId);
    if (!previous || previous.format !== 'short_answer' || previous.text !== answer.text) return set;
  }
  return { ...set, answers: [...set.answers.filter((candidate) => candidate.questionId !== answer.questionId), answer], updatedAt: now };
}
