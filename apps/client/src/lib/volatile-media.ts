import { useSyncExternalStore } from 'react';

/*
 * Media that exists only in this tab's memory: an imported file the learner
 * chose not to keep (or that couldn't be kept), or a Speaking recording that
 * wasn't saved. A reload or a closed tab loses it, so the update banner asks
 * before reloading and points to where it can be saved.
 */

export interface VolatileMedia {
  readonly key: string;
  readonly kind: 'listening' | 'speaking';
  /** File name or topic title, shown to the learner. */
  readonly label: string;
  /** Where the learner can keep a copy. */
  readonly path: string;
}

const entries = new Map<string, VolatileMedia>();
let snapshot: readonly VolatileMedia[] = [];
const listeners = new Set<() => void>();

function emit() {
  snapshot = [...entries.values()];
  for (const listener of listeners) listener();
}

export function setVolatileMedia(entry: VolatileMedia): void {
  entries.set(entry.key, entry);
  emit();
}

export function clearVolatileMedia(key: string): void {
  if (entries.delete(key)) emit();
}

export function getVolatileMedia(): readonly VolatileMedia[] {
  return snapshot;
}

/**
 * What pressing Reload may do: wait for in-flight work (an AI request or a
 * recording would be destroyed), ask first when unsaved media would be lost,
 * or reload straight away.
 */
export function reloadDecision(state: { readonly busy: boolean; readonly volatile: readonly VolatileMedia[] }): 'wait' | 'confirm' | 'reload' {
  if (state.busy) return 'wait';
  return state.volatile.length > 0 ? 'confirm' : 'reload';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVolatileMedia(): readonly VolatileMedia[] {
  return useSyncExternalStore(subscribe, getVolatileMedia, () => snapshot);
}
