import { transcriptFingerprint, type SubtitleCue } from '@ldg/shared';
import { useMemo, useState } from 'react';
import { useListeningExercises } from './use-listening-exercises';

/**
 * State for the comprehension mode of a session: saved sets, which one is
 * open (null = the generator), and whether a set predates the current
 * transcript.
 */
export function useExerciseMode(sessionId: string, cues: readonly SubtitleCue[] | null) {
  const exercises = useListeningExercises(sessionId);
  const [chosenId, setChosenId] = useState<string | null | undefined>(undefined);
  const fingerprint = useMemo(() => (cues ? transcriptFingerprint(cues) : null), [cues]);

  const sets = exercises.sets ?? [];
  // Until the learner chooses, open the newest set, or the generator when there is none.
  const activeId = chosenId === undefined ? (sets[0]?.id ?? null) : chosenId !== null && !sets.some((set) => set.id === chosenId) ? null : chosenId;
  const active = sets.find((set) => set.id === activeId) ?? null;

  return {
    ...exercises,
    loaded: exercises.sets !== null,
    active,
    activeId,
    select: (id: string | null) => setChosenId(id),
    isStale: (setFingerprint: string) => fingerprint !== null && setFingerprint !== fingerprint,
  };
}

export type ExerciseModeApi = ReturnType<typeof useExerciseMode>;
