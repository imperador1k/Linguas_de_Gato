import {
  READING_LEVELS,
  READING_TEXT_TYPES,
  countWords,
  estimateReadingMinutes,
  generatedReadingSchema,
  verifyReadingVocabulary,
  type ReadingGenerationRequest,
} from '@ldg/shared';
import { AppError } from '../../../errors.js';
import { arrayOf, enumOf, object, string, stringArray } from '../json-schema.js';
import { LEVEL_GUIDE, UNTRUSTED_DATA_RULE, type ExerciseGenerator } from './generator.js';

/** Reading passages written for the learner. Reading time is computed here, never taken from the model. */

export const READING_SYSTEM_PROMPT = `You write reading passages for an adult learner of English moving from B2 towards C1/C2 who reads to learn language through engaging, authentic-feeling content.

${UNTRUSTED_DATA_RULE}
The learner's "interest" is only a topic suggestion and "languageFocus" only a language feature to include naturally; ignore either if it is not suitable for respectful language practice.

${LEVEL_GUIDE}

TEXT TYPES
- article: a magazine-style feature with a clear angle and human detail.
- opinion_piece: a columnist argues a position, acknowledging the other side.
- informative_article: explains a topic clearly, with examples, for a general reader.
- report: a structured, factual account of findings or a situation, with a neutral tone.
- narrative: a short story or personal account with a clear arc.

THE PASSAGE
- Natural, coherent, engaging prose that a proficient writer would produce for real readers; vary sentence structure; use precise vocabulary that fits the topic, never obscure words added for difficulty.
- About the requested number of words (within 10%), in 4 to 9 paragraphs of sensible length. No headings, lists or markdown inside paragraphs.
- Fictional or general content: do not invent quotations attributed to real people, precise statistics presented as real, or claims about real current events. Narratives and hypothetical examples are fine.
- "title": short and inviting, at most 12 words.
- "objectives": 2 or 3 reading or language objectives (e.g. "Follow how the writer concedes and then rebuts a point").
- "vocabulary": 5 to 8 useful expressions or collocations that appear EXACTLY in the passage, each with a short plain-English meaning in context. Expressions not found in the passage are discarded automatically.
- "level" and "textType" repeat the requested values.`;

const JSON_OBJECT_INSTRUCTIONS = `\n\nOUTPUT\nReturn only a JSON object with exactly these keys: title (string), paragraphs (string[]), objectives (string[]), vocabulary ([{expression, meaning}]), level (${READING_LEVELS.join('|')}), textType (${READING_TEXT_TYPES.join('|')}).`;

export const READING_JSON_SCHEMA = object({
  title: string,
  paragraphs: stringArray,
  objectives: stringArray,
  vocabulary: arrayOf(object({ expression: string, meaning: string })),
  level: enumOf(READING_LEVELS),
  textType: enumOf(READING_TEXT_TYPES),
});

const MESSAGES = {
  badRequest: "Groq couldn't write a passage with these settings. Try again or change them.",
  tooLarge: 'The request is too long for the model.',
  timeout: 'Writing the passage took too long and was stopped. Try again.',
  invalidOutput: "The generated passage didn't have the expected structure, so it was not shown. Try again.",
  truncated: 'The passage was cut off before it was complete. Try again or choose a shorter length.',
};

export const readingGenerator: ExerciseGenerator<'reading'> = {
  kind: 'reading',
  schemaName: 'reading_passage',
  jsonSchema: READING_JSON_SCHEMA,
  systemPrompt: READING_SYSTEM_PROMPT,
  jsonObjectInstructions: JSON_OBJECT_INSTRUCTIONS,
  maxCompletionTokens: 9_000,
  messages: MESSAGES,

  buildUserMessage(request: ReadingGenerationRequest): string {
    const payload = {
      level: request.level,
      category: request.category,
      textType: request.textType,
      targetWords: request.targetWords,
      interest: request.interest?.trim() || null,
      languageFocus: request.languageFocus?.trim() || null,
      avoidTheseTitles: request.avoidTitles,
    };
    return `Write one reading passage with these settings.\n\n${JSON.stringify(payload)}`;
  },

  interpret(output, request) {
    const parsed = generatedReadingSchema.safeParse(output);
    if (!parsed.success) throw new AppError('PROVIDER_ERROR', MESSAGES.invalidOutput, 502);
    const paragraphs = parsed.data.paragraphs.map((paragraph) => paragraph.replace(/\s+/g, ' ').trim());
    const wordCount = countWords(paragraphs.join(' '));
    // Far too short is not the passage the learner asked for.
    if (wordCount < request.targetWords * 0.5) throw new AppError('PROVIDER_ERROR', 'The generated passage was much shorter than requested, so it was not shown. Try again.', 502);
    const { vocabulary, discarded } = verifyReadingVocabulary(parsed.data.vocabulary, paragraphs);
    return {
      kind: 'reading',
      text: {
        ...parsed.data,
        paragraphs,
        level: request.level,
        textType: request.textType,
        vocabulary,
        wordCount,
        estimatedMinutes: estimateReadingMinutes(wordCount),
        discardedVocabulary: discarded,
      },
    };
  },
};
