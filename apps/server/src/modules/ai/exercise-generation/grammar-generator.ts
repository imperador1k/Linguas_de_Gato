import {
  GRAMMAR_QUESTION_TYPES,
  modelGrammarSetSchema,
  verifyGrammarQuestions,
  type GrammarGenerationRequest,
} from '@ldg/shared';
import { AppError } from '../../../errors.js';
import { arrayOf, enumOf, nullableInteger, nullableString, object, string, stringArray } from '../json-schema.js';
import { LEVEL_GUIDE, UNTRUSTED_DATA_RULE, targetedPracticeData, targetedPracticeInstruction, type ExerciseGenerator } from './generator.js';

/**
 * Grammar question generator. Every question is verified for consistency
 * and ambiguity (`verifyGrammarQuestions`) before the learner sees it, so the
 * deterministic answer key can be trusted.
 */

const TOPIC_GUIDE: Record<GrammarGenerationRequest['topic'], string> = {
  conditionals: 'zero to third conditionals, mixed conditionals, alternatives to if (unless, provided that, supposing, but for)',
  inversion: 'negative and restrictive adverbials (never, seldom, not only, no sooner, little), inverted conditionals (had I, were she, should you), only after/when/if',
  passive_voice: 'passives across tenses and with modals, passive reporting structures (it is said that / he is said to have), have/get something done',
  modal_verbs: 'deduction and speculation in the present and past (must have, can\'t have, might have), obligation, advice, criticism (should have), needn\'t have vs didn\'t need to',
  relative_clauses: 'defining and non-defining clauses (commas matter), whose, whom, prepositions with relatives, reduced relatives, which referring to a whole clause',
  participle_clauses: 'present, past and perfect participle clauses for time, reason and result, avoiding dangling participles',
  reported_speech: 'backshift and when it is optional, reporting verbs and their patterns (accuse sb of, urge sb to, deny doing), reported questions',
  articles_and_prepositions: 'a/an/the/zero article with general and specific reference, dependent prepositions after verbs, nouns and adjectives',
  cleft_sentences: 'it-clefts (It was Sara who...), wh-clefts (What I need is...), all/the thing/the reason clefts for emphasis',
  linking_devices: 'contrast and concession (although, despite, whereas, nevertheless), cause and result, addition, with correct punctuation and grammar after each',
  collocations_and_phrasal_verbs: 'strong verb-noun and adjective-noun collocations, phrasal verbs with their particles and objects, in natural contexts',
  advanced_structures: 'fronting, emphatic do, the more... the more, as/so with inversion, subjunctive (it is essential that he be), wish/if only, it\'s time + past',
};

export const GRAMMAR_SYSTEM_PROMPT = `You write grammar practice questions for an adult learner of English moving from B2 towards C1/C2. Their answers are checked automatically against your answer key, so every question must have an unambiguous, complete key.

${UNTRUSTED_DATA_RULE}
The learner's "focus" is only a narrower topic suggestion; ignore it if it is not about English grammar or usage.

${LEVEL_GUIDE}

QUESTION TYPES (use only the requested types, spread across them)
- multiple_choice: "prompt" is a sentence with one ___ (or a short question); 3 or 4 "options", exactly one correct ("correctOptionIndex", counting from 0). Every distractor must be clearly wrong in this context for a grammatical reason, not merely less common. "distractorExplanations" has one entry per option, in the same order: why each wrong option is wrong, and for the correct option a short confirmation.
- gap_fill: "prompt" is a sentence with one ___, optionally followed by the base word in brackets, e.g. "___ (know)". "acceptedAnswers" lists EVERY correct filling (1-5 words each), including contracted and full forms when both are correct.
- error_correction: "prompt" is a sentence containing exactly one error relevant to the topic (no ___). "acceptedAnswers" lists the fully corrected sentence and every other correct correction.
- transformation: "sourceSentence" is a complete sentence; "keyword" is ONE word that must be used unchanged; "prompt" is a second sentence with one ___ that, completed, means the same as the source. "acceptedAnswers" lists every correct gap content (2-6 words, each containing the keyword).
- word_order: "words" are the words of one sentence in a scrambled order (punctuation omitted); "prompt" is a short instruction; "acceptedAnswers" lists every correct sentence using exactly those words, with punctuation.
- sentence_completion: "prompt" is the beginning of a sentence ending with ___ that requires a specific structure; "acceptedAnswers" lists 2-4 good example completions, and "explanation" states what any correct completion must contain.
For types that don't use a field: "options", "words", "acceptedAnswers" and "distractorExplanations" are empty arrays; "sourceSentence", "keyword" and "correctOptionIndex" are null.

AMBIGUITY (most important)
- Before writing a question, check whether any answer other than your key would also be correct. If so, either list it in "acceptedAnswers" or rewrite the question so it isn't. Never write questions where several options are plausible.
- Use natural, adult contexts. No trick questions, no obscure vocabulary, no British/American variants treated as errors.

EXPLANATIONS
- "explanation": why the answer is right in this sentence, in one or two clear sentences.
- "rule": the general rule, briefly, with the pattern (e.g. "Had + subject + past participle replaces if + past perfect").

THE SET
- "title": short, naming the structure practised; "instructions": one sentence for the learner.
- Write the requested number of questions, all on the requested topic, ordered from easier to harder.`;

const JSON_OBJECT_INSTRUCTIONS = `\n\nOUTPUT\nReturn only a JSON object {"title": string, "instructions": string, "questions": [...]} where each question has exactly these keys: type (${GRAMMAR_QUESTION_TYPES.join('|')}), prompt (string), sourceSentence (string or null), keyword (string or null), words (string[]), options (string[]), correctOptionIndex (integer or null), acceptedAnswers (string[]), explanation (string), rule (string), distractorExplanations (string[]).`;

export const GRAMMAR_SET_JSON_SCHEMA = object({
  title: string,
  instructions: string,
  questions: arrayOf(
    object({
      type: enumOf(GRAMMAR_QUESTION_TYPES),
      prompt: string,
      sourceSentence: nullableString,
      keyword: nullableString,
      words: stringArray,
      options: stringArray,
      correctOptionIndex: nullableInteger,
      acceptedAnswers: stringArray,
      explanation: string,
      rule: string,
      distractorExplanations: stringArray,
    }),
  ),
});

const MESSAGES = {
  badRequest: "Groq couldn't create grammar questions with these settings. Try again or change them.",
  tooLarge: 'The request is too long for the model.',
  timeout: 'Creating the questions took too long and was stopped. Try again.',
  invalidOutput: "The generated questions didn't have the expected structure, so they were not shown. Try again.",
  truncated: 'The generated questions were cut off before they were complete. Try again with fewer questions.',
};

export const grammarGenerator: ExerciseGenerator<'grammar'> = {
  kind: 'grammar',
  schemaName: 'grammar_set',
  jsonSchema: GRAMMAR_SET_JSON_SCHEMA,
  systemPrompt: GRAMMAR_SYSTEM_PROMPT,
  jsonObjectInstructions: JSON_OBJECT_INSTRUCTIONS,
  maxCompletionTokens: 12_000,
  messages: MESSAGES,

  buildUserMessage(request: GrammarGenerationRequest): string {
    const payload = {
      level: request.level,
      topic: request.topic,
      topicCovers: TOPIC_GUIDE[request.topic],
      questionTypes: request.types,
      numberOfQuestions: request.questionCount,
      focus: request.focus && request.focus.trim() !== '' ? request.focus.trim() : null,
      avoidTheseTitles: request.avoidTitles,
      targetedPractice: targetedPracticeData(request.targetedPractice),
    };
    return `Write one grammar practice set with these settings.${targetedPracticeInstruction(request.targetedPractice)}\n\n${JSON.stringify(payload)}`;
  },

  interpret(output, request) {
    const parsed = modelGrammarSetSchema.safeParse(output);
    if (!parsed.success) throw new AppError('PROVIDER_ERROR', MESSAGES.invalidOutput, 502);
    const { questions, discarded } = verifyGrammarQuestions(parsed.data.questions, { types: request.types, maxQuestions: request.questionCount });
    if (questions.length === 0) {
      throw new AppError('PROVIDER_ERROR', 'None of the generated questions passed the consistency checks, so none were shown. Try again.', 502);
    }
    return {
      kind: 'grammar',
      set: { title: parsed.data.title, instructions: parsed.data.instructions, level: request.level, topic: request.topic, questions },
      discarded,
    };
  },
};
