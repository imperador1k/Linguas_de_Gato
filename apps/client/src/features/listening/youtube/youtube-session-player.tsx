import { buildYouTubeWatchUrl, type TimeRange, type YouTubeVideoRef } from '@ldg/shared';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { LoopBand } from '../media-player';
import type { PlaybackControls, PlaybackSnapshot } from '../playback/playback';
import { YOUTUBE_PLAYBACK_RATES } from '../playback/playback';
import { ShortcutHints } from '../playback/shortcut-hints';
import type { YouTubePlayerStatus } from './use-youtube-player';

function WatchOnYouTube({ video }: { video: YouTubeVideoRef }) {
  return (
    <a
      href={buildYouTubeWatchUrl(video)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm underline decoration-border-strong underline-offset-4 hover:decoration-brand"
    >
      Open on YouTube
      <ExternalLink aria-hidden="true" className="size-3.5" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** Frame around YouTube's own embedded player, with loading and error states. */
export function YouTubeSessionPlayer({
  video,
  containerRef,
  status,
  state,
  controls,
  loop,
  onRetry,
}: {
  video: YouTubeVideoRef;
  containerRef: (element: HTMLDivElement | null) => void;
  status: YouTubePlayerStatus;
  state: PlaybackSnapshot;
  controls: PlaybackControls;
  loop: TimeRange | null;
  onRetry: () => void;
}) {
  const rateId = useId();
  // Show the closest supported rate if a stored rate isn't in YouTube's list.
  const rate = YOUTUBE_PLAYBACK_RATES.reduce((best, candidate) =>
    Math.abs(candidate - state.playbackRate) < Math.abs(best - state.playbackRate) ? candidate : best,
  );

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="relative aspect-video bg-black">
        <div ref={containerRef} className="absolute inset-0 [&_iframe]:size-full" />
        {status.kind === 'loading' ? (
          <p role="status" className="absolute inset-0 grid place-items-center text-sm text-white/80">
            Loading YouTube player…
          </p>
        ) : null}
        {status.kind === 'error' ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-card px-6 text-center">
            <p className="max-w-md text-sm leading-relaxed">{status.message}</p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              {status.retryable ? (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  <RefreshCw aria-hidden="true" />
                  Try again
                </Button>
              ) : null}
              <WatchOnYouTube video={video} />
            </div>
            {!status.embeddable ? (
              <p className="max-w-md text-xs text-muted-foreground">
                The transcript below still works for reading along.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="px-5 pt-3 pb-4 sm:px-6">
        <div className="relative h-2" aria-hidden="true">
          {loop && state.duration > 0 ? <span className="absolute inset-x-0 top-1/2 h-px bg-border" /> : null}
          <LoopBand loop={loop} duration={state.duration} />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <label className="sr-only" htmlFor={rateId}>
              Playback speed
            </label>
            <select
              id={rateId}
              value={rate}
              disabled={!state.ready}
              onChange={(event) => controls.setPlaybackRate(Number(event.target.value))}
              className="h-9 rounded-md border border-input bg-card px-2.5 font-mono text-xs tabular-nums hover:border-border-strong disabled:opacity-50"
            >
              {YOUTUBE_PLAYBACK_RATES.map((option) => (
                <option key={option} value={option}>
                  {option}×
                </option>
              ))}
            </select>
            <p className="text-sm text-muted-foreground">
              Video <span className="font-mono text-xs text-foreground">{video.videoId}</span>
            </p>
          </div>
          <WatchOnYouTube video={video} />
        </div>
        <ShortcutHints
          className="mt-4"
          note="Shortcuts work while focus is on this page. Inside the video, YouTube's own shortcuts apply. Turn off YouTube captions while practising dictation."
        />
      </div>
    </div>
  );
}
