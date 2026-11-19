import type { DictationRecord, ListeningSession, SubtitleCue, TranscriptSummary } from '@ldg/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListeningRepository, TranscriptContent } from '../storage/listening-repository';
import { describeStorageError, useListeningStorage, type ListeningStorage } from '../storage/listening-storage';
import { forgetSessionMedia, recallSessionMedia, rememberSessionMedia } from '../storage/session-media-cache';

export interface LoadedSession {
  readonly session: ListeningSession;
  readonly cues: readonly SubtitleCue[] | null;
  readonly dictation: readonly DictationRecord[];
  /** The playable media, when available (chosen this page lifetime or saved as a copy). */
  readonly media: Blob | null;
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

  let media = recallSessionMedia(id);
  if (!media && opened.source.kind === 'file' && opened.source.mediaStored) {
    media = await repository.getMedia(id);
    if (media) rememberSessionMedia(id, media);
  }
  return { session: opened, cues: transcript?.cues ?? null, dictation, media };
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

  const attachMedia = useCallback(
    (media: Blob) => {
      rememberSessionMedia(id, media);
      patch((data) => ({ ...data, media }));
    },
    [id, patch],
  );

  const setMediaCopy = useCallback(
    async (enabled: boolean, media: Blob | null): Promise<boolean> => {
      const updated = await run((repository) =>
        enabled && media ? repository.saveMedia(id, media) : repository.deleteMedia(id),
      );
      if (!updated) return false;
      patch((data) => ({ ...data, session: updated }));
      return true;
    },
    [id, patch, run],
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
    setMediaCopy,
    deleteSession,
  };
}

export type ListeningSessionApi = ReturnType<typeof useListeningSession>;
