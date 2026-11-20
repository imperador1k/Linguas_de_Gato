import {
  SPEAKING_CATEGORIES,
  SPEAKING_EXERCISE_FORMATS,
  SPEAKING_LEVELS,
  generatedSpeakingExerciseSchema,
  type SpeakingGenerationRequest,
} from '@ldg/shared';
import { AppError } from '../../../errors.js';
import { arrayOf, enumOf, object, string, stringArray } from '../json-schema.js';
import { LEVEL_GUIDE, UNTRUSTED_DATA_RULE, targetedPracticeData, targetedPracticeInstruction, type ExerciseGenerator } from './generator.js';

/**
 * Speaking task generator. It produces a task to *prepare and speak*, never
 * a model answer: reading a scripted answer would undermine the spontaneous
 * practice the Speaking Lab exists for.
 */

const FORMAT_GUIDE = `FORMATS
- free: an open question; the learner organises their own answer. Discussion points are optional ideas.
- guided: a structured discussion; discussion points are aspects to cover in a sensible order.
- debate: a clear, contestable motion; the learner takes a side, supports it, and responds to the strongest opposing argument. Discussion points present considerations on both sides.
- critical_thinking: a problem, dilemma or claim to analyse (causes, assumptions, trade-offs, implications) before reaching a reasoned judgement.`;

const SKILL_GUIDE = `SKILL FOCUS (when given, shape the task, objectives and vocabulary around it)
- lexical_range: precise, varied vocabulary and collocations instead of repeated general words.
- grammatical_range: structures such as conditionals, passives, cleft sentences, modals of deduction, inversion where natural.
- coherence: signposting, logical sequencing and linking of ideas.
- argumentation: claims supported by reasons and examples, concession and rebuttal.
- register_and_tone: adapting formality and tone to an audience or situation.
- hedging_and_nuance: qualifying claims, expressing degrees of certainty and fine distinctions.`;

export const SPEAKING_SYSTEM_PROMPT = `You design speaking tasks for an adult learner of English who is moving from B2 towards C1/C2 and practises alone by recording a spoken answer.

${UNTRUSTED_DATA_RULE}
The learner's "interest" is only a topic suggestion. If it is not a suitable, respectful topic for language practice, ignore it and design a task within the chosen category.

${LEVEL_GUIDE}

${FORMAT_GUIDE}

${SKILL_GUIDE}

THE TASK
- Fit the chosen category, format, level and suggested duration (a 30-second task needs a narrow question; 3 minutes allows development and a counter-argument).
- "title": short and compelling, at most 8 words, no quotation marks.
- "centralPrompt": the question or task, addressed to the learner, one to three sentences. Avoid yes/no questions unless the format is debate.
- "instructions": how to approach it: structure, what to include, how long to speak. Do not tell the learner what to say.
- "discussionPoints": 3 to 5 concise, relevant aspects (questions or angles), not full sentences to read aloud.
- "followUpQuestions": 2 or 3 questions an examiner might ask next to push the learner further.
- "vocabulary": 6 to 10 useful expressions and natural collocations at the target level, genuinely useful for this topic. "meaning" is a plain-English definition; "example" is one natural sentence that does not answer the central prompt for the learner.
- "objectives": 2 or 3 concrete, observable speaking objectives (for example "Concede one opposing point before rebutting it").
- "level" and "format" repeat the requested values.
- Never write a model answer, a sample response or a script.
- Avoid stereotypes and keep topics respectful; avoid partisan current-affairs claims presented as fact.`;

const JSON_OBJECT_INSTRUCTIONS = `\n\nOUTPUT\nReturn only a JSON object with exactly these keys: title (string), centralPrompt (string), instructions (string), discussionPoints (string[]), followUpQuestions (string[]), vocabulary ([{expression, meaning, example}]), objectives (string[]), level (${SPEAKING_LEVELS.join('|')}), format (${SPEAKING_EXERCISE_FORMATS.join('|')}).`;

export const SPEAKING_JSON_SCHEMA = object({
  title: string,
  centralPrompt: string,
  instructions: string,
  discussionPoints: stringArray,
  followUpQuestions: stringArray,
  vocabulary: arrayOf(object({ expression: string, meaning: string, example: string })),
  objectives: stringArray,
  level: enumOf(SPEAKING_LEVELS),
  format: enumOf(SPEAKING_EXERCISE_FORMATS),
});

const CATEGORY_NAMES: Record<(typeof SPEAKING_CATEGORIES)[number], string> = {
  technology: 'Technology and the digital world',
  work: 'Work and careers',
  culture: 'Culture, media and the arts',
  education: 'Education and learning',
  science: 'Science, health and the environment',
  society: 'Society and public life',
  everyday: 'Everyday life and relationships',
};

export const speakingGenerator: ExerciseGenerator<'speaking'> = {
  kind: 'speaking',
  schemaName: 'speaking_exercise',
  jsonSchema: SPEAKING_JSON_SCHEMA,
  systemPrompt: SPEAKING_SYSTEM_PROMPT,
  jsonObjectInstructions: JSON_OBJECT_INSTRUCTIONS,
  maxCompletionTokens: 6_000,
  messages: {
    badRequest: "Groq couldn't create a speaking task with these settings. Try again or change them.",
    tooLarge: 'The request is too long for the model.',
    timeout: 'Creating the task took too long and was stopped. Try again.',
    invalidOutput: "The generated task didn't have the expected structure, so it was not shown. Try again.",
    truncated: 'The generated task was cut off before it was complete. Try again.',
  },

  buildUserMessage(request: SpeakingGenerationRequest): string {
    const payload = {
      level: request.level,
      category: CATEGORY_NAMES[request.category],
      format: request.format,
      suggestedDurationSeconds: request.targetDurationSeconds,
      skillFocus: request.skillFocus,
      interest: request.interest && request.interest.trim() !== '' ? request.interest.trim() : null,
      avoidTheseTitles: request.avoidTitles,
      targetedPractice: targetedPracticeData(request.targetedPractice),
    };
    return `Design one speaking task with these settings. If titles to avoid are listed, make a clearly different task.${targetedPracticeInstruction(request.targetedPractice)}\n\n${JSON.stringify(payload)}`;
  },

  interpret(output, request) {
    const parsed = generatedSpeakingExerciseSchema.safeParse(output);
    if (!parsed.success) throw new AppError('PROVIDER_ERROR', this.messages.invalidOutput, 502);
    // The learner's choices win over whatever the model echoed back.
    return { kind: 'speaking', exercise: { ...parsed.data, level: request.level, format: request.format } };
  },
};
