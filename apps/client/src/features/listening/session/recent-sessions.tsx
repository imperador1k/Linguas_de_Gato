import { formatAccuracy, formatBytes, summarizeDictation, type ListeningSession } from '@ldg/shared';
import { FileMusic, SquarePlay, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import {
  describeStorageError,
  estimateStorage,
  type ListeningStorage,
  type StorageEstimateSummary,
} from '../storage/listening-storage';
import { forgetSessionMedia } from '../storage/session-media-cache';

interface SessionRow {
  readonly session: ListeningSession;
  readonly progress: string | null;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function loadRows(storage: ListeningStorage): Promise<SessionRow[]> {
  const sessions = await storage.repository.listSessions();
  return Promise.all(
    sessions.map(async (session): Promise<SessionRow> => {
      if (!session.transcript) return { session, progress: null };
      const [transcript, records] = await Promise.all([
        storage.repository.getTranscript(session.id),
        storage.repository.listDictation(session.id),
      ]);
      const summary = summarizeDictation(transcript?.cues ?? [], records);
      if (summary.practisedLines === 0) return { session, progress: null };
      const average = summary.averageLatestAccuracy === null ? '' : ` · ${formatAccuracy(summary.averageLatestAccuracy)}`;
      return { session, progress: `Dictation ${summary.practisedLines}/${summary.totalLines}${average}` };
    }),
  );
}

function sourceLine(session: ListeningSession): string {
  const parts: string[] = [];
  if (session.source.kind === 'youtube') parts.push('YouTube');
  else parts.push(`${session.source.formatExtension.toUpperCase()} · ${formatBytes(session.source.fileSize)}`);
  parts.push(session.transcript ? `${session.transcript.cueCount} lines` : 'No transcript');
  return parts.join(' · ');
}

/** Saved sessions with their progress. Renders nothing until there is at least one. */
export function RecentSessions({ storage }: { storage: ListeningStorage }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimateSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ListeningSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const titleId = useId();

  const refresh = useCallback(async () => {
    try {
      setRows(await loadRows(storage));
      setError(null);
    } catch (loadError) {
      setError(describeStorageError(loadError));
      setRows([]);
    }
    if (storage.repository.persistent) setEstimate(await estimateStorage());
  }, [storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await storage.repository.deleteSession(pendingDelete.id);
      forgetSessionMedia(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
    } catch (deleteError) {
      setError(describeStorageError(deleteError));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  if (!rows || (rows.length === 0 && !error)) return null;

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader className="pb-3">
        <CardTitle id={titleId}>Your sessions</CardTitle>
        <CardDescription>
          {storage.repository.persistent ? 'Saved in this browser.' : 'Kept until you close this tab.'}
        </CardDescription>
      </CardHeader>
      {error ? (
        <div className="px-5 pb-3 sm:px-6">
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        </div>
      ) : null}
      <ul className="border-t" aria-label="Saved sessions">
        {rows.map(({ session, progress }) => {
          const Icon = session.source.kind === 'youtube' ? SquarePlay : FileMusic;
          return (
            <li key={session.id} className="flex items-center gap-2 border-b px-3 py-1 last:border-b-0 sm:px-4">
              <Link
                to={`/listening/session/${session.id}`}
                className="flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-accent/70"
              >
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium" title={session.title}>
                    {session.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{sourceLine(session)}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {progress ? `${progress} · ` : ''}
                    <time dateTime={new Date(session.lastOpenedAt).toISOString()}>
                      {dateFormatter.format(session.lastOpenedAt)}
                    </time>
                  </span>
                </span>
              </Link>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${session.title}`}
                title="Delete session"
                onClick={() => setPendingDelete(session)}
              >
                <Trash aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
      {estimate ? (
        <p className="border-t px-5 py-3 text-xs text-muted-foreground sm:px-6">
          Browser storage used by this app: {formatBytes(estimate.usage)}
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this session?"
        description={`"${pendingDelete?.title ?? ''}" and its transcript, dictation history and any saved media copy will be removed from this browser. Your original files are not affected.`}
        confirmLabel="Delete session"
        destructive
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  );
}
