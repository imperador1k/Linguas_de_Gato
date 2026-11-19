import { formatBytes, type ListeningSession } from '@ldg/shared';
import { ArrowLeft, BookOpenText, CircleCheck, PencilLine, Trash, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/utils';
import { LocalSessionView, YouTubeSessionView } from './session/session-views';
import { useListeningSession } from './session/use-listening-session';
import { describeTranscriptSource } from './transcription/transcribed-session';

function BackLink() {
  return (
    <Link to="/listening" className={cn(buttonVariants({ variant: 'secondary' }))}>
      <ArrowLeft aria-hidden="true" />
      All sessions
    </Link>
  );
}

function describeSource(session: ListeningSession): string {
  const { source } = session;
  const lines = session.transcript ? `${session.transcript.cueCount} transcript lines` : 'No transcript yet';
  if (source.kind === 'youtube') return `YouTube video · ${lines}`;
  return `${source.mediaKind === 'video' ? 'Video' : 'Audio'} file · ${formatBytes(source.fileSize)} · ${lines}`;
}

/** Confirms a fresh automatic transcript and offers the next step. */
function TranscribedBanner({ session, onStartDictation, onDismiss }: { session: ListeningSession; onStartDictation: () => void; onDismiss: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Move focus here after the navigation, so keyboard and screen-reader users hear the outcome.
  useEffect(() => headingRef.current?.focus(), []);
  if (!session.transcript) return null;
  const lines = session.transcript.cueCount;

  return (
    <section
      aria-labelledby="transcribed-heading"
      className="mb-6 flex flex-col gap-4 rounded-lg border border-success/40 bg-success-subtle px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 gap-3">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="min-w-0">
          <h2 id="transcribed-heading" ref={headingRef} tabIndex={-1} className="font-medium outline-none">
            Transcript ready: {lines} {lines === 1 ? 'line' : 'lines'}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {describeTranscriptSource(session.transcript)}. Check it while you listen; automatic transcripts can contain mistakes.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button onClick={onStartDictation}>
          <PencilLine aria-hidden="true" />
          Start dictation
        </Button>
        <Button variant="secondary" onClick={onDismiss}>
          <BookOpenText aria-hidden="true" />
          Read along
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={onDismiss}>
          <X aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

function RenameDialog({
  open,
  initialTitle,
  onSave,
  onClose,
}: {
  open: boolean;
  initialTitle: string;
  onSave: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const inputId = useId();
  const trimmed = title.trim();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rename session"
      onSubmit={() => trimmed && onSave(trimmed.slice(0, 200))}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmed}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>Name</Label>
        <Input id={inputId} value={title} maxLength={200} autoFocus onChange={(event) => setTitle(event.target.value)} />
      </div>
    </Dialog>
  );
}

export function ListeningSessionPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const api = useListeningSession(sessionId);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { state } = api;

  if (state.status === 'loading') {
    return (
      <p role="status" className="py-24 text-center text-sm text-muted-foreground">
        Opening session…
      </p>
    );
  }

  if (state.status !== 'ready') {
    return (
      <>
        <PageHeader
          eyebrow="Listening"
          title={state.status === 'missing' ? 'Session not found' : "This session couldn't be opened"}
          description={
            state.status === 'missing'
              ? 'It may have been deleted, or it was saved in another browser.'
              : state.message
          }
          actions={<BackLink />}
        />
      </>
    );
  }

  const { session } = state.data;
  const justTranscribed = searchParams.get('transcribed') === '1' && session.transcript?.format === 'whisper';

  function leaveBanner(mode: 'read' | 'dictation') {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.delete('transcribed');
        if (mode === 'dictation') {
          params.set('mode', 'dictation');
          params.set('line', '1');
        }
        return params;
      },
      { replace: true },
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Listening session"
        title={<span className="break-words">{session.title}</span>}
        description={describeSource(session)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BackLink />
            <Button variant="ghost" size="icon" aria-label="Rename session" title="Rename" onClick={() => setRenaming(true)}>
              <PencilLine aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Delete session" title="Delete" onClick={() => setConfirmDelete(true)}>
              <Trash aria-hidden="true" />
            </Button>
          </div>
        }
      />

      {api.fallbackReason ? (
        <Notice className="mb-6">
          {api.fallbackReason.message} This session lasts until you close the tab.
        </Notice>
      ) : null}

      {justTranscribed ? (
        <TranscribedBanner session={session} onStartDictation={() => leaveBanner('dictation')} onDismiss={() => leaveBanner('read')} />
      ) : null}

      {session.source.kind === 'file' ? (
        <LocalSessionView key={session.id} api={api} data={state.data} source={session.source} />
      ) : (
        <YouTubeSessionView key={session.id} api={api} data={state.data} source={session.source} />
      )}

      {renaming ? (
        <RenameDialog
          open
          initialTitle={session.title}
          onClose={() => setRenaming(false)}
          onSave={(title) => {
            setRenaming(false);
            void api.updateSession((current) => ({ ...current, title, updatedAt: Date.now() }));
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this session?"
        description="Its transcript, dictation history and any saved media copy will be removed from this browser. Your original files are not affected."
        confirmLabel="Delete session"
        destructive
        busy={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setDeleting(true);
          const deleted = await api.deleteSession();
          setDeleting(false);
          setConfirmDelete(false);
          if (deleted) navigate('/listening', { replace: true });
        }}
      />
    </>
  );
}
