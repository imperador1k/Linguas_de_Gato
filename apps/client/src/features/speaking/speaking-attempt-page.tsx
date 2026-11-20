import { formatBytes, formatSpokenDuration, formatTimestamp, type ExerciseResponse, type SpeakingAttempt } from '@ldg/shared';
import { ArrowLeft, MessageSquareText, RotateCcw, Trash, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { useCapabilities } from '@/hooks/use-capabilities';
import { estimateStorage, requestPersistentStorage } from '../listening/storage/listening-storage';
import { isEdited, toAssessmentRequest } from './attempt';
import { AssessmentView } from './assessment-view';
import { ExerciseCard } from './exercise-card';
import { FluencyPanel } from './fluency-panel';
import { CATEGORY_LABELS } from './prompt-library';
import {
  describeSpeakingStorageError,
  forgetRecording,
  recallRecording,
  rememberRecording,
  useSpeakingStorage,
  type SpeakingStorage,
} from './storage/speaking-storage';
import { useAssessmentJob } from './use-assessment-job';

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

function RecordingCard({
  attempt,
  recording,
  audioRef,
  storage,
  onChange,
}: {
  attempt: SpeakingAttempt;
  recording: Blob | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  storage: SpeakingStorage;
  onChange: (attempt: SpeakingAttempt) => void;
}) {
  const url = useObjectUrl(recording);
  const [busy, setBusy] = useState(false);
  // Reflect the click immediately while the write runs.
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkboxId = useId();

  async function toggle(keep: boolean) {
    setBusy(true);
    setPending(keep);
    setError(null);
    try {
      if (keep && recording) {
        const estimate = await estimateStorage();
        if (estimate && estimate.quota - estimate.usage < recording.size * 2) {
          setError('Not enough browser storage to keep this recording.');
          return;
        }
        await requestPersistentStorage();
        const updated = await storage.repository.saveRecording(attempt.id, recording);
        if (updated) onChange(updated);
      } else {
        const updated = await storage.repository.deleteRecording(attempt.id);
        if (updated) onChange(updated);
      }
    } catch (caught) {
      setError(describeSpeakingStorageError(caught));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle>Recording</CardTitle>
        <CardDescription>
          {recording
            ? `${formatTimestamp(attempt.recordingDurationMs / 1000)} · ${formatBytes(recording.size)}`
            : 'Not kept. Only the transcript and feedback were saved.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {url ? <audio ref={audioRef} src={url} controls preload="metadata" className="w-full" aria-label="Your recording" /> : null}
        {recording || attempt.recording.stored ? (
          <div className="flex items-start gap-2.5">
            <input
              id={checkboxId}
              type="checkbox"
              checked={pending ?? attempt.recording.stored}
              aria-busy={busy || undefined}
              disabled={busy || (!recording && !attempt.recording.stored)}
              onChange={(event) => void toggle(event.target.checked)}
              className="mt-0.5 size-4 accent-[var(--brand)]"
            />
            <label htmlFor={checkboxId} className="text-sm">
              Keep this recording in this browser
              <span className="block text-xs text-muted-foreground">
                Off by default. Unticking deletes the saved audio; the transcript and feedback stay.
              </span>
            </label>
          </div>
        ) : null}
        {error ? (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SpeakingAttemptPage() {
  const { attemptId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const storage = useSpeakingStorage();
  const capabilities = useCapabilities();
  const [attempt, setAttempt] = useState<SpeakingAttempt | null | 'missing'>(null);
  const [recording, setRecording] = useState<Blob | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const job = useAssessmentJob();
  const elapsed = useElapsed(job.state.phase === 'running' ? job.state.startedAt : null);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!storage) return;
    let active = true;
    void (async () => {
      try {
        const loaded = await storage.repository.getAttempt(attemptId);
        if (!active) return;
        if (!loaded) {
          setAttempt('missing');
          return;
        }
        let audio = recallRecording(attemptId);
        if (!audio && loaded.recording.stored) {
          audio = await storage.repository.getRecording(attemptId);
          if (audio) rememberRecording(attemptId, audio);
        }
        if (!active) return;
        setRecording(audio);
        setAttempt(loaded);
      } catch {
        if (active) setAttempt('missing');
      }
    })();
    return () => {
      active = false;
    };
  }, [storage, attemptId]);

  const assess = useCallback(async () => {
    if (!storage || !attempt || attempt === 'missing') return;
    const response = await job.start(toAssessmentRequest(attempt));
    if (!response) return;
    try {
      const updated = await storage.repository.updateAttempt(attempt.id, (current) => ({
        ...current,
        assessment: { model: response.model, createdAt: response.createdAt, result: response.assessment },
        exerciseResponses: [],
        updatedAt: Date.now(),
      }));
      if (updated) setAttempt(updated);
    } catch (error) {
      job.fail(`The feedback arrived but couldn't be saved. ${describeSpeakingStorageError(error)}`);
    }
  }, [storage, attempt, job]);

  // Right after confirming a transcript, ask for feedback once, automatically.
  useEffect(() => {
    if (autoStarted.current || searchParams.get('assess') !== '1' || !attempt || attempt === 'missing') return;
    if (capabilities.status !== 'ready') return;
    autoStarted.current = true;
    setSearchParams({}, { replace: true });
    if (!attempt.assessment && capabilities.data.feedback.available) void assess();
  }, [attempt, searchParams, setSearchParams, assess, capabilities]);

  function seek(ms: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    void audio.play().catch(() => undefined);
  }

  async function saveResponse(response: ExerciseResponse) {
    if (!storage || !attempt || attempt === 'missing') return;
    try {
      const updated = await storage.repository.updateAttempt(attempt.id, (current) => ({
        ...current,
        exerciseResponses: [...current.exerciseResponses.filter((item) => item.exerciseId !== response.exerciseId), response],
        updatedAt: Date.now(),
      }));
      if (updated) setAttempt(updated);
      setSaveError(null);
    } catch (error) {
      setSaveError(describeSpeakingStorageError(error));
    }
  }

  async function deleteAttempt() {
    if (!storage) return;
    try {
      await storage.repository.deleteAttempt(attemptId);
      forgetRecording(attemptId);
      navigate('/speaking', { replace: true });
    } catch (error) {
      setConfirmDelete(false);
      setSaveError(describeSpeakingStorageError(error));
    }
  }

  const backLink = (
    <Link to="/speaking" className={buttonVariants({ variant: 'secondary' })}>
      <ArrowLeft aria-hidden="true" />
      Speaking Lab
    </Link>
  );

  if (attempt === 'missing') {
    return <PageHeader eyebrow="Speaking" title="Attempt not found" description="It may have been deleted, or it was saved in another browser." actions={backLink} />;
  }
  if (attempt === null || !storage) {
    return (
      <p role="status" className="py-24 text-center text-sm text-muted-foreground">
        Opening attempt…
      </p>
    );
  }

  const assessment = attempt.assessment?.result ?? null;
  const feedbackAvailable = capabilities.status === 'ready' && capabilities.data.feedback.available;
  const onSeek = recording ? seek : undefined;
  const editedCount = attempt.transcript.segments.filter(isEdited).length;

  return (
    <>
      <PageHeader
        eyebrow="Speaking attempt"
        title={<span className="break-words">{attempt.prompt.title}</span>}
        description={`${dateFormatter.format(attempt.createdAt)} · ${attempt.mode === 'guided' ? 'Guided' : 'Free'} · ${formatSpokenDuration(
          attempt.recordingDurationMs / 1000,
        )} · ${CATEGORY_LABELS[attempt.prompt.category]}${attempt.prompt.level ? ` · ${attempt.prompt.level}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {backLink}
            <Button variant="ghost" size="icon" aria-label="Delete attempt" title="Delete attempt" onClick={() => setConfirmDelete(true)}>
              <Trash aria-hidden="true" />
            </Button>
          </div>
        }
      />

      {storage.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} This attempt lasts until you close the tab.</Notice> : null}
      {saveError ? (
        <Notice tone="error" role="alert" className="mb-6">
          {saveError}
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {assessment ? (
            <>
              <AssessmentView assessment={assessment} onSeek={onSeek} />
              {assessment.exercises.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Practise what came up</CardTitle>
                    <CardDescription>Short exercises built from your own sentences.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-1">
                    <ol className="flex flex-col gap-3">
                      {assessment.exercises.map((exercise, index) => (
                        <ExerciseCard
                          key={exercise.id}
                          exercise={exercise}
                          index={index}
                          response={attempt.exerciseResponses.find((item) => item.exerciseId === exercise.id)}
                          onSave={(response) => void saveResponse(response)}
                          onSeek={onSeek}
                        />
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquareText aria-hidden="true" className="size-4 text-muted-foreground" />
                  Feedback
                </CardTitle>
                <CardDescription>
                  Detailed feedback on grammar, vocabulary, coherence, naturalness and the task, with every correction tied to
                  your words.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 pt-1">
                {job.state.phase === 'running' ? (
                  <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/40 px-4 py-3.5">
                    <div role="status" aria-live="polite" className="text-sm">
                      <p className="font-medium">Analysing your answer…</p>
                      <p className="mt-0.5 text-muted-foreground">
                        <span className="font-mono tabular-nums">{formatTimestamp(elapsed)}</span> elapsed · this usually takes a little
                        while
                      </p>
                      <progress className="mt-3 h-1.5 w-full accent-[var(--brand)]" aria-label="Feedback in progress" />
                    </div>
                    <Button variant="ghost" size="sm" onClick={job.cancel}>
                      <X aria-hidden="true" />
                      Cancel
                    </Button>
                  </div>
                ) : null}
                {job.state.phase === 'failed' ? (
                  <Notice tone="error" role="alert">
                    {job.state.message}
                  </Notice>
                ) : null}
                {job.state.phase === 'cancelled' ? <p className="text-sm text-muted-foreground">Feedback cancelled.</p> : null}
                {job.state.phase !== 'running' ? (
                  <div>
                    <Button variant="brand" size="lg" disabled={!feedbackAvailable} onClick={() => void assess()}>
                      {job.state.phase === 'failed' ? <RotateCcw aria-hidden="true" /> : <MessageSquareText aria-hidden="true" />}
                      {job.state.phase === 'failed' ? 'Try again' : 'Get feedback'}
                    </Button>
                  </div>
                ) : null}
                {!feedbackAvailable && capabilities.status === 'ready' ? (
                  <p className="text-sm text-muted-foreground">Feedback needs a Groq API key in apps/server/.env.</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Your confirmed transcript (not the audio) is sent to Groq for feedback.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Transcript</CardTitle>
              <CardDescription>
                {editedCount > 0
                  ? `You corrected ${editedCount} ${editedCount === 1 ? 'segment' : 'segments'} where speech recognition misheard you.`
                  : 'As confirmed by you.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-1">
              <ol className="flex flex-col gap-1">
                {attempt.transcript.segments.map((segment) => (
                  <li key={segment.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 py-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 justify-start px-1.5 font-mono text-xs tabular-nums"
                      disabled={!onSeek}
                      onClick={() => onSeek?.(segment.startMs)}
                      aria-label={`Play from ${formatTimestamp(segment.startMs / 1000)}`}
                    >
                      {formatTimestamp(segment.startMs / 1000)}
                    </Button>
                    <p className="font-serif text-[1.0625rem] leading-relaxed" lang="en">
                      {segment.text}
                      {isEdited(segment) ? <span className="ml-2 font-sans text-xs text-brand">corrected</span> : null}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <RecordingCard attempt={attempt} recording={recording} audioRef={audioRef} storage={storage} onChange={setAttempt} />
          <FluencyPanel fluency={attempt.fluency} onSeek={onSeek} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this attempt?"
        description="Its transcript, feedback, exercise answers and any saved recording will be removed from this browser."
        confirmLabel="Delete attempt"
        destructive
        onConfirm={() => void deleteAttempt()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
