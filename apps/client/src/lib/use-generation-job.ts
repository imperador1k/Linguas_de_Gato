import { generationResponseSchema, type GenerationRequest, type GenerationResponse } from '@ldg/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiPost } from '@/lib/api-client';
import { useWorkInProgress } from '@/lib/work-in-progress';

export type GenerationJobState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running'; readonly startedAt: number }
  | { readonly phase: 'failed'; readonly message: string }
  | { readonly phase: 'cancelled' };

/**
 * One AI exercise-generation request at a time, shared by every module.
 * It only ever runs from an explicit learner action; cancelling aborts the
 * request (the server then aborts the Groq call).
 */
export function useGenerationJob() {
  const [state, setState] = useState<GenerationJobState>({ phase: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);
  useWorkInProgress(state.phase === 'running');

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = useCallback(async (request: GenerationRequest): Promise<GenerationResponse | null> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ phase: 'running', startedAt: Date.now() });
    try {
      const response = await apiPost('/api/exercises/generate', request, generationResponseSchema, controller.signal);
      if (controller.signal.aborted) return null;
      if (response.result.kind !== request.kind) throw new ApiError('INVALID_RESPONSE', 'The server returned exercises of the wrong kind.', 502);
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
          : 'Generation failed unexpectedly. Try again.';
      setState({ phase: 'failed', message });
      return null;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const reset = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, start, cancel, reset };
}
