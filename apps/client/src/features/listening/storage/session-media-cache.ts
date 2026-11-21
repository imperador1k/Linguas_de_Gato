import { clearVolatileMedia, setVolatileMedia } from '@/lib/volatile-media';

/**
 * Media files open during this page lifetime, keyed by session id.
 *
 * Kept copies live in IndexedDB (see `saveMedia`); this cache only avoids
 * re-reading them and holds files the learner chose not to keep. Those are
 * registered as volatile, so a reload can warn before losing them.
 * Cleared when the page unloads.
 */
const cache = new Map<string, Blob>();

/** Why the last attempt to keep a session's media didn't work, for this page lifetime. */
export type MediaIssue = 'quota' | 'write-failed' | 'copy-missing';
const issues = new Map<string, MediaIssue>();

export interface MediaInfo {
  /** Whether a copy is saved in the browser database. */
  readonly saved: boolean;
  /** File name, for the reload warning. */
  readonly label: string;
}

function trackVolatility(sessionId: string, info: MediaInfo) {
  const key = `listening:${sessionId}`;
  if (info.saved) clearVolatileMedia(key);
  else setVolatileMedia({ key, kind: 'listening', label: info.label, path: `/listening/session/${sessionId}` });
}

export function rememberSessionMedia(sessionId: string, media: Blob, info: MediaInfo): void {
  cache.set(sessionId, media);
  trackVolatility(sessionId, info);
}

/** Updates whether the open media is saved (after keeping or removing a copy). */
export function markSessionMediaSaved(sessionId: string, info: MediaInfo): void {
  if (cache.has(sessionId)) trackVolatility(sessionId, info);
}

export function recallSessionMedia(sessionId: string): Blob | null {
  return cache.get(sessionId) ?? null;
}

export function forgetSessionMedia(sessionId: string): void {
  cache.delete(sessionId);
  issues.delete(sessionId);
  clearVolatileMedia(`listening:${sessionId}`);
}

export function noteMediaIssue(sessionId: string, issue: MediaIssue | null): void {
  if (issue) issues.set(sessionId, issue);
  else issues.delete(sessionId);
}

export function mediaIssueOf(sessionId: string): MediaIssue | null {
  return issues.get(sessionId) ?? null;
}
