import type { LearningCategory, TrainingModule } from '@ldg/shared';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { practiseCategoryFor } from './practise-links';

/**
 * Reads `?practise=<category>` for a module hub. Returns the category only when
 * this module's generator can practise it; `clear` removes the parameter (e.g.
 * when the creation panel closes) without adding a history entry.
 */
export function usePractiseParam(module: TrainingModule): { category: LearningCategory | null; clear: () => void } {
  const [params, setParams] = useSearchParams();
  const category = practiseCategoryFor(params.get('practise'), module);
  const clear = useCallback(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('practise');
        return next;
      },
      { replace: true },
    );
  }, [setParams]);
  return { category, clear };
}
