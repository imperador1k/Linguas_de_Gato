import type { DictationRecord, ListeningSession, SubtitleCue, TranscriptSummary } from '@ldg/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListeningRepository, TranscriptContent } from '../storage/listening-repository';
import { describeStorageError, useListeningStorage, type ListeningStorage } from '../storage/listening-storage';
import { fileLabel, keepSessionMedia } from '../storage/session-media';
import {
  forgetSessionMedia,
  markSessionMediaSaved,
  mediaIssueOf,
  noteMediaIssue,
  recallSessionMedia,
  rememberSessionMedia,
  type MediaIssue,
} from '../storage/session-media-cache';

export interface LoadedSession {
  readonly session: ListeningSession;
  readonly cues: readonly SubtitleCue[] | null;
  readonly dictation: readonly DictationRecord[];
  /** The playable media, when available (chosen this page lifetime or saved as a copy). */
  readonly media: Blob | null;
  /** Why the media isn't saved when it should be (a full disk, a missing copy), for this page lifetime. */
  readonly mediaIssue: MediaIssue | null;
}

export type SessionLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: LoadedSession };

async function loadSession(repository: ListeningRepository, id: string): Promise<LoadedSession | null> {
  const opened = await repository.updateSession(id, (session) => ({ ...session, lastOpenedAt: Date.now() }));
  if (!opened) return null;
  const [transcript, dictation] = await Promise.all([repository.getTranscript(id), repository.listDictation(id)]);

  let session = opened;
  let media = recallSessionMedia(id);
  let mediaIssue = mediaIssueOf(id);
  if (session.source.kind === 'file') {
    // Trust what is stored, not the flag: a copy that is gone must not be reported as saved.
    const check = await repository.reconcileMedia(id);
    if (check) {
      session = check.session;
      if (check.repaired === 'flag-cleared') {
        mediaIssue = 'copy-missing';
        noteMediaIssue(id, mediaIssue);
      }
      if (!media && check.present) media = await repository.getMedia(id);
      if (media) rememberSessionMedia(id, media, { saved: check.present, label: fileLabel(session) });
    }
  }
  return { session, cues: transcript?.cues ?? null, dictation, media, mediaIssue };
}

export interface MediaOutcome {
  readonly ok: boolean;
  readonly issue: MediaIssue | null;
}

/**
 * Loads one Listening session and exposes persistence actions. The UI updates
 * optimistically; a failed write is reported through `saveError` and the
 * in-memory state is kept so the learner can carry on.
 */
export function useListeningSession(id: string) {
  const storage = useListeningStorage();
  const [state, setState] = useState<SessionLoadState>({ status: 'loading' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const storageRef = useRef<ListeningStorage | null>(null);
  storageRef.current = storage;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!storage) return;
    let active = true;
    setState({ status: 'loading' });
    loadSession(storage.repository, id).then(
      (data) => active && setState(data ? { status: 'ready', data } : { status: 'missing' }),
      (error: unknown) => active && setState({ status: 'error', message: describeStorageError(error) }),
    );
    return () => {
      active = false;
    };
  }, [storage, id]);

  const patch = useCallback((update: (data: LoadedSession) => LoadedSession) => {
    setState((current) => (current.status === 'ready' ? { status: 'ready', data: update(current.data) } : current));
  }, []);

  const run = useCallback(async <T,>(write: (repository: ListeningRepository) => Promise<T>): Promise<T | undefined> => {
    const repository = storageRef.current?.repository;
    if (!repository) return undefined;
    try {
      const result = await write(repository);
      setSaveError(null);
      return result;
    } catch (error) {
      setSaveError(describeStorageError(error));
      return undefined;
    }
  }, []);

  /** Updates the session in state and storage. `update` must be pure: it runs on both copies. */
  const updateSession = useCallback(
    (update: (session: ListeningSession) => ListeningSession, options: { reflectInState?: boolean } = {}) => {
      if (options.reflectInState !== false) patch((data) => ({ ...data, session: update(data.session) }));
      return run((repository) => repository.updateSession(id, update));
    },
    [id, patch, run],
  );

  /** Imported subtitles and generated transcripts both go through here (dictation history is cleared). */
  const replaceTranscript = useCallback(
    (session: ListeningSession, summary: TranscriptSummary | null, transcript: TranscriptContent | null) => {
      const next: ListeningSession = { ...session, transcript: summary, updatedAt: Date.now() };
      patch((data) => ({ ...data, session: next, cues: transcript?.cues ?? null, dictation: [] }));
      return run((repository) => repository.replaceTranscript(next, transcript));
    },
    [patch, run],
  );

  const saveDictation = useCallback(
    (record: DictationRecord) => {
      patch((data) => ({
        ...data,
        dictation: [...data.dictation.filter((item) => item.cueId !== record.cueId), record],
      }));
      return run((repository) => repository.putDictation(record));
    },
    [patch, run],
  );

  const sessionOf = useCallback(() => (stateRef.current.status === 'ready' ? stateRef.current.data.session : null), []);

  /** Keeps a copy of media that is open now; reports what happened instead of throwing. */
  const keepCopy = useCallback(
    async (media: Blob): Promise<MediaOutcome> => {
      const repository = storageRef.current?.repository;
      const session = sessionOf();
      if (!repository || !session) return { ok: false, issue: 'write-failed' };
      const outcome = await keepSessionMedia(repository, session, media);
      patch((data) => ({ ...data, session: outcome.session ?? data.session, mediaIssue: outcome.issue }));
      return { ok: outcome.session !== null, issue: outcome.issue };
    },
    [patch, sessionOf],
  );

  /** A reconnected file: play it now and, when asked, keep a copy again. */
  const attachMedia = useCallback(
    async (media: Blob, keep: boolean): Promise<MediaOutcome> => {
      const session = sessionOf();
      rememberSessionMedia(id, media, { saved: false, label: session ? fileLabel(session) : 'Audio' });
      patch((data) => ({ ...data, media, mediaIssue: null }));
      noteMediaIssue(id, null);
      return keep ? keepCopy(media) : { ok: true, issue: null };
    },
    [id, patch, keepCopy, sessionOf],
  );

  const setMediaCopy = useCallback(
    async (enabled: boolean, media: Blob | null): Promise<MediaOutcome> => {
      if (enabled) return media ? keepCopy(media) : { ok: false, issue: 'write-failed' };
      const updated = await run((repository) => repository.deleteMedia(id));
      if (!updated) return { ok: false, issue: 'write-failed' };
      markSessionMediaSaved(id, { saved: false, label: fileLabel(updated) });
      patch((data) => ({ ...data, session: updated, mediaIssue: null }));
      return { ok: true, issue: null };
    },
    [id, patch, run, keepCopy],
  );

  const deleteSession = useCallback(async () => {
    const done = await run(async (repository) => {
      await repository.deleteSession(id);
      return true;
    });
    if (done) forgetSessionMedia(id);
    return done === true;
  }, [id, run]);

  return {
    state,
    saveError,
    persistent: storage?.repository.persistent ?? true,
    fallbackReason: storage?.fallbackReason ?? null,
    updateSession,
    replaceTranscript,
    saveDictation,
    attachMedia,
    keepCopy,
    setMediaCopy,
    deleteSession,
  };
}

export type ListeningSessionApi = ReturnType<typeof useListeningSession>;
