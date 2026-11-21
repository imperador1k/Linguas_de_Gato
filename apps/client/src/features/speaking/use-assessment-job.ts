import { assessmentResponseSchema, type AssessmentRequest, type AssessmentResponse } from '@ldg/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiPost } from '@/lib/api-client';
import { useWorkInProgress } from '@/lib/work-in-progress';

export type AssessmentJobState =
  | { readonly phase: 'idle' }
  /** The model reports no progress, so only elapsed time is shown. */
  | { readonly phase: 'running'; readonly startedAt: number }
  | { readonly phase: 'failed'; readonly message: string }
  | { readonly phase: 'cancelled' };

/** One feedback request at a time; cancelling aborts it (the server then aborts the Groq call). */
export function useAssessmentJob() {
  const [state, setState] = useState<AssessmentJobState>({ phase: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);
  useWorkInProgress(state.phase === 'running');

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = useCallback(async (request: AssessmentRequest): Promise<AssessmentResponse | null> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ phase: 'running', startedAt: Date.now() });
    try {
      const response = await apiPost('/api/speaking/assessments', request, assessmentResponseSchema, controller.signal);
      if (controller.signal.aborted) return null;
      setState({ phase: 'idle' });
      return response;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        setState({ phase: 'cancelled' });
        return null;
      }
      const message =
        error instanceof ApiError
          ? error.code === 'NETWORK_ERROR'
            ? "Couldn't reach the local server. Check that it is running, then try again."
            : error.message
          : 'Feedback failed unexpectedly. Try again.';
      setState({ phase: 'failed', message });
      return null;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const fail = useCallback((message: string) => setState({ phase: 'failed', message }), []);

  return { state, start, cancel, fail };
}
