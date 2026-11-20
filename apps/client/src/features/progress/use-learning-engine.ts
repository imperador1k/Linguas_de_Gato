import { computeInsights, computeRecommendations, extractObservations, type LearningObservation } from '@ldg/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { learningStorage, type LearningData } from './storage/learning-repository';

export type EngineState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'memory' }
  | { readonly phase: 'error'; readonly message: string }
  | { readonly phase: 'ready'; readonly data: LearningData; readonly loadedAt: number };

/**
 * Loads every module's records once and derives the analytics in memory.
 * Nothing here calls the server: all metrics, insights and recommendations
 * are deterministic functions of the local data.
 */
export function useLearningEngine() {
  const storage = learningStorage.use();
  const [state, setState] = useState<EngineState>({ phase: 'loading' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!storage) return;
    let active = true;
    storage.repository.loadSnapshot().then(
      (data) => active && setState(data ? { phase: 'ready', data, loadedAt: Date.now() } : { phase: 'memory' }),
      (error: unknown) => active && setState({ phase: 'error', message: describeStorageFailure(error) }),
    );
    return () => {
      active = false;
    };
  }, [storage, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  const derived = useMemo(() => {
    if (state.phase !== 'ready') return null;
    const now = state.loadedAt;
    const extraction = extractObservations(state.data.snapshot);
    const insights = computeInsights(extraction.observations, extraction.exposures, now);
    const recommendations = computeRecommendations(insights, extraction.observations, state.data.snapshot, state.data.recommendationStates, state.data.trainingSessions, now);
    const byId = new Map<string, LearningObservation>(extraction.observations.map((observation) => [observation.id, observation]));
    return { now, extraction, insights, recommendations, byId };
  }, [state]);

  return { storage, state, derived, reload };
}

export type LearningEngine = ReturnType<typeof useLearningEngine>;
export type DerivedLearning = NonNullable<LearningEngine['derived']>;
