import { err, ok, type Result } from './result.js';
import type { SubtitleCue } from './subtitles.js';

/**
 * Time maths for listening practice: replaying a line, A-B loops and segment
 * boundaries. Everything is in milliseconds and player-agnostic.
 */

export interface TimeRange {
  readonly startMs: number;
  readonly endMs: number;
}

/** Subtitle timings are often tight; a little padding avoids clipped words. */
export const SEGMENT_LEAD_IN_MS = 150;
export const SEGMENT_TAIL_MS = 250;
export const MIN_LOOP_MS = 500;

export function segmentPlaybackRange(
  cue: Pick<SubtitleCue, 'startMs' | 'endMs'>,
  options: { durationMs?: number; leadInMs?: number; tailMs?: number } = {},
): TimeRange {
  const leadIn = options.leadInMs ?? SEGMENT_LEAD_IN_MS;
  const tail = options.tailMs ?? SEGMENT_TAIL_MS;
  const startMs = Math.max(0, cue.startMs - leadIn);
  const paddedEnd = cue.endMs + tail;
  const endMs =
    options.durationMs !== undefined && options.durationMs > 0 ? Math.min(paddedEnd, options.durationMs) : paddedEnd;
  return { startMs, endMs: Math.max(endMs, startMs) };
}

export type LoopRangeError = { readonly reason: 'end-before-start' | 'too-short'; readonly message: string };

/** Validates an A-B loop. Points are never swapped silently: the learner chose them. */
export function createLoopRange(aMs: number, bMs: number, minLengthMs = MIN_LOOP_MS): Result<TimeRange, LoopRangeError> {
  if (bMs <= aMs) {
    return err({ reason: 'end-before-start', message: 'Loop end (B) must come after the start (A).' });
  }
  if (bMs - aMs < minLengthMs) {
    return err({ reason: 'too-short', message: `A loop must be at least ${minLengthMs / 1000} seconds long.` });
  }
  return ok({ startMs: Math.max(0, aMs), endMs: bMs });
}

/**
 * Index of the cue a "replay line" action should target at `timeMs`: the cue
 * being spoken, otherwise the most recent one that started before it (the line
 * the learner just heard), otherwise the first cue. -1 when there are no cues.
 * Expects cues sorted by start time.
 */
export function findReplayCueIndex(cues: readonly Pick<SubtitleCue, 'startMs'>[], timeMs: number): number {
  if (cues.length === 0) return -1;
  let low = 0;
  let high = cues.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const cue = cues[mid];
    if (cue === undefined) break;
    if (cue.startMs <= timeMs) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return candidate === -1 ? 0 : candidate;
}

export type RangeAction = 'continue' | 'wrap' | 'stop' | 'abandon';

/**
 * What a player should do at `timeMs` while bounded playback is active.
 * - Loops wrap to the start once the end is reached.
 * - One-off segments stop at the end, and are abandoned if the learner seeks
 *   well outside them (they took over playback).
 */
export function resolveRangeAction(timeMs: number, range: TimeRange, mode: 'segment' | 'loop', toleranceMs = 750): RangeAction {
  if (timeMs >= range.endMs) {
    if (mode === 'loop') return 'wrap';
    return timeMs - range.endMs > toleranceMs ? 'abandon' : 'stop';
  }
  if (mode === 'segment' && timeMs < range.startMs - toleranceMs) return 'abandon';
  return 'continue';
}
