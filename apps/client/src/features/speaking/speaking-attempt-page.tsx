import { MAX_STORED_RECORDING_BYTES, formatBytes, formatSpokenDuration, formatTimestamp, type ExerciseResponse, type RecordingState, type SpeakingAttempt } from '@ldg/shared';
import { HardDrive, MessageSquareText, RotateCcw, Trash, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { useKeepChoice } from '@/components/ui/keep-media-option';
import { RecordingStateBadge } from '@/components/ui/media-state-badge';
import { useCapabilities } from '@/hooks/use-capabilities';
import { StorageError } from '@/lib/storage/indexed-db';
import { requestPersistentStorage } from '../listening/storage/listening-storage';
import { isEdited, toAssessmentRequest } from './attempt';
import { AssessmentView, HighlightedText } from './assessment-view';
import { highlightsFor } from './issue-highlights';
import { ExerciseCard } from './exercise-card';
import { FluencyPanel } from './fluency-panel';
import { CATEGORY_LABELS } from './prompt-library';
import {
  describeSpeakingStorageError,
  forgetRecording,
  markRecordingSaved,
  noteRecordingIssue,
  recallRecording,
  recordingIssueOf,
  rememberRecording,
  useSpeakingStorage,
  type RecordingIssue,
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

const RECORDING_ISSUE_TEXT: Record<RecordingIssue, string> = {
  quota: 'Storage limit reached: the recording could not be saved in this browser. Free space in Settings & data, then keep it.',
  'write-failed': 'The recording could not be saved in this browser.',
  'recording-missing': 'The saved recording is missing from this browser (it may have been cleared). The transcript and feedback are intact.',
};

/**
 * The recording of this attempt and whether it survives a reload. Saved
 * recordings can be deleted on their own; an unsaved one says plainly that a
 * reload loses it, with the one action that prevents that.
 */
function RecordingCard({
  attempt,
  recording,
  audioRef,
  storage,
  issue,
  onChange,
  onDeleted,
  onIssue,
}: {
  attempt: SpeakingAttempt;
  recording: Blob | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  storage: SpeakingStorage;
  issue: RecordingIssue | null;
  onChange: (attempt: SpeakingAttempt) => void;
  onDeleted: () => void;
  onIssue: (issue: RecordingIssue | null) => void;
}) {
  const url = useObjectUrl(recording);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = attempt.recording.stored && recording !== null;
  const state: RecordingState = saved ? 'saved' : recording ? 'this-visit' : 'not-kept';
  const { plan } = useKeepChoice(state === 'this-visit' && recording ? recording.size : null, storage.repository.persistent, MAX_STORED_RECORDING_BYTES);

  async function keep() {
    if (!recording) return;
    setBusy(true);
    setError(null);
    try {
      await requestPersistentStorage();
      const updated = await storage.repository.saveRecording(attempt.id, recording);
      if (updated) {
        onChange(updated);
        markRecordingSaved(attempt.id, { saved: true, label: attempt.prompt.title });
        onIssue(null);
      }
    } catch (caught) {
      const kind = caught instanceof StorageError && caught.kind === 'quota' ? 'quota' : 'write-failed';
      onIssue(kind);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setConfirmDelete(false);
    setBusy(true);
    setError(null);
    try {
      const updated = await storage.repository.deleteRecording(attempt.id);
      if (updated) onChange(updated);
      // Deleting means gone: not even this tab keeps it.
      forgetRecording(attempt.id);
      onDeleted();
    } catch (caught) {
      setError(describeSpeakingStorageError(caught));
    } finally {
      setBusy(false);
    }
  }

  const description =
    state === 'saved'
      ? `${formatTimestamp(attempt.recordingDurationMs / 1000)} · ${formatBytes(recording?.size ?? 0)} · saved in this browser`
      : state === 'this-visit'
        ? `${formatTimestamp(attempt.recordingDurationMs / 1000)} · ${formatBytes(recording?.size ?? 0)} · not saved: a reload or closing the tab loses it`
        : issue === 'recording-missing'
          ? RECORDING_ISSUE_TEXT['recording-missing']
          : 'Not kept. Only the transcript and feedback were saved.';

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Recording</CardTitle>
          <RecordingStateBadge state={state} />
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {url ? <audio ref={audioRef} src={url} controls preload="metadata" className="w-full" aria-label="Your recording" /> : null}
        <div className="flex flex-wrap gap-2" aria-live="polite">
          {state === 'this-visit' && plan?.allowed ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void keep()}>
              <HardDrive aria-hidden="true" />
              {busy ? 'Saving…' : 'Keep this recording'}
            </Button>
          ) : null}
          {state === 'saved' ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash aria-hidden="true" />
              Delete recording
            </Button>
          ) : null}
        </div>
        {state === 'this-visit' && plan && !plan.allowed ? (
          <p className="text-xs text-muted-foreground">
            {plan.blocker === 'storage-full' ? `Storage limit reached: about ${formatBytes(plan.freeBytes ?? 0)} free.` : plan.blocker === 'too-large' ? 'This recording is too large to keep.' : "This browser isn't keeping data for this site."}
          </p>
        ) : null}
        {state === 'this-visit' && issue && issue !== 'recording-missing' ? (
          <Notice tone="error" role="alert">
            {RECORDING_ISSUE_TEXT[issue]}
          </Notice>
        ) : null}
        {error ? (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this recording?"
        description="The audio is removed from this browser and can't be recovered. The transcript, feedback and exercises stay."
        confirmLabel="Delete recording"
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
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
  const [recordingIssue, setRecordingIssue] = useState<RecordingIssue | null>(null);
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
        // Trust what is stored, not the flag: a recording that is gone must not be reported as saved.
        const check = await storage.repository.reconcileRecording(attemptId);
        if (!active) return;
        if (!check) {
          setAttempt('missing');
          return;
        }
        const loaded = check.attempt;
        if (check.repaired === 'flag-cleared') noteRecordingIssue(attemptId, 'recording-missing');
        let audio = recallRecording(attemptId);
        if (!audio && check.present) audio = await storage.repository.getRecording(attemptId);
        if (audio) rememberRecording(attemptId, audio, { saved: check.present, label: loaded.prompt.title });
        if (!active) return;
        setRecording(audio);
        setRecordingIssue(recordingIssueOf(attemptId));
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

  const back = { to: '/speaking', label: 'Speaking' } as const;

  if (attempt === 'missing') {
    return <PageHeader eyebrow="Speaking" title="Attempt not found" description="It may have been deleted, or it was saved in another browser." back={back} />;
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
        back={back}
        eyebrow="Speaking attempt"
        title={<span className="break-words">{attempt.prompt.title}</span>}
        description={`${dateFormatter.format(attempt.createdAt)} · ${attempt.mode === 'guided' ? 'Guided' : 'Free'} · ${formatSpokenDuration(
          attempt.recordingDurationMs / 1000,
        )} · ${CATEGORY_LABELS[attempt.prompt.category]}${attempt.prompt.level ? ` · ${attempt.prompt.level}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
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

      {/* Your answer first: recording (first on small screens) and transcript, then the feedback on it. */}
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>What you said</CardTitle>
              <CardDescription>
                {editedCount > 0 ? `Your confirmed transcript. You corrected ${editedCount} ${editedCount === 1 ? 'segment' : 'segments'} where speech recognition misheard you.` : 'Your confirmed transcript.'}
                {assessment && assessment.issues.length > 0 ? ' Underlined passages have a numbered correction below.' : ''}
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
                      {assessment ? <HighlightedText text={segment.text} highlights={highlightsFor(segment.text, segment.id, assessment.issues)} /> : segment.text}
                      {isEdited(segment) ? <span className="ml-2 font-sans text-xs text-brand">corrected</span> : null}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

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
        </div>

        {/* `contents` below xl lets the recording move to the top of the page while fluency stays after the feedback. */}
        <div className="contents min-w-0 xl:flex xl:flex-col xl:gap-6">
          <div className="order-first min-w-0 xl:order-none">
            <RecordingCard
              attempt={attempt}
              recording={recording}
              audioRef={audioRef}
              storage={storage}
              issue={recordingIssue}
              onChange={setAttempt}
              onDeleted={() => setRecording(null)}
              onIssue={(issue) => {
                noteRecordingIssue(attempt.id, issue);
                setRecordingIssue(issue);
              }}
            />
          </div>
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
