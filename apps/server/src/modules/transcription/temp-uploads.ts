import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Prefix of every per-request upload directory; nothing else in the temp dir is ever touched. */
export const UPLOAD_DIR_PREFIX = 'ldg-transcription-';

/** Older than any request can live (max timeout is 30 minutes), with margin. */
export const STALE_UPLOAD_AGE_MS = 60 * 60 * 1000;

/**
 * Deletes upload directories left behind by a crash or forced kill (normal
 * requests always clean up in `finally`). Best effort: errors are swallowed,
 * because a failed sweep must never stop the server from starting.
 * Resolves with the number of directories removed.
 */
export async function sweepStaleUploads(tempRoot: string, now = Date.now(), maxAgeMs = STALE_UPLOAD_AGE_MS): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(tempRoot);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const name of entries) {
    if (!name.startsWith(UPLOAD_DIR_PREFIX)) continue;
    const path = join(tempRoot, name);
    try {
      const info = await stat(path);
      if (!info.isDirectory() || now - info.mtimeMs < maxAgeMs) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Raced with another cleanup, or not ours to delete: leave it.
    }
  }
  return removed;
}
