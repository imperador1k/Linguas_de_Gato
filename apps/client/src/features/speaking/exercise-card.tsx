import { compareTexts, formatTimestamp, type AssessmentExercise, type ExerciseResponse, type ExerciseType } from '@ldg/shared';
import { Play } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DictationDiff } from '../listening/dictation/dictation-diff';

const TYPE_LABELS: Readonly<Record<ExerciseType, string>> = {
  correct_the_error: 'Correct the error',
  natural_collocation: 'Natural collocation',
  reformulate: 'Reformulate',
  linking: 'Linking ideas',
  develop_argument: 'Develop the argument',
};

/** Exercises with one expected answer get a word-level comparison; open ones just show the model answer. */
const COMPARABLE: ReadonlySet<ExerciseType> = new Set(['correct_the_error', 'natural_collocation']);

/**
 * A follow-up exercise built from the learner's own words. Answers are kept
 * with the attempt; the model answer is one good option, not the only one.
 */
export function ExerciseCard({
  exercise,
  index,
  response,
  onSave,
  onSeek,
}: {
  exercise: AssessmentExercise;
  index: number;
  response: ExerciseResponse | undefined;
  onSave: (response: ExerciseResponse) => void;
  onSeek?: (ms: number) => void;
}) {
  const [answer, setAnswer] = useState(response?.answer ?? '');
  const [revealed, setRevealed] = useState(response?.revealed ?? false);
  const fieldId = useId();
  const comparison = revealed && COMPARABLE.has(exercise.type) && answer.trim() ? compareTexts(exercise.modelAnswer, answer) : null;

  function save(next: { answer?: string; revealed?: boolean }) {
    onSave({
      exerciseId: exercise.id,
      answer: next.answer ?? answer,
      revealed: next.revealed ?? revealed,
      updatedAt: Date.now(),
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
          {index + 1}. {TYPE_LABELS[exercise.type]} · {exercise.focus}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 font-mono text-xs tabular-nums"
          disabled={!onSeek}
          onClick={() => onSeek?.(exercise.startMs)}
          aria-label={`Play your recording at ${formatTimestamp(exercise.startMs / 1000)}`}
        >
          <Play aria-hidden="true" />
          {formatTimestamp(exercise.startMs / 1000)}
        </Button>
      </div>
      <p className="text-sm leading-relaxed">{exercise.instruction}</p>
      <blockquote className="border-l-2 border-border-strong pl-3 font-serif text-[1.0625rem] leading-relaxed" lang="en">
        <span className="sr-only">From your answer: </span>“{exercise.sourceQuote}”
      </blockquote>
      <label htmlFor={fieldId} className="text-sm font-medium">
        Your version
      </label>
      <textarea
        id={fieldId}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        onBlur={() => answer !== (response?.answer ?? '') && save({})}
        rows={2}
        lang="en"
        className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-serif text-[1.0625rem] leading-relaxed transition-colors duration-150 hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none"
      />
      {!revealed ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setRevealed(true);
              save({ revealed: true });
            }}
          >
            {answer.trim() ? 'Compare with a model answer' : 'Show a model answer'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md bg-muted/60 px-3.5 py-3" aria-live="polite">
          <p className="text-xs text-muted-foreground">Model answer</p>
          <p className="font-serif text-[1.0625rem] leading-relaxed" lang="en">
            {exercise.modelAnswer}
          </p>
          {comparison && !comparison.isExactMatch ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">Your version compared with it</p>
              <DictationDiff alignment={comparison.alignment} />
            </>
          ) : null}
          {comparison?.isExactMatch ? <p className="text-sm text-success">Your version matches the model answer.</p> : null}
          {!COMPARABLE.has(exercise.type) ? (
            <p className="text-xs text-muted-foreground">There are many good answers to this one; compare the ideas, not the exact words.</p>
          ) : null}
        </div>
      )}
    </li>
  );
}
