import type { HintStore } from './pending-hints';

/** A Map-backed stand-in for localStorage (the client tests run without a DOM). */
export function memoryHintStore(): HintStore & { readonly size: number } {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, String(value)),
    removeItem: (key) => void rows.delete(key),
    key: (index) => [...rows.keys()][index] ?? null,
    get length() {
      return rows.size;
    },
    get size() {
      return rows.size;
    },
  };
}
