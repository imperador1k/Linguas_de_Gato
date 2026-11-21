import { useEffect, useSyncExternalStore } from 'react';

/*
 * A tiny registry of work that a page reload would destroy: an AI request in
 * flight, an upload being transcribed, a recording not yet saved. The update
 * banner reads it so "Reload" waits until that work is finished or cancelled.
 */

let active = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Registers work in progress while `busy` is true. */
export function useWorkInProgress(busy: boolean) {
  useEffect(() => {
    if (!busy) return;
    active += 1;
    emit();
    return () => {
      active -= 1;
      emit();
    };
  }, [busy]);
}

/** True while any registered work is in progress. */
export function useHasWorkInProgress(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active > 0,
    () => false,
  );
}
