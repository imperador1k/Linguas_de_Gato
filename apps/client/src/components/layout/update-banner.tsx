import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useNewVersionAvailable } from '@/lib/version-check';
import { reloadDecision, useVolatileMedia } from '@/lib/volatile-media';
import { useHasWorkInProgress } from '@/lib/work-in-progress';

/**
 * "A new version is available." Shown once a newer build is detected; it never
 * reloads by itself.
 * - While a recording or an AI request is in progress, Reload waits.
 * - When audio is open but not saved in the browser (an imported file without
 *   a copy, an unsaved recording), Reload first says what would be lost and
 *   links to where it can be kept; reloading anyway is the learner's choice.
 * Unsaved edits elsewhere are protected by the pages' own leave confirmations.
 */
export function UpdateBanner() {
  const available = useNewVersionAvailable();
  const busy = useHasWorkInProgress();
  const volatile = useVolatileMedia();
  const [confirming, setConfirming] = useState(false);
  if (!available) return null;
  const decision = reloadDecision({ busy, volatile });
  const recordings = volatile.filter((item) => item.kind === 'speaking').length;

  return (
    <div role="status" className="mb-6 flex flex-col gap-3 rounded-lg border border-border-strong bg-card px-4 py-3 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <p className="min-w-0 flex-1">
          A new version is available. Reload to update.
          {decision === 'wait' ? <span className="block text-xs text-muted-foreground">Finish or cancel what is in progress first; it would be lost on reload.</span> : null}
        </p>
        {!confirming ? (
          <Button
            size="sm"
            variant="secondary"
            className="self-start sm:self-auto"
            disabled={decision === 'wait'}
            onClick={() => (decision === 'confirm' ? setConfirming(true) : window.location.reload())}
          >
            <RefreshCw aria-hidden="true" />
            Reload
          </Button>
        ) : null}
      </div>
      {confirming && decision !== 'wait' ? (
        <div className="flex flex-col gap-2 rounded-md border border-caution/40 bg-caution-subtle px-3 py-2.5">
          <p className="font-medium">Some audio isn't saved in this browser and would be lost:</p>
          <ul className="flex flex-col gap-1">
            {volatile.map((item) => (
              <li key={item.key} className="flex flex-wrap items-baseline gap-x-2">
                <span className="break-all">{item.label}</span>
                <Link to={item.path} className="text-xs underline underline-offset-2" onClick={() => setConfirming(false)}>
                  {item.kind === 'speaking' ? 'Open to keep the recording' : 'Open to keep a copy'}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {recordings > 0 ? 'A recording that is not kept cannot be recovered. ' : ''}
            Imported files can be chosen again after the reload.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={() => window.location.reload()}>
              Reload anyway
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
