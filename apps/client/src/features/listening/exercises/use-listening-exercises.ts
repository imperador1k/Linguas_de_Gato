import type { ListeningExerciseSet } from '@ldg/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeStorageError, useListeningStorage } from '../storage/listening-storage';

export type SetUpdater = (set: ListeningExerciseSet) => ListeningExerciseSet;

/**
 * The AI exercise sets of one listening session. Writes are optimistic: the
 * UI keeps the learner's answers even if saving fails, and says so.
 *
 * Updates are functional and read the latest value from a ref, so two quick
 * changes in one tick (a short answer saved on blur, then "Check answers")
 * never overwrite each other.
 */
export function useListeningExercises(sessionId: string) {
  const storage = useListeningStorage();
  const [sets, setSetsState] = useState<ListeningExerciseSet[] | null>(null);
  const setsRef = useRef<ListeningExerciseSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setSets = useCallback((next: ListeningExerciseSet[]) => {
    setsRef.current = next;
    setSetsState(next);
  }, []);

  useEffect(() => {
    if (!storage) return;
    let active = true;
    storage.repository.listExerciseSets(sessionId).then(
      (loaded) => active && setSets(loaded),
      (caught: unknown) => {
        if (!active) return;
        setError(describeStorageError(caught));
        setSets([]);
      },
    );
    return () => {
      active = false;
    };
  }, [storage, sessionId, setSets]);

  const persist = useCallback(
    async (set: ListeningExerciseSet) => {
      if (!storage) return;
      try {
        await storage.repository.putExerciseSet(set);
        setError(null);
      } catch (caught) {
        setError(describeStorageError(caught));
      }
    },
    [storage],
  );

  const add = useCallback(
    async (set: ListeningExerciseSet) => {
      setSets([set, ...(setsRef.current ?? []).filter((candidate) => candidate.id !== set.id)].sort((a, b) => b.createdAt - a.createdAt));
      await persist(set);
    },
    [persist, setSets],
  );

  const update = useCallback(
    (id: string, updater: SetUpdater) => {
      const current = setsRef.current?.find((set) => set.id === id);
      if (!current) return;
      const next = updater(current);
      if (next === current) return;
      setSets((setsRef.current ?? []).map((set) => (set.id === id ? next : set)));
      void persist(next);
    },
    [persist, setSets],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!storage) return;
      try {
        await storage.repository.deleteExerciseSet(id);
        setSets((setsRef.current ?? []).filter((set) => set.id !== id));
      } catch (caught) {
        setError(describeStorageError(caught));
      }
    },
    [storage, setSets],
  );

  return { sets, error, add, update, remove };
}

export type ListeningExercisesApi = ReturnType<typeof useListeningExercises>;
