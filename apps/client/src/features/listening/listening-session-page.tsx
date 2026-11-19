import { formatBytes, type ListeningSession } from '@ldg/shared';
import { ArrowLeft, PencilLine, Trash } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/utils';
import { LocalSessionView, YouTubeSessionView } from './session/session-views';
import { useListeningSession } from './session/use-listening-session';

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
