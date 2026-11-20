import { countWords, type WritingAttempt, type WritingDraft, type WritingTaskRecord } from '@ldg/shared';
import { ArrowRight, PenLine, ShieldCheck, Sparkles, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { useCapabilities } from '@/hooks/use-capabilities';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { deleteWritingTask, newestFirst, writingStorage, type WritingRepository } from './storage/writing-repository';
import { WritingTaskGenerator } from './writing-task-generator';
import { dateFormatter, WRITING_FORMAT_LABELS } from './writing-labels';

interface LabData {
  readonly tasks: WritingTaskRecord[];
  readonly drafts: Map<string, WritingDraft>;
  readonly attempts: WritingAttempt[];
}

async function loadLab(repository: WritingRepository): Promise<LabData> {
  const [tasks, drafts, attempts] = await Promise.all([repository.tasks.list(), repository.drafts.list(), repository.attempts.list()]);
  return { tasks: newestFirst(tasks), drafts: new Map(drafts.map((draft) => [draft.taskId, draft])), attempts: attempts.sort((a, b) => b.submittedAt - a.submittedAt) };
}

export function WritingLabPage() {
  const storage = writingStorage.use();
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [data, setData] = useState<LabData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [pendingTask, setPendingTask] = useState<WritingTaskRecord | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState<WritingAttempt | null>(null);
  const ids = { tasks: useId(), attempts: useId() };
  const generationAvailable = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;
  const feedbackAvailable = capabilities.status === 'ready' && capabilities.data.feedback.available;

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

  async function run(action: () => Promise<void>) {
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Writing"
        title="Write with purpose, revise with evidence."
        description="Practise the texts you need at B2–C2, then get feedback where every correction quotes your own words and separates real errors from stylistic suggestions."
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card aria-labelledby={ids.tasks}>
            <CardHeader>
              <CardTitle id={ids.tasks}>Your writing tasks</CardTitle>
              <CardDescription>Essays, emails, reports, reviews and text work. Drafts are saved as you type.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-1">
              {saved ? (
                <Notice tone="success" role="status">
                  Saved “{saved}”.
                </Notice>
              ) : null}
              {generating && storage ? (
                <WritingTaskGenerator
                  repository={storage.repository}
                  onClose={() => setGenerating(false)}
                  onSaved={(record, write) => {
                    if (write) {
                      navigate(`/writing/tasks/${record.id}`);
                      return;
                    }
                    setGenerating(false);
                    setSaved(record.task.title);
                    void refresh();
                  }}
                />
              ) : generationAvailable ? (
                <Button className="self-start" onClick={() => setGenerating(true)}>
                  <Sparkles aria-hidden="true" />
                  Generate a writing task
                </Button>
              ) : null}

              {data === null ? null : data.tasks.length === 0 ? (
                !generating ? <p className="text-sm text-muted-foreground">No tasks yet. Generate one to start writing.</p> : null
              ) : (
                <ul className="flex flex-col divide-y rounded-lg border" aria-label="Saved writing tasks">
                  {data.tasks.map((record) => {
                    const draft = data.drafts.get(record.id);
                    const words = draft ? countWords(draft.text) : 0;
                    return (
                      <li key={record.id} className="flex items-center gap-2 px-3 py-2">
                        <Link to={`/writing/tasks/${record.id}`} className="group min-w-0 flex-1 rounded-md px-1 py-1.5 hover:bg-accent/40">
                          <span className="block truncate font-medium">{record.task.title}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Badge variant="outline" className="px-2 py-0">
                              {record.task.level}
                            </Badge>
                            {WRITING_FORMAT_LABELS[record.task.format]} · {record.task.wordCount.min}–{record.task.wordCount.max} words ·{' '}
                            {draft && words > 0 ? <span className="font-medium text-foreground">Draft · {words} words</span> : 'Not started'}
                          </span>
                        </Link>
                        <ArrowRight aria-hidden="true" className="hidden size-4 text-muted-foreground sm:block" />
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete task ${record.task.title}`} onClick={() => setPendingTask(record)}>
                          <Trash aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card aria-labelledby={ids.attempts}>
            <CardHeader>
              <CardTitle id={ids.attempts}>Submitted writing</CardTitle>
              <CardDescription>{storage?.persistent === false ? 'Kept until you close this tab.' : 'Saved in this browser.'}</CardDescription>
            </CardHeader>
            <CardContent className="pt-1">
              {data === null ? null : data.attempts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Texts you submit for feedback appear here.</p>
              ) : (
                <ul className="flex flex-col divide-y rounded-lg border" aria-label="Submitted writing">
                  {data.attempts.map((attempt) => (
                    <li key={attempt.id} className="flex items-center gap-2 px-3 py-1.5">
                      <Link to={`/writing/attempts/${attempt.id}`} className="min-w-0 flex-1 rounded-md px-1 py-1.5 hover:bg-accent/40">
                        <span className="block truncate text-sm font-medium">{attempt.task.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {dateFormatter.format(attempt.submittedAt)} · {attempt.wordCount} words · {attempt.assessment ? 'Feedback ready' : 'No feedback yet'}
                        </span>
                      </Link>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete submission ${attempt.task.title}`} onClick={() => setPendingAttempt(attempt)}>
                        <Trash aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PenLine aria-hidden="true" className="size-4 text-muted-foreground" />
                How feedback works
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-1 text-sm leading-relaxed text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Errors</span> are things that are wrong. <span className="font-medium text-foreground">Suggestions</span> are
                optional improvements to text that is already acceptable.
              </p>
              <p>Every correction quotes your text; anything that can't be found in it is withheld. An improved version is optional, after you've studied the feedback.</p>
              <p className="flex gap-2 text-xs">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Drafts stay in this browser. When you ask for feedback, your text and the task are sent through this app's local server to Groq; Groq's retention is
                  governed by your Groq account settings and policies. Feedback is practice guidance, not an official CEFR assessment.
                </span>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

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
