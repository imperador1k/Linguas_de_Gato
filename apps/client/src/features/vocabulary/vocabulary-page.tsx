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
import { ArrowRight, BookOpenText, LoaderCircle, Repeat, Sparkles, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { CheckGroup, SELECT_CLASS } from '@/components/ui/choice-group';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { PrivacyNote } from '@/components/ui/privacy-note';
import { FILTER_CONTROL, resultCount, SEARCH_THRESHOLD, SearchField } from '@/components/ui/search-field';
import { SidePanel } from '@/components/ui/side-panel';
import { TabList, tabPanelProps } from '@/components/ui/tabs';
import { useCapabilities } from '@/hooks/use-capabilities';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { useGenerationJob } from '@/lib/use-generation-job';
import { cn } from '@/lib/utils';
import { vocabularyStorage, type VocabularyRepository } from './storage/vocabulary-repository';
import { dateFormatter, describeDue, KIND_LABELS, PRACTICE_TYPE_LABELS, STATUS_LABELS } from './vocabulary-labels';

type View = 'collection' | 'practice';

function PracticeGenerator({
  repository,
  entries,
  selected,
  onCreated,
  onDirtyChange,
}: {
  repository: VocabularyRepository;
  entries: readonly VocabularyEntry[];
  selected: ReadonlySet<string>;
  onCreated: (set: VocabularyPracticeSet) => void;
  onDirtyChange: (dirty: boolean) => void;
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

  useEffect(() => onDirtyChange(running), [running, onDirtyChange]);

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
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border bg-card px-4 py-3 text-sm">
        <p className="font-medium">{selected.size > 0 ? `${pool.length} selected expression${pool.length === 1 ? '' : 's'}` : `${pool.length} expression${pool.length === 1 ? '' : 's'} from your collection`}</p>
        <p className="mt-0.5 text-muted-foreground">
          {selected.size > 0 ? 'Chosen in the collection. Close this panel to change the selection.' : `Due first, up to ${VOCABULARY_LIMITS.maxPracticeItems}. To practise specific ones, select them in the collection first.`}
        </p>
        <p className="mt-2 line-clamp-2 font-serif text-[0.9375rem]">{pool.map((entry) => entry.expression).join(' · ')}</p>
      </div>
      <CheckGroup legend="Exercise types" values={types} disabled={running} options={VOCABULARY_QUESTION_TYPES.map((value) => ({ value, label: PRACTICE_TYPE_LABELS[value].label, hint: PRACTICE_TYPE_LABELS[value].hint }))} onChange={setTypes} />
      {types.includes('matching') && pool.length < 3 ? <p className="-mt-3 text-xs text-muted-foreground">Matching needs at least three expressions; it will be skipped.</p> : null}
      {effectiveTypes.length === 0 ? <p className="-mt-3 text-xs text-destructive">Choose at least one type.</p> : null}
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
      <div className="flex flex-wrap items-center gap-2">
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
              Writing exercises · {elapsed}s
            </span>
          </>
        ) : (
          <Button onClick={() => void generate()} disabled={pool.length === 0 || effectiveTypes.length === 0}>
            <Sparkles aria-hidden="true" />
            Generate
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
      {job.state.phase === 'cancelled' ? <p className="text-sm text-muted-foreground">Generation cancelled. Nothing was saved.</p> : null}
      <p className="text-xs text-muted-foreground">Objective questions are scored against a key; your own sentences get a separate AI check against clear criteria.</p>
      <PrivacyNote>The chosen expressions, their meanings and context sentences are sent to Groq to write the exercises.</PrivacyNote>
    </div>
  );
}

/** The review queue, always visible: the one daily task in this module that has a due date. */
function ReviewStrip({ due, nextDueAt, now }: { due: number; nextDueAt: number | null; now: number }) {
  return (
    <section aria-label="Review queue" className="mb-8 flex flex-col gap-3 rounded-lg border bg-card px-4 py-4 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Review queue</p>
        <p className="mt-1.5 font-serif text-[1.1875rem] leading-snug">{due > 0 ? `${due} expression${due === 1 ? '' : 's'} due for review` : 'Nothing due for review'}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {due > 0 ? 'Recall each meaning from its sentence before revealing it.' : nextDueAt ? `${describeDue(nextDueAt, now)}.` : 'Expressions you save join the queue.'}
        </p>
      </div>
      {due > 0 ? (
        <Link to="/vocabulary/review" className={cn(buttonVariants(), 'shrink-0 self-start sm:self-auto')}>
          <Repeat aria-hidden="true" />
          Review {due} due
        </Link>
      ) : null}
    </section>
  );
}

/**
 * The Vocabulary hub. Reviewing what is due is the primary task, so its count
 * is always on screen; practice is generated on demand from the collection
 * (or a selection of it) in the creation panel.
 */
export function VocabularyPage() {
  const storage = vocabularyStorage.use();
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'practice' ? 'practice' : 'collection';
  const [entries, setEntries] = useState<VocabularyEntry[] | null>(null);
  const [sets, setSets] = useState<VocabularyPracticeSet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ExpressionKind | 'all'>('all');
  const [status, setStatus] = useState<'all' | 'due' | 'new' | 'learning' | 'known'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingSet, setPendingSet] = useState<VocabularyPracticeSet | null>(null);
  const [panel, setPanel] = useState({ open: false, key: 0 });
  const [dirty, setDirty] = useState(false);
  const idBase = useId();
  const available = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;
  const [now] = useState(() => Date.now());

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

  const openPanel = useCallback(() => setPanel((current) => (current.open ? current : { open: true, key: current.key + 1 })), []);
  // The "Practise vocabulary" recommendation links here with ?practise=practice.
  const practiseParam = params.get('practise') === 'practice';
  useEffect(() => {
    if (practiseParam && entries && entries.length > 0) openPanel();
  }, [practiseParam, entries, openPanel]);

  const updateParams = (change: (next: URLSearchParams) => void) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        change(next);
        return next;
      },
      { replace: true },
    );
  const setView = (next: View) => updateParams((result) => (next === 'practice' ? result.set('view', 'practice') : result.delete('view')));
  const closePanel = () => {
    setPanel((current) => ({ ...current, open: false }));
    setDirty(false);
    if (practiseParam) updateParams((result) => result.delete('practise'));
  };

  const due = useMemo(() => (entries ? dueEntries(entries, now) : []), [entries, now]);
  const nextDueAt = useMemo(() => {
    const upcoming = (entries ?? []).map((entry) => entry.review.dueAt).filter((at) => at > now);
    return upcoming.length > 0 ? Math.min(...upcoming) : null;
  }, [entries, now]);
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
  const filtered = query.trim() !== '' || kind !== 'all' || status !== 'all';

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < VOCABULARY_LIMITS.maxPracticeItems) next.add(id);
      return next;
    });

  const hasEntries = entries !== null && entries.length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Vocabulary"
        title="Your personal dictionary."
        description="Expressions you met while reading, kept with the sentence you found them in, what they meant there, and how they are used."
        actions={
          storage && hasEntries ? (
            <Button variant="secondary" onClick={openPanel}>
              <Sparkles aria-hidden="true" />
              Practise
            </Button>
          ) : null
        }
      />
      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Your vocabulary will last until you close this tab.</Notice> : null}
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}

      {hasEntries ? <ReviewStrip due={due.length} nextDueAt={nextDueAt} now={now} /> : null}

      {entries === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading your vocabulary…
        </p>
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nothing saved yet."
          action={
            <Link to="/reading" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <BookOpenText aria-hidden="true" />
              Go to Reading
            </Link>
          }
        >
          Open a text in Reading, select a word or expression, look it up, and save it. It joins your collection and the review queue.
        </EmptyState>
      ) : (
        <>
          <TabList
            label="Vocabulary"
            idBase={idBase}
            value={view}
            onChange={setView}
            className="mb-5"
            items={[
              { value: 'collection', label: 'Collection', adornment: <span className="text-xs font-normal text-muted-foreground tabular-nums">{entries.length}</span> },
              { value: 'practice', label: 'Practice sets', adornment: <span className="text-xs font-normal text-muted-foreground tabular-nums">{sets.length}</span> },
            ]}
          />
          <div {...tabPanelProps(idBase, view)} className="flex flex-col gap-4">
            {view === 'collection' ? (
              <>
                {entries.length >= SEARCH_THRESHOLD ? (
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <SearchField label="Search your vocabulary" placeholder="Search expressions or meanings" value={query} onChange={setQuery} className="col-span-2 sm:flex-[1_1_16rem]" />
                  <select aria-label="Type" value={kind} onChange={(event) => setKind(event.target.value as ExpressionKind | 'all')} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_10rem]')}>
                    <option value="all">All types</option>
                    {EXPRESSION_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {KIND_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Review status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_9rem]')}>
                    <option value="all">Any status</option>
                    <option value="due">Due now</option>
                    <option value="new">New</option>
                    <option value="learning">Learning</option>
                    <option value="known">Known</option>
                  </select>
                </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
                  <span>{resultCount(visible.length, entries.length, 'expression')}</span>
                  {filtered ? (
                    <button
                      type="button"
                      className="underline-offset-2 hover:text-foreground hover:underline"
                      onClick={() => {
                        setQuery('');
                        setKind('all');
                        setStatus('all');
                      }}
                    >
                      Clear filters
                    </button>
                  ) : null}
                  <span>Tick expressions to practise specific ones (up to {VOCABULARY_LIMITS.maxPracticeItems}).</span>
                </div>
                {selected.size > 0 ? (
                  <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border-strong bg-card px-3 py-2 text-sm shadow-sm">
                    <span className="font-medium tabular-nums">{selected.size} selected</span>
                    <Button size="sm" onClick={openPanel}>
                      <Sparkles aria-hidden="true" />
                      Practise these
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                      Clear selection
                    </Button>
                  </div>
                ) : null}
                {visible.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No expressions match.</p>
                ) : (
                  <ul className="divide-y rounded-lg border bg-card" aria-label="Saved expressions">
                    {visible.map((entry) => {
                      const sense = entry.senses[0];
                      return (
                        <li key={entry.id} className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
                          <input
                            type="checkbox"
                            aria-label={`Select ${entry.expression} for practice`}
                            checked={selected.has(entry.id)}
                            onChange={() => toggle(entry.id)}
                            className="mt-1.5 size-4 shrink-0 accent-[var(--brand)]"
                          />
                          <Link to={`/vocabulary/entries/${entry.id}`} className="group min-w-0 flex-1 rounded-md">
                            <span className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-serif text-[1.125rem] group-hover:underline">{entry.expression}</span>
                              <span className="text-xs text-muted-foreground">{KIND_LABELS[entry.kind]}</span>
                              {entry.senses.length > 1 ? <Badge variant="neutral" className="px-1.5 py-0">{entry.senses.length} meanings</Badge> : null}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{sense?.contextualMeaning}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                              <span>{STATUS_LABELS[entry.review.status]}</span>
                              <span aria-hidden="true">·</span>
                              <span className={entry.review.dueAt <= now ? 'font-medium text-foreground' : undefined}>{describeDue(entry.review.dueAt, now)}</span>
                              <span aria-hidden="true">·</span>
                              <span>added {dateFormatter.format(entry.createdAt)}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : sets.length === 0 ? (
              <EmptyState
                title="No practice sets yet."
                action={
                  <Button size="sm" variant="secondary" onClick={openPanel}>
                    <Sparkles aria-hidden="true" />
                    Practise
                  </Button>
                }
              >
                Generate exercises from your collection or a selection of it: gap fills, meanings, collocations and your own sentences.
              </EmptyState>
            ) : (
              <ul className="divide-y rounded-lg border bg-card" aria-label="Practice sets">
                {sets.map((set) => {
                  const score = scoreVocabularySet(set);
                  const last = set.history.at(-1);
                  const statusLabel = last ? `Last ${last.correct}/${last.objectiveTotal} objective` : score.answered > 0 ? `In progress · ${score.answered}/${score.total}` : 'Not started';
                  return (
                    <li key={set.id} className="flex items-center gap-2 px-3 py-2 sm:px-4">
                      <Link to={`/vocabulary/practice/${set.id}`} className="group min-w-0 flex-1 rounded-md py-1.5">
                        <span className="flex items-center gap-2">
                          <span className="font-medium group-hover:underline">
                            {set.questions.length} questions · {set.entryIds.length} expressions
                          </span>
                          <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {statusLabel} · {dateFormatter.format(set.createdAt)}
                        </span>
                      </Link>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete practice set from ${dateFormatter.format(set.createdAt)}`} onClick={() => setPendingSet(set)}>
                        <Trash aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {storage && entries ? (
        <SidePanel key={panel.key} open={panel.open} onClose={closePanel} dirty={dirty} busy={dirty} title="Practise vocabulary" description="Exercises built from your own expressions and the sentences you found them in.">
          {panel.open ? (
            capabilities.status === 'ready' && !available ? (
              <Notice>
                Generating practice needs a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>.
              </Notice>
            ) : (
              <PracticeGenerator repository={storage.repository} entries={entries} selected={selected} onDirtyChange={setDirty} onCreated={(set) => navigate(`/vocabulary/practice/${set.id}`)} />
            )
          ) : null}
        </SidePanel>
      ) : null}

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
