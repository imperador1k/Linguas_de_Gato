import { GRAMMAR_LEVELS, GRAMMAR_TOPICS, scoreGrammarSet, type GrammarLevel, type GrammarSetRecord, type GrammarTopic } from '@ldg/shared';
import { ArrowRight, Plus, Trash } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContinueCard } from '@/components/ui/continue-card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpDisclosure } from '@/components/ui/help-disclosure';
import { Notice } from '@/components/ui/notice';
import { FILTER_CONTROL, resultCount, SEARCH_THRESHOLD, SearchField } from '@/components/ui/search-field';
import { SidePanel } from '@/components/ui/side-panel';
import { logTrainingSession, optionFor, TargetedPracticeNotice, useTargetedPractice } from '@/features/personalized-training/targeted-practice';
import { usePractiseParam } from '@/features/personalized-training/use-practise-param';
import { useCapabilities } from '@/hooks/use-capabilities';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { cn } from '@/lib/utils';
import { GrammarGenerator } from './grammar-generator';
import { dateFormatter, GRAMMAR_TOPIC_LABELS } from './grammar-labels';
import { grammarStorage } from './storage/grammar-repository';

type Status = 'not_started' | 'in_progress' | 'checked';
const STATUS_LABELS: Record<Status, string> = { not_started: 'Not started', in_progress: 'In progress', checked: 'Checked' };

function statusOf(record: GrammarSetRecord): Status {
  if (record.history.length > 0 && record.checkedAt !== null) return 'checked';
  if (scoreGrammarSet(record).answered > 0) return 'in_progress';
  return record.history.length > 0 ? 'checked' : 'not_started';
}

function resultLine(record: GrammarSetRecord): string {
  const last = record.history.at(-1);
  const status = statusOf(record);
  if (status === 'in_progress') {
    const { answered, total } = scoreGrammarSet(record);
    return `${answered} of ${total} answered${last ? ` · last round ${last.correct}/${last.total}` : ''}`;
  }
  if (!last) return `${record.set.questions.length} questions`;
  const best = Math.max(...record.history.map((round) => round.correct));
  return `Last ${last.correct}/${last.total}${record.history.length > 1 ? ` · best ${best}/${last.total} · ${record.history.length} rounds` : ''}`;
}

export function GrammarLabPage() {
  const storage = grammarStorage.use();
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const practise = usePractiseParam('grammar');
  const [sets, setSets] = useState<GrammarSetRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GrammarSetRecord | null>(null);
  const [panel, setPanel] = useState({ open: false, key: 0 });
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<GrammarTopic | 'all'>('all');
  const [level, setLevel] = useState<GrammarLevel | 'all'>('all');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const available = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;
  const targeted = useTargetedPractice(practise.category, 'grammar');
  const option = practise.category ? optionFor(practise.category, 'grammar') : null;

  const refresh = useCallback(async () => {
    if (!storage) return;
    try {
      setSets((await storage.repository.sets.list()).sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (caught) {
      setError(describeStorageFailure(caught));
      setSets([]);
    }
  }, [storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // "Practise this" from Progress or Today opens the panel pre-filled.
  useEffect(() => {
    if (practise.category) setPanel((current) => (current.open ? current : { open: true, key: current.key + 1 }));
  }, [practise.category]);

  const openPanel = () => setPanel((current) => ({ open: true, key: current.key + 1 }));
  const closePanel = () => {
    setPanel((current) => ({ ...current, open: false }));
    setDirty(false);
    if (practise.category) practise.clear();
  };

  const resume = useMemo(() => (sets ?? []).find((record) => statusOf(record) === 'in_progress') ?? null, [sets]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (sets ?? []).filter((record) => {
      if (topic !== 'all' && record.set.topic !== topic) return false;
      if (level !== 'all' && record.set.level !== level) return false;
      if (status !== 'all' && statusOf(record) !== status) return false;
      return !needle || record.set.title.toLowerCase().includes(needle) || GRAMMAR_TOPIC_LABELS[record.set.topic].toLowerCase().includes(needle);
    });
  }, [sets, query, topic, level, status]);
  const filtered = query.trim() !== '' || topic !== 'all' || level !== 'all' || status !== 'all';

  return (
    <>
      <PageHeader
        eyebrow="Grammar"
        title="Precise structures, clear rules."
        description="Focused exercises on the B2–C2 structures that make writing and speech precise, checked against a verified answer key."
        actions={
          storage ? (
            <Button onClick={openPanel}>
              <Plus aria-hidden="true" />
              New exercise set
            </Button>
          ) : null
        }
      />

      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Your exercises will last until you close this tab.</Notice> : null}
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}

      {resume ? <ContinueCard title={resume.set.title} detail={`${GRAMMAR_TOPIC_LABELS[resume.set.topic]} · ${resultLine(resume)}`} to={`/grammar/sets/${resume.id}`} /> : null}

      {sets === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading your exercises…
        </p>
      ) : sets.length === 0 ? (
        <EmptyState
          title="No exercise sets yet."
          action={
            <Button size="sm" onClick={openPanel}>
              <Plus aria-hidden="true" />
              New exercise set
            </Button>
          }
        >
          Choose a grammar area and level; the questions are generated, checked and saved for you to answer and retry.
        </EmptyState>
      ) : (
        <section aria-labelledby="grammar-sets" className="flex flex-col gap-4">
          <h2 id="grammar-sets" className="sr-only">
            Your exercise sets
          </h2>
          {sets.length >= SEARCH_THRESHOLD ? (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <SearchField label="Search exercise sets" value={query} onChange={setQuery} className="col-span-2 sm:flex-[1_1_14rem]" />
            <select aria-label="Grammar area" value={topic} onChange={(event) => setTopic(event.target.value as GrammarTopic | 'all')} className={cn(FILTER_CONTROL, 'col-span-2 min-w-0 sm:col-span-1 sm:flex-[0_1_15rem]')}>
              <option value="all">All grammar areas</option>
              {GRAMMAR_TOPICS.map((value) => (
                <option key={value} value={value}>
                  {GRAMMAR_TOPIC_LABELS[value]}
                </option>
              ))}
            </select>
            <select aria-label="Level" value={level} onChange={(event) => setLevel(event.target.value as GrammarLevel | 'all')} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_8rem]')}>
              <option value="all">All levels</option>
              {GRAMMAR_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value as Status | 'all')} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_10rem]')}>
              <option value="all">Any status</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="checked">Checked</option>
            </select>
          </div>
          ) : null}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {resultCount(visible.length, sets.length, 'set')}
            {filtered ? (
              <button
                type="button"
                className="ml-2 underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setQuery('');
                  setTopic('all');
                  setLevel('all');
                  setStatus('all');
                }}
              >
                Clear filters
              </button>
            ) : null}
          </p>
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No sets match these filters.</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card" aria-label="Exercise sets">
              {visible.map((record) => {
                const recordStatus = statusOf(record);
                return (
                  <li key={record.id} className="flex items-center gap-2 px-3 py-2 sm:px-4">
                    <Link to={`/grammar/sets/${record.id}`} className="group min-w-0 flex-1 rounded-md py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="font-medium group-hover:underline">{record.set.title}</span>
                        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                        <Badge variant="outline" className="px-2 py-0">
                          {record.set.level}
                        </Badge>
                        <span>{GRAMMAR_TOPIC_LABELS[record.set.topic]}</span>
                        <span aria-hidden="true">·</span>
                        <span>{resultLine(record)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{dateFormatter.format(record.createdAt)}</span>
                        <Badge variant={recordStatus === 'checked' ? 'success' : recordStatus === 'in_progress' ? 'outline' : 'neutral'} className="px-2 py-0">
                          {STATUS_LABELS[recordStatus]}
                        </Badge>
                      </span>
                    </Link>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete exercise set ${record.set.title}`} onClick={() => setPendingDelete(record)}>
                      <Trash aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <HelpDisclosure id="grammar" title="How grammar practice works" className="mt-10">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>Answers are checked in this browser against a verified key; each question explains the rule and why each option is right or wrong.</li>
          <li>An open answer the key doesn't recognise can get an AI second opinion; it never changes your score.</li>
          <li>“Try again” clears your answers and keeps the history of your rounds.</li>
          <li>Levels are practice targets, not an official CEFR assessment.</li>
        </ul>
      </HelpDisclosure>

      {storage ? (
        <SidePanel
          key={panel.key}
          open={panel.open}
          onClose={closePanel}
          dirty={dirty}
          busy={dirty}
          title={practise.category ? 'Targeted grammar practice' : 'New exercise set'}
          description="Choose an area, a level and the kinds of question. The set opens as soon as it is ready."
        >
          {panel.open ? (
            <div className="flex flex-col gap-5">
              {practise.category ? (
                <TargetedPracticeNotice
                  category={practise.category}
                  module="grammar"
                  mistakes={targeted.mistakes}
                  profile={targeted.context?.profile ?? null}
                  includeExamples={targeted.includeExamples}
                  onIncludeExamplesChange={targeted.setIncludeExamples}
                />
              ) : null}
              {capabilities.status === 'ready' && !available ? (
                <Notice>Generating exercises needs the local server and a Groq API key in apps/server/.env.</Notice>
              ) : practise.category && !targeted.context?.profile ? null : (
                <GrammarGenerator
                  repository={storage.repository}
                  initial={option ? { topic: option.topic, focus: option.focus } : undefined}
                  targetedPractice={targeted.context?.profile ?? null}
                  onDirtyChange={setDirty}
                  onCreated={(record) => {
                    if (targeted.context) void logTrainingSession(targeted.context, { id: record.id, title: record.set.title, level: record.set.level });
                    navigate(`/grammar/sets/${record.id}`);
                  }}
                />
              )}
            </div>
          ) : null}
        </SidePanel>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this exercise set?"
        description="Its questions, your answers and the history of your results are removed from this browser."
        confirmLabel="Delete set"
        destructive
        onConfirm={() => {
          const record = pendingDelete;
          setPendingDelete(null);
          if (record && storage) void storage.repository.sets.delete(record.id).then(refresh, (caught: unknown) => setError(describeStorageFailure(caught)));
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
