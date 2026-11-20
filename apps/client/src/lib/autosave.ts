export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface Autosaver<T> {
  /** Queues `value`; it is saved after `delayMs` without further changes. */
  schedule(value: T): void;
  /** Saves the queued value now (e.g. on blur, pagehide or before submitting). */
  flush(): Promise<void>;
  /** Stops timers; a queued value is not saved. Call `flush` first to keep it. */
  dispose(): void;
}

export interface AutosaverOptions<T> {
  readonly save: (value: T) => Promise<void>;
  readonly delayMs: number;
  readonly onStatus?: (status: AutosaveStatus, error?: unknown) => void;
}

/**
 * Debounced, serialised saving: at most one write in flight, and the latest
 * value always wins (a value queued while a write is running is saved right
 * after it). A failed write is reported and retried on the next change.
 */
export function createAutosaver<T>({ save, delayMs, onStatus }: AutosaverOptions<T>): Autosaver<T> {
  let queued: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  async function drain(): Promise<void> {
    while (queued && !disposed) {
      const { value } = queued;
      queued = null;
      onStatus?.('saving');
      try {
        await save(value);
        if (!queued) onStatus?.('saved');
      } catch (error) {
        onStatus?.('error', error);
        return;
      }
    }
  }

  function start(): Promise<void> {
    clearTimer();
    running ??= drain().finally(() => {
      running = null;
      // A value queued during the last write, after the loop checked, is not lost.
      if (queued && !disposed) void start();
    });
    return running;
  }

  return {
    schedule(value) {
      if (disposed) return;
      queued = { value };
      onStatus?.('pending');
      clearTimer();
      timer = setTimeout(() => void start(), delayMs);
    },
    async flush() {
      if (queued) await start();
      else if (running) await running;
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
