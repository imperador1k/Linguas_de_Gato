import { clamp } from '@ldg/shared';
import { useEffect, useMemo, useState } from 'react';

export const PLAYBACK_RATES = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5] as const;

export interface MediaPlayerState {
  readonly ready: boolean;
  readonly playing: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly playbackRate: number;
  readonly volume: number;
  readonly muted: boolean;
  /** False for audio files and for video containers without a video track. */
  readonly hasVideo: boolean;
  readonly error: string | null;
}

export interface MediaPlayerControls {
  togglePlay(): void;
  seek(seconds: number): void;
  skip(deltaSeconds: number): void;
  setPlaybackRate(rate: number): void;
  stepPlaybackRate(direction: 1 | -1): void;
  setVolume(volume: number): void;
  toggleMute(): void;
}

const INITIAL_STATE: MediaPlayerState = {
  ready: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  volume: 1,
  muted: false,
  hasVideo: false,
  error: null,
};

const MEDIA_EVENTS = [
  'loadedmetadata',
  'durationchange',
  'timeupdate',
  'play',
  'pause',
  'ended',
  'seeked',
  'ratechange',
  'volumechange',
  'resize',
  'emptied',
  'error',
] as const;

function describeMediaError(error: MediaError | null): string | null {
  if (!error) return null;
  switch (error.code) {
    case MediaError.MEDIA_ERR_DECODE:
      return 'This file could not be decoded. It may be damaged or use an unsupported codec.';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "Your browser can't play this file. Try converting it to MP3 or MP4 (H.264/AAC).";
    default:
      return 'Playback failed. Try loading the file again.';
  }
}

function readState(element: HTMLVideoElement): MediaPlayerState {
  return {
    ready: element.readyState >= HTMLMediaElement.HAVE_METADATA,
    playing: !element.paused && !element.ended,
    currentTime: element.currentTime,
    duration: Number.isFinite(element.duration) ? element.duration : 0,
    playbackRate: element.playbackRate,
    volume: element.volume,
    muted: element.muted,
    hasVideo: element.videoWidth > 0,
    error: describeMediaError(element.error),
  };
}

/**
 * Wraps an HTMLMediaElement as React state plus imperative controls.
 * Attach `ref` to a <video> element (it also plays audio-only files).
 */
export function useMediaPlayer(): {
  ref: (element: HTMLVideoElement | null) => void;
  state: MediaPlayerState;
  controls: MediaPlayerControls;
} {
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  const [state, setState] = useState<MediaPlayerState>(INITIAL_STATE);

  useEffect(() => {
    if (!element) return;
    const sync = () => setState(readState(element));
    MEDIA_EVENTS.forEach((type) => element.addEventListener(type, sync));
    sync();
    return () => MEDIA_EVENTS.forEach((type) => element.removeEventListener(type, sync));
  }, [element]);

  const controls = useMemo<MediaPlayerControls>(() => {
    const seek = (seconds: number) => {
      if (!element || !Number.isFinite(element.duration)) return;
      element.currentTime = clamp(seconds, 0, element.duration);
    };

    return {
      togglePlay() {
        if (!element) return;
        if (element.paused || element.ended) {
          element.play().catch(() => {
            // Rejections (e.g. interrupted by a new load) surface through the `error` event when relevant.
          });
        } else {
          element.pause();
        }
      },
      seek,
      skip(deltaSeconds) {
        if (element) seek(element.currentTime + deltaSeconds);
      },
      setPlaybackRate(rate) {
        if (element) element.playbackRate = rate;
      },
      stepPlaybackRate(direction) {
        if (!element) return;
        const current = PLAYBACK_RATES.findIndex((rate) => rate >= element.playbackRate);
        const index = clamp((current === -1 ? PLAYBACK_RATES.length - 1 : current) + direction, 0, PLAYBACK_RATES.length - 1);
        element.playbackRate = PLAYBACK_RATES[index] ?? 1;
      },
      setVolume(volume) {
        if (!element) return;
        element.volume = clamp(volume, 0, 1);
        if (volume > 0) element.muted = false;
      },
      toggleMute() {
        if (element) element.muted = !element.muted;
      },
    };
  }, [element]);

  return { ref: setElement, state, controls };
}
