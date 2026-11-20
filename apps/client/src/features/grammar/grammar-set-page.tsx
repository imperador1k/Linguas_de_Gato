import {
  canRequestReview,
  checkGrammarSet,
  retryGrammarSet,
  scoreGrammarSet,
  withGrammarAnswer,
  withGrammarReview,
  type GrammarSetRecord,
} from '@ldg/shared';
import { ArrowLeft, CircleAlert, RotateCcw, Trash } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { createAutosaver, type Autosaver } from '@/lib/autosave';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { cn } from '@/lib/utils';
import { dateFormatter, GRAMMAR_TOPIC_LABELS } from './grammar-labels';
import { GrammarQuestionItem } from './grammar-question';
import { grammarStorage } from './storage/grammar-repository';

function BackLink() {
  return (
    <Link to="/grammar" className={cn(buttonVariants({ variant: 'secondary' }))}>
      <ArrowLeft aria-hidden="true" />
      Grammar Lab
    </Link>
  );
}

export function GrammarSetPage() {
  const { setId = '' } = useParams();
  const navigate = useNavigate();
  const storage = grammarStorage.use();
  const [record, setRecordState] = useState<GrammarSetRecord | null | 'missing'>(null);
  const recordRef = useRef<GrammarSetRecord | null>(null);
  const saverRef = useRef<Autosaver<GrammarSetRecord> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'check' | 'retry' | 'delete' | null>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!storage) return;
    let active = true;
    storage.repository.sets.get(setId).then(
      (row) => {
        if (!active) return;
        recordRef.current = row;
        setRecordState(row ?? 'missing');
      },
      (caught: unknown) => {
        if (!active) return;
        setSaveError(describeStorageFailure(caught));
        setRecordState('missing');
      },
    );
    const saver = createAutosaver<GrammarSetRecord>({
      delayMs: 400,
      save: (value) => storage.repository.sets.put(value),
      onStatus: (status, error) => setSaveError(status === 'error' ? describeStorageFailure(error) : null),
    });
    saverRef.current = saver;
    const flush = () => void saver.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      active = false;
      window.removeEventListener('pagehide', flush);
      void saver.flush().finally(() => saver.dispose());
    };
  }, [storage, setId]);

  /** Functional, ref-based updates: fast typing followed by "Check" can't lose an answer. */
  function apply(change: (current: GrammarSetRecord) => GrammarSetRecord, immediate = false) {
    const current = recordRef.current;
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    recordRef.current = next;
    setRecordState(next);
    saverRef.current?.schedule(next);
    if (immediate) void saverRef.current?.flush();
  }

  if (record === null) {
    return (
      <p role="status" className="py-24 text-center text-sm text-muted-foreground">
        Opening your exercise…
      </p>
    );
  }
  if (record === 'missing') {
    return <PageHeader eyebrow="Grammar" title="Exercise not found" description={saveError ?? 'It may have been deleted, or it was saved in another browser.'} actions={<BackLink />} />;
  }

  const checked = record.checkedAt !== null;
  const score = scoreGrammarSet(record);
  const byQuestion = new Map(record.answers.map((answer) => [answer.questionId, answer]));
  const reviews = new Map(record.reviews.map((review) => [review.questionId, review]));
  const unanswered = score.total - score.answered;

  function check() {
    setConfirm(null);
    apply((current) => checkGrammarSet(current, Date.now()), true);
    window.setTimeout(() => resultsRef.current?.focus(), 0);
  }

  async function remove() {
    if (!storage) return;
    setConfirm(null);
    saverRef.current?.dispose();
    try {
      await storage.repository.sets.delete(setId);
      navigate('/grammar', { replace: true });
    } catch (caught) {
      setSaveError(describeStorageFailure(caught));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={GRAMMAR_TOPIC_LABELS[record.set.topic]}
        title={<span className="break-words">{record.set.title}</span>}
        description={record.set.instructions}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BackLink />
            <Button variant="ghost" size="icon" aria-label="Delete exercise" title="Delete" onClick={() => setConfirm('delete')}>
              <Trash aria-hidden="true" />
            </Button>
          </div>
        }
      />

      {saveError ? (
        <Notice tone="error" role="alert" className="mb-6">
          <span className="inline-flex items-center gap-1.5">
            <CircleAlert aria-hidden="true" className="size-4" />
            {saveError} Your answers are still on this page.
          </span>
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {checked ? (
            <Card>
              <CardHeader>
                <CardTitle ref={resultsRef} tabIndex={-1} className="outline-none">
                  {score.correct} of {score.total} correct
                </CardTitle>
                <CardDescription>
                  {score.correct === score.total
                    ? 'Every answer matched the key.'
                    : 'Read the rule and explanation under each question, then try again when you are ready. Your earlier results are kept.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-1">
                <Button variant="secondary" onClick={() => setConfirm('retry')}>
                  <RotateCcw aria-hidden="true" />
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <ol className="flex flex-col gap-3">
            {record.set.questions.map((question, index) => (
              <GrammarQuestionItem
                key={`${question.id}-${record.history.length}-${checked}`}
                question={question}
                number={index + 1}
                answer={byQuestion.get(question.id)}
                checked={checked}
                level={record.set.level}
                topic={record.set.topic}
                review={reviews.get(question.id)}
                canReview={canRequestReview(record, question)}
                onAnswer={(answer) => apply((current) => withGrammarAnswer(current, answer, Date.now()))}
                onReview={(response, answer) =>
                  apply(
                    (current) =>
                      withGrammarReview(current, { ...response.review, questionId: question.id, answer, model: response.model, createdAt: response.createdAt }, Date.now()),
                    true,
                  )
                }
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
          {record.discarded > 0 ? (
            <p className="text-xs text-muted-foreground">
              {record.discarded} generated question{record.discarded === 1 ? ' was' : 's were'} left out because {record.discarded === 1 ? 'it' : 'they'} failed the consistency checks (for example,
              more than one plausible answer).
            </p>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{record.set.level}</Badge>
                <Badge variant="neutral">{record.set.questions.length} questions</Badge>
              </div>
              <CardTitle className="mt-2 text-base">Your results</CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              {record.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">Each time you check this exercise, the result is recorded here.</p>
              ) : (
                <ol className="flex flex-col gap-1.5 text-sm" aria-label="Previous rounds">
                  {[...record.history].reverse().map((round, index) => (
                    <li key={round.checkedAt} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        Round {record.history.length - index} · {dateFormatter.format(round.checkedAt)}
                      </span>
                      <span className="font-mono tabular-nums">
                        {round.correct}/{round.total}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            Scores come from the answer key only: harmless differences such as capitals, final punctuation or contractions are ignored; different words are not.
          </p>
        </aside>
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
        title="Try this exercise again?"
        description="Your current answers are cleared so you can answer from scratch. The results of earlier rounds are kept."
        confirmLabel="Try again"
        onConfirm={() => {
          setConfirm(null);
          apply((current) => retryGrammarSet(current, Date.now()), true);
          window.scrollTo({ top: 0 });
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this exercise?"
        description="Its questions, your answers and the history of your results are removed from this browser."
        confirmLabel="Delete exercise"
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
