import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNewVersionAvailable } from '@/lib/version-check';
import { useHasWorkInProgress } from '@/lib/work-in-progress';

/**
 * "A new version is available." Shown once a newer build is detected; it never
 * reloads by itself. While a recording or an AI request is in progress the
 * Reload button waits, so the update can't throw that work away. Unsaved
 * edits elsewhere are protected by the pages' own leave confirmations.
 */
export function UpdateBanner() {
  const available = useNewVersionAvailable();
  const busy = useHasWorkInProgress();
  if (!available) return null;
  return (
    <div role="status" className="mb-6 flex flex-col gap-2 rounded-lg border border-border-strong bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
      <p className="min-w-0 flex-1">
        A new version is available. Reload to update.
        {busy ? <span className="block text-xs text-muted-foreground">Finish or cancel what is in progress first; it would be lost on reload.</span> : null}
      </p>
      <Button size="sm" variant="secondary" className="self-start sm:self-auto" disabled={busy} onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden="true" />
        Reload
      </Button>
    </div>
  );
}
