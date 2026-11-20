import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZodType } from 'zod';
import { ApiError, apiPost } from '@/lib/api-client';

export type ApiJobState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running'; readonly startedAt: number }
  | { readonly phase: 'failed'; readonly message: string }
  | { readonly phase: 'cancelled' };

/**
 * One AI request at a time for a JSON endpoint (writing feedback, improved
 * version, grammar second opinion). Started only by an explicit learner
 * action; cancelling or unmounting aborts it, and the server then aborts the
 * Groq call.
 */
export function useApiJob<Req, Res>(path: `/api/${string}`, schema: ZodType<Res>, fallbackMessage: string) {
  const [state, setState] = useState<ApiJobState>({ phase: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = useCallback(
    async (request: Req): Promise<Res | null> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ phase: 'running', startedAt: Date.now() });
      try {
        const response = await apiPost(path, request, schema, controller.signal);
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
            : fallbackMessage;
        setState({ phase: 'failed', message });
        return null;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [path, schema, fallbackMessage],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  const fail = useCallback((message: string) => setState({ phase: 'failed', message }), []);

  return { state, start, cancel, reset, fail };
}
