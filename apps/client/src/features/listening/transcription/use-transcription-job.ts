import { transcriptionResultSchema, type TranscriptionOptions, type TranscriptionResult } from '@ldg/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiUpload } from '@/lib/api-client';
import { useWorkInProgress } from '@/lib/work-in-progress';

export type TranscriptionJobState =
  | { readonly phase: 'idle' }
  /** Real byte counts reported by the browser; `total` is null until known. */
  | { readonly phase: 'uploading'; readonly loaded: number; readonly total: number | null }
  /** The upload finished; the server and Groq are working. No progress is reported, so none is shown. */
  | { readonly phase: 'processing'; readonly startedAt: number }
  | { readonly phase: 'succeeded'; readonly result: TranscriptionResult }
  | { readonly phase: 'failed'; readonly message: string }
  | { readonly phase: 'cancelled' };

export function isTranscriptionBusy(state: TranscriptionJobState): boolean {
  return state.phase === 'uploading' || state.phase === 'processing';
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK_ERROR') return "Couldn't reach the local server. Check that it is running, then try again.";
    return error.message;
  }
  return 'Transcription failed unexpectedly. Try again.';
}

/**
 * Runs one transcription request at a time. The request is asynchronous
 * (XHR), so the page stays responsive; cancelling aborts the upload or the
 * wait, and the server then stops the provider call and deletes its temp file.
 */
export function useTranscriptionJob() {
  const [state, setState] = useState<TranscriptionJobState>({ phase: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);
  useWorkInProgress(isTranscriptionBusy(state));

  // Leaving the page cancels the request instead of letting it finish unseen.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = useCallback(
    async (media: Blob, fileName: string, options: TranscriptionOptions): Promise<TranscriptionResult | null> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ phase: 'uploading', loaded: 0, total: media.size || null });

      const form = new FormData();
      // Text fields must precede the file: the server reads the multipart stream in order.
      form.append('model', options.model);
      form.append('language', options.language);
      form.append('file', media, fileName);

      try {
        const result = await apiUpload('/api/transcriptions', form, transcriptionResultSchema, {
          signal: controller.signal,
          onUploadProgress: (loaded, total) => {
            if (!controller.signal.aborted) setState({ phase: 'uploading', loaded, total });
          },
          onUploadComplete: () => {
            if (!controller.signal.aborted) setState({ phase: 'processing', startedAt: Date.now() });
          },
        });
        if (controller.signal.aborted) return null;
        setState({ phase: 'succeeded', result });
        return result;
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          setState({ phase: 'cancelled' });
          return null;
        }
        setState({ phase: 'failed', message: describeError(error) });
        return null;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  /** Report a failure that happened after the request (e.g. saving the session). */
  const fail = useCallback((message: string) => setState({ phase: 'failed', message }), []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState({ phase: 'idle' });
  }, []);

  return { state, start, cancel, fail, reset };
}
