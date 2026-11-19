import { formatPreciseTimestamp } from '@ldg/shared';
import { Repeat, Repeat1, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import type { BoundedPlaybackApi } from './playback/use-bounded-playback';

function describe(practice: BoundedPlaybackApi): string {
  const { bounded, pointA } = practice;
  if (bounded?.mode === 'loop') {
    const label = bounded.source === 'line' ? `Looping line ${bounded.cueIndex + 1}` : 'Looping';
    return `${label} · ${formatPreciseTimestamp(bounded.range.startMs)} – ${formatPreciseTimestamp(bounded.range.endMs)}`;
  }
  if (bounded?.mode === 'segment') return `Replaying line ${bounded.cueIndex + 1}`;
  if (pointA !== null) return `A at ${formatPreciseTimestamp(pointA)}. Press B where the loop should end.`;
  return 'Replay a line, or mark A and B to loop any passage.';
}

/** Replay-line and A-B loop controls shared by every source type. */
export function PracticeBar({
  practice,
  ready,
  canReplayLine,
  onReplayLine,
  onToggleLineLoop,
}: {
  practice: BoundedPlaybackApi;
  ready: boolean;
  canReplayLine: boolean;
  onReplayLine: () => void;
  onToggleLineLoop: () => void;
}) {
  const { bounded, pointA, error } = practice;
  const lineLoopActive = bounded?.mode === 'loop' && bounded.source === 'line';
  const abActive = bounded?.mode === 'loop' && bounded.source === 'ab';
  const canClear = bounded !== null || pointA !== null;
  const lineHint = canReplayLine ? undefined : 'Import a transcript to replay by line';

  return (
    <section aria-label="Practice controls" className="rounded-lg border bg-card px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!ready || !canReplayLine}
            title={lineHint ?? 'Replay the current line (R)'}
            onClick={onReplayLine}
          >
            <Repeat1 aria-hidden="true" />
            Replay line
            <Kbd className="ml-0.5 hidden sm:inline-flex">R</Kbd>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={lineLoopActive}
            disabled={!ready || !canReplayLine}
            title={lineHint ?? 'Loop the current line until you stop it'}
            onClick={onToggleLineLoop}
            className={cn(lineLoopActive && 'border-brand bg-brand-subtle text-foreground hover:bg-brand-subtle')}
          >
            <Repeat aria-hidden="true" />
            Loop line
          </Button>
        </div>

        <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border sm:block" />

        <div role="group" aria-label="A-B loop" className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!ready}
            aria-pressed={pointA !== null || abActive}
            title="Set loop start at the current position (A)"
            onClick={practice.setPointA}
            className={cn('font-mono', (pointA !== null || abActive) && 'border-brand text-brand')}
          >
            <span aria-hidden="true">A</span>
            <span className="sr-only">Set loop start</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!ready}
            aria-pressed={abActive}
            title="Set loop end at the current position (B)"
            onClick={practice.setPointB}
            className={cn('font-mono', abActive && 'border-brand text-brand')}
          >
            <span aria-hidden="true">B</span>
            <span className="sr-only">Set loop end</span>
          </Button>
          <Button variant="ghost" size="sm" disabled={!canClear} title="Clear the loop (Esc)" onClick={practice.clear}>
            <X aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>

      <p
        aria-live="polite"
        className={cn('mt-2 text-sm', error ? 'text-destructive' : bounded ? 'text-foreground' : 'text-muted-foreground')}
      >
        {error ?? describe(practice)}
      </p>
    </section>
  );
}
