import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { ConfirmDialog } from './dialog';

/**
 * The creation side panel: where something new is made (a topic, later a
 * task or an exercise set) without leaving the page. Built on the native
 * <dialog>, like `Dialog`: focus is contained, the page behind is inert and
 * Escape closes it. When `dirty` is true, closing first asks before
 * discarding the learner's unsaved work. Focus returns to the element that
 * opened the panel.
 *
 * Full height on the right from the `sm` breakpoint; full screen on phones.
 */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  dirty = false,
  busy = false,
  children,
  className,
}: {
  open: boolean;
  /** Called once closing is confirmed (or needs no confirmation). */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Unsaved work inside: closing asks for confirmation. */
  dirty?: boolean;
  /** A save or generation is running: the close button is disabled. */
  busy?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      openerRef.current = document.activeElement;
      dialog.showModal();
      // The page behind shouldn't scroll under the panel.
      document.documentElement.style.overflow = 'hidden';
    }
    if (!open && dialog.open) {
      dialog.close();
      document.documentElement.style.overflow = '';
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    }
  }, [open]);

  useEffect(() => () => void (document.documentElement.style.overflow = ''), []);

  function requestClose() {
    if (busy) return;
    if (dirty) setConfirming(true);
    else onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Escape: keep React state as the source of truth and protect unsaved work.
        event.preventDefault();
        if (!confirming) requestClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      className={cn(
        'm-0 ml-auto h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground shadow-2xl sm:max-w-xl sm:border-l',
        'backdrop:bg-foreground/35',
        className,
      )}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="font-serif text-2xl leading-tight">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={requestClose} disabled={busy}>
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Discard your changes?"
        description="What you have entered or generated in this panel hasn't been saved."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setConfirming(false);
          onClose();
        }}
        onCancel={() => setConfirming(false)}
      />
    </dialog>
  );
}
