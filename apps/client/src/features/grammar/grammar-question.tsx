import {
  GAP,
  evaluateGrammarAnswer,
  fillGap,
  grammarEvaluationResponseSchema,
  wordTokens,
  type GrammarAnswer,
  type GrammarEvaluationRequest,
  type GrammarEvaluationResponse,
  type GrammarLevel,
  type GrammarQuestion,
  type GrammarTopic,
  type StoredGrammarReview,
} from '@ldg/shared';
import { CircleCheck, CircleX, LoaderCircle, MessageSquareText, Undo2, X } from 'lucide-react';
import { useId, useMemo, type ReactNode } from 'react';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FIELD_CLASS } from '@/components/ui/choice-group';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { useApiJob } from '@/lib/use-api-job';
import { cn } from '@/lib/utils';
import { QUESTION_TYPE_LABELS } from './grammar-labels';

/** Renders a prompt with its gap as a visible blank (or the learner's/correct answer after checking). */
function Prompt({ prompt, fill }: { prompt: string; fill?: ReactNode }) {
  const [before, after] = prompt.split(GAP) as [string, string | undefined];
  if (after === undefined) return <span>{prompt}</span>;
  return (
    <span>
      {before}
      {fill ?? (
        <span aria-label="blank" className="mx-0.5 inline-block w-16 border-b-2 border-foreground/50 align-baseline">
          &nbsp;
        </span>
      )}
      {after}
    </span>
  );
}

/** Restores which word tiles were used, from a saved answer. */
function chosenIndexes(words: readonly string[], text: string): number[] {
  const used = new Set<number>();
  const result: number[] = [];
  for (const token of wordTokens(text)) {
    const index = words.findIndex((word, position) => !used.has(position) && wordTokens(word).join(' ') === token);
    if (index === -1) continue;
    used.add(index);
    result.push(index);
  }
  return result;
}

function WordOrder({ question, text, disabled, onChange }: { question: Extract<GrammarQuestion, { type: 'word_order' }>; text: string; disabled: boolean; onChange: (text: string) => void }) {
  const chosen = useMemo(() => chosenIndexes(question.words, text), [question.words, text]);
  const set = (indexes: number[]) => onChange(indexes.map((index) => question.words[index]).join(' '));
  return (
    <div className="flex flex-col gap-3">
      <div aria-label="Your sentence" className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-md border border-dashed px-3 py-2">
        {chosen.length === 0 ? <span className="text-sm text-muted-foreground">Select the words in order.</span> : null}
        {chosen.map((index, position) => (
          <button
            key={`${index}-${position}`}
            type="button"
            disabled={disabled}
            onClick={() => set(chosen.filter((_, place) => place !== position))}
            aria-label={`Remove “${question.words[index]}”`}
            className="rounded-md border border-foreground/30 bg-accent/60 px-2.5 py-1 font-serif text-[1.0625rem] disabled:cursor-default"
          >
            {question.words[index]}
          </button>
        ))}
      </div>
      <div aria-label="Words to use" className="flex flex-wrap gap-1.5">
        {question.words.map((word, index) =>
          chosen.includes(index) ? null : (
            <button
              key={`${word}-${index}`}
              type="button"
              disabled={disabled}
              onClick={() => set([...chosen, index])}
              className="rounded-md border px-2.5 py-1 font-serif text-[1.0625rem] hover:border-border-strong disabled:opacity-60"
            >
              {word}
            </button>
          ),
        )}
      </div>
      {!disabled && chosen.length > 0 ? (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => set(chosen.slice(0, -1))}>
            <Undo2 aria-hidden="true" />
            Undo
          </Button>
          <Button variant="ghost" size="sm" onClick={() => set([])}>
            <X aria-hidden="true" />
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const VERDICT_LABELS = { correct: 'Correct', acceptable: 'Acceptable', incorrect: 'Not correct' } as const;

function SecondOpinion({
  question,
  answer,
  level,
  topic,
  review,
  onReview,
}: {
  question: Extract<GrammarQuestion, { type: 'error_correction' | 'transformation' | 'sentence_completion' }>;
  answer: string;
  level: GrammarLevel;
  topic: GrammarTopic;
  review: StoredGrammarReview | undefined;
  onReview: (response: GrammarEvaluationResponse) => void;
}) {
  const job = useApiJob<GrammarEvaluationRequest, GrammarEvaluationResponse>('/api/grammar/evaluations', grammarEvaluationResponseSchema, 'The review failed unexpectedly. Try again.');

  if (review) {
    return (
      <div className="rounded-md border px-3.5 py-3" role="note">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <MessageSquareText aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="font-medium">AI second opinion: {VERDICT_LABELS[review.verdict]}</span>
          <span className="text-xs text-muted-foreground">(doesn't change your score)</span>
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{review.explanation}</p>
        {review.correctedAnswer ? (
          <p className="mt-1.5 text-sm">
            <span className="text-muted-foreground">Suggested: </span>
            <span className="font-serif">{review.correctedAnswer}</span>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Think your answer is also correct? An AI reviewer can check it against an explicit rubric. Your question and answer are sent to Groq; your score stays as it is.
      </p>
      {job.state.phase === 'running' ? (
        <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          Reviewing your answer…
        </p>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={async () => {
            const response = await job.start({
              level,
              topic,
              question: {
                type: question.type,
                prompt: question.prompt,
                sourceSentence: question.type === 'transformation' ? question.sourceSentence : null,
                keyword: question.type === 'transformation' ? question.keyword : null,
                acceptedAnswers: question.acceptedAnswers,
                rule: question.rule,
              },
              answer,
            });
            if (response) onReview(response);
          }}
        >
          <MessageSquareText aria-hidden="true" />
          Ask for a second opinion
        </Button>
      )}
      {job.state.phase === 'failed' ? (
        <Notice tone="error" role="alert">
          {job.state.message}
        </Notice>
      ) : null}
    </div>
  );
}

export interface GrammarQuestionItemProps {
  readonly question: GrammarQuestion;
  readonly number: number;
  readonly answer: GrammarAnswer | undefined;
  readonly checked: boolean;
  readonly level: GrammarLevel;
  readonly topic: GrammarTopic;
  readonly review: StoredGrammarReview | undefined;
  readonly canReview: boolean;
  readonly onAnswer: (answer: GrammarAnswer) => void;
  readonly onReview: (response: GrammarEvaluationResponse, answer: string) => void;
}

/** One question: answer input before checking; result, key, rule and explanations after. */
export function GrammarQuestionItem({ question, number, answer, checked, level, topic, review, canReview, onAnswer, onReview }: GrammarQuestionItemProps) {
  const id = useId();
  const evaluation = evaluateGrammarAnswer(question, answer);
  const text = answer?.kind === 'text' ? answer.text : '';
  const setText = (value: string) => onAnswer({ kind: 'text', questionId: question.id, text: value });
  const answered = answer !== undefined && (answer.kind === 'choice' || answer.text.trim() !== '');
  const correctAnswers = question.type === 'multiple_choice' ? [question.options[question.correctOptionIndex] ?? ''] : question.acceptedAnswers;

  return (
    <li className="flex flex-col gap-3.5 rounded-lg border px-4 py-4 sm:px-5" aria-labelledby={`${id}-label`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span id={`${id}-label`} className="font-mono tabular-nums">
          Question {number}
        </span>
        <Badge variant="neutral">{QUESTION_TYPE_LABELS[question.type].label}</Badge>
        {checked ? (
          evaluation.correct ? (
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-success">
              <CircleCheck aria-hidden="true" className="size-4" />
              Correct
            </span>
          ) : (
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-destructive">
              <CircleX aria-hidden="true" className="size-4" />
              {answered ? 'Not quite' : 'Not answered'}
            </span>
          )
        ) : null}
      </div>

      {question.type === 'transformation' ? (
        <div className="flex flex-col gap-2">
          <p className="font-serif text-[1.0625rem] leading-relaxed">{question.sourceSentence}</p>
          <p className="text-sm text-muted-foreground">
            Use the word <span className="rounded border border-foreground/40 px-1.5 py-0.5 font-mono text-xs font-medium tracking-wide text-foreground">{question.keyword}</span> unchanged:
          </p>
          <p className="font-serif text-[1.0625rem] leading-relaxed">
            <Prompt prompt={question.prompt} />
          </p>
        </div>
      ) : question.type === 'word_order' ? (
        <p className="text-sm text-muted-foreground">{question.prompt}</p>
      ) : (
        <p className="font-serif text-[1.125rem] leading-relaxed">
          <Prompt prompt={question.prompt} />
        </p>
      )}

      {/* Answer input */}
      {question.type === 'multiple_choice' ? (
        <fieldset disabled={checked} aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
          {question.options.map((option, index) => {
            const selected = answer?.kind === 'choice' && answer.selectedIndex === index;
            const isKey = index === question.correctOptionIndex;
            return (
              <label
                key={option}
                className={cn(
                  'flex items-start gap-3 rounded-md border px-3.5 py-2.5 text-[0.9375rem] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                  !checked && (selected ? 'cursor-pointer border-foreground bg-accent/60' : 'cursor-pointer border-input hover:border-border-strong'),
                  checked && isKey && 'border-success bg-success-subtle',
                  checked && selected && !isKey && 'border-destructive bg-destructive-subtle',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-option`}
                  checked={selected}
                  onChange={() => onAnswer({ kind: 'choice', questionId: question.id, selectedIndex: index })}
                  className="mt-1 size-4 accent-[var(--brand)] focus-visible:outline-none"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-serif text-[1.0625rem]">{option}</span>
                  {checked && question.distractorExplanations[index] ? (
                    <span className={cn('mt-1 block text-sm', isKey ? 'text-success' : 'text-muted-foreground')}>{question.distractorExplanations[index]}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : question.type === 'word_order' ? (
        <WordOrder question={question} text={text} disabled={checked} onChange={setText} />
      ) : question.type === 'error_correction' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-answer`} className="text-sm font-medium">
            Corrected sentence
          </label>
          <AutoGrowTextarea
            id={`${id}-answer`}
            value={text}
            disabled={checked}
            maxLength={400}
            spellCheck={false}
            placeholder="Rewrite the sentence correctly"
            onChange={(event) => setText(event.target.value)}
            className={cn(FIELD_CLASS, 'font-serif text-[1.0625rem]')}
          />
          {!checked && text === '' ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setText(question.prompt)}>
              Start from the original sentence
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-answer`} className="text-sm font-medium">
            {question.type === 'sentence_completion' ? 'Your ending' : 'Missing words'}
          </label>
          <Input
            id={`${id}-answer`}
            value={text}
            disabled={checked}
            maxLength={400}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            className="font-serif text-[1.0625rem]"
          />
        </div>
      )}

      {/* Result */}
      {checked ? (
        <div className="flex flex-col gap-3 border-t pt-3.5">
          {question.type !== 'multiple_choice' ? (
            <div className="flex flex-col gap-1.5 text-sm">
              {answered && !evaluation.correct ? (
                <p>
                  <span className="text-muted-foreground">Your answer: </span>
                  <span className="font-serif text-[1.0625rem] text-destructive line-through decoration-destructive/60">{text}</span>
                </p>
              ) : null}
              <div>
                <span className="text-muted-foreground">{correctAnswers.length > 1 ? 'Accepted answers:' : 'Answer:'}</span>
                <ul className="mt-1 flex flex-col gap-1">
                  {correctAnswers.map((accepted) => (
                    <li key={accepted} className="font-serif text-[1.0625rem]">
                      {question.type === 'gap_fill' || question.type === 'transformation' ? <Prompt prompt={question.prompt} fill={<span className="font-medium text-success">{accepted}</span>} /> : accepted}
                    </li>
                  ))}
                </ul>
                {(question.type === 'gap_fill' || question.type === 'transformation') && correctAnswers[0] ? (
                  <span className="sr-only">Full sentence: {fillGap(question.prompt, correctAnswers[0])}</span>
                ) : null}
              </div>
            </div>
          ) : null}
          <p className="text-sm leading-relaxed">
            <span className="font-medium">Why: </span>
            {question.explanation}
          </p>
          <p className="rounded-md bg-muted/60 px-3.5 py-2.5 text-sm leading-relaxed">
            <span className="font-medium">Rule: </span>
            {question.rule}
          </p>
          {canReview && (question.type === 'error_correction' || question.type === 'transformation' || question.type === 'sentence_completion') ? (
            <SecondOpinion question={question} answer={text} level={level} topic={topic} review={review} onReview={(response) => onReview(response, text)} />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
