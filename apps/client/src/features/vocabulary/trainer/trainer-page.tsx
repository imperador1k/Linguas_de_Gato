import {
  GAP_MARKER,
  describeMatch,
  hintMask,
  hintsUsed,
  isCollectionRef,
  matchLocalAnswer,
  nextHint,
  situationOf,
  type LocalVocabularyQuestion,
  type MatchResult,
  type TrainerHint,
  type VocabularyAnswer,
  type VocabularyPracticeSet,
} from '@ldg/shared';
import { ArrowRight, CircleAlert, CircleCheck, CircleX, Lightbulb, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { cn } from '@/lib/utils';
import { loadPackById } from '../library/pack-loader';
import { vocabularyStorage } from '../storage/vocabulary-repository';
import { HighlightedContext } from '../vocabulary-detail';
import { clearPendingHints, clearRoundHints, loadPendingHints, savePendingHints } from './pending-hints';
import { MODE_LABELS } from './trainer-labels';
import { finishRound, isLocalSet, localQuestions, packIdOf, retryMissed, saveAnswer, type FinishOutcome } from './trainer-service';

const BACK = { to: '/vocabulary', label: 'Vocabulary' } as const;

type Verdict = MatchResult['verdict'];

const VERDICT_STYLE: Record<Verdict, { title: string; icon: typeof CircleCheck; tone: string; badge: 'success' | 'caution' | 'destructive' | 'neutral' }> = {
  correct: { title: 'Correct', icon: CircleCheck, tone: 'border-success/40 bg-success-subtle', badge: 'success' },
  almost: { title: 'Almost', icon: CircleAlert, tone: 'border-caution/40 bg-caution-subtle', badge: 'caution' },
  wrong_form: { title: 'Right word, wrong form', icon: CircleAlert, tone: 'border-caution/40 bg-caution-subtle', badge: 'caution' },
  incorrect: { title: 'Incorrect', icon: CircleX, tone: 'border-destructive/40 bg-destructive-subtle', badge: 'destructive' },
  empty: { title: 'Not known', icon: CircleX, tone: 'border-destructive/40 bg-destructive-subtle', badge: 'neutral' },
};

const HINT_LABELS: Record<TrainerHint, string> = { length: 'Show the length', first_letter: 'Show the first letter', letter: 'Show another letter' };

function Sentence({ text, fill }: { text: string; fill?: string }) {
  const [before, after] = text.split(GAP_MARKER);
  return (
    <p className="font-serif text-[1.375rem] leading-relaxed" lang="en">
      {before}
      {fill ? (
        <span className="rounded-sm bg-accent px-1 font-medium">{fill}</span>
      ) : (
        <span className="mx-0.5 inline-block w-24 border-b-2 border-foreground/60 align-baseline" aria-label="blank" role="img" />
      )}
      {after}
    </p>
  );
}

const PROMPT_LABELS: Record<Exclude<LocalVocabularyQuestion['type'], 'context'>, { label: string; lang: string }> = {
  spelling: { label: 'Portuguese (Portugal)', lang: 'pt-PT' },
  recognition: { label: 'English', lang: 'en' },
  definition: { label: 'Definition', lang: 'en' },
};

function Prompt({ question }: { question: LocalVocabularyQuestion }) {
  if (question.type === 'context') {
    return (
      <div className="flex flex-col gap-3">
        {question.clue ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Meaning:</span> {question.clue}
          </p>
        ) : null}
        <Sentence text={question.prompt} />
      </div>
    );
  }
  const label = PROMPT_LABELS[question.type];
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label.label}
        {question.partOfSpeech ? <span className="ml-2 font-normal tracking-normal normal-case">· {question.partOfSpeech}</span> : null}
      </p>
      <p className="font-serif text-[1.5rem] leading-snug" lang={label.lang}>
        {question.prompt}
      </p>
      {question.type === 'recognition' && question.example ? (
        <p className="mt-1 font-serif text-[1.0625rem] leading-relaxed text-muted-foreground" lang="en">
          <HighlightedContext sentence={question.example} expression={question.prompt} />
        </p>
      ) : null}
    </div>
  );
}

function Feedback({ question, answer, result, last, onNext }: { question: LocalVocabularyQuestion; answer: VocabularyAnswer | undefined; result: MatchResult; last: boolean; onNext: () => void }) {
  const style = VERDICT_STYLE[result.verdict];
  const Icon = style.icon;
  const hints = hintsUsed(answer);
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => nextRef.current?.focus(), []);
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className={cn('flex flex-col gap-2 rounded-lg border px-4 py-3.5', style.tone)}>
        <p className="flex items-center gap-2 font-medium">
          <Icon aria-hidden="true" className="size-5 shrink-0" />
          {style.title}
          {result.verdict === 'correct' && hints > 0 ? <span className="text-sm font-normal text-muted-foreground">· with {hints} hint{hints === 1 ? '' : 's'}</span> : null}
        </p>
        <p className="text-sm">{result.verdict === 'empty' ? `The answer is “${question.answer}”.` : describeMatch(result, situationOf(question))}</p>
        {question.type === 'context' ? <Sentence text={question.prompt} fill={result.verdict === 'correct' ? result.closest : question.answer} /> : null}
        {question.accepted.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Accepted: {[question.answer, ...question.accepted].join(', ')}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{question.explanation}</p>
      </div>
      <Button ref={nextRef} size="lg" className="self-start" onClick={onNext}>
        {last ? 'See results' : 'Next question'}
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}

function QuestionView({ setId, question, onSubmit }: { setId: string; question: LocalVocabularyQuestion; onSubmit: (text: string, hints: TrainerHint[]) => Promise<void> }) {
  const [text, setText] = useState('');
  // Hints taken before leaving the round come back, so they still count when the answer is scored.
  const [hints, setHints] = useState<TrainerHint[]>(() => loadPendingHints(setId, question.id, question.answer));
  const [busy, setBusy] = useState(false);
  // Hints come one at a time and never give the whole answer away.
  const hint = nextHint(question.answer, hints);
  const mask = hintMask(question.answer, hints);
  const answerLang = question.type === 'recognition' ? 'pt-PT' : question.language;

  async function submit(value: string) {
    if (busy) return;
    setBusy(true);
    await onSubmit(value, hints);
    setBusy(false);
  }

  function onForm(event: FormEvent) {
    event.preventDefault();
    if (text.trim() === '') return;
    void submit(text);
  }

  return (
    <form onSubmit={onForm} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="trainer-answer" className="text-sm font-medium">
          {question.type === 'recognition' ? 'Your answer in Portuguese' : 'Your answer in English'}
        </label>
        <Input
          id="trainer-answer"
          value={text}
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          lang={answerLang}
          maxLength={120}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          className="h-12 font-serif text-[1.25rem]"
        />
        <p className="text-xs text-muted-foreground">Press Enter to check.</p>
      </div>
      {mask ? (
        <p className="font-mono text-lg tracking-wide" aria-live="polite" aria-label={`Hint: ${mask.replace(/_/g, 'blank')}`}>
          {mask}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" disabled={busy || text.trim() === ''}>
          Check
        </Button>
        {hint ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              const taken = [...hints, hint];
              setHints(taken);
              savePendingHints(setId, question.id, taken);
            }}
          >
            <Lightbulb aria-hidden="true" />
            {HINT_LABELS[hint]}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void submit('')}>
          I don't know
        </Button>
      </div>
      {hints.length > 0 ? <p className="text-xs text-muted-foreground">Hints are recorded: a word answered with hints doesn't move up your review schedule.</p> : null}
    </form>
  );
}

function Results({ set, outcome, onRetry, retrying }: { set: VocabularyPracticeSet; outcome: FinishOutcome | null; onRetry: () => void; retrying: boolean }) {
  const questions = localQuestions(set);
  const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
  const rows = questions.map((question) => {
    const answer = answers.get(question.id);
    return { question, answer, result: matchLocalAnswer(question, answer), hints: hintsUsed(answer) };
  });
  const count = (verdict: Verdict) => rows.filter((row) => row.result?.verdict === verdict).length;
  const correct = count('correct');
  const hinted = rows.filter((row) => row.result?.verdict === 'correct' && row.hints > 0).length;
  const hard = rows.filter((row) => row.result?.verdict !== 'correct' || row.hints > 0).length;
  const wrongForm = (inContext: boolean) => rows.filter((row) => row.result?.verdict === 'wrong_form' && (row.question.type === 'context') === inContext).length;
  // The kinds of error made, so the learner sees what went wrong, not just how much.
  const summary = [
    { label: 'Correct', value: correct - hinted },
    { label: 'Correct with hints', value: hinted },
    { label: 'Almost (spelling or accents)', value: count('almost') },
    { label: 'Not the dictionary form', value: wrongForm(false) },
    { label: 'Wrong form for the sentence', value: wrongForm(true) },
    { label: 'Incorrect', value: count('incorrect') },
    { label: 'Not known', value: count('empty') },
  ].filter((item) => item.value > 0);
  const directions = (['spelling', 'recognition', 'context', 'definition'] as const)
    .map((type) => {
      const ofType = rows.filter((row) => row.question.type === type);
      return { type, total: ofType.length, correct: ofType.filter((row) => row.result?.verdict === 'correct' && row.hints === 0).length };
    })
    .filter((item) => item.total > 0);
  const fromCollection = questions.some((question) => isCollectionRef(question.ref));

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="results-title" className="rounded-lg border bg-card px-5 py-5">
        <h2 id="results-title" className="font-serif text-[1.75rem] leading-tight">
          {correct} of {questions.length} correct
        </h2>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {summary.map((item) => (
            <li key={item.label}>
              <span className="font-medium text-foreground tabular-nums">{item.value}</span> {item.label.toLowerCase()}
            </li>
          ))}
        </ul>
        {directions.length > 1 ? (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Correct without hints, by exercise">
            {directions.map((item) => (
              <li key={item.type}>
                {MODE_LABELS[item.type].short}{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {item.correct}/{item.total}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {outcome && (outcome.added > 0 || outcome.rescheduled > 0) ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {outcome.added > 0 ? `${outcome.added} word${outcome.added === 1 ? '' : 's'} added to your collection. ` : ''}
            {outcome.rescheduled > 0 ? `${outcome.rescheduled} review date${outcome.rescheduled === 1 ? '' : 's'} updated, each for the direction you answered.` : ''}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">Only answers without hints move a word up its schedule, and only while it is due. A wrong answer brings it back tomorrow.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {hard > 0 ? (
            <Button disabled={retrying} onClick={onRetry}>
              <RotateCcw aria-hidden="true" />
              Practise the {hard} that {hard === 1 ? 'was' : 'were'} hard
            </Button>
          ) : null}
          <Link to={fromCollection ? '/vocabulary?train=1' : '/vocabulary?view=library&train=library'} className={buttonVariants({ variant: hard > 0 ? 'secondary' : 'primary' })}>
            New round
          </Link>
          <Link to="/vocabulary" className={buttonVariants({ variant: 'ghost' })}>
            Back to Vocabulary
          </Link>
        </div>
      </section>

      <section aria-labelledby="answers-title">
        <h2 id="answers-title" className="mb-3 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
          Your answers
        </h2>
        <ol className="divide-y rounded-lg border bg-card">
          {rows.map(({ question, answer, result, hints }) => {
            const style = VERDICT_STYLE[result?.verdict ?? 'empty'];
            const typed = answer?.kind === 'typed' ? answer.text.trim() : '';
            return (
              <li key={question.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground">{question.type === 'context' ? question.prompt.replace(GAP_MARKER, '___') : question.prompt}</p>
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-serif text-[1.0625rem]">
                    {result?.verdict === 'correct' ? (
                      <span>{typed}</span>
                    ) : (
                      <>
                        {typed ? <span className="text-muted-foreground line-through decoration-destructive/60">{typed}</span> : <span className="font-sans text-sm text-muted-foreground">no answer</span>}
                        <ArrowRight aria-label="expected" className="size-4 self-center text-muted-foreground" />
                        <span className="font-medium">{question.answer}</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {directions.length > 1 ? <Badge variant="outline">{MODE_LABELS[question.type].short}</Badge> : null}
                  <Badge variant={style.badge}>{style.title}</Badge>
                  {hints > 0 ? <Badge variant="outline">{hints} hint{hints === 1 ? '' : 's'}</Badge> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

/**
 * A local Vocabulary Trainer round: one question at a time with immediate
 * feedback, progress, a results screen and a retry of the hard ones. Answers
 * are saved as they are given, so leaving and coming back resumes the round.
 * No request is made to the AI or any `/api/` endpoint.
 */
export function TrainerPage() {
  const { setId = '' } = useParams();
  const navigate = useNavigate();
  const storage = vocabularyStorage.use();
  const [set, setSet] = useState<VocabularyPracticeSet | null | 'missing'>(null);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<FinishOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const finishing = useRef(false);

  useEffect(() => {
    if (!storage) return;
    let active = true;
    setSet(null);
    setFeedbackFor(null);
    setOutcome(null);
    finishing.current = false;
    storage.repository.practiceSets.get(setId).then(
      (loaded) => active && setSet(loaded ?? 'missing'),
      (caught: unknown) => {
        if (!active) return;
        setError(describeStorageFailure(caught));
        setSet('missing');
      },
    );
    return () => {
      active = false;
    };
  }, [storage, setId]);

  const finish = useCallback(async () => {
    if (!storage || !set || set === 'missing' || finishing.current) return;
    finishing.current = true;
    setError(null);
    try {
      const packId = packIdOf(set);
      const pack = packId ? await loadPackById(packId) : null;
      const result = await finishRound(storage.repository, set.id, pack);
      clearRoundHints(set.id);
      if (result) {
        setOutcome(result);
        setSet(result.set);
      }
    } catch (caught) {
      setError(`Your answers are saved, but the round couldn't be completed. ${describeStorageFailure(caught)}`);
      finishing.current = false;
    }
  }, [storage, set]);

  // Once every question has an answer (and its feedback was seen), the round is checked automatically.
  const readyToFinish =
    set !== null && set !== 'missing' && isLocalSet(set) && set.checkedAt === null && feedbackFor === null && localQuestions(set).every((question) => set.answers.some((answer) => answer.questionId === question.id));
  useEffect(() => {
    if (readyToFinish && !error) void finish();
  }, [readyToFinish, error, finish]);

  if (set === 'missing') return <PageHeader eyebrow="Vocabulary trainer" title="Round not found" description={error ?? 'It may have been deleted.'} back={BACK} />;
  if (set === null || !storage) {
    return (
      <p role="status" className="py-24 text-center text-sm text-muted-foreground">
        Opening the round…
      </p>
    );
  }
  // AI practice sets keep their own page.
  if (!isLocalSet(set)) return <Navigate to={`/vocabulary/practice/${set.id}`} replace />;

  const questions = localQuestions(set);
  const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
  const nextIndex = questions.findIndex((question) => !answers.has(question.id));
  const feedbackIndex = feedbackFor ? questions.findIndex((question) => question.id === feedbackFor) : -1;
  const activeIndex = feedbackIndex >= 0 ? feedbackIndex : nextIndex;
  const active = activeIndex >= 0 ? questions[activeIndex] : undefined;
  const mixed = new Set(questions.map((question) => question.type)).size > 1;
  const mode = mixed ? { label: 'Mixed', instruction: 'Each question says which direction it practises. Answer in the language it asks for.' } : MODE_LABELS[questions[0]?.type ?? 'spelling'];
  const done = activeIndex < 0;

  async function submit(question: LocalVocabularyQuestion, text: string, hints: TrainerHint[]) {
    if (!storage || !set || set === 'missing') return;
    try {
      const updated = await saveAnswer(storage.repository, set.id, { kind: 'typed', questionId: question.id, text, hints, answeredAt: Date.now() });
      // The answer now carries its hints; the pending copy is no longer needed.
      clearPendingHints(set.id, question.id);
      if (updated) setSet(updated);
      setFeedbackFor(question.id);
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  async function retry() {
    if (!storage || !set || set === 'missing') return;
    setRetrying(true);
    try {
      const next = await retryMissed(storage.repository, set);
      if (next) navigate(`/vocabulary/train/${next.id}`);
    } catch (caught) {
      setError(describeStorageFailure(caught));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <PageHeader back={BACK} eyebrow="Vocabulary trainer" title={`${mode.label} round`} description={done ? 'Round complete. Your results are saved.' : mode.instruction} />

      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}{' '}
          {done && set.checkedAt === null ? (
            <button type="button" className="underline underline-offset-2" onClick={() => void finish()}>
              Try again
            </button>
          ) : null}
        </Notice>
      ) : null}

      {active ? (
        <div className="flex max-w-2xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Question <span className="font-medium text-foreground tabular-nums">{activeIndex + 1}</span> of <span className="tabular-nums">{questions.length}</span>
              </span>
              <Badge variant="neutral">{MODE_LABELS[active.type].label}</Badge>
            </div>
            <div role="progressbar" aria-label="Round progress" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={answers.size} className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(answers.size / questions.length) * 100}%` }} />
            </div>
          </div>

          <section aria-label={`Question ${activeIndex + 1}`} className="flex flex-col gap-5 rounded-lg border bg-card px-5 py-5">
            <Prompt question={active} />
            {feedbackFor === active.id ? (
              <Feedback
                question={active}
                answer={answers.get(active.id)}
                result={matchLocalAnswer(active, answers.get(active.id)) ?? { verdict: 'empty', reason: 'none', closest: active.answer }}
                last={nextIndex < 0}
                onNext={() => setFeedbackFor(null)}
              />
            ) : (
              <QuestionView key={`${set.id}:${active.id}`} setId={set.id} question={active} onSubmit={(text, hints) => submit(active, text, hints)} />
            )}
          </section>
        </div>
      ) : set.checkedAt === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saving your results…
        </p>
      ) : (
        <Results set={set} outcome={outcome} onRetry={() => void retry()} retrying={retrying} />
      )}
    </>
  );
}
