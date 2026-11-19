import { clamp } from '@ldg/shared';

/**
 * Player-agnostic playback contract. Local media (HTMLMediaElement) and the
 * YouTube IFrame player both implement it, so practice tools (replay line,
 * A-B loop, dictation) are written once.
 */
export interface PlaybackSnapshot {
  readonly ready: boolean;
  readonly playing: boolean;
  /** Seconds. */
  readonly currentTime: number;
  /** Seconds; 0 while unknown. */
  readonly duration: number;
  readonly playbackRate: number;
  readonly muted: boolean;
}

export interface PlaybackControls {
  play(): void;
  pause(): void;
  togglePlay(): void;
  seek(seconds: number): void;
  skip(deltaSeconds: number): void;
  setPlaybackRate(rate: number): void;
  stepPlaybackRate(direction: 1 | -1): void;
  toggleMute(): void;
  /** Reads the live position, which can be fresher than the last React state. */
  getCurrentTime(): number;
}

export interface Playback {
  readonly state: PlaybackSnapshot;
  readonly controls: PlaybackControls;
}

export const PLAYBACK_RATES = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5] as const;
/**
 * YouTube supports only some rates and silently rounds others towards 1, so
 * stepping from 1 to 1.1 would get stuck. These are its documented typical steps.
 */
export const YOUTUBE_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
export const SKIP_SECONDS = 5;

/** Next rate in `rates` from `current`, clamped to the ends of the list. */
export function stepRate(current: number, direction: 1 | -1, rates: readonly number[] = PLAYBACK_RATES): number {
  const index = rates.findIndex((rate) => rate >= current);
  const next = clamp((index === -1 ? rates.length - 1 : index) + direction, 0, rates.length - 1);
  return rates[next] ?? 1;
}
