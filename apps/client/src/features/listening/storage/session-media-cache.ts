/**
 * Media files chosen during this page lifetime, keyed by session id.
 *
 * A `File` from a file picker can't be persisted without copying its bytes, so
 * by default we only keep it in memory: navigating between sessions doesn't
 * ask for the file again, but a reload does (unless the learner opted in to a
 * saved copy). Cleared when the page unloads.
 */
const cache = new Map<string, Blob>();

export function rememberSessionMedia(sessionId: string, media: Blob): void {
  cache.set(sessionId, media);
}

export function recallSessionMedia(sessionId: string): Blob | null {
  return cache.get(sessionId) ?? null;
}

export function forgetSessionMedia(sessionId: string): void {
  cache.delete(sessionId);
}
