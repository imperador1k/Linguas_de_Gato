import type { ListeningSession } from '@ldg/shared';
import { StorageError } from '@/lib/storage/indexed-db';
import { withMediaStored, type ListeningRepository, type TranscriptContent } from './listening-repository';
import { noteMediaIssue, rememberSessionMedia, type MediaIssue } from './session-media-cache';

export interface CreatedSession {
  /** The session as stored. */
  readonly session: ListeningSession;
  /** Whether a copy of the media was saved with it. */
  readonly kept: boolean;
  /** Why the copy couldn't be saved, when the learner asked for one. */
  readonly issue: MediaIssue | null;
}

function issueFor(error: unknown): MediaIssue {
  return error instanceof StorageError && error.kind === 'quota' ? 'quota' : 'write-failed';
}

/**
 * Creates a session from a local file, keeping a copy of the file when asked.
 * The copy is written in the same transaction as the session; if it doesn't
 * fit (a full disk, a file over the cap), the session and transcript are
 * created without it, so an expensive transcription is never lost because of
 * the audio. Errors that would also prevent saving the session propagate.
 */
export async function createSessionWithMedia(
  repository: ListeningRepository,
  session: ListeningSession,
  options: { readonly transcript?: TranscriptContent; readonly media: Blob; readonly keep: boolean },
): Promise<CreatedSession> {
  const { transcript, media, keep } = options;
  let issue: MediaIssue | null = null;
  if (keep) {
    try {
      await repository.createSession(session, transcript, media);
      const stored = withMediaStored(session, true, session.updatedAt);
      rememberSessionMedia(session.id, media, { saved: true, label: fileLabel(session) });
      noteMediaIssue(session.id, null);
      return { session: stored, kept: true, issue: null };
    } catch (error) {
      issue = issueFor(error);
    }
  }
  await repository.createSession(session, transcript);
  rememberSessionMedia(session.id, media, { saved: false, label: fileLabel(session) });
  noteMediaIssue(session.id, issue);
  return { session, kept: false, issue };
}

/** Keeps (or re-keeps) a copy of an open session's media. Never throws: the outcome says what happened. */
export async function keepSessionMedia(repository: ListeningRepository, session: ListeningSession, media: Blob): Promise<{ session: ListeningSession | null; issue: MediaIssue | null }> {
  try {
    const updated = await repository.saveMedia(session.id, media);
    rememberSessionMedia(session.id, media, { saved: updated !== null, label: fileLabel(session) });
    noteMediaIssue(session.id, null);
    return { session: updated, issue: null };
  } catch (error) {
    const issue = issueFor(error);
    rememberSessionMedia(session.id, media, { saved: false, label: fileLabel(session) });
    noteMediaIssue(session.id, issue);
    return { session: null, issue };
  }
}

export function fileLabel(session: ListeningSession): string {
  return session.source.kind === 'file' ? session.source.fileName : session.title;
}
