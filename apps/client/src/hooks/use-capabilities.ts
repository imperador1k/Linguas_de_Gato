import { capabilitiesResponseSchema, type CapabilitiesResponse } from '@ldg/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet } from '@/lib/api-client';

export type CapabilitiesState =
  | { status: 'loading' }
  | { status: 'ready'; data: CapabilitiesResponse }
  | { status: 'error'; error: ApiError };

// Shared across components so navigating between pages doesn't refetch.
let cached: Promise<CapabilitiesResponse> | null = null;

function loadCapabilities(): Promise<CapabilitiesResponse> {
  cached ??= apiGet('/api/capabilities', capabilitiesResponseSchema).catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

export function useCapabilities(): CapabilitiesState & { retry: () => void } {
  const [state, setState] = useState<CapabilitiesState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadCapabilities().then(
      (data) => active && setState({ status: 'ready', data }),
      (error: unknown) =>
        active &&
        setState({
          status: 'error',
          error: error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', 'Unexpected error.', 0),
        }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  return { ...state, retry };
}
