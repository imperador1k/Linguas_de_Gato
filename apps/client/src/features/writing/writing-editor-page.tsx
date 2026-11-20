import {
  WRITING_LIMITS,
  WRITING_RECORD_VERSION,
  countWords,
  formatTimestamp,
  wordCountStatus,
  type WritingAttempt,
  type WritingDraft,
  type WritingTaskRecord,
} from '@ldg/shared';
import { ArrowLeft, CircleAlert, CircleCheck, Pause, Play, Send, Timer, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { createAutosaver, type AutosaveStatus, type Autosaver } from '@/lib/autosave';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { cn } from '@/lib/utils';
import { writingStorage } from './storage/writing-repository';
import { TaskBrief } from './task-brief';

const AUTOSAVE_DELAY_MS = 800;

function BackLink() {
  return (
    <Link to="/writing" className={cn(buttonVariants({ variant: 'secondary' }))}>
      <ArrowLeft aria-hidden="true" />
      Writing Lab
    </Link>
  );
}

function SaveIndicator({ status, persistent }: { status: AutosaveStatus; persistent: boolean }) {
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <CircleAlert aria-hidden="true" className="size-4" />
        Not saved
      </span>
    );
  }
  const label = status === 'pending' || status === 'saving' ? 'Saving…' : status === 'saved' ? (persistent ? 'Draft saved' : 'Kept until you close this tab') : persistent ? 'Saved as you type' : 'Kept until you close this tab';
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      {status === 'saved' ? <CircleCheck aria-hidden="true" className="size-4 text-success" /> : null}
      {label}
    </span>
  );
}

/** Optional, never enforced: time spent writing, persisted with the draft. */
function useOptionalTimer(initialMs: number) {
  const [elapsedMs, setElapsedMs] = useState(initialMs);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Refs, not state, are the source of truth: closures from an earlier render must never double-count.
  const baseRef = useRef(initialMs);
  const startedRef = useRef<number | null>(null);
  useEffect(() => {
    if (startedAt === null) return;
    const tick = window.setInterval(() => setElapsedMs(baseRef.current + Date.now() - startedAt), 1000);
    return () => window.clearInterval(tick);
  }, [startedAt]);
  const current = useCallback(() => (startedRef.current === null ? baseRef.current : baseRef.current + Date.now() - startedRef.current), []);
  return {
    running: startedAt !== null,
    elapsedMs,
    current,
    reset(value: number) {
      baseRef.current = value;
      startedRef.current = null;
      setElapsedMs(value);
      setStartedAt(null);
    },
    start() {
      const now = Date.now();
      startedRef.current = now;
      setStartedAt(now);
    },
    /** Stops the timer and returns the settled total. */
    pause(): number {
      if (startedRef.current !== null) baseRef.current += Date.now() - startedRef.current;
      startedRef.current = null;
      setElapsedMs(baseRef.current);
      setStartedAt(null);
      return baseRef.current;
    },
  };
}

type Loaded = { readonly record: WritingTaskRecord; readonly draft: WritingDraft | null };

export function WritingEditorPage() {
  const { taskId = '' } = useParams();
  const navigate = useNavigate();
  const storage = writingStorage.use();
  const [loaded, setLoaded] = useState<Loaded | null | 'missing'>(null);
  const [text, setText] = useState('');
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'submit' | 'discard' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timer = useOptionalTimer(0);
  const saverRef = useRef<Autosaver<WritingDraft> | null>(null);
  const createdAtRef = useRef<number>(Date.now());
  const editorId = useId();
  const statusId = useId();

  useEffect(() => {
    if (!storage) return;
    let active = true;
    Promise.all([storage.repository.tasks.get(taskId), storage.repository.drafts.get(taskId)]).then(
      ([record, draft]) => {
        if (!active) return;
        if (!record) {
          setLoaded('missing');
          return;
        }
        setLoaded({ record, draft });
        setText(draft?.text ?? '');
        createdAtRef.current = draft?.createdAt ?? Date.now();
        timer.reset(draft?.timerElapsedMs ?? 0);
      },
      (caught: unknown) => {
        if (!active) return;
        setSaveError(describeStorageFailure(caught));
        setLoaded('missing');
      },
    );
    return () => {
      active = false;
    };
    // Load once per task: depending on `timer` (a new object each render) would reset the timer on every tick.
  }, [storage, taskId]);

  // One autosaver per task; flushed when the page is hidden or left.
  useEffect(() => {
    if (!storage) return;
    const saver = createAutosaver<WritingDraft>({
      delayMs: AUTOSAVE_DELAY_MS,
      save: (draft) => storage.repository.drafts.put(draft),
      onStatus: (status, error) => {
        setSaveStatus(status);
        setSaveError(status === 'error' ? describeStorageFailure(error) : null);
      },
    });
    saverRef.current = saver;
    const flush = () => void saver.flush();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      void saver.flush().finally(() => saver.dispose());
      saverRef.current = null;
    };
  }, [storage, taskId]);

  const queueSave = useCallback(
    (nextText: string, timerMs: number) => {
      const now = Date.now();
      saverRef.current?.schedule({ taskId, version: WRITING_RECORD_VERSION, text: nextText, timerElapsedMs: Math.round(timerMs), createdAt: createdAtRef.current, updatedAt: now });
    },
    [taskId],
  );

  const words = useMemo(() => countWords(text), [text]);

  if (loaded === null) {
    return (
      <p role="status" className="py-24 text-center text-sm text-muted-foreground">
        Opening your draft…
      </p>
    );
  }
  if (loaded === 'missing') {
    return <PageHeader eyebrow="Writing" title="Task not found" description={saveError ?? 'It may have been deleted, or it was saved in another browser.'} actions={<BackLink />} />;
  }

  const { task } = loaded.record;
  const status = wordCountStatus(words, task.wordCount);
  const canSubmit = words >= WRITING_LIMITS.minWordsForAssessment && !submitting;
  const statusText =
    status === 'empty'
      ? `Aim for ${task.wordCount.min}–${task.wordCount.max} words`
      : status === 'under'
        ? `${task.wordCount.min - words} below the range`
        : status === 'over'
          ? `${words - task.wordCount.max} above the range`
          : 'Within the range';

  async function submit() {
    if (!storage || loaded === null || loaded === 'missing') return;
    setConfirm(null);
    setSubmitting(true);
    const timerMs = timer.pause();
    try {
      await saverRef.current?.flush();
      const now = Date.now();
      const attempt: WritingAttempt = {
        id: crypto.randomUUID(),
        version: WRITING_RECORD_VERSION,
        taskId,
        task: loaded.record.task,
        text,
        wordCount: words,
        timerElapsedMs: Math.round(timerMs),
        assessment: null,
        improvement: null,
        submittedAt: now,
        updatedAt: now,
      };
      await storage.repository.attempts.put(attempt);
      // The submitted text now lives in the attempt; keeping the draft too would duplicate it.
      saverRef.current?.dispose();
      await storage.repository.drafts.delete(taskId);
      navigate(`/writing/attempts/${attempt.id}?assess=1`);
    } catch (caught) {
      setSaveError(describeStorageFailure(caught));
      setSubmitting(false);
    }
  }

  async function discardDraft() {
    if (!storage) return;
    setConfirm(null);
    saverRef.current?.dispose();
    try {
      await storage.repository.drafts.delete(taskId);
      setText('');
      timer.reset(0);
      setSaveStatus('idle');
      // A fresh saver for whatever the learner writes next.
      saverRef.current = createAutosaver<WritingDraft>({
        delayMs: AUTOSAVE_DELAY_MS,
        save: (draft) => storage.repository.drafts.put(draft),
        onStatus: (next, error) => {
          setSaveStatus(next);
          setSaveError(next === 'error' ? describeStorageFailure(error) : null);
        },
      });
      createdAtRef.current = Date.now();
    } catch (caught) {
      setSaveError(describeStorageFailure(caught));
    }
  }

  return (
    <>
      <PageHeader eyebrow="Writing" title={<span className="break-words">{task.title}</span>} actions={<BackLink />} />

      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Your draft lasts until you close this tab.</Notice> : null}
      {saveError ? (
        <Notice tone="error" role="alert" className="mb-6">
          {saveError} Keep this tab open; your text is still here.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Your text" className="flex min-w-0 flex-col gap-3 lg:order-1">
          {/* On small screens the full brief sits below the editor; keep the essentials in view first. */}
          <details open className="rounded-lg border bg-card px-4 py-3 lg:hidden">
            <summary className="cursor-pointer text-sm font-medium">The task</summary>
            <p className="mt-2 text-[0.9375rem] leading-relaxed">{task.instructions}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {task.wordCount.min}–{task.wordCount.max} words · include: {task.requiredElements.join('; ')}. Full brief below.
            </p>
          </details>
          <div className="rounded-xl border bg-card shadow-xs">
            <label htmlFor={editorId} className="sr-only">
              Your text for “{task.title}”
            </label>
            <textarea
              id={editorId}
              value={text}
              maxLength={WRITING_LIMITS.maxTextChars}
              spellCheck
              lang="en"
              aria-describedby={statusId}
              placeholder="Start writing here. Your draft is saved in this browser as you type."
              onChange={(event) => {
                setText(event.target.value);
                queueSave(event.target.value, timer.current());
              }}
              onBlur={() => void saverRef.current?.flush()}
              className="block min-h-[55vh] w-full resize-y rounded-t-xl bg-transparent px-5 py-5 font-serif text-[1.125rem] leading-[1.8] text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none sm:px-8 sm:py-7"
            />
            <div id={statusId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2.5 text-sm sm:px-5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-mono tabular-nums">
                  <span className={cn('font-medium', status === 'within' ? 'text-success' : status === 'empty' ? 'text-foreground' : 'text-brand')}>{words}</span>
                  <span className="text-muted-foreground"> / {task.wordCount.min}–{task.wordCount.max} words</span>
                </span>
                <span className="text-muted-foreground" aria-live="polite">
                  {statusText}
                </span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{text.length.toLocaleString()} characters</span>
              </div>
              <SaveIndicator status={saveStatus} persistent={storage?.persistent !== false} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => (status === 'within' ? void submit() : setConfirm('submit'))} disabled={!canSubmit}>
                <Send aria-hidden="true" />
                {submitting ? 'Submitting…' : 'Submit for feedback'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm('discard')} disabled={text === '' || submitting}>
                <Trash aria-hidden="true" />
                Discard draft
              </Button>
            </div>
            <div className="flex items-center gap-2" role="group" aria-label="Optional timer">
              <Timer aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="font-mono text-sm tabular-nums" aria-label={`Time spent: ${formatTimestamp(timer.elapsedMs / 1000)}`}>
                {formatTimestamp(timer.elapsedMs / 1000)}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (timer.running) queueSave(text, timer.pause());
                  else timer.start();
                }}
              >
                {timer.running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {timer.running ? 'Pause timer' : timer.elapsedMs > 0 ? 'Resume timer' : 'Start timer'}
              </Button>
            </div>
          </div>
          {words > 0 && words < WRITING_LIMITS.minWordsForAssessment ? (
            <p className="text-xs text-muted-foreground">Feedback needs at least {WRITING_LIMITS.minWordsForAssessment} words.</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Submitting sends your text and the task to Groq for feedback. The timer is only for you; it is never required.
          </p>
        </section>

        <aside className="min-w-0 lg:sticky lg:top-6 lg:order-2 lg:self-start">
          <TaskBrief task={task} />
        </aside>
      </div>

      <ConfirmDialog
        open={confirm === 'submit'}
        title="Submit outside the word range?"
        description={`Your text has ${words} words; the task asks for ${task.wordCount.min}–${task.wordCount.max}. Length is part of task achievement, but you can still get feedback.`}
        confirmLabel="Submit anyway"
        onConfirm={() => void submit()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        title="Discard this draft?"
        description="The text you've written for this task is removed from this browser. The task itself is kept."
        confirmLabel="Discard draft"
        destructive
        onConfirm={() => void discardDraft()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
