import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosaver, type AutosaveStatus } from './autosave';

describe('createAutosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces changes and saves only the latest value', async () => {
    const save = vi.fn(async () => undefined);
    const statuses: AutosaveStatus[] = [];
    const saver = createAutosaver({ save, delayMs: 500, onStatus: (status) => statuses.push(status) });
    saver.schedule('a');
    saver.schedule('ab');
    saver.schedule('abc');
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
    expect(statuses.at(-1)).toBe('saved');
  });

  it('flushes immediately', async () => {
    const save = vi.fn(async () => undefined);
    const saver = createAutosaver({ save, delayMs: 10_000 });
    saver.schedule('draft');
    await saver.flush();
    expect(save).toHaveBeenCalledWith('draft');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never runs two writes at once, and saves a value queued during a write', async () => {
    let release: (() => void) | undefined;
    let active = 0;
    let maxActive = 0;
    const saved: string[] = [];
    const save = vi.fn(async (value: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (value === 'first') await new Promise<void>((resolve) => (release = resolve));
      saved.push(value);
      active -= 1;
    });
    const saver = createAutosaver({ save, delayMs: 100 });
    saver.schedule('first');
    await vi.advanceTimersByTimeAsync(100);
    saver.schedule('second');
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    release?.();
    await saver.flush();
    await vi.runAllTimersAsync();
    expect(saved).toEqual(['first', 'second']);
    expect(maxActive).toBe(1);
  });

  it('reports failures and retries on the next change', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('QuotaExceededError')).mockResolvedValue(undefined);
    const statuses: AutosaveStatus[] = [];
    const saver = createAutosaver({ save, delayMs: 10, onStatus: (status) => statuses.push(status) });
    saver.schedule('x');
    await vi.advanceTimersByTimeAsync(10);
    expect(statuses.at(-1)).toBe('error');
    saver.schedule('xy');
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenLastCalledWith('xy');
    expect(statuses.at(-1)).toBe('saved');
  });

  it('saves nothing after dispose', async () => {
    const save = vi.fn(async () => undefined);
    const saver = createAutosaver({ save, delayMs: 10 });
    saver.schedule('x');
    saver.dispose();
    await vi.advanceTimersByTimeAsync(100);
    saver.schedule('y');
    await vi.advanceTimersByTimeAsync(100);
    expect(save).not.toHaveBeenCalled();
  });
});
