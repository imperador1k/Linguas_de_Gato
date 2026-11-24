import { z } from 'zod';
import { PARTS_OF_SPEECH } from './vocabulary-pack.js';
import { VOCABULARY_LIMITS } from './vocabulary.js';

/**
 * What the learner types to add or edit a word in their personal collection
 * (V1). Untrusted input: validated before anything is saved. Lists are
 * already split (see `parseAnswerList`).
 */

const item = z.string().trim().min(1).max(80);

export const personalSenseInputSchema = z
  .object({
    /** The English word or expression, in its dictionary form ("eat", "look forward to"). */
    expression: z.string().trim().min(1, 'Write the English word or expression.').max(VOCABULARY_LIMITS.maxExpressionChars),
    /** Portuguese (Portugal) translations: the first is the main one; the others are also accepted. */
    translations: z.array(item).min(1, 'Write what it means in Portuguese.').max(VOCABULARY_LIMITS.maxTranslations),
    /** Empty when not given. */
    partOfSpeech: z.enum(['', ...PARTS_OF_SPEECH]),
    /** A sentence using the word (optional). Used for context practice when it contains the word or one of its forms. */
    example: z.string().trim().max(VOCABULARY_LIMITS.maxSentenceChars),
    /** Other English answers accepted for this meaning (true equivalents only). */
    alternatives: z.array(item).max(VOCABULARY_LIMITS.maxAlternatives),
    /** Other grammatical forms ("eats, ate, eaten"). */
    forms: z.array(item).max(VOCABULARY_LIMITS.maxForms),
    notes: z.string().trim().max(VOCABULARY_LIMITS.maxNoteChars),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expression.split(/\s+/).filter(Boolean).length > VOCABULARY_LIMITS.maxExpressionWords) {
      context.addIssue({ code: 'custom', path: ['expression'], message: `Use at most ${VOCABULARY_LIMITS.maxExpressionWords} words.` });
    }
  });
export type PersonalSenseInput = z.infer<typeof personalSenseInputSchema>;
