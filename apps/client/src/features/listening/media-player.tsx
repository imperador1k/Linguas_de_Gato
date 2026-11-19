import { formatSpokenDuration, formatTimestamp, type TimeRange } from '@ldg/shared';
import { AudioLines, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { useId, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/utils';
import { PLAYBACK_RATES, SKIP_SECONDS } from './playback/playback';
import { ShortcutHints } from './playback/shortcut-hints';
import type { MediaPlayerControls, MediaPlayerState } from './use-media-player';

/** Marks the active loop on the seek track. Decorative: the practice bar states it in text. */
export function LoopBand({ loop, duration }: { loop: TimeRange | null; duration: number }) {
  if (!loop || duration <= 0) return null;
  const left = Math.min(100, (loop.startMs / 1000 / duration) * 100);
  const width = Math.max(0.5, Math.min(100 - left, ((loop.endMs - loop.startMs) / 1000 / duration) * 100));
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-brand/45"
      style={{ left: `${left}%`, width: `${width}%` }}
    />
  );
}

function progressStyle(value: number, max: number): CSSProperties {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return { '--range-progress': `${percent}%` } as CSSProperties;
}

function formatRate(rate: number): string {
  return `${rate}×`;
}

export function MediaPlayer({
  src,
  title,
  meta,
  mediaRef,
  state,
  controls,
  loop = null,
}: {
  src: string;
  title: string;
  meta: string;
  mediaRef: (element: HTMLVideoElement | null) => void;
  state: MediaPlayerState;
  controls: MediaPlayerControls;
  loop?: TimeRange | null;
}) {
  const { playing, currentTime, duration, playbackRate, volume, muted, hasVideo, ready, error } = state;
  const effectiveVolume = muted ? 0 : volume;
  const rateId = useId();

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className={cn('bg-black', hasVideo ? 'block' : 'hidden')}>
        <video
          ref={mediaRef}
          src={src}
          preload="metadata"
          playsInline
          onClick={controls.togglePlay}
          className="mx-auto aspect-video max-h-[60vh] w-full"
        />
      </div>

      {!hasVideo ? (
        <div className="flex items-center gap-4 border-b px-5 py-5 sm:px-6">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
            <AudioLines aria-hidden="true" className="size-5 text-muted-foreground" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium" title={title}>
              {title}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{meta}</p>
          </div>
        </div>
      ) : (
        <div className="border-b px-5 py-3 sm:px-6">
          <p className="truncate text-sm font-medium" title={title}>
            {title} <span className="font-normal text-muted-foreground">· {meta}</span>
          </p>
        </div>
      )}

      <div className="px-5 pt-4 pb-5 sm:px-6">
        {error ? (
          <Notice tone="error" role="alert" className="mb-4">
            {error}
          </Notice>
        ) : null}

        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{formatTimestamp(currentTime)}</span>
          <div className="relative min-w-0 flex-1">
            <input
              type="range"
              className="media-range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              disabled={!ready}
              onChange={(event) => controls.seek(Number(event.target.value))}
              aria-label="Seek"
              aria-valuetext={`${formatSpokenDuration(currentTime)} of ${formatSpokenDuration(duration)}`}
              style={progressStyle(currentTime, duration)}
            />
            <LoopBand loop={loop} duration={duration} />
          </div>
          <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
            {formatTimestamp(duration)}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex items-center">
            <label className="sr-only" htmlFor={rateId}>
              Playback speed
            </label>
            <select
              id={rateId}
              value={playbackRate}
              onChange={(event) => controls.setPlaybackRate(Number(event.target.value))}
              className="h-9 rounded-md border border-input bg-card px-2.5 font-mono text-xs tabular-nums hover:border-border-strong"
            >
              {PLAYBACK_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {formatRate(rate)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Back ${SKIP_SECONDS} seconds`}
              title={`Back ${SKIP_SECONDS} seconds (J)`}
              disabled={!ready}
              onClick={() => controls.skip(-SKIP_SECONDS)}
            >
              <RotateCcw aria-hidden="true" />
            </Button>
            <Button
              size="icon-lg"
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
              disabled={!ready}
              onClick={controls.togglePlay}
            >
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" className="translate-x-px" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Forward ${SKIP_SECONDS} seconds`}
              title={`Forward ${SKIP_SECONDS} seconds (L)`}
              disabled={!ready}
              onClick={() => controls.skip(SKIP_SECONDS)}
            >
              <RotateCw aria-hidden="true" />
            </Button>
          </div>

          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={muted ? 'Unmute' : 'Mute'}
              aria-pressed={muted}
              title={muted ? 'Unmute (M)' : 'Mute (M)'}
              onClick={controls.toggleMute}
            >
              {muted || volume === 0 ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
            </Button>
            <input
              type="range"
              className="media-range hidden w-20 sm:block"
              min={0}
              max={1}
              step={0.05}
              value={effectiveVolume}
              onChange={(event) => controls.setVolume(Number(event.target.value))}
              aria-label="Volume"
              aria-valuetext={`${Math.round(effectiveVolume * 100)}%`}
              style={progressStyle(effectiveVolume, 1)}
            />
          </div>
        </div>

        <ShortcutHints className="mt-4" />
      </div>
    </div>
  );
}
