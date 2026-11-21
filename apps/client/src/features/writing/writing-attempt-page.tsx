import {
  WRITING_RECORD_VERSION,
  formatTimestamp,
  toWritingTaskInput,
  writingAssessmentResponseSchema,
  writingImprovementResponseSchema,
  type WritingAssessmentRequest,
  type WritingAssessmentResponse,
  type WritingAttempt,
  type WritingImprovementRequest,
  type WritingImprovementResponse,
} from '@ldg/shared';
import { LoaderCircle, PenLine, RotateCcw, Sparkles, Trash } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { useApiJob } from '@/lib/use-api-job';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { writingStorage } from './storage/writing-repository';
import { TaskBrief } from './task-brief';
import { AnnotatedText, AssessmentSummary, CorrectionList, TextTabs, textWithFixes, type TextView } from './writing-feedback';
import { dateFormatter } from './writing-labels';

const BACK = { to: '/writing', label: 'Writing' } as const;

function RunningState({ startedAt, label, onCancel }: { startedAt: number; label: string; onCancel: () => void }) {
  const elapsed = useElapsedSeconds(startedAt);
  return (
    <div className="flex flex-wrap items-center gap-3" role="status">
      <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
      <span className="text-sm">
        {label} <span className="text-muted-foreground tabular-nums">· {elapsed}s</span>
      </span>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export function WritingAttemptPage() {
  const { attemptId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const storage = writingStorage.use();
  const [attempt, setAttempt] = useState<WritingAttempt | null | 'missing'>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<TextView>('annotated');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'revise' | null>(null);
  const assessJob = useApiJob<WritingAssessmentRequest, WritingAssessmentResponse>('/api/writing/assessments', writingAssessmentResponseSchema, 'Feedback failed unexpectedly. Try again.');
  const improveJob = useApiJob<WritingImprovementRequest, WritingImprovementResponse>('/api/writing/improvements', writingImprovementResponseSchema, 'The improved version failed unexpectedly. Try again.');
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!storage) return;
    let active = true;
    storage.repository.attempts.get(attemptId).then(
      (row) => active && setAttempt(row ?? 'missing'),
      (caught: unknown) => {
        if (!active) return;
        setError(describeStorageFailure(caught));
        setAttempt('missing');
      },
    );
    return () => {
      active = false;
    };
  }, [storage, attemptId]);

  async function assess(current: WritingAttempt) {
    if (!storage) return;
    const response = await assessJob.start({ task: toWritingTaskInput(current.task), text: current.text });
    if (!response) return;
    try {
      const updated = await storage.repository.attempts.update(current.id, (row) => ({
        ...row,
        assessment: { model: response.model, createdAt: response.createdAt, result: response.assessment },
        updatedAt: Date.now(),
      }));
      if (updated) setAttempt(updated);
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  // "Submit for feedback" in the editor lands here with ?assess=1: that click is the explicit request.
  useEffect(() => {
    if (autoStarted.current || attempt === null || attempt === 'missing' || attempt.assessment || searchParams.get('assess') !== '1') return;
    autoStarted.current = true;
    setSearchParams({}, { replace: true });
    void assess(attempt);
    // Runs once, when the attempt first loads (guarded by `autoStarted`).
  }, [attempt]);

  async function improve(current: WritingAttempt) {
    if (!storage || !current.assessment) return;
    const corrections = current.assessment.result.corrections.map((correction) => ({ original: correction.original, correction: correction.correction }));
    const response = await improveJob.start({ task: toWritingTaskInput(current.task), text: current.text, corrections });
    if (!response) return;
    try {
      const updated = await storage.repository.attempts.update(current.id, (row) => ({
        ...row,
        improvement: { model: response.model, createdAt: response.createdAt, improvedText: response.improvedText, notes: response.notes },
        updatedAt: Date.now(),
      }));
      if (updated) setAttempt(updated);
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  async function revise(current: WritingAttempt) {
    if (!storage) return;
    setConfirm(null);
    try {
      const now = Date.now();
      // Restore the task from the attempt's snapshot if it was deleted in the meantime.
      if (!(await storage.repository.tasks.get(current.taskId))) {
        await storage.repository.tasks.put({ id: current.taskId, version: WRITING_RECORD_VERSION, task: current.task, category: 'everyday', model: null, createdAt: now, updatedAt: now });
      }
      await storage.repository.drafts.put({ taskId: current.taskId, version: WRITING_RECORD_VERSION, text: current.text, timerElapsedMs: 0, createdAt: now, updatedAt: now });
      navigate(`/writing/tasks/${current.taskId}`);
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  async function remove(current: WritingAttempt) {
    if (!storage) return;
    setConfirm(null);
    try {
      await storage.repository.attempts.delete(current.id);
      navigate('/writing', { replace: true });
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  if (attempt === null) {
    return (
      <p role="status" className="py-24 text-center text-sm text-muted-foreground">
        Opening your writing…
      </p>
    );
  }
  if (attempt === 'missing') {
    return <PageHeader eyebrow="Writing" title="Submission not found" description={error ?? 'It may have been deleted, or it was saved in another browser.'} back={BACK} />;
  }

  const assessment = attempt.assessment?.result ?? null;
  const corrections = assessment?.corrections ?? [];

  function select(id: string) {
    setActiveId(id);
    document.getElementById(`correction-${id}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }

  return (
    <>
      <PageHeader back={BACK}
        eyebrow="Writing feedback"
        title={<span className="break-words">{attempt.task.title}</span>}
        description={`Submitted ${dateFormatter.format(attempt.submittedAt)} · ${attempt.wordCount} words${attempt.timerElapsedMs > 0 ? ` · ${formatTimestamp(attempt.timerElapsedMs / 1000)} timed` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Delete submission" title="Delete" onClick={() => setConfirm('delete')}>
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {!assessment ? (
            <Card>
              <CardHeader>
                <CardTitle>Feedback</CardTitle>
                <CardDescription>Your text is saved. Feedback quotes your own words and separates errors from optional suggestions.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-1">
                {assessJob.state.phase === 'running' ? (
                  <RunningState startedAt={assessJob.state.startedAt} label="Reading your text and checking every correction against it" onCancel={assessJob.cancel} />
                ) : (
                  <>
                    {assessJob.state.phase === 'failed' ? (
                      <Notice tone="error" role="alert">
                        {assessJob.state.message}
                      </Notice>
                    ) : null}
                    {assessJob.state.phase === 'cancelled' ? <p className="text-sm text-muted-foreground">Feedback cancelled.</p> : null}
                    <Button className="self-start" onClick={() => void assess(attempt)}>
                      <Sparkles aria-hidden="true" />
                      {assessJob.state.phase === 'failed' ? 'Try again' : 'Get feedback'}
                    </Button>
                    <p className="text-xs text-muted-foreground">Your text and the task are sent through this app's local server to Groq.</p>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <AssessmentSummary assessment={assessment} />
          )}

          <Card>
            <CardContent className="pt-4">
              <TextTabs view={view} onChange={setView} improvedAvailable={attempt.improvement !== null}>
                {view === 'annotated' ? (
                  assessment ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-xs text-muted-foreground">
                        <span className="underline decoration-destructive decoration-2 underline-offset-4">Solid</span> = error ·{' '}
                        <span className="underline decoration-muted-foreground decoration-dotted decoration-2 underline-offset-4">dotted</span> = suggestion. Select a passage to see its explanation.
                      </p>
                      <AnnotatedText text={attempt.text} corrections={corrections} activeId={activeId} onSelect={select} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Corrections appear here after feedback.</p>
                  )
                ) : view === 'original' ? (
                  <div className="font-serif text-[1.0625rem] leading-[1.85] whitespace-pre-wrap">{attempt.text}</div>
                ) : view === 'fixed' ? (
                  assessment ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-xs text-muted-foreground">Your text with only the errors corrected. Suggestions are left out, so the text stays yours.</p>
                      <div className="font-serif text-[1.0625rem] leading-[1.85] whitespace-pre-wrap">{textWithFixes(attempt.text, corrections)}</div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Available after feedback.</p>
                  )
                ) : attempt.improvement ? (
                  <div className="flex flex-col gap-4">
                    <div className="font-serif text-[1.0625rem] leading-[1.85] whitespace-pre-wrap">{attempt.improvement.improvedText}</div>
                    <div className="rounded-md bg-muted/50 px-4 py-3">
                      <h3 className="mb-1.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">What changed</h3>
                      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
                        {attempt.improvement.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      A complete revision of your text that keeps your ideas and structure. Study the corrections first: comparing your own fixes with this version is where
                      most of the learning happens.
                    </p>
                    {improveJob.state.phase === 'running' ? (
                      <RunningState startedAt={improveJob.state.startedAt} label="Writing an improved version" onCancel={improveJob.cancel} />
                    ) : (
                      <>
                        {improveJob.state.phase === 'failed' ? (
                          <Notice tone="error" role="alert">
                            {improveJob.state.message}
                          </Notice>
                        ) : null}
                        <Button variant="secondary" className="self-start" disabled={!assessment} onClick={() => void improve(attempt)}>
                          <Sparkles aria-hidden="true" />
                          Write an improved version
                        </Button>
                        {!assessment ? <p className="text-xs text-muted-foreground">Available after feedback.</p> : null}
                      </>
                    )}
                  </div>
                )}
              </TextTabs>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setConfirm('revise')}>
              <PenLine aria-hidden="true" />
              Revise this text
            </Button>
            {assessment ? (
              <Button variant="ghost" onClick={() => void assess(attempt)} disabled={assessJob.state.phase === 'running'}>
                <RotateCcw aria-hidden="true" />
                Assess again
              </Button>
            ) : null}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          {assessment ? (
            <Card>
              <CardHeader>
                <CardTitle>Corrections</CardTitle>
                <CardDescription>Most important first.</CardDescription>
              </CardHeader>
              <CardContent className="pt-1">
                {corrections.length === 0 ? <p className="text-sm text-muted-foreground">No corrections were needed.</p> : <CorrectionList corrections={corrections} activeId={activeId} onSelect={setActiveId} />}
              </CardContent>
            </Card>
          ) : null}
          <TaskBrief task={attempt.task} compact />
        </aside>
      </div>

      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this submission?"
        description="The text, its feedback and any improved version are removed from this browser."
        confirmLabel="Delete submission"
        destructive
        onConfirm={() => void remove(attempt)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'revise'}
        title="Revise this text?"
        description="Your submitted text becomes the working draft for this task, replacing any unsubmitted draft. This submission and its feedback are kept."
        confirmLabel="Start revising"
        onConfirm={() => void revise(attempt)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
