import { formatTimestamp, type FluencyMetrics } from '@ldg/shared';
import { Gauge } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function Metric({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-md border px-3.5 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-lg tabular-nums">{value}</dd>
      {note ? <dd className="mt-0.5 text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

/**
 * Measurements from the transcript's timestamps: deterministic, and labelled
 * as such so they are never confused with the AI's judgement.
 */
export function FluencyPanel({ fluency, onSeek }: { fluency: FluencyMetrics; onSeek?: (ms: number) => void }) {
  const titleId = useId();
  const { pauses } = fluency;

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="flex items-center gap-2">
          <Gauge aria-hidden="true" className="size-4 text-muted-foreground" />
          Fluency measurements
        </CardTitle>
        <CardDescription>Calculated from your transcript's timestamps, not judged by AI.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-1">
        <dl className="grid grid-cols-2 gap-2">
          <Metric
            label="Speech rate"
            value={fluency.wordsPerMinute === null ? '—' : `${Math.round(fluency.wordsPerMinute)} wpm`}
            note={fluency.wordsPerMinute === null ? 'Too little timed speech' : 'Estimated'}
          />
          <Metric label="Words" value={fluency.wordCount} note={`${seconds(fluency.speakingTimeMs)} of speech`} />
          <Metric
            label={`Pauses ≥ ${pauses.thresholdMs / 1000} s`}
            value={pauses.count}
            note={`${pauses.longCount} over ${pauses.longThresholdMs / 1000} s`}
          />
          <Metric label="Longest pause" value={pauses.longestMs > 0 ? seconds(pauses.longestMs) : '—'} />
          <Metric label="Repetitions" value={fluency.repetitions.count} note={fluency.repetitions.examples[0] ? `e.g. “${fluency.repetitions.examples[0]}”` : undefined} />
          <Metric
            label="Possible fillers"
            value={fluency.fillers.count}
            note={fluency.fillers.items.length > 0 ? fluency.fillers.items.map((item) => `${item.text} ×${item.count}`).join(', ') : undefined}
          />
        </dl>

        {pauses.longest.length > 0 ? (
          <div>
            <h3 className="mb-1.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Longest pauses</h3>
            <ul className="flex flex-wrap gap-2">
              {pauses.longest.map((pause) => (
                <li key={pause.startMs}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="font-mono text-xs tabular-nums"
                    disabled={!onSeek}
                    onClick={() => onSeek?.(pause.startMs)}
                    aria-label={`Pause of ${seconds(pause.durationMs)} at ${formatTimestamp(pause.startMs / 1000)}`}
                  >
                    {formatTimestamp(pause.startMs / 1000)} · {seconds(pause.durationMs)}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs leading-relaxed text-muted-foreground">
          Conversational English is often quoted at roughly 120–160 words per minute; clarity matters more than speed. Speech
          recognition usually leaves out hesitations such as “um”, so filler counts are a minimum, and pause lengths are
          estimates. Pronunciation, accent and intonation are not measured.
        </p>
      </CardContent>
    </Card>
  );
}
