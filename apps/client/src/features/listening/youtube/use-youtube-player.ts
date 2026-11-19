import { clamp, type YouTubeVideoRef } from '@ldg/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { YOUTUBE_PLAYBACK_RATES, stepRate, type PlaybackControls, type PlaybackSnapshot } from '../playback/playback';
import {
  YOUTUBE_PLAYER_HOST,
  YT_STATE,
  describeYouTubeError,
  loadYouTubeIframeApi,
  type YTPlayer,
} from './youtube-iframe-api';

export type YouTubePlayerStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly message: string; readonly embeddable: boolean; readonly retryable: boolean };

const INITIAL: PlaybackSnapshot = { ready: false, playing: false, currentTime: 0, duration: 0, playbackRate: 1, muted: false };

/** The IFrame API has no time-update event, so the position is polled. */
const POLL_MS = 200;

function snapshot(player: YTPlayer): PlaybackSnapshot {
  const state = player.getPlayerState();
  return {
    ready: true,
    playing: state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING,
    currentTime: player.getCurrentTime() || 0,
    duration: player.getDuration() || 0,
    playbackRate: player.getPlaybackRate() || 1,
    muted: player.isMuted(),
  };
}

function sameSnapshot(a: PlaybackSnapshot, b: PlaybackSnapshot): boolean {
  return (
    a.ready === b.ready &&
    a.playing === b.playing &&
    a.currentTime === b.currentTime &&
    a.duration === b.duration &&
    a.playbackRate === b.playbackRate &&
    a.muted === b.muted
  );
}

/**
 * Embeds a YouTube video with the official IFrame Player API and exposes it
 * through the shared playback contract.
 */
export function useYouTubePlayer(
  video: YouTubeVideoRef,
  initial: { readonly positionSeconds: number; readonly playbackRate: number },
): {
  containerRef: (element: HTMLDivElement | null) => void;
  status: YouTubePlayerStatus;
  state: PlaybackSnapshot;
  controls: PlaybackControls;
  retry: () => void;
} {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<YouTubePlayerStatus>({ kind: 'loading' });
  const [state, setState] = useState<PlaybackSnapshot>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const playerRef = useRef<YTPlayer | null>(null);
  // Read once at creation; later changes must not recreate the player.
  const initialRef = useRef(initial);

  useEffect(() => {
    if (!container) return;
    let disposed = false;
    let poll: number | undefined;
    setStatus({ kind: 'loading' });
    setState(INITIAL);

    const sync = () => {
      const player = playerRef.current;
      if (!player) return;
      try {
        const next = snapshot(player);
        setState((previous) => (sameSnapshot(previous, next) ? previous : next));
      } catch {
        // The iframe may be mid-teardown; the next tick or event resyncs.
      }
    };

    // The API replaces its target element with an iframe, so give it a node React doesn't own.
    const host = document.createElement('div');
    host.className = 'size-full';
    container.replaceChildren(host);

    loadYouTubeIframeApi().then(
      (YT) => {
        if (disposed) return;
        const start = Math.floor(initialRef.current.positionSeconds);
        playerRef.current = new YT.Player(host, {
          host: YOUTUBE_PLAYER_HOST,
          videoId: video.videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            playsinline: 1,
            rel: 0,
            enablejsapi: 1,
            origin: window.location.origin,
            ...(start > 0 ? { start } : {}),
          },
          events: {
            onReady: (event) => {
              if (disposed) return;
              const rate = initialRef.current.playbackRate;
              if (rate !== 1) event.target.setPlaybackRate(rate);
              setStatus({ kind: 'ready' });
              sync();
              poll = window.setInterval(sync, POLL_MS);
            },
            onStateChange: sync,
            onPlaybackRateChange: sync,
            onError: (event) => {
              if (disposed) return;
              const { message, embeddable } = describeYouTubeError(event.data);
              setStatus({ kind: 'error', message, embeddable, retryable: false });
            },
          },
        });
      },
      (error: unknown) => {
        if (disposed) return;
        const message = error instanceof Error ? error.message : "Couldn't load YouTube's player.";
        setStatus({ kind: 'error', message, embeddable: true, retryable: true });
      },
    );

    return () => {
      disposed = true;
      window.clearInterval(poll);
      try {
        playerRef.current?.destroy();
      } catch {
        // Destroying a player whose iframe never loaded can throw; nothing to clean.
      }
      playerRef.current = null;
      container.replaceChildren();
    };
  }, [container, video.videoId, attempt]);

  const controls = useMemo<PlaybackControls>(() => {
    // Every call goes through here so an unready or destroyed player is a no-op.
    const withPlayer = (action: (player: YTPlayer) => void) => {
      const player = playerRef.current;
      if (!player) return;
      try {
        action(player);
      } catch {
        // Player not ready yet.
      }
    };
    const seek = (seconds: number) =>
      withPlayer((player) => {
        const duration = player.getDuration();
        player.seekTo(duration > 0 ? clamp(seconds, 0, duration) : Math.max(0, seconds), true);
      });

    return {
      play: () => withPlayer((player) => player.playVideo()),
      pause: () => withPlayer((player) => player.pauseVideo()),
      togglePlay: () =>
        withPlayer((player) => {
          if (player.getPlayerState() === YT_STATE.PLAYING) player.pauseVideo();
          else player.playVideo();
        }),
      seek,
      skip: (delta) => withPlayer((player) => seek(player.getCurrentTime() + delta)),
      setPlaybackRate: (rate) => withPlayer((player) => player.setPlaybackRate(rate)),
      stepPlaybackRate: (direction) => withPlayer((player) => player.setPlaybackRate(stepRate(player.getPlaybackRate(), direction, YOUTUBE_PLAYBACK_RATES))),
      toggleMute: () => withPlayer((player) => (player.isMuted() ? player.unMute() : player.mute())),
      getCurrentTime: () => {
        try {
          return playerRef.current?.getCurrentTime() ?? 0;
        } catch {
          return 0;
        }
      },
    };
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { containerRef: setContainer, status, state, controls, retry };
}
