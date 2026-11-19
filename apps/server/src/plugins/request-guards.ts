import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '@ldg/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';

/**
 * Protects state-changing API routes of a server that runs on the learner's
 * own machine. Without this, any website open in the same browser could:
 *
 * - CSRF: submit a plain cross-origin `multipart/form-data` POST (no CORS
 *   preflight for "simple" requests) and spend the learner's Groq quota;
 * - DNS rebinding: point a hostile hostname at 127.0.0.1 and talk to the API
 *   "same-origin", which a custom-header check alone doesn't stop.
 *
 * Defences, all required for every request except GET/HEAD/OPTIONS (whatever its path):
 * 1. a loopback Host header (only when the server is bound to loopback);
 * 2. no cross-site/same-site `Sec-Fetch-Site` (modern browsers always send it);
 * 3. the custom client header, which forces a preflight this server never answers.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

function forbidden(): AppError {
  return new AppError('FORBIDDEN', 'This request was blocked because it did not come from the Linguas de Gato app.', 403);
}

export interface RequestGuardOptions {
  /** True when the server listens on a loopback address (the default). */
  readonly enforceLoopbackHost: boolean;
}

export function checkStateChangingRequest(request: FastifyRequest, options: RequestGuardOptions): void {
  // Deliberately path-independent: the router decodes paths (`/%61pi/...` matches `/api/...`), so any
  // prefix test on the raw URL can be bypassed. The server has no state-changing routes outside the API.
  if (SAFE_METHODS.has(request.method)) return;

  if (options.enforceLoopbackHost) {
    const hostname = hostnameOf(request.headers.host);
    if (!hostname || !LOOPBACK_HOSTNAMES.has(hostname)) throw forbidden();
  }

  const fetchSite = request.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && !ALLOWED_FETCH_SITES.has(fetchSite)) throw forbidden();

  if (request.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE) throw forbidden();
}

export function registerRequestGuards(app: FastifyInstance, options: RequestGuardOptions): void {
  // onRequest runs before body parsing, so a blocked upload is never read or written to disk.
  app.addHook('onRequest', async (request) => {
    checkStateChangingRequest(request, options);
  });
}
