import {
  LOCAL_PRACTICE_MODEL,
  OBJECTIVE_VOCABULARY_TYPES,
  checkVocabularySet,
  evaluateVocabularyAnswer,
  retryVocabularySet,
  scoreVocabularySet,
  vocabularyEvaluationResponseSchema,
  withVocabularyAnswer,
  withVocabularyReview,
  type StoredVocabularyReview,
  type VocabularyAnswer,
  type VocabularyEntry,
  type VocabularyEvaluationRequest,
  type VocabularyEvaluationResponse,
  type VocabularyPracticeSet,
  type VocabularyQuestion,
} from '@ldg/shared';
import { CircleCheck, CircleDashed, CircleX, LoaderCircle, MessageSquareText, RotateCcw, Trash } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FIELD_CLASS, SELECT_CLASS } from '@/components/ui/choice-group';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { createAutosaver, type Autosaver } from '@/lib/autosave';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { useApiJob } from '@/lib/use-api-job';
import { cn } from '@/lib/utils';
import { vocabularyStorage } from './storage/vocabulary-repository';
import { PRACTICE_TYPE_LABELS } from './vocabulary-labels';

const VERDICTS = { correct: 'Correct', partly: 'Partly right', incorrect: 'Not quite' } as const;

function Prompt({ text }: { text: string }) {
  const [before, after] = text.split('___') as [string, string | undefined];
  if (after === undefined) return <>{text}</>;
  return (
    <>
      {before}
      <span aria-label="blank" className="mx-0.5 inline-block w-16 border-b-2 border-foreground/50 align-baseline">
        &nbsp;
      </span>
      {after}
    </>
  );
}

function AiFeedback({
  question,
  answer,
  entry,
  review,
  onReview,
}: {
  question: Extract<VocabularyQuestion, { type: 'sentence_completion' | 'paraphrase' | 'own_sentence' }>;
  answer: string;
  entry: VocabularyEntry | undefined;
  review: StoredVocabularyReview | undefined;
  onReview: (response: VocabularyEvaluationResponse) => void;
}) {
  const job = useApiJob<VocabularyEvaluationRequest, VocabularyEvaluationResponse>('/api/vocabulary/evaluations', vocabularyEvaluationResponseSchema, 'The evaluation failed unexpectedly. Try again.');
  if (review) {
    return (
      <div className="rounded-md border px-3.5 py-3" role="note">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <MessageSquareText aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="font-medium">AI feedback: {VERDICTS[review.verdict]}</span>
          {!review.usesExpressionCorrectly ? <Badge variant="destructive">Expression not used as intended</Badge> : null}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{review.feedback}</p>
        {review.improvedAnswer ? (
          <p className="mt-1.5 text-sm">
            <span className="text-muted-foreground">Suggested: </span>
            <span className="font-serif text-[1.0625rem]">{review.improvedAnswer}</span>
          </p>
        ) : null}
      </div>
    );
  }
  const sense = entry?.senses[0];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Open answers can't be judged by matching words. Ask for feedback against explicit criteria: right meaning, task met, grammatical and natural. Your answer is sent to Groq.</p>
      {job.state.phase === 'running' ? (
        <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          Checking your answer…
        </p>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={!entry || !sense}
          onClick={async () => {
            if (!entry || !sense) return;
            const response = await job.start({
              expression: entry.expression,
              meaning: sense.contextualMeaning,
              task: question.type,
              prompt: question.prompt,
              exampleAnswers: question.type === 'own_sentence' ? [] : question.acceptedAnswers,
              answer,
            });
            if (response) onReview(response);
          }}
        >
          <MessageSquareText aria-hidden="true" />
          Get feedback on my answer
        </Button>
      )}
      {!entry ? <p className="text-xs text-muted-foreground">This expression is no longer in your collection.</p> : null}
      {job.state.phase === 'failed' ? (
        <Notice tone="error" role="alert">
          {job.state.message}
        </Notice>
      ) : null}
    </div>
  );
}

function QuestionItem({
  question,
  number,
  set,
  entries,
  onAnswer,
  onReview,
}: {
  question: VocabularyQuestion;
  number: number;
  set: VocabularyPracticeSet;
  entries: Map<string, VocabularyEntry>;
  onAnswer: (answer: VocabularyAnswer) => void;
  onReview: (response: VocabularyEvaluationResponse, answer: string) => void;
}) {
  const id = useId();
  const checked = set.checkedAt !== null;
  const answer = set.answers.find((candidate) => candidate.questionId === question.id);
  const outcome = evaluateVocabularyAnswer(question, answer);
  const text = answer?.kind === 'text' ? answer.text : '';
  const setText = (value: string) => onAnswer({ kind: 'text', questionId: question.id, text: value });
  const review = set.reviews.find((candidate) => candidate.questionId === question.id);
  const entry = entries.get(question.itemId);
  const objective = OBJECTIVE_VOCABULARY_TYPES.has(question.type);

  return (
    <li className="flex flex-col gap-3 rounded-lg border px-4 py-4 sm:px-5" aria-labelledby={`${id}-label`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span id={`${id}-label`} className="font-mono tabular-nums">
          Question {number}
        </span>
        <Badge variant="neutral">{PRACTICE_TYPE_LABELS[question.type].label}</Badge>
        {checked ? (
          outcome === 'correct' ? (
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-success">
              <CircleCheck aria-hidden="true" className="size-4" />
              Correct
            </span>
          ) : outcome === 'incorrect' ? (
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-destructive">
              <CircleX aria-hidden="true" className="size-4" />
              Not quite
            </span>
          ) : outcome === 'open' ? (
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-muted-foreground">
              <CircleDashed aria-hidden="true" className="size-4" />
              {review ? `AI: ${VERDICTS[review.verdict]}` : 'Open answer'}
            </span>
          ) : (
            <span className="ml-auto text-muted-foreground">Not answered</span>
          )
        ) : null}
      </div>
      <p className={cn('leading-relaxed', question.type === 'own_sentence' || question.type === 'paraphrase' || question.type === 'matching' ? 'text-[0.9375rem]' : 'font-serif text-[1.125rem]')}>
        <Prompt text={question.prompt} />
      </p>

      {question.type === 'meaning_choice' || question.type === 'collocation' ? (
        <fieldset disabled={checked} aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
          {question.options.map((option, index) => {
            const selected = answer?.kind === 'choice' && answer.selectedIndex === index;
            const isKey = checked && index === question.correctOptionIndex;
            return (
              <label
                key={option}
                className={cn(
                  'flex items-start gap-3 rounded-md border px-3.5 py-2.5 text-[0.9375rem] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                  !checked && (selected ? 'cursor-pointer border-foreground bg-accent/60' : 'cursor-pointer border-input hover:border-border-strong'),
                  isKey && 'border-success bg-success-subtle',
                  checked && selected && !isKey && 'border-destructive bg-destructive-subtle',
                )}
              >
                <input type="radio" name={`${id}-o`} checked={selected} onChange={() => onAnswer({ kind: 'choice', questionId: question.id, selectedIndex: index })} className="mt-1 size-4 accent-[var(--brand)]" />
                <span className="min-w-0 flex-1">{option}</span>
              </label>
            );
          })}
        </fieldset>
      ) : question.type === 'matching' ? (
        <div className="flex flex-col gap-2.5">
          {question.pairs.map((pair, pairIndex) => {
            const order = set.shuffles[question.id] ?? question.pairs.map((_, index) => index);
            const choices = answer?.kind === 'matching' ? answer.choices : question.pairs.map(() => -1);
            const value = choices[pairIndex] ?? -1;
            const right = checked && value === pairIndex;
            return (
              <div key={pair.itemId} className="grid items-center gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <label htmlFor={`${id}-m${pairIndex}`} className="font-serif text-[1.0625rem]">
                  {pair.expression}
                </label>
                <div className="flex items-center gap-2">
                  <select
                    id={`${id}-m${pairIndex}`}
                    value={value}
                    disabled={checked}
                    onChange={(event) => {
                      const next = [...choices];
                      next[pairIndex] = Number(event.target.value);
                      onAnswer({ kind: 'matching', questionId: question.id, choices: next });
                    }}
                    className={cn(SELECT_CLASS, checked && (right ? 'border-success' : 'border-destructive'))}
                  >
                    <option value={-1}>Choose a meaning…</option>
                    {order.map((meaningIndex) => (
                      <option key={meaningIndex} value={meaningIndex}>
                        {question.pairs[meaningIndex]?.meaning}
                      </option>
                    ))}
                  </select>
                  {checked ? right ? <CircleCheck aria-label="Correct" className="size-4 shrink-0 text-success" /> : <CircleX aria-label="Incorrect" className="size-4 shrink-0 text-destructive" /> : null}
                </div>
                {checked && !right ? <p className="text-sm text-muted-foreground sm:col-start-2">Answer: {pair.meaning}</p> : null}
              </div>
            );
          })}
        </div>
      ) : question.type === 'gap_fill' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-a`} className="text-sm font-medium">
            Missing words
          </label>
          <Input id={`${id}-a`} value={text} disabled={checked} maxLength={400} autoComplete="off" spellCheck={false} onChange={(event) => setText(event.target.value)} className="font-serif text-[1.0625rem]" />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-a`} className="text-sm font-medium">
            {question.type === 'sentence_completion' ? 'Your ending' : question.type === 'paraphrase' ? 'Your rewrite' : 'Your sentence'}
          </label>
          <AutoGrowTextarea id={`${id}-a`} value={text} disabled={checked} maxLength={400} onChange={(event) => setText(event.target.value)} className={cn(FIELD_CLASS, 'font-serif text-[1.0625rem]')} />
        </div>
      )}

      {checked ? (
        <div className="flex flex-col gap-3 border-t pt-3">
          {(question.type === 'gap_fill' || question.type === 'sentence_completion' || question.type === 'paraphrase') && outcome !== 'correct' ? (
            <div className="text-sm">
              <span className="text-muted-foreground">{objective ? (question.acceptedAnswers.length > 1 ? 'Accepted answers:' : 'Answer:') : 'Example answers:'}</span>
              <ul className="mt-1 flex flex-col gap-0.5 font-serif text-[1.0625rem]">
                {question.acceptedAnswers.map((accepted) => (
                  <li key={accepted}>{accepted}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-sm leading-relaxed">
            <span className="font-medium">Note: </span>
            {question.explanation}
          </p>
          {outcome === 'open' && (question.type === 'sentence_completion' || question.type === 'paraphrase' || question.type === 'own_sentence') ? (
            <AiFeedback question={question} answer={text} entry={entry} review={review} onReview={(response) => onReview(response, text)} />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function VocabularyPracticePage() {
  const { setId = '' } = useParams();
  const navigate = useNavigate();
  const storage = vocabularyStorage.use();
  const [set, setSetState] = useState<VocabularyPracticeSet | null | 'missing'>(null);
  const [entries, setEntries] = useState<Map<string, VocabularyEntry>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'check' | 'retry' | 'delete' | null>(null);
  const setRef = useRef<VocabularyPracticeSet | null>(null);
  const saverRef = useRef<Autosaver<VocabularyPracticeSet> | null>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!storage) return;
    let active = true;
    Promise.all([storage.repository.practiceSets.get(setId), storage.repository.entries.list()]).then(
      ([row, allEntries]) => {
        if (!active) return;
        setRef.current = row;
        setSetState(row ?? 'missing');
        setEntries(new Map(allEntries.map((entry) => [entry.id, entry])));
      },
      (caught: unknown) => {
        if (!active) return;
        setError(describeStorageFailure(caught));
        setSetState('missing');
      },
    );
    const saver = createAutosaver<VocabularyPracticeSet>({ delayMs: 400, save: (value) => storage.repository.practiceSets.put(value), onStatus: (status, failure) => setError(status === 'error' ? describeStorageFailure(failure) : null) });
    saverRef.current = saver;
    const flush = () => void saver.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      active = false;
      window.removeEventListener('pagehide', flush);
      void saver.flush().finally(() => saver.dispose());
    };
  }, [storage, setId]);

  function apply(change: (current: VocabularyPracticeSet) => VocabularyPracticeSet, immediate = false) {
    const current = setRef.current;
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    setRef.current = next;
    setSetState(next);
    saverRef.current?.schedule(next);
    if (immediate) void saverRef.current?.flush();
  }

  const back = { to: '/vocabulary', label: 'Vocabulary' } as const;

  if (set === null) return null;
  if (set === 'missing') return <PageHeader eyebrow="Vocabulary practice" title="Practice set not found" description={error ?? 'It may have been deleted.'} back={back} />;
  // Local trainer rounds have their own page.
  if (set.model === LOCAL_PRACTICE_MODEL) return <Navigate to={`/vocabulary/train/${set.id}`} replace />;

  const checked = set.checkedAt !== null;
  const score = scoreVocabularySet(set);
  const unanswered = score.total - score.answered;

  function check() {
    setConfirm(null);
    apply((current) => checkVocabularySet(current, Date.now()), true);
    window.setTimeout(() => resultsRef.current?.focus(), 0);
  }

  return (
    <>
      <PageHeader
        back={back}
        eyebrow="Vocabulary practice"
        title={`${set.questions.length} questions on ${set.entryIds.length} expression${set.entryIds.length === 1 ? '' : 's'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Delete practice set" title="Delete" onClick={() => setConfirm('delete')}>
              <Trash aria-hidden="true" />
            </Button>
          </div>
        }
      />
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {checked ? (
          <Card>
            <CardHeader>
              <CardTitle ref={resultsRef} tabIndex={-1} className="outline-none">
                {score.objectiveTotal > 0 ? `${score.correct} of ${score.objectiveTotal} correct` : 'Answers checked'}
              </CardTitle>
              <CardDescription>
                {score.objectiveTotal > 0 ? 'Objective questions are scored against the key. ' : ''}
                {score.open > 0 ? `${score.open} open answer${score.open === 1 ? '' : 's'} can get AI feedback below; it is shown separately from the score.` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="secondary" onClick={() => setConfirm('retry')}>
                <RotateCcw aria-hidden="true" />
                Try again
              </Button>
              {set.history.length > 1 ? <span className="text-sm text-muted-foreground">Earlier rounds: {set.history.slice(0, -1).map((round) => `${round.correct}/${round.objectiveTotal}`).join(' · ')}</span> : null}
            </CardContent>
          </Card>
        ) : null}
        <ol className="flex flex-col gap-3">
          {set.questions.map((question, index) => (
            <QuestionItem
              key={`${question.id}-${set.history.length}-${checked}`}
              question={question}
              number={index + 1}
              set={set}
              entries={entries}
              onAnswer={(answer) => apply((current) => withVocabularyAnswer(current, answer, Date.now()))}
              onReview={(response, answer) => apply((current) => withVocabularyReview(current, { ...response.review, questionId: question.id, answer, model: response.model, createdAt: response.createdAt }, Date.now()), true)}
            />
          ))}
        </ol>
        {!checked ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => (unanswered > 0 ? setConfirm('check') : check())}>
              Check answers
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              {score.answered} of {score.total} answered · saved automatically
            </span>
          </div>
        ) : null}
        {set.discarded > 0 ? <p className="text-xs text-muted-foreground">{set.discarded} generated question{set.discarded === 1 ? ' was' : 's were'} left out because {set.discarded === 1 ? 'it' : 'they'} failed the checks.</p> : null}
      </div>

      <ConfirmDialog
        open={confirm === 'check'}
        title="Check your answers now?"
        description={`${unanswered} question${unanswered === 1 ? ' has' : 's have'} no answer yet. Answers are locked once checked; you can try again afterwards.`}
        confirmLabel="Check answers"
        onConfirm={check}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'retry'}
        title="Try this practice again?"
        description="Your answers and AI feedback are cleared; earlier results are kept."
        confirmLabel="Try again"
        onConfirm={() => {
          setConfirm(null);
          apply((current) => retryVocabularySet(current, Date.now()), true);
          window.scrollTo({ top: 0 });
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this practice set?"
        description="Its questions, your answers and results are removed. Your saved expressions are not affected."
        confirmLabel="Delete set"
        destructive
        onConfirm={() => {
          setConfirm(null);
          saverRef.current?.dispose();
          storage?.repository.practiceSets.delete(setId).then(() => navigate('/vocabulary', { replace: true }), (caught: unknown) => setError(describeStorageFailure(caught)));
        }}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
