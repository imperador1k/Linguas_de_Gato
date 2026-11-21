import { countWords, type WritingAttempt, type WritingDraft, type WritingTaskRecord } from '@ldg/shared';
import { ArrowRight, CircleCheck, CircleDot, Plus, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContinueCard } from '@/components/ui/continue-card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpDisclosure } from '@/components/ui/help-disclosure';
import { Notice } from '@/components/ui/notice';
import { PrivacyNote } from '@/components/ui/privacy-note';
import { FILTER_CONTROL, SEARCH_THRESHOLD, SearchField } from '@/components/ui/search-field';
import { SidePanel } from '@/components/ui/side-panel';
import { TabList, tabPanelProps } from '@/components/ui/tabs';
import { logTrainingSession, optionFor, TargetedPracticeNotice, useTargetedPractice } from '@/features/personalized-training/targeted-practice';
import { usePractiseParam } from '@/features/personalized-training/use-practise-param';
import { useCapabilities } from '@/hooks/use-capabilities';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { cn } from '@/lib/utils';
import { deleteWritingTask, newestFirst, writingStorage, type WritingRepository } from './storage/writing-repository';
import { WritingTaskGenerator } from './writing-task-generator';
import { dateFormatter, WRITING_FORMAT_LABELS } from './writing-labels';

type View = 'tasks' | 'submitted';

interface LabData {
  readonly tasks: WritingTaskRecord[];
  readonly drafts: Map<string, WritingDraft>;
  readonly attempts: WritingAttempt[];
}

async function loadLab(repository: WritingRepository): Promise<LabData> {
  const [tasks, drafts, attempts] = await Promise.all([repository.tasks.list(), repository.drafts.list(), repository.attempts.list()]);
  return { tasks: newestFirst(tasks), drafts: new Map(drafts.map((draft) => [draft.taskId, draft])), attempts: attempts.sort((a, b) => b.submittedAt - a.submittedAt) };
}

function draftWords(data: LabData, taskId: string): number {
  const draft = data.drafts.get(taskId);
  return draft ? countWords(draft.text) : 0;
}

/**
 * The Writing hub: Tasks (things to write, with their drafts) and Submitted
 * (texts with their feedback). New tasks are made in the creation panel; the
 * editor itself stays a separate, focused page.
 */
export function WritingLabPage() {
  const storage = writingStorage.use();
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'submitted' ? 'submitted' : 'tasks';
  const practise = usePractiseParam('writing');
  const [data, setData] = useState<LabData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [panel, setPanel] = useState({ open: false, key: 0 });
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [taskStatus, setTaskStatus] = useState<'all' | 'draft' | 'not_started'>('all');
  const [pendingTask, setPendingTask] = useState<WritingTaskRecord | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState<WritingAttempt | null>(null);
  const idBase = useId();
  const generationAvailable = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;
  const feedbackAvailable = capabilities.status === 'ready' && capabilities.data.feedback.available;
  const targeted = useTargetedPractice(practise.category, 'writing');
  const option = practise.category ? optionFor(practise.category, 'writing') : null;

  const refresh = useCallback(async () => {
    if (!storage) return;
    try {
      setData(await loadLab(storage.repository));
    } catch (caught) {
      setError(describeStorageFailure(caught));
      setData({ tasks: [], drafts: new Map(), attempts: [] });
    }
  }, [storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (practise.category) setPanel((current) => (current.open ? current : { open: true, key: current.key + 1 }));
  }, [practise.category]);

  const setView = (next: View) =>
    setParams(
      (current) => {
        const result = new URLSearchParams(current);
        if (next === 'submitted') result.set('view', 'submitted');
        else result.delete('view');
        return result;
      },
      { replace: true },
    );
  const openPanel = () => setPanel((current) => ({ open: true, key: current.key + 1 }));
  const closePanel = () => {
    setPanel((current) => ({ ...current, open: false }));
    setDirty(false);
    if (practise.category) practise.clear();
  };

  async function run(action: () => Promise<void>) {
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  const resume = useMemo(() => {
    if (!data) return null;
    const drafts = [...data.drafts.values()].filter((draft) => countWords(draft.text) > 0).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const draft of drafts) {
      const task = data.tasks.find((record) => record.id === draft.taskId);
      if (task) return { task, words: countWords(draft.text), at: draft.updatedAt };
    }
    return null;
  }, [data]);

  const needle = query.trim().toLowerCase();
  const tasks = useMemo(
    () =>
      (data?.tasks ?? []).filter((record) => {
        const words = data ? draftWords(data, record.id) : 0;
        if (taskStatus === 'draft' && words === 0) return false;
        if (taskStatus === 'not_started' && words > 0) return false;
        return !needle || record.task.title.toLowerCase().includes(needle) || WRITING_FORMAT_LABELS[record.task.format].toLowerCase().includes(needle);
      }),
    [data, taskStatus, needle],
  );
  const attempts = useMemo(() => (data?.attempts ?? []).filter((attempt) => !needle || attempt.task.title.toLowerCase().includes(needle)), [data, needle]);

  return (
    <>
      <PageHeader
        eyebrow="Writing"
        title="Write with purpose, revise with evidence."
        description="Practise the texts you need at B2–C2. Feedback quotes your own words and keeps real errors apart from stylistic suggestions."
        actions={
          storage ? (
            <Button onClick={openPanel}>
              <Plus aria-hidden="true" />
              New task
            </Button>
          ) : null
        }
      />

      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Your writing will last until you close this tab.</Notice> : null}
      {capabilities.status === 'ready' && !feedbackAvailable ? (
        <Notice className="mb-6">
          Task generation and feedback need a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}
      <div aria-live="polite">
        {saved ? (
          <Notice tone="success" className="mb-6">
            {saved}
          </Notice>
        ) : null}
      </div>

      {resume ? <ContinueCard title={resume.task.task.title} detail={`Draft · ${resume.words} words · ${WRITING_FORMAT_LABELS[resume.task.task.format]}`} to={`/writing/tasks/${resume.task.id}`} action="Continue writing" /> : null}

      {data === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading your writing…
        </p>
      ) : (
        <>
          <TabList
            label="Writing"
            idBase={idBase}
            value={view}
            onChange={setView}
            className="mb-5"
            items={[
              { value: 'tasks', label: 'Tasks', adornment: <span className="text-xs font-normal text-muted-foreground tabular-nums">{data.tasks.length}</span> },
              { value: 'submitted', label: 'Submitted', adornment: <span className="text-xs font-normal text-muted-foreground tabular-nums">{data.attempts.length}</span> },
            ]}
          />
          <div {...tabPanelProps(idBase, view)} className="flex flex-col gap-4">
            {(view === 'tasks' ? data.tasks.length : data.attempts.length) >= SEARCH_THRESHOLD ? (
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <SearchField label={view === 'tasks' ? 'Search tasks' : 'Search submitted writing'} value={query} onChange={setQuery} className="sm:flex-[1_1_16rem]" />
                {view === 'tasks' ? (
                  <select aria-label="Status" value={taskStatus} onChange={(event) => setTaskStatus(event.target.value as typeof taskStatus)} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_11rem]')}>
                    <option value="all">All tasks</option>
                    <option value="draft">With a draft</option>
                    <option value="not_started">Not started</option>
                  </select>
                ) : null}
              </div>
            ) : null}

            {view === 'tasks' ? (
              data.tasks.length === 0 ? (
                <EmptyState
                  title="No writing tasks yet."
                  action={
                    <Button size="sm" onClick={openPanel}>
                      <Plus aria-hidden="true" />
                      New task
                    </Button>
                  }
                >
                  Generate a task in one of twelve formats at B2, C1 or C2, edit it if you like, and write. Drafts are saved as you type.
                </EmptyState>
              ) : tasks.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No tasks match.</p>
              ) : (
                <ul className="divide-y rounded-lg border bg-card" aria-label="Writing tasks">
                  {tasks.map((record) => {
                    const words = draftWords(data, record.id);
                    return (
                      <li key={record.id} className="flex items-center gap-2 px-3 py-2 sm:px-4">
                        <Link to={`/writing/tasks/${record.id}`} className="group min-w-0 flex-1 rounded-md py-1.5">
                          <span className="flex items-center gap-2">
                            <span className="font-medium group-hover:underline">{record.task.title}</span>
                            <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                            <Badge variant="outline" className="px-2 py-0">
                              {record.task.level}
                            </Badge>
                            <span>{WRITING_FORMAT_LABELS[record.task.format]}</span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">
                              {record.task.wordCount.min}–{record.task.wordCount.max} words
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{dateFormatter.format(record.createdAt)}</span>
                            {words > 0 ? (
                              <Badge variant="outline" className="px-2 py-0">
                                Draft · {words} words
                              </Badge>
                            ) : (
                              <Badge variant="neutral" className="px-2 py-0">
                                Not started
                              </Badge>
                            )}
                          </span>
                        </Link>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete task ${record.task.title}`} onClick={() => setPendingTask(record)}>
                          <Trash aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : data.attempts.length === 0 ? (
              <EmptyState title="Nothing submitted yet.">Texts you submit for feedback appear here, with their corrections and any improved version.</EmptyState>
            ) : attempts.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No submissions match.</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-card" aria-label="Submitted writing">
                {attempts.map((attempt) => (
                  <li key={attempt.id} className="flex items-center gap-2 px-3 py-2 sm:px-4">
                    <Link to={`/writing/attempts/${attempt.id}`} className="group min-w-0 flex-1 rounded-md py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="font-medium group-hover:underline">{attempt.task.title}</span>
                        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                        <span>{dateFormatter.format(attempt.submittedAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{attempt.wordCount} words</span>
                        <span aria-hidden="true">·</span>
                        <span>{WRITING_FORMAT_LABELS[attempt.task.format]}</span>
                        {attempt.assessment ? (
                          <Badge variant="success" className="px-2 py-0">
                            <CircleCheck aria-hidden="true" />
                            Feedback ready
                          </Badge>
                        ) : (
                          <Badge variant="caution" className="px-2 py-0">
                            <CircleDot aria-hidden="true" />
                            No feedback yet
                          </Badge>
                        )}
                      </span>
                    </Link>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete submission ${attempt.task.title}`} onClick={() => setPendingAttempt(attempt)}>
                      <Trash aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <HelpDisclosure id="writing" title="How feedback works" className="mt-10">
        <div className="flex flex-col gap-3 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Errors</span> are things that are wrong. <span className="font-medium text-foreground">Suggestions</span> are optional
            improvements to text that is already acceptable.
          </p>
          <p>Every correction quotes your text; anything that can't be found in it is withheld. An improved version is optional, after you've studied the feedback. Feedback is practice guidance, not an official CEFR assessment.</p>
          <PrivacyNote>Drafts stay in this browser; your text and the task are sent only when you ask for feedback.</PrivacyNote>
        </div>
      </HelpDisclosure>

      {storage ? (
        <SidePanel
          key={panel.key}
          open={panel.open}
          onClose={closePanel}
          dirty={dirty}
          title={practise.category ? 'Targeted writing task' : 'New task'}
          description="Choose the kind of writing; preview, regenerate and edit the task before saving it."
        >
          {panel.open ? (
            <div className="flex flex-col gap-5">
              {practise.category ? (
                <TargetedPracticeNotice
                  category={practise.category}
                  module="writing"
                  mistakes={targeted.mistakes}
                  profile={targeted.context?.profile ?? null}
                  includeExamples={targeted.includeExamples}
                  onIncludeExamplesChange={targeted.setIncludeExamples}
                />
              ) : null}
              {capabilities.status === 'ready' && !generationAvailable ? (
                <Notice>Generating writing tasks needs the local server and a Groq API key in apps/server/.env.</Notice>
              ) : practise.category && !targeted.context?.profile ? null : (
                <WritingTaskGenerator
                  repository={storage.repository}
                  embedded
                  initial={option ? { format: option.format, register: option.register, objective: option.objective } : undefined}
                  targetedPractice={targeted.context?.profile ?? null}
                  onDirtyChange={setDirty}
                  onClose={closePanel}
                  onSaved={(record, write) => {
                    if (targeted.context) void logTrainingSession(targeted.context, { id: record.id, title: record.task.title, level: record.task.level });
                    if (write) {
                      navigate(`/writing/tasks/${record.id}`);
                      return;
                    }
                    closePanel();
                    setView('tasks');
                    setSaved(`Saved “${record.task.title}”.`);
                    void refresh();
                  }}
                />
              )}
            </div>
          ) : null}
        </SidePanel>
      ) : null}

      <ConfirmDialog
        open={pendingTask !== null}
        title="Delete this task?"
        description="The task and its unsubmitted draft are removed from this browser. Texts you already submitted are kept."
        confirmLabel="Delete task"
        destructive
        onConfirm={() => {
          const record = pendingTask;
          setPendingTask(null);
          if (record && storage) void run(() => deleteWritingTask(storage.repository, record.id));
        }}
        onCancel={() => setPendingTask(null)}
      />
      <ConfirmDialog
        open={pendingAttempt !== null}
        title="Delete this submission?"
        description="The text, its feedback and any improved version are removed from this browser."
        confirmLabel="Delete submission"
        destructive
        onConfirm={() => {
          const attempt = pendingAttempt;
          setPendingAttempt(null);
          if (attempt && storage) void run(() => storage.repository.attempts.delete(attempt.id));
        }}
        onCancel={() => setPendingAttempt(null)}
      />
    </>
  );
}
