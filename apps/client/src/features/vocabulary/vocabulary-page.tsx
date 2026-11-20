import {
  EXPRESSION_KINDS,
  VOCABULARY_LIMITS,
  VOCABULARY_QUESTION_TYPES,
  VOCABULARY_RECORD_VERSION,
  dueEntries,
  scoreVocabularySet,
  seededShuffle,
  toPracticeItem,
  type ExpressionKind,
  type VocabularyEntry,
  type VocabularyPracticeSet,
  type VocabularyQuestionType,
} from '@ldg/shared';
import { BookOpenText, LoaderCircle, Repeat, Search, Sparkles, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckGroup, SELECT_CLASS } from '@/components/ui/choice-group';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { useCapabilities } from '@/hooks/use-capabilities';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { useGenerationJob } from '@/lib/use-generation-job';
import { cn } from '@/lib/utils';
import { vocabularyStorage, type VocabularyRepository } from './storage/vocabulary-repository';
import { dateFormatter, describeDue, KIND_LABELS, PRACTICE_TYPE_LABELS, STATUS_LABELS } from './vocabulary-labels';

function PracticeGenerator({
  repository,
  entries,
  selected,
  onCreated,
}: {
  repository: VocabularyRepository;
  entries: readonly VocabularyEntry[];
  selected: ReadonlySet<string>;
  onCreated: (set: VocabularyPracticeSet) => void;
}) {
  const job = useGenerationJob();
  const [types, setTypes] = useState<VocabularyQuestionType[]>(['gap_fill', 'meaning_choice', 'collocation', 'own_sentence']);
  const [count, setCount] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const running = job.state.phase === 'running';
  const elapsed = useElapsedSeconds(job.state.phase === 'running' ? job.state.startedAt : null);
  const id = useId();
  // Selected expressions, or the whole collection (due and newest first), capped per set.
  const pool = (selected.size > 0 ? entries.filter((entry) => selected.has(entry.id)) : [...entries].sort((a, b) => a.review.dueAt - b.review.dueAt)).slice(0, VOCABULARY_LIMITS.maxPracticeItems);
  const effectiveTypes = pool.length < 3 ? types.filter((type) => type !== 'matching') : types;

  async function generate() {
    setError(null);
    const response = await job.start({ kind: 'vocabulary_practice', types: effectiveTypes, questionCount: count, items: pool.map(toPracticeItem) });
    if (!response || response.result.kind !== 'vocabulary_practice') return;
    const now = Date.now();
    const setId = crypto.randomUUID();
    const shuffles: Record<string, number[]> = {};
    for (const question of response.result.questions) if (question.type === 'matching') shuffles[question.id] = seededShuffle(question.pairs.length, `${setId}-${question.id}`);
    const set: VocabularyPracticeSet = {
      id: setId,
      version: VOCABULARY_RECORD_VERSION,
      entryIds: pool.map((entry) => entry.id),
      types: effectiveTypes,
      questions: response.result.questions,
      shuffles,
      discarded: response.result.discarded,
      model: response.model,
      answers: [],
      reviews: [],
      checkedAt: null,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await repository.practiceSets.put(set);
      onCreated(set);
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {selected.size > 0 ? `Practising ${pool.length} selected expression${pool.length === 1 ? '' : 's'}.` : `Practising your collection (${pool.length} expression${pool.length === 1 ? '' : 's'}, due first). Select rows below to choose specific ones.`}
      </p>
      <CheckGroup legend="Exercise types" values={types} disabled={running} options={VOCABULARY_QUESTION_TYPES.map((value) => ({ value, label: PRACTICE_TYPE_LABELS[value].label, hint: PRACTICE_TYPE_LABELS[value].hint }))} onChange={setTypes} />
      {types.includes('matching') && pool.length < 3 ? <p className="-mt-2 text-xs text-muted-foreground">Matching needs at least three expressions; it will be skipped.</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-count`} className="text-sm font-medium">
            Questions
          </label>
          <select id={`${id}-count`} value={count} disabled={running} onChange={(event) => setCount(Number(event.target.value))} className={cn(SELECT_CLASS, 'w-28')}>
            {[4, 6, 8, 10, 12].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        {running ? (
          <>
            <Button disabled>
              <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              Generating…
            </Button>
            <Button variant="ghost" onClick={job.cancel}>
              Cancel
            </Button>
            <span role="status" className="text-sm text-muted-foreground tabular-nums">
              {elapsed}s
            </span>
          </>
        ) : (
          <Button onClick={() => void generate()} disabled={pool.length === 0 || effectiveTypes.length === 0}>
            <Sparkles aria-hidden="true" />
            Generate practice
          </Button>
        )}
      </div>
      {job.state.phase === 'failed' ? (
        <Notice tone="error" role="alert">
          {job.state.message}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <p className="text-xs text-muted-foreground">The chosen expressions, their meanings and context sentences are sent to Groq to write the exercises.</p>
    </div>
  );
}

export function VocabularyPage() {
  const storage = vocabularyStorage.use();
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<VocabularyEntry[] | null>(null);
  const [sets, setSets] = useState<VocabularyPracticeSet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ExpressionKind | 'all'>('all');
  const [status, setStatus] = useState<'all' | 'due' | 'new' | 'learning' | 'known'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingSet, setPendingSet] = useState<VocabularyPracticeSet | null>(null);
  const ids = { collection: useId(), practice: useId() };
  const available = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;
  const now = Date.now();

  const refresh = useCallback(async () => {
    if (!storage) return;
    try {
      const [loadedEntries, loadedSets] = await Promise.all([storage.repository.entries.list(), storage.repository.practiceSets.list()]);
      setEntries(loadedEntries.sort((a, b) => b.createdAt - a.createdAt));
      setSets(loadedSets.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (caught) {
      setError(describeStorageFailure(caught));
      setEntries([]);
    }
  }, [storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const due = useMemo(() => (entries ? dueEntries(entries, now) : []), [entries, now]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (entries ?? []).filter((entry) => {
      if (kind !== 'all' && entry.kind !== kind) return false;
      if (status === 'due' && entry.review.dueAt > now) return false;
      if (status !== 'all' && status !== 'due' && entry.review.status !== status) return false;
      if (!needle) return true;
      return entry.expression.toLowerCase().includes(needle) || entry.lemma.toLowerCase().includes(needle) || entry.senses.some((sense) => sense.contextualMeaning.toLowerCase().includes(needle));
    });
  }, [entries, query, kind, status, now]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < VOCABULARY_LIMITS.maxPracticeItems) next.add(id);
      return next;
    });

  return (
    <>
      <PageHeader
        eyebrow="Vocabulary"
        title="Your personal dictionary."
        description="Expressions you met while reading, kept with the sentence you found them in, what they meant there, and how they are used."
        actions={
          due.length > 0 ? (
            <Link to="/vocabulary/review" className={buttonVariants()}>
              <Repeat aria-hidden="true" />
              Review {due.length} due
            </Link>
          ) : null
        }
      />
      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Your vocabulary will last until you close this tab.</Notice> : null}
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card aria-labelledby={ids.collection} className="min-w-0">
          <CardHeader>
            <CardTitle id={ids.collection}>Collection</CardTitle>
            <CardDescription>
              {entries === null ? '' : `${entries.length} expression${entries.length === 1 ? '' : 's'} · ${due.length} due for review`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-1">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_9rem]">
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Search your vocabulary" value={query} placeholder="Search expressions or meanings" onChange={(event) => setQuery(event.target.value)} className="pl-9" />
              </div>
              <select aria-label="Type" value={kind} onChange={(event) => setKind(event.target.value as ExpressionKind | 'all')} className={SELECT_CLASS}>
                <option value="all">All types</option>
                {EXPRESSION_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {KIND_LABELS[value]}
                  </option>
                ))}
              </select>
              <select aria-label="Review status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={SELECT_CLASS}>
                <option value="all">Any status</option>
                <option value="due">Due now</option>
                <option value="new">New</option>
                <option value="learning">Learning</option>
                <option value="known">Known</option>
              </select>
            </div>

            {entries === null ? null : entries.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-6">
                <p className="text-sm text-muted-foreground">Nothing saved yet. Open a text in Reading, select a word or expression, look it up, and save it.</p>
                <Link to="/reading" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                  <BookOpenText aria-hidden="true" />
                  Go to Reading
                </Link>
              </div>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expressions match.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border" aria-label="Saved expressions">
                {visible.map((entry) => {
                  const sense = entry.senses[0];
                  return (
                    <li key={entry.id} className="flex items-start gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${entry.expression} for practice`}
                        checked={selected.has(entry.id)}
                        onChange={() => toggle(entry.id)}
                        className="mt-1.5 size-4 shrink-0 accent-[var(--brand)]"
                      />
                      <Link to={`/vocabulary/entries/${entry.id}`} className="min-w-0 flex-1 rounded-md hover:bg-accent/40">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-serif text-[1.125rem]">{entry.expression}</span>
                          <span className="text-xs text-muted-foreground">{KIND_LABELS[entry.kind]}</span>
                          {entry.senses.length > 1 ? <Badge variant="neutral" className="px-1.5 py-0">{entry.senses.length} meanings</Badge> : null}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{sense?.contextualMeaning}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {STATUS_LABELS[entry.review.status]} · {describeDue(entry.review.dueAt, now)} · added {dateFormatter.format(entry.createdAt)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {selected.size > 0 ? (
              <div className="flex items-center gap-2 text-sm">
                <span>{selected.size} selected</span>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear selection
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card aria-labelledby={ids.practice}>
            <CardHeader>
              <CardTitle id={ids.practice}>Practice</CardTitle>
              <CardDescription>Objective questions are scored against a key; your own sentences get a separate AI check against clear criteria.</CardDescription>
            </CardHeader>
            <CardContent className="pt-1">
              {!storage || entries === null ? null : entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Save some expressions first.</p>
              ) : !available ? (
                <Notice>
                  Generating practice needs a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>.
                </Notice>
              ) : (
                <PracticeGenerator repository={storage.repository} entries={entries} selected={selected} onCreated={(set) => navigate(`/vocabulary/practice/${set.id}`)} />
              )}
            </CardContent>
          </Card>

          {sets.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Practice sets</CardTitle>
              </CardHeader>
              <CardContent className="pt-1">
                <ul className="flex flex-col divide-y rounded-lg border">
                  {sets.map((set) => {
                    const score = scoreVocabularySet(set);
                    const last = set.history.at(-1);
                    return (
                      <li key={set.id} className="flex items-center gap-2 px-3 py-1.5">
                        <Link to={`/vocabulary/practice/${set.id}`} className="min-w-0 flex-1 rounded-md px-1 py-1.5 hover:bg-accent/40">
                          <span className="block text-sm font-medium">
                            {set.questions.length} questions · {set.entryIds.length} expressions
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {last ? `Last: ${last.correct}/${last.objectiveTotal} objective` : score.answered > 0 ? `In progress · ${score.answered}/${score.total}` : 'Not started'} · {dateFormatter.format(set.createdAt)}
                          </span>
                        </Link>
                        <Button variant="ghost" size="icon-sm" aria-label="Delete practice set" onClick={() => setPendingSet(set)}>
                          <Trash aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={pendingSet !== null}
        title="Delete this practice set?"
        description="Its questions, your answers and results are removed. Your saved expressions are not affected."
        confirmLabel="Delete set"
        destructive
        onConfirm={() => {
          const set = pendingSet;
          setPendingSet(null);
          if (set && storage) void storage.repository.practiceSets.delete(set.id).then(refresh, (caught: unknown) => setError(describeStorageFailure(caught)));
        }}
        onCancel={() => setPendingSet(null)}
      />
    </>
  );
}
