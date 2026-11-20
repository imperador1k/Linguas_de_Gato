import { formatSpokenDuration, formatTimestamp } from '@ldg/shared';
import { Circle, Mic, Pause, Play, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { RecorderState } from './audio-recorder';
import { LevelMeter } from './level-meter';

/**
 * The recording surface: a large timer, a live level meter and explicit
 * controls. The microphone is requested only when the learner presses
 * "Start recording".
 */
export function RecorderPanel({
  state,
  stream,
  targetSeconds,
  maxMs,
  onStart,
  onPause,
  onResume,
  onFinish,
  onCancel,
}: {
  state: RecorderState;
  stream: MediaStream | null;
  targetSeconds: number;
  maxMs: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const live = state.status === 'recording' || state.status === 'paused' || state.status === 'stopping';
  const elapsedMs = live ? state.elapsedMs : 0;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const targetPercent = Math.min(100, (elapsedMs / (targetSeconds * 1000)) * 100);
  const overTarget = elapsedMs > targetSeconds * 1000;

  return (
    <div className="flex flex-col items-center gap-6 rounded-xl border bg-card px-5 py-8 sm:px-8">
      <div className="flex items-center gap-2 text-sm font-medium" aria-live="polite">
        {state.status === 'recording' ? (
          <>
            <Circle aria-hidden="true" className="size-3 fill-destructive text-destructive" />
            Recording
          </>
        ) : state.status === 'paused' ? (
          <>
            <Pause aria-hidden="true" className="size-3.5" />
            Paused
          </>
        ) : state.status === 'requesting' ? (
          'Waiting for microphone permission…'
        ) : state.status === 'stopping' ? (
          'Finishing…'
        ) : (
          <span className="text-muted-foreground">Ready when you are</span>
        )}
      </div>

      <div className="text-center">
        <p className="font-mono text-6xl font-light tracking-tight tabular-nums sm:text-7xl" aria-hidden="true">
          {formatTimestamp(elapsedSeconds)}
        </p>
        <p className="sr-only" role="timer">
          {formatSpokenDuration(elapsedSeconds)} recorded
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {overTarget ? 'Past the suggested time; you can keep going' : `Suggested ${formatTimestamp(targetSeconds)}`} · stops at{' '}
          {formatTimestamp(maxMs / 1000)}
        </p>
      </div>

      <div className="w-full max-w-md">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Time against the suggested duration"
          aria-valuemin={0}
          aria-valuemax={targetSeconds}
          aria-valuenow={Math.min(elapsedSeconds, targetSeconds)}
        >
          <div className="h-full rounded-full bg-foreground transition-[width] duration-200" style={{ width: `${targetPercent}%` }} />
        </div>
      </div>

      <LevelMeter stream={stream} active={state.status === 'recording'} className="w-full max-w-md" />

      {state.status === 'error' ? (
        <Notice tone="error" role="alert" className="w-full max-w-md">
          {state.message}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {state.status === 'idle' || state.status === 'error' || state.status === 'requesting' ? (
          <Button variant="brand" size="lg" onClick={onStart} disabled={state.status === 'requesting'}>
            <Mic aria-hidden="true" />
            {state.status === 'error' ? 'Try again' : 'Start recording'}
          </Button>
        ) : null}
        {state.status === 'recording' ? (
          <Button variant="secondary" size="lg" onClick={onPause}>
            <Pause aria-hidden="true" />
            Pause
          </Button>
        ) : null}
        {state.status === 'paused' ? (
          <Button variant="secondary" size="lg" onClick={onResume}>
            <Play aria-hidden="true" />
            Resume
          </Button>
        ) : null}
        {state.status === 'recording' || state.status === 'paused' ? (
          <>
            <Button size="lg" onClick={onFinish}>
              <Square aria-hidden="true" className="fill-current" />
              Finish
            </Button>
            <Button variant="ghost" size="lg" onClick={onCancel}>
              <X aria-hidden="true" />
              Cancel
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
