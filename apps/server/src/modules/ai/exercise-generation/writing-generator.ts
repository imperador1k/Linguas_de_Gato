import {
  SOURCE_TEXT_FORMATS,
  WRITING_FORMATS,
  WRITING_LEVELS,
  WRITING_REGISTERS,
  writingTaskSchema,
  type WritingGenerationRequest,
  type WritingTask,
} from '@ldg/shared';
import { AppError } from '../../../errors.js';
import { arrayOf, enumOf, integer, nullableString, object, string, stringArray } from '../json-schema.js';
import { LEVEL_GUIDE, UNTRUSTED_DATA_RULE, targetedPracticeData, targetedPracticeInstruction, type ExerciseGenerator } from './generator.js';

/**
 * Writing task generator. It produces a task to write, never a model answer:
 * seeing one first would replace the learner's own planning and drafting.
 */

const FORMAT_GUIDE = `FORMATS
- argumentative_essay: argue one side of a contestable issue, anticipating and rebutting objections.
- opinion_essay: give and justify a personal view on a question.
- discursive_essay: weigh several perspectives evenly before a balanced conclusion.
- formal_email / informal_email: a realistic message with a clear purpose, reader and relationship.
- report: inform a defined reader about findings, with headings and recommendations.
- proposal: persuade a decision-maker to adopt a plan, with justification and practical details.
- article: engage readers of a named publication, with a title and a personal, lively angle.
- review: describe and evaluate something (a book, a place, a service) for a stated audience.
- summary: condense the supplied source text in the learner's own words, keeping only the key points.
- paraphrase: restate the supplied source text with the same meaning but different wording and structure.
- reformulation: rewrite the supplied source text (deliberately weak: repetitive, clumsy or in the wrong register) so it meets the brief.`;

export const WRITING_SYSTEM_PROMPT = `You design writing tasks for an adult learner of English who is moving from B2 towards C1/C2 and writes on their own, then receives detailed feedback.

${UNTRUSTED_DATA_RULE}
The learner's "interest" is only a topic suggestion and their "objective" only a learning focus. If either is not a suitable, respectful topic or focus for language practice, ignore it and design a task within the chosen category.

${LEVEL_GUIDE}

${FORMAT_GUIDE}

REGISTER
- formal: impersonal, precise, no contractions or colloquialisms (e.g. a complaint to a company, a report for a manager).
- neutral: clear and polite, suitable for a general audience (e.g. most essays, articles).
- informal: friendly and natural, contractions and idiomatic language welcome (e.g. an email to a friend).
The scenario must make the register natural; if the requested register clashes with the format, choose a scenario where it fits.

THE TASK
- "title": short and specific, at most 10 words.
- "instructions": what to write, for whom and why, in two to four sentences, addressed to the learner ("Write an article for ...").
- "context": the situation that makes the task realistic (who the reader is, what has happened, what the writer wants to achieve).
- "sourceText": for summary, paraphrase and reformulation, an original text of 120-300 words written by you for this task (for reformulation, deliberately flawed as described above); null for every other format.
- "wordCount": "target" equals the requested target words; "min" and "max" give a sensible range around it (usually 10-15% either side). For summaries the target may be shorter than requested if the source is short.
- "requiredElements": 3 to 5 concrete things the text must contain (points to cover, structural features such as a subject line or headings).
- "evaluationCriteria": 3 to 5 criteria the text will be judged on, specific to this task.
- "objectives": 2 or 3 learning objectives, including the learner's objective when one was given and is suitable.
- "languageFeatures": 3 to 6 language features that would help (structures, cohesive devices, register markers), as short labels with an example.
- "level", "format" and "register" repeat the requested values.
- Never write a model answer, a sample text, an opening paragraph or a plan the learner could copy.
- Avoid stereotypes, partisan current affairs presented as fact and topics that require specialist knowledge.`;

const JSON_OBJECT_INSTRUCTIONS = `\n\nOUTPUT\nReturn only a JSON object with exactly these keys: title, instructions, context (strings), sourceText (string or null), wordCount {target, min, max} (integers), requiredElements, evaluationCriteria, objectives, languageFeatures (string arrays), level (${WRITING_LEVELS.join('|')}), format (${WRITING_FORMATS.join('|')}), register (${WRITING_REGISTERS.join('|')}).`;

export const WRITING_TASK_JSON_SCHEMA = object({
  title: string,
  instructions: string,
  context: string,
  sourceText: nullableString,
  wordCount: object({ target: integer, min: integer, max: integer }),
  requiredElements: stringArray,
  evaluationCriteria: stringArray,
  objectives: stringArray,
  languageFeatures: arrayOf(string),
  level: enumOf(WRITING_LEVELS),
  format: enumOf(WRITING_FORMATS),
  register: enumOf(WRITING_REGISTERS),
});

const MESSAGES = {
  badRequest: "Groq couldn't create a writing task with these settings. Try again or change them.",
  tooLarge: 'The request is too long for the model.',
  timeout: 'Creating the task took too long and was stopped. Try again.',
  invalidOutput: "The generated task didn't have the expected structure, so it was not shown. Try again.",
  truncated: 'The generated task was cut off before it was complete. Try again.',
};

/**
 * The learner's settings win over what the model echoes, and the word range
 * is made coherent with the requested target (summaries may legitimately be
 * shorter than requested, so their target is kept if sensible).
 */
export function normalizeWritingTask(task: WritingTask, request: WritingGenerationRequest): WritingTask {
  const isSourceFormat = SOURCE_TEXT_FORMATS.has(request.format);
  const target = request.format === 'summary' && task.wordCount.target < request.targetWords && task.wordCount.target >= 40 ? task.wordCount.target : request.targetWords;
  const sensible = task.wordCount.min <= target && target <= task.wordCount.max && task.wordCount.min >= target * 0.7 && task.wordCount.max <= target * 1.3;
  const wordCount = sensible ? { ...task.wordCount, target } : { target, min: Math.round(target * 0.9), max: Math.round(target * 1.1) };
  return { ...task, level: request.level, format: request.format, register: request.register, wordCount, sourceText: isSourceFormat ? task.sourceText : null };
}

export const writingGenerator: ExerciseGenerator<'writing'> = {
  kind: 'writing',
  schemaName: 'writing_task',
  jsonSchema: WRITING_TASK_JSON_SCHEMA,
  systemPrompt: WRITING_SYSTEM_PROMPT,
  jsonObjectInstructions: JSON_OBJECT_INSTRUCTIONS,
  maxCompletionTokens: 8_000,
  messages: MESSAGES,

  buildUserMessage(request: WritingGenerationRequest): string {
    const payload = {
      level: request.level,
      format: request.format,
      category: request.category,
      register: request.register,
      targetWords: request.targetWords,
      interest: request.interest && request.interest.trim() !== '' ? request.interest.trim() : null,
      objective: request.objective && request.objective.trim() !== '' ? request.objective.trim() : null,
      avoidTheseTitles: request.avoidTitles,
      targetedPractice: targetedPracticeData(request.targetedPractice),
    };
    return `Design one writing task with these settings. If titles to avoid are listed, make a clearly different task.${targetedPracticeInstruction(request.targetedPractice)}\n\n${JSON.stringify(payload)}`;
  },

  interpret(output, request) {
    const parsed = writingTaskSchema.safeParse(output);
    if (!parsed.success) throw new AppError('PROVIDER_ERROR', MESSAGES.invalidOutput, 502);
    // Summary, paraphrase and reformulation are impossible without a source text.
    if (SOURCE_TEXT_FORMATS.has(request.format) && !parsed.data.sourceText) throw new AppError('PROVIDER_ERROR', MESSAGES.invalidOutput, 502);
    return { kind: 'writing', task: normalizeWritingTask(parsed.data, request) };
  },
};
