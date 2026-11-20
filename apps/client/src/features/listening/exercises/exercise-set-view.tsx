import {
  formatTimestamp,
  questionOutcome,
  resemblesAcceptedAnswer,
  summarizeListeningResults,
  withListeningAnswer,
  type ListeningAnswer,
  type ListeningExerciseSet,
  type ListeningQuestion,
  type QuestionOutcome,
} from '@ldg/shared';
import { CircleCheck, CircleDashed, CircleX, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/utils';
import { QUESTION_TYPE_LABELS } from './exercise-labels';
import type { SetUpdater } from './use-listening-exercises';

const FIELD_CLASS =
  'w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[0.9375rem] leading-relaxed hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none disabled:opacity-80';

const OUTCOME: Record<QuestionOutcome, { label: string; icon: typeof CircleCheck; className: string }> = {
  correct: { label: 'Correct', icon: CircleCheck, className: 'text-success' },
  partly: { label: 'Partly right', icon: CircleDashed, className: 'text-brand' },
  incorrect: { label: 'Not quite', icon: CircleX, className: 'text-destructive' },
  unanswered: { label: 'Not answered', icon: CircleDashed, className: 'text-muted-foreground' },
  unrated: { label: 'Compare your answer', icon: CircleDashed, className: 'text-muted-foreground' },
};

function Evidence({
  question,
  stale,
  canPlay,
  onPlay,
}: {
  question: ListeningQuestion;
  stale: boolean;
  canPlay: boolean;
  onPlay: (question: ListeningQuestion) => void;
}) {
  return (
    <figure className="rounded-md border-l-2 border-brand bg-muted/50 px-3.5 py-2.5">
      <figcaption className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>From the recording at {formatTimestamp(question.startMs / 1000)}</span>
        {!stale ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => onPlay(question)}
            disabled={!canPlay}
            title={canPlay ? undefined : 'Open the recording above to play this part'}
          >
            <Play aria-hidden="true" />
            Play this part
          </Button>
        ) : null}
      </figcaption>
      <blockquote className="font-serif text-[0.9375rem] leading-relaxed">“{question.evidenceQuote}”</blockquote>
    </figure>
  );
}

function QuestionItem({
  question,
  number,
  answer,
  submitted,
  stale,
  canPlay,
  onAnswer,
  onPlay,
}: {
  question: ListeningQuestion;
  number: number;
  answer: ListeningAnswer | undefined;
  submitted: boolean;
  stale: boolean;
  canPlay: boolean;
  onAnswer: (answer: ListeningAnswer) => void;
  onPlay: (question: ListeningQuestion) => void;
}) {
  const id = useId();
  const outcome = questionOutcome(question, answer);
  const shortText = answer?.format === 'short_answer' ? answer.text : '';
  const [draft, setDraft] = useState(shortText);
  useEffect(() => setDraft(shortText), [shortText]);
  const Outcome = OUTCOME[outcome];

  return (
    <li className="flex flex-col gap-3 rounded-lg border px-4 py-4" aria-labelledby={`${id}-q`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">Q{number}</span>
        <Badge variant="neutral">{QUESTION_TYPE_LABELS[question.type].label}</Badge>
        <Badge variant="outline">{question.difficulty}</Badge>
        {submitted ? (
          <span className={cn('ml-auto inline-flex items-center gap-1 font-medium', Outcome.className)}>
            <Outcome.icon aria-hidden="true" className="size-4" />
            {Outcome.label}
          </span>
        ) : null}
      </div>
      <p id={`${id}-q`} className="text-base leading-relaxed font-medium">
        {question.question}
      </p>

      {question.format === 'multiple_choice' ? (
        <fieldset disabled={submitted} aria-labelledby={`${id}-q`} className="flex flex-col gap-2">
          {question.options.map((option, index) => {
            const selected = answer?.format === 'multiple_choice' && answer.selectedIndex === index;
            const correct = submitted && index === question.correctOptionIndex;
            const wrongChoice = submitted && selected && !correct;
            return (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-2.5 text-sm leading-relaxed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                  !submitted && (selected ? 'border-foreground bg-accent/60' : 'border-input hover:border-border-strong'),
                  correct && 'border-success bg-success-subtle',
                  wrongChoice && 'border-destructive bg-destructive-subtle',
                  submitted && !correct && !wrongChoice && 'border-input opacity-80',
                  submitted && 'cursor-default',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-options`}
                  checked={selected}
                  onChange={() => onAnswer({ format: 'multiple_choice', questionId: question.id, selectedIndex: index })}
                  className="mt-1 size-4 accent-[var(--brand)] focus-visible:outline-none"
                />
                <span className="min-w-0 flex-1">
                  {option}
                  {correct ? <span className="mt-0.5 block text-xs font-medium text-success">Correct answer{selected ? ' · your answer' : ''}</span> : null}
                  {wrongChoice ? <span className="mt-0.5 block text-xs font-medium text-destructive">Your answer</span> : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-answer`} className="sr-only">
            Your answer to question {number}
          </label>
          <AutoGrowTextarea
            id={`${id}-answer`}
            value={draft}
            rows={2}
            maxLength={1000}
            disabled={submitted}
            placeholder="Answer in a few words or a sentence"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft !== shortText) onAnswer({ format: 'short_answer', questionId: question.id, text: draft, selfAssessment: null });
            }}
            className={FIELD_CLASS}
          />
          {submitted ? (
            <div className="flex flex-col gap-3 rounded-md bg-muted/50 px-3.5 py-3">
              <div>
                <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Accepted answers</p>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm">
                  {question.acceptedAnswers.map((accepted) => (
                    <li key={accepted}>{accepted}</li>
                  ))}
                </ul>
              </div>
              {shortText.trim() !== '' ? (
                <div className="flex flex-col gap-2">
                  {resemblesAcceptedAnswer(shortText, question.acceptedAnswers) ? (
                    <p className="text-xs text-muted-foreground">Your answer contains the words of an accepted answer.</p>
                  ) : null}
                  <div role="group" aria-label={`How well did you answer question ${number}?`} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">How did you do?</span>
                    {(['correct', 'partly', 'incorrect'] as const).map((value) => {
                      const selected = answer?.format === 'short_answer' && answer.selfAssessment === value;
                      return (
                        <Button
                          key={value}
                          size="sm"
                          variant={selected ? 'primary' : 'secondary'}
                          aria-pressed={selected}
                          onClick={() => onAnswer({ format: 'short_answer', questionId: question.id, text: shortText, selfAssessment: value })}
                        >
                          {value === 'correct' ? 'Got it' : value === 'partly' ? 'Partly' : 'Missed it'}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {submitted ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed">
            <span className="font-medium">Why: </span>
            {question.explanation}
          </p>
          <Evidence question={question} stale={stale} canPlay={canPlay} onPlay={onPlay} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Answer first, then check: explanations, correct answers and the transcript
 * passage only appear after "Check answers", so the set tests listening
 * rather than reading.
 */
export function ExerciseSetView({
  set,
  stale,
  canPlay,
  onChange,
  onPlay,
}: {
  set: ListeningExerciseSet;
  /** True when the session's transcript changed after the set was generated. */
  stale: boolean;
  canPlay: boolean;
  onChange: (update: SetUpdater) => void;
  onPlay: (question: ListeningQuestion) => void;
}) {
  const submitted = set.submittedAt !== null;
  const summary = summarizeListeningResults(set);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const byQuestion = new Map(set.answers.map((answer) => [answer.questionId, answer]));
  const unanswered = summary.total - summary.answered;

  // Move focus to the results only when they appear after "Check answers", not when reopening a checked set.
  const wasSubmitted = useRef(submitted);
  useEffect(() => {
    if (submitted && !wasSubmitted.current) resultsRef.current?.focus();
    wasSubmitted.current = submitted;
  }, [submitted]);

  function answer(value: ListeningAnswer) {
    onChange((current) => withListeningAnswer(current, value, Date.now()));
  }

  function submit() {
    setConfirmSubmit(false);
    // Functional update: a short answer saved on blur just before this click is kept.
    onChange((current) => ({ ...current, submittedAt: Date.now(), updatedAt: Date.now() }));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand">AI-generated</Badge>
          <Badge variant="outline">{set.level}</Badge>
          <span className="text-xs text-muted-foreground">
            {set.questions.length} questions{set.truncated ? ' · covers the first part of the recording' : ''}
          </span>
        </div>
        <CardTitle className="mt-2 outline-none" ref={resultsRef} tabIndex={-1}>
          {submitted ? 'Your results' : 'Answer from what you heard'}
        </CardTitle>
        <CardDescription>
          {submitted
            ? summary.unrated > 0
              ? `Compare your short answers with the accepted answers and rate them (${summary.unrated} to rate).`
              : `${summary.correct} correct${summary.partly ? `, ${summary.partly} partly right` : ''} out of ${summary.total}.`
            : 'Replay the recording as often as you like. Answers are saved as you go; explanations appear when you check.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-1">
        {stale ? (
          <Notice>
            <span className="inline-flex items-center gap-1.5">
              <TriangleAlert aria-hidden="true" className="size-4" />
              The transcript changed after these questions were generated. They still quote the earlier transcript, so playback links are off.
            </span>
          </Notice>
        ) : null}
        {submitted ? (
          <div className="grid grid-cols-3 gap-2 text-center" aria-label="Summary">
            <div className="rounded-md border px-2 py-2.5">
              <p className="font-mono text-xl tabular-nums">{summary.correct}</p>
              <p className="text-xs text-muted-foreground">Correct</p>
            </div>
            <div className="rounded-md border px-2 py-2.5">
              <p className="font-mono text-xl tabular-nums">{summary.partly}</p>
              <p className="text-xs text-muted-foreground">Partly</p>
            </div>
            <div className="rounded-md border px-2 py-2.5">
              <p className="font-mono text-xl tabular-nums">{summary.incorrect + (summary.total - summary.answered)}</p>
              <p className="text-xs text-muted-foreground">To review</p>
            </div>
          </div>
        ) : null}

        <ol className="flex flex-col gap-3">
          {set.questions.map((question, index) => (
            <QuestionItem
              key={question.id}
              question={question}
              number={index + 1}
              answer={byQuestion.get(question.id)}
              submitted={submitted}
              stale={stale}
              canPlay={canPlay}
              onAnswer={answer}
              onPlay={onPlay}
            />
          ))}
        </ol>

        {set.discarded > 0 ? (
          <p className="text-xs text-muted-foreground">
            {set.discarded} generated {set.discarded === 1 ? 'question was' : 'questions were'} left out because {set.discarded === 1 ? 'its' : 'their'} evidence
            couldn't be found in the transcript.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {submitted ? (
            <Button variant="secondary" onClick={() => setConfirmRetry(true)}>
              <RotateCcw aria-hidden="true" />
              Answer again
            </Button>
          ) : (
            <Button onClick={() => (unanswered > 0 ? setConfirmSubmit(true) : submit())}>Check answers</Button>
          )}
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmSubmit}
        title="Check your answers now?"
        description={`${unanswered} ${unanswered === 1 ? 'question has' : 'questions have'} no answer yet. After checking, answers are locked and the explanations are shown.`}
        confirmLabel="Check answers"
        onConfirm={submit}
        onCancel={() => setConfirmSubmit(false)}
      />
      <ConfirmDialog
        open={confirmRetry}
        title="Answer these questions again?"
        description="Your current answers and results for this set will be cleared."
        confirmLabel="Start again"
        onConfirm={() => {
          setConfirmRetry(false);
          onChange((current) => ({ ...current, answers: [], submittedAt: null, updatedAt: Date.now() }));
        }}
        onCancel={() => setConfirmRetry(false)}
      />
    </Card>
  );
}
