import { formatAccuracy, formatBytes, listeningMediaState, summarizeDictation, type ListeningMediaState, type ListeningSession } from '@ldg/shared';
import { MediaStateBadge } from '@/components/ui/media-state-badge';
import { recallSessionMedia } from '../storage/session-media-cache';
import { ArrowRight, FileMusic, Plus, SquarePlay, Trash } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { ContinueCard } from '@/components/ui/continue-card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { FILTER_CONTROL, resultCount, SEARCH_THRESHOLD, SearchField } from '@/components/ui/search-field';
import { cn } from '@/lib/utils';
import { describeStorageError, estimateStorage, type ListeningStorage, type StorageEstimateSummary } from '../storage/listening-storage';
import { forgetSessionMedia } from '../storage/session-media-cache';

interface SessionRow {
  readonly session: ListeningSession;
  /** "Dictation 4/12 · 87%", or null before any dictation. */
  readonly dictation: string | null;
  readonly dictationDone: boolean;
  readonly questionSets: number;
  readonly media: ListeningMediaState;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function loadRows(storage: ListeningStorage): Promise<SessionRow[]> {
  const [sessions, mediaKeys] = await Promise.all([storage.repository.listSessions(), storage.repository.listMediaKeys()]);
  // Saved means the copy exists, not just that the record says so.
  const stored = new Set(mediaKeys);
  const mediaOf = (session: ListeningSession) => listeningMediaState(session.source, { stored: stored.has(session.id), inMemory: recallSessionMedia(session.id) !== null });
  const rows = await Promise.all(
    sessions.map(async (session): Promise<SessionRow> => {
      const media = mediaOf(session);
      if (!session.transcript) return { session, dictation: null, dictationDone: false, questionSets: 0, media };
      const [transcript, records, sets] = await Promise.all([storage.repository.getTranscript(session.id), storage.repository.listDictation(session.id), storage.repository.listExerciseSets(session.id)]);
      const summary = summarizeDictation(transcript?.cues ?? [], records);
      const average = summary.averageLatestAccuracy === null ? '' : ` · ${formatAccuracy(summary.averageLatestAccuracy)}`;
      return {
        session,
        dictation: summary.practisedLines === 0 ? null : `Dictation ${summary.practisedLines}/${summary.totalLines}${average}`,
        dictationDone: summary.totalLines > 0 && summary.practisedLines >= summary.totalLines,
        questionSets: sets.length,
        media,
      };
    }),
  );
  return rows.sort((a, b) => b.session.lastOpenedAt - a.session.lastOpenedAt);
}

function sourceLine(session: ListeningSession): string {
  const parts: string[] = [];
  if (session.source.kind === 'youtube') parts.push('YouTube');
  else parts.push(`${session.source.formatExtension.toUpperCase()} · ${formatBytes(session.source.fileSize)}`);
  parts.push(session.transcript ? `${session.transcript.cueCount} lines` : 'No transcript yet');
  return parts.join(' · ');
}

/**
 * Saved listening sessions: the one to continue, then the whole library with
 * direct entry points into reading along, dictation and comprehension
 * questions. Importing new media lives in the creation panel, not here.
 */
export function SessionLibrary({ storage, onNewSession }: { storage: ListeningStorage; onNewSession: () => void }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimateSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ListeningSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | 'file' | 'youtube'>('all');

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

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rows ?? []).filter(({ session }) => (source === 'all' || session.source.kind === source) && (!needle || session.title.toLowerCase().includes(needle)));
  }, [rows, query, source]);
  const resume = rows?.find((row) => row.session.transcript && !row.dictationDone) ?? null;
  const filtered = query.trim() !== '' || source !== 'all';

  if (rows === null) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Reading your sessions…
      </p>
    );
  }

  return (
    <>
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}

      {resume ? (
        resume.media === 'needs-file' ? (
          // Dictation can't play without the audio: say so before the learner gets there.
          <ContinueCard
            title={resume.session.title}
            detail={`${resume.dictation ?? 'Not dictated yet'} · the audio needs the original file`}
            to={`/listening/session/${resume.session.id}`}
            action="Reconnect the file"
          />
        ) : (
          <ContinueCard
            title={resume.session.title}
            detail={resume.dictation ?? `${sourceLine(resume.session)} · not dictated yet`}
            to={`/listening/session/${resume.session.id}?mode=dictation`}
            action="Continue dictation"
            secondary={
              <Link to={`/listening/session/${resume.session.id}`} className={buttonVariants({ variant: 'ghost' })}>
                Open
              </Link>
            }
          />
        )
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No listening sessions yet."
          action={
            <Button size="sm" onClick={onNewSession}>
              <Plus aria-hidden="true" />
              New session
            </Button>
          }
        >
          Transcribe a recording you own, open a file with its subtitles, or load a YouTube lesson. Sessions keep your transcript, loop points and dictation progress.
        </EmptyState>
      ) : (
        <section aria-labelledby="listening-sessions" className="flex flex-col gap-4">
          <h2 id="listening-sessions" className="sr-only">
            Your sessions
          </h2>
          {rows.length >= SEARCH_THRESHOLD ? (
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              <SearchField label="Search sessions" value={query} onChange={setQuery} className="sm:flex-[1_1_16rem]" />
              <select aria-label="Source" value={source} onChange={(event) => setSource(event.target.value as typeof source)} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_11rem]')}>
                <option value="all">All sources</option>
                <option value="file">Your files</option>
                <option value="youtube">YouTube</option>
              </select>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {resultCount(visible.length, rows.length, 'session')} · {storage.repository.persistent ? 'saved in this browser' : 'kept until you close this tab'}
            {estimate ? ` · ${formatBytes(estimate.usage)} of browser storage used by this app` : ''}
            {filtered ? (
              <button
                type="button"
                className="ml-2 underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setQuery('');
                  setSource('all');
                }}
              >
                Clear filters
              </button>
            ) : null}
          </p>
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No sessions match.</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card" aria-label="Saved sessions">
              {visible.map(({ session, dictation, questionSets, media }) => {
                const Icon = session.source.kind === 'youtube' ? SquarePlay : FileMusic;
                return (
                  <li key={session.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Icon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <Link to={`/listening/session/${session.id}`} className="group min-w-0 flex-1 rounded-md">
                        <span className="flex items-center gap-2">
                          <span className="font-medium break-words group-hover:underline">{session.title}</span>
                          <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                          <span>{sourceLine(session)}</span>
                          <MediaStateBadge state={media} />
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {dictation ? `${dictation} · ` : ''}
                          {questionSets > 0 ? `${questionSets} question set${questionSets === 1 ? '' : 's'} · ` : ''}
                          <time dateTime={new Date(session.lastOpenedAt).toISOString()}>{dateFormatter.format(session.lastOpenedAt)}</time>
                        </span>
                      </Link>
                    </div>
                    <div className="flex items-center gap-1 pl-7 sm:pl-0">
                      {session.transcript ? (
                        <>
                          <Link to={`/listening/session/${session.id}?mode=dictation`} className={buttonVariants({ variant: 'secondary', size: 'sm' })} aria-label={`Dictation: ${session.title}`}>
                            Dictation
                          </Link>
                          <Link to={`/listening/session/${session.id}?mode=exercises`} className={buttonVariants({ variant: 'ghost', size: 'sm' })} aria-label={`Comprehension questions: ${session.title}`}>
                            Questions
                          </Link>
                        </>
                      ) : null}
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${session.title}`} onClick={() => setPendingDelete(session)}>
                        <Trash aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this session?"
        description={`"${pendingDelete?.title ?? ''}" and its transcript, dictation history, questions and any saved media copy will be removed from this browser. Your original files are not affected.`}
        confirmLabel="Delete session"
        destructive
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
