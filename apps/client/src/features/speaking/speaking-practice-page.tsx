import {
  DEFAULT_TRANSCRIPTION_MAX_BYTES,
  SPEAKING_LIMITS,
  TARGET_DURATIONS_SECONDS,
  formatBytes,
  formatTimestamp,
  type GeneratedSpeakingDetails,
  type ReviewedSegment,
  type SpeakingMode,
  type SpeakingPrompt,
  type TargetDurationSeconds,
  type TranscriptionResult,
} from '@ldg/shared';
import { AudioLines, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { PrivacyNote } from '@/components/ui/privacy-note';
import { useCapabilities } from '@/hooks/use-capabilities';
import { cn } from '@/lib/utils';
import { TranscriptionOptionsFields, useTranscriptionPreferences } from '../listening/transcription/transcription-options';
import { TranscriptionStatus } from '../listening/transcription/transcription-status';
import { isTranscriptionBusy, useTranscriptionJob } from '../listening/transcription/use-transcription-job';
import { createAttempt, segmentsForReview } from './attempt';
import { CEFR_DISCLAIMER, FORMAT_LABELS } from './generation-labels';
import { CATEGORY_LABELS, findLibraryPrompt, toSpeakingPrompt } from './prompt-library';
import { RecorderPanel } from './recorder/recorder-panel';
import { useAudioRecorder } from './recorder/use-audio-recorder';
import { describeSpeakingStorageError, rememberRecording, useSpeakingStorage } from './storage/speaking-storage';
import { TranscriptReview } from './transcript-review';
import { useWorkInProgress } from '@/lib/work-in-progress';

interface LoadedTask {
  readonly prompt: SpeakingPrompt;
  readonly structure: readonly string[];
  readonly suggested: TargetDurationSeconds;
  /** Present for AI-generated topics. */
  readonly generated?: GeneratedSpeakingDetails | undefined;
}

const SECTION_HEADING = 'mb-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase';

/** What a generated task adds: guidance, objectives, useful language, follow-ups (never a model answer). */
function GeneratedTaskDetails({ details }: { details: GeneratedSpeakingDetails }) {
  return (
    <>
      <div>
        <h3 className={SECTION_HEADING}>How to approach it</h3>
        <p className="text-sm leading-relaxed">{details.guidance}</p>
      </div>
      {details.objectives.length > 0 ? (
        <div>
          <h3 className={SECTION_HEADING}>Aim to</h3>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
            {details.objectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {details.vocabulary.length > 0 ? (
        <details className="group rounded-md border px-3.5 py-2.5" open>
          <summary className="cursor-pointer text-sm font-medium">Useful language ({details.vocabulary.length})</summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {details.vocabulary.map((item) => (
              <div key={item.expression}>
                <dt className="text-sm font-medium">{item.expression}</dt>
                <dd className="text-xs text-muted-foreground">{item.meaning}</dd>
                <dd className="mt-0.5 text-xs italic text-muted-foreground">{item.example}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {details.followUpQuestions.length > 0 ? (
        <details className="rounded-md border px-3.5 py-2.5">
          <summary className="cursor-pointer text-sm font-medium">Follow-up questions (for a second attempt)</summary>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
            {details.followUpQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-xs text-muted-foreground">{CEFR_DISCLAIMER}</p>
    </>
  );
}

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

/** Shown where the recording can be sent; the full explanation lives in Settings → Privacy & AI. */
export function SpeakingPrivacyNote({ className }: { className?: string }) {
  return (
    <PrivacyNote className={className}>
      Your recording stays in this browser until you press Transcribe; then the audio, and later your confirmed transcript, are sent to Groq through the local server.
    </PrivacyNote>
  );
}

function TaskCard({ task, mode }: { task: LoadedTask; mode: SpeakingMode }) {
  const { prompt } = task;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{CATEGORY_LABELS[prompt.category]}</Badge>
          {task.generated ? <Badge variant="brand">AI-generated · {FORMAT_LABELS[task.generated.format].label}</Badge> : null}
          {prompt.level ? <Badge variant="outline">{prompt.level}</Badge> : <Badge variant="outline">Your topic</Badge>}
        </div>
        <CardTitle className="mt-2 font-serif text-2xl font-normal">{prompt.title}</CardTitle>
        <CardDescription className="text-base text-foreground">{prompt.instructions}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-1">
        {prompt.points.length > 0 ? (
          <div>
            <h3 className="mb-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {mode === 'guided' ? 'Cover these points' : 'Points you could mention'}
            </h3>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
              {prompt.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {mode === 'guided' && task.structure.length > 0 ? (
          <div>
            <h3 className="mb-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Suggested structure</h3>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed">
              {task.structure.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}
        {task.generated ? <GeneratedTaskDetails details={task.generated} /> : null}
      </CardContent>
    </Card>
  );
}

type Stage = 'prepare' | 'record' | 'listen' | 'review';

const STEPS: ReadonlyArray<{ label: string; stages: readonly Stage[] }> = [
  { label: 'Task', stages: [] },
  { label: 'Set up', stages: ['prepare'] },
  { label: 'Record', stages: ['record', 'listen'] },
  { label: 'Check transcript', stages: ['review'] },
  { label: 'Feedback', stages: [] },
  { label: 'Exercises', stages: [] },
];

/** Where the learner is in the practice: the order of the page, stated once. */
function PracticeSteps({ stage }: { stage: Stage }) {
  const current = STEPS.findIndex((step) => step.stages.includes(stage));
  return (
    <nav aria-label="Practice steps" className="mb-6">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
        {STEPS.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={step.label} className="flex items-center gap-1" aria-current={active ? 'step' : undefined}>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
                  active ? 'bg-accent font-medium text-foreground' : done ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span aria-hidden="true" className={cn('inline-flex size-5 items-center justify-center rounded-full border text-[0.6875rem] tabular-nums', active && 'border-foreground', done && 'border-transparent bg-foreground text-background')}>
                  {index + 1}
                </span>
                {step.label}
                {done ? <span className="sr-only"> (done)</span> : null}
              </span>
              {index < STEPS.length - 1 ? <span aria-hidden="true" className="text-border-strong">·</span> : null}
            </li>
          );
        })}
      </ol>
      {current >= 3 ? <p className="mt-2 text-xs text-muted-foreground">Saving the transcript opens the attempt, where feedback and exercises follow.</p> : null}
    </nav>
  );
}

function PracticeSettings({
  mode,
  onModeChange,
  target,
  onTargetChange,
  disabled,
}: {
  mode: SpeakingMode;
  onModeChange: (mode: SpeakingMode) => void;
  target: TargetDurationSeconds;
  onTargetChange: (target: TargetDurationSeconds) => void;
  disabled: boolean;
}) {
  const id = useId();
  const modes: Array<{ value: SpeakingMode; label: string; description: string }> = [
    { value: 'guided', label: 'Guided', description: 'With points to cover and a suggested structure.' },
    { value: 'free', label: 'Free', description: 'Organise your answer your own way.' },
  ];
  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={disabled}>
        <legend className="mb-2 text-sm font-medium">Mode</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {modes.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer gap-3 rounded-md border px-3.5 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                mode === option.value ? 'border-foreground bg-accent/60' : 'border-input hover:border-border-strong',
              )}
            >
              <input
                type="radio"
                name={`${id}-mode`}
                checked={mode === option.value}
                onChange={() => onModeChange(option.value)}
                className="mt-0.5 size-4 accent-[var(--brand)] focus-visible:outline-none"
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend className="mb-2 text-sm font-medium">Suggested speaking time</legend>
        <div className="flex flex-wrap gap-2">
          {TARGET_DURATIONS_SECONDS.map((seconds) => (
            <label
              key={seconds}
              className={cn(
                'inline-flex h-10 cursor-pointer items-center rounded-md border px-4 font-mono text-sm tabular-nums has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                target === seconds ? 'border-foreground bg-accent/60 font-medium' : 'border-input hover:border-border-strong',
              )}
            >
              <input
                type="radio"
                name={`${id}-duration`}
                checked={target === seconds}
                onChange={() => onTargetChange(seconds)}
                className="sr-only"
              />
              {formatTimestamp(seconds)}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          A guide, not a limit. Recording stops automatically at {formatTimestamp(SPEAKING_LIMITS.maxRecordingMs / 1000)}.
        </p>
      </fieldset>
    </div>
  );
}

export function SpeakingPracticePage() {
  const { source, topicId = '' } = useParams();
  const navigate = useNavigate();
  const storage = useSpeakingStorage();
  const capabilities = useCapabilities();
  const [task, setTask] = useState<LoadedTask | null | 'missing'>(null);
  const [mode, setMode] = useState<SpeakingMode>('guided');
  const [target, setTarget] = useState<TargetDurationSeconds>(60);
  const [transcriptionOptions, setTranscriptionOptions] = useTranscriptionPreferences();
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [segments, setSegments] = useState<ReviewedSegment[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { state: recorderState, recorder } = useAudioRecorder({
    maxDurationMs: SPEAKING_LIMITS.maxRecordingMs,
    minDurationMs: SPEAKING_LIMITS.minRecordingMs,
    maxBytes: DEFAULT_TRANSCRIPTION_MAX_BYTES,
  });
  const job = useTranscriptionJob();
  const recording = recorderState.status === 'recorded' ? recorderState.recording : null;
  const recordingUrl = useObjectUrl(recording?.blob ?? null);

  // Load the task: a library prompt, or a saved custom topic.
  useEffect(() => {
    if (source === 'library') {
      const found = findLibraryPrompt(topicId);
      setTask(found ? { prompt: toSpeakingPrompt(found), structure: found.structure, suggested: found.suggestedDurationSeconds } : 'missing');
      if (found) setTarget(found.suggestedDurationSeconds);
      return;
    }
    if (!storage) return;
    let active = true;
    void storage.repository.listTopics().then(
      (topics) => {
        if (!active) return;
        const topic = topics.find((item) => item.id === topicId);
        if (!topic) {
          setTask('missing');
          return;
        }
        const suggested = topic.generated?.targetDurationSeconds ?? 60;
        setTask({ prompt: topic.prompt, structure: [], suggested, generated: topic.generated });
        setTarget(suggested);
        // Generated free-speaking tasks and hand-written topics start in free mode; other formats come with points to cover.
        setMode(topic.generated && topic.generated.format !== 'free' ? 'guided' : 'free');
      },
      () => active && setTask('missing'),
    );
    return () => {
      active = false;
    };
  }, [source, topicId, storage]);

  const busy = isTranscriptionBusy(job.state) || saving;
  const stage: Stage = transcription
    ? 'review'
    : recording
      ? 'listen'
      : recorderState.status === 'idle' || recorderState.status === 'error'
        ? 'prepare'
        : 'record';
  const hasWork = stage !== 'prepare' || busy;

  // Leaving mid-practice would discard the recording or the transcript: ask first.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => hasWork && !saving && currentLocation.pathname !== nextLocation.pathname);
  useWorkInProgress(hasWork);
  useEffect(() => {
    if (!hasWork) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasWork]);

  function discardAll() {
    job.reset();
    setTranscription(null);
    setSegments([]);
    setSaveError(null);
    recorder.cancel();
  }

  async function transcribe() {
    if (!recording) return;
    const file = new File([recording.blob], `recording.${recording.format.extension}`, { type: recording.format.uploadType });
    // English by default for the Speaking Lab; the learner can still pick automatic detection.
    const result = await job.start(file, file.name, transcriptionOptions);
    if (!result) return;
    const reviewed = segmentsForReview(result, recording.durationMs);
    if (reviewed.length === 0) {
      job.fail('No speech was found in the recording. Check your microphone and record again.');
      return;
    }
    setTranscription(result);
    setSegments(reviewed);
  }

  async function confirmTranscript() {
    if (!storage || !recording || !transcription || task === null || task === 'missing') return;
    setSaving(true);
    setSaveError(null);
    const attempt = createAttempt({
      id: crypto.randomUUID(),
      prompt: task.prompt,
      mode,
      targetDurationSeconds: target,
      recordingDurationMs: recording.durationMs,
      recordingType: recording.format.uploadType,
      transcription,
      segments,
      now: Date.now(),
    });
    try {
      await storage.repository.putAttempt(attempt);
    } catch (error) {
      setSaving(false);
      setSaveError(`The attempt couldn't be saved. ${describeSpeakingStorageError(error)}`);
      return;
    }
    rememberRecording(attempt.id, recording.blob);
    navigate(`/speaking/attempts/${attempt.id}?assess=1`);
  }

  if (task === 'missing') {
    return (
      <PageHeader
        eyebrow="Speaking"
        title="Topic not found"
        description="It may have been deleted."
        back={{ to: '/speaking', label: 'Speaking' }}
      />
    );
  }
  if (task === null) {
    return (
      <p role="status" className="py-24 text-center text-sm text-muted-foreground">
        Opening topic…
      </p>
    );
  }

  const transcriptionAvailable = capabilities.status === 'ready' && capabilities.data.transcription.available;

  return (
    <>
      <PageHeader
        eyebrow="Speaking practice"
        title={<span className="break-words">{task.prompt.title}</span>}
        back={{ to: '/speaking', label: 'Speaking' }}
      />

      {capabilities.status === 'ready' && !transcriptionAvailable ? (
        <Notice className="mb-6">
          You can record and listen back, but transcription and feedback need a Groq API key in{' '}
          <code className="font-mono text-xs">apps/server/.env</code>.
        </Notice>
      ) : null}

      <PracticeSteps stage={stage} />

      {/* Reading order is the practice order: the task, then set-up, recording and the transcript check. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <div className="min-w-0 lg:sticky lg:top-6">
          <TaskCard task={task} mode={mode} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {stage === 'prepare' ? (
            <Card>
              <CardHeader>
                <CardTitle>Set up</CardTitle>
                <CardDescription>Choose how to answer before you start recording.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5 pt-1">
                <PracticeSettings mode={mode} onModeChange={setMode} target={target} onTargetChange={setTarget} disabled={false} />
                <SpeakingPrivacyNote />
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">
              {mode === 'guided' ? 'Guided' : 'Free'} · suggested {formatTimestamp(target)}
            </p>
          )}
          {stage === 'review' ? (
            <TranscriptReview
              audioUrl={recordingUrl}
              segments={segments}
              onChange={setSegments}
              onConfirm={() => void confirmTranscript()}
              onDiscard={discardAll}
              busy={saving}
            />
          ) : stage === 'listen' && recording ? (
            <Card>
              <CardHeader>
                <CardTitle>Listen back</CardTitle>
                <CardDescription>
                  {formatTimestamp(recording.durationMs / 1000)} recorded · {formatBytes(recording.blob.size)}
                  {recording.endedBy === 'max-duration' ? ' · stopped at the maximum length' : ''}
                  {recording.endedBy === 'device-ended' ? ' · the microphone was disconnected' : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {recordingUrl ? <audio src={recordingUrl} controls preload="metadata" className="w-full" aria-label="Your recording" /> : null}
                {transcriptionAvailable ? (
                  <TranscriptionOptionsFields value={transcriptionOptions} onChange={setTranscriptionOptions} disabled={busy} />
                ) : null}
                <SpeakingPrivacyNote />
                <TranscriptionStatus state={job.state} onCancel={job.cancel} onRetry={() => void transcribe()} />
                {!busy ? (
                  <div className="flex flex-wrap gap-3">
                    <Button variant="brand" size="lg" disabled={!transcriptionAvailable} onClick={() => void transcribe()}>
                      <AudioLines aria-hidden="true" />
                      Transcribe
                    </Button>
                    <Button variant="ghost" size="lg" onClick={discardAll}>
                      <RotateCcw aria-hidden="true" />
                      Record again
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <RecorderPanel
              state={recorderState}
              stream={recorder.getStream()}
              targetSeconds={target}
              maxMs={SPEAKING_LIMITS.maxRecordingMs}
              onStart={() => void recorder.start()}
              onPause={() => recorder.pause()}
              onResume={() => recorder.resume()}
              onFinish={() => recorder.finish()}
              onCancel={() => recorder.cancel()}
            />
          )}

          {saveError ? (
            <Notice tone="error" role="alert">
              {saveError}
            </Notice>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave this practice?"
        description="Your recording and transcript haven't been saved and will be discarded."
        confirmLabel="Leave"
        destructive
        onConfirm={() => {
          discardAll();
          blocker.proceed?.();
        }}
        onCancel={() => blocker.reset?.()}
      />
    </>
  );
}
