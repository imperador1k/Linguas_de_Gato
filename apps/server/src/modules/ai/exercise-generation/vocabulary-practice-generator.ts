import { VOCABULARY_QUESTION_TYPES, verifyVocabularyQuestions, type VocabularyPracticeRequest } from '@ldg/shared';
import { z } from 'zod';
import { AppError } from '../../../errors.js';
import { arrayOf, enumOf, nullableInteger, object, string, stringArray } from '../json-schema.js';
import { UNTRUSTED_DATA_RULE, type ExerciseGenerator } from './generator.js';

/** Practice built only from the learner's saved expressions, in the senses they saved. */

export const VOCABULARY_PRACTICE_PROMPT = `You write vocabulary practice for an adult learner of English (B2 towards C1/C2) using ONLY the expressions they have saved, each with the meaning they met it in.

${UNTRUSTED_DATA_RULE}

QUESTION TYPES (use only the requested types; cover as many different items as possible)
- gap_fill: "prompt" is a new, natural sentence with one ___ where the item fits (in the saved meaning); "acceptedAnswers" lists every correct form (e.g. "broke even", "had broken even").
- meaning_choice: "prompt" shows the item in a new sentence and asks what it means there; 3-4 "options", one correct ("correctOptionIndex", from 0), distractors plausible but clearly wrong in context.
- collocation: "prompt" is a sentence with one ___ and the item's collocate missing (or the item missing next to its collocate); 3-4 options with exactly one natural choice.
- matching: "pairs" lists 3-6 items (use their ids) each with a short meaning; "prompt" is the instruction. Meanings must be distinct.
- sentence_completion: "prompt" is the start of a sentence ending in ___ that naturally continues with the item; "acceptedAnswers" gives 1-3 example completions.
- paraphrase: "prompt" asks the learner to rewrite a given sentence using the item; "acceptedAnswers" gives 1-3 good rewrites that use it.
- own_sentence: "prompt" asks the learner to write their own sentence using the item in the saved meaning, with a short situation to write about.

RULES
- "itemId" is the id of the item practised (for matching: any id from the pairs). Never practise words that are not in the list.
- Use each item in the meaning given, in natural adult contexts, different from the original context sentence.
- Exactly one ___ where a gap is needed. Fields a type doesn't use are empty arrays or null.
- "explanation": one or two sentences on the meaning or usage the question tests.`;

const JSON_OBJECT_INSTRUCTIONS = `\n\nOUTPUT\nReturn only a JSON object {"questions": [...]} where each question has exactly these keys: type (${VOCABULARY_QUESTION_TYPES.join('|')}), itemId (string), prompt (string), options (string[]), correctOptionIndex (integer or null), acceptedAnswers (string[]), pairs ([{itemId, expression, meaning}]), explanation (string).`;

export const VOCABULARY_PRACTICE_JSON_SCHEMA = object({
  questions: arrayOf(
    object({
      type: enumOf(VOCABULARY_QUESTION_TYPES),
      itemId: string,
      prompt: string,
      options: stringArray,
      correctOptionIndex: nullableInteger,
      acceptedAnswers: stringArray,
      pairs: arrayOf(object({ itemId: string, expression: string, meaning: string })),
      explanation: string,
    }),
  ),
});

const outputSchema = z.object({ questions: z.array(z.unknown()).max(30) }).strict();

const MESSAGES = {
  badRequest: "Groq couldn't create practice for these expressions. Try again in a moment.",
  tooLarge: 'Too many expressions for one practice set.',
  timeout: 'Creating the practice took too long and was stopped. Try again.',
  invalidOutput: "The generated practice didn't have the expected structure, so it was not shown. Try again.",
  truncated: 'The practice was cut off before it was complete. Try again with fewer questions.',
};

export const vocabularyPracticeGenerator: ExerciseGenerator<'vocabulary_practice'> = {
  kind: 'vocabulary_practice',
  schemaName: 'vocabulary_practice',
  jsonSchema: VOCABULARY_PRACTICE_JSON_SCHEMA,
  systemPrompt: VOCABULARY_PRACTICE_PROMPT,
  jsonObjectInstructions: JSON_OBJECT_INSTRUCTIONS,
  maxCompletionTokens: 9_000,
  messages: MESSAGES,

  buildUserMessage(request: VocabularyPracticeRequest): string {
    return `Write vocabulary practice with these settings.\n\n${JSON.stringify({ questionTypes: request.types, numberOfQuestions: request.questionCount, items: request.items })}`;
  },

  interpret(output, request) {
    const parsed = outputSchema.safeParse(output);
    if (!parsed.success) throw new AppError('PROVIDER_ERROR', MESSAGES.invalidOutput, 502);
    const { questions, discarded } = verifyVocabularyQuestions(parsed.data.questions, request.items, { types: request.types, maxQuestions: request.questionCount });
    if (questions.length === 0) throw new AppError('PROVIDER_ERROR', 'None of the generated questions passed the checks, so none were shown. Try again.', 502);
    return { kind: 'vocabulary_practice', questions, discarded };
  },
};
