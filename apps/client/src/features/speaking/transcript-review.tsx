import { findActiveCueIndex, formatTimestamp, type ReviewedSegment } from '@ldg/shared';
import { Play, RotateCcw } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/utils';
import { editSegment, isEdited, restoreSegment, summarizeReview } from './attempt';

/** Grows with its content at any width, so a segment is never clipped on narrow screens. */
function SegmentTextarea({ id, value, onChange, disabled }: { id: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <AutoGrowTextarea
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
      lang="en"
      disabled={disabled}
      className="w-full rounded-md border border-input bg-card px-3 py-2 font-serif text-[1.0625rem] leading-relaxed transition-colors duration-150 hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none"
    />
  );
}

/**
 * The learner checks what the speech recogniser heard before any feedback is
 * requested, so recognition errors are never mistaken for language errors.
 * Each segment keeps its timestamps; text edits never move it in time.
 */
export function TranscriptReview({
  audioUrl,
  segments,
  onChange,
  onConfirm,
  onDiscard,
  busy,
}: {
  audioUrl: string | null;
  segments: readonly ReviewedSegment[];
  onChange: (segments: ReviewedSegment[]) => void;
  onConfirm: () => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentMs, setCurrentMs] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const titleId = useId();
  const summary = summarizeReview(segments);
  const activeIndex = useMemo(() => (playing ? findActiveCueIndex(segments, currentMs) : -1), [segments, currentMs, playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sync = () => {
      setCurrentMs(audio.currentTime * 1000);
      setPlaying(!audio.paused);
    };
    const events = ['timeupdate', 'play', 'pause', 'seeked', 'ended'] as const;
    events.forEach((type) => audio.addEventListener(type, sync));
    return () => events.forEach((type) => audio.removeEventListener(type, sync));
  }, [audioUrl]);

  function playFrom(startMs: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = startMs / 1000;
    void audio.play().catch(() => undefined);
  }

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>Check the transcript</CardTitle>
        <CardDescription>
          Listen and fix only words the app <span className="font-medium text-foreground">misheard</span>. Leave your own grammar
          and vocabulary exactly as you said them: that is what the feedback is for.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {audioUrl ? (
          // Native controls: keyboard accessible and familiar.
          <audio ref={audioRef} src={audioUrl} controls preload="metadata" className="w-full" aria-label="Your recording" />
        ) : null}

        <ol className="flex flex-col gap-3" aria-label="Transcript segments">
          {segments.map((segment, index) => {
            const edited = isEdited(segment);
            const active = index === activeIndex;
            const fieldId = `${titleId}-segment-${segment.id}`;
            return (
              <li
                key={segment.id}
                className={cn(
                  'grid gap-2 rounded-lg border p-3 transition-colors duration-150 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-4',
                  active ? 'border-brand bg-brand-subtle' : 'bg-card',
                )}
                aria-current={active ? 'true' : undefined}
              >
                <div className="flex items-center gap-2 sm:flex-col sm:items-start">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2 font-mono text-xs tabular-nums"
                    disabled={!audioUrl}
                    onClick={() => playFrom(segment.startMs)}
                    aria-label={`Play from ${formatTimestamp(segment.startMs / 1000)}`}
                  >
                    <Play aria-hidden="true" />
                    {formatTimestamp(segment.startMs / 1000)}
                  </Button>
                  {edited ? (
                    <span className="text-xs font-medium text-brand">
                      Corrected
                    </span>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor={fieldId} className="sr-only">
                    Segment {index + 1}, starting at {formatTimestamp(segment.startMs / 1000)}
                  </label>
                  <SegmentTextarea
                    id={fieldId}
                    value={segment.text}
                    onChange={(value) => onChange(editSegment(segments, segment.id, value))}
                    disabled={busy}
                  />
                  {edited ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="min-w-0">
                        Heard: <span className="font-serif text-sm">“{segment.recognizedText}”</span>
                      </span>
                      <Button variant="link" size="sm" className="h-auto text-xs" onClick={() => onChange(restoreSegment(segments, segment.id))}>
                        <RotateCcw aria-hidden="true" className="size-3" />
                        Restore
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {summary.words} words · {summary.edited} {summary.edited === 1 ? 'segment' : 'segments'} corrected
        </p>
        {summary.problem ? <Notice tone="error">{summary.problem}</Notice> : null}

        <div className="flex flex-wrap gap-3">
          <Button size="lg" onClick={onConfirm} disabled={busy || summary.problem !== null}>
            Confirm transcript
          </Button>
          <Button variant="ghost" size="lg" onClick={onDiscard} disabled={busy}>
            Discard and record again
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
