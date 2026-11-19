import { createLoopRange, resolveRangeAction, type TimeRange } from '@ldg/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Playback } from './playback';

export type BoundedPlayback =
  | { readonly mode: 'segment'; readonly range: TimeRange; readonly cueIndex: number }
  | { readonly mode: 'loop'; readonly range: TimeRange; readonly source: 'ab' }
  | { readonly mode: 'loop'; readonly range: TimeRange; readonly source: 'line'; readonly cueIndex: number };

export interface BoundedPlaybackApi {
  readonly bounded: BoundedPlayback | null;
  /** Pending loop start while the learner hasn't set B yet (ms). */
  readonly pointA: number | null;
  readonly error: string | null;
  playSegment(range: TimeRange, cueIndex: number): void;
  loopLine(range: TimeRange, cueIndex: number): void;
  setPointA(): void;
  setPointB(): void;
  clear(): void;
}

/** Interval polling (not rAF) so loops keep working while the tab is in the background. */
const CHECK_MS = 40;

/**
 * Replay-a-line and A-B looping on top of any `Playback`. The pure decision of
 * what to do at a given time lives in `resolveRangeAction` (shared, tested).
 */
export function useBoundedPlayback(
  playback: Playback,
  options: { initialLoop: TimeRange | null; onLoopChange?: (loop: TimeRange | null) => void },
): BoundedPlaybackApi {
  const { state, controls } = playback;
  const [bounded, setBounded] = useState<BoundedPlayback | null>(() =>
    options.initialLoop ? { mode: 'loop', range: options.initialLoop, source: 'ab' } : null,
  );
  const [pointA, setPointAState] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onLoopChangeRef = useRef(options.onLoopChange);
  useEffect(() => {
    onLoopChangeRef.current = options.onLoopChange;
  });

  // Persist only A-B loops: line loops and segments are momentary. The string
  // key makes the effect depend on the loop's value, not its object identity.
  const persistedLoop = bounded?.mode === 'loop' && bounded.source === 'ab' ? bounded.range : null;
  const persistedKey = persistedLoop ? `${persistedLoop.startMs}-${persistedLoop.endMs}` : '';
  const lastPersistedKey = useRef(persistedKey);
  useEffect(() => {
    if (lastPersistedKey.current === persistedKey) return;
    lastPersistedKey.current = persistedKey;
    const [startMs, endMs] = persistedKey.split('-').map(Number);
    onLoopChangeRef.current?.(persistedKey && startMs !== undefined && endMs !== undefined ? { startMs, endMs } : null);
  }, [persistedKey]);

  useEffect(() => {
    if (!bounded || !state.playing) return;
    const timer = window.setInterval(() => {
      const action = resolveRangeAction(controls.getCurrentTime() * 1000, bounded.range, bounded.mode);
      if (action === 'wrap') {
        controls.seek(bounded.range.startMs / 1000);
      } else if (action === 'stop') {
        controls.pause();
        setBounded(null);
      } else if (action === 'abandon') {
        setBounded(null);
      }
    }, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [bounded, state.playing, controls]);

  const start = useCallback(
    (next: BoundedPlayback) => {
      setError(null);
      setBounded(next);
      controls.seek(next.range.startMs / 1000);
      controls.play();
    },
    [controls],
  );

  const playSegment = useCallback(
    (range: TimeRange, cueIndex: number) => {
      setPointAState(null);
      start({ mode: 'segment', range, cueIndex });
    },
    [start],
  );

  const loopLine = useCallback(
    (range: TimeRange, cueIndex: number) => {
      setPointAState(null);
      start({ mode: 'loop', range, source: 'line', cueIndex });
    },
    [start],
  );

  const setPointA = useCallback(() => {
    setError(null);
    setPointAState(Math.round(controls.getCurrentTime() * 1000));
    // A new A point starts a new loop definition.
    setBounded((current) => (current?.mode === 'loop' ? null : current));
  }, [controls]);

  const setPointB = useCallback(() => {
    if (pointA === null) {
      setError('Set the loop start (A) first.');
      return;
    }
    const result = createLoopRange(pointA, Math.round(controls.getCurrentTime() * 1000));
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setPointAState(null);
    start({ mode: 'loop', range: result.value, source: 'ab' });
  }, [controls, pointA, start]);

  const clear = useCallback(() => {
    setBounded(null);
    setPointAState(null);
    setError(null);
  }, []);

  return { bounded, pointA, error, playSegment, loopLine, setPointA, setPointB, clear };
}
