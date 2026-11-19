import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * Modal dialog on the native <dialog> element: the browser provides focus
 * containment, Escape to close, inertness of the page behind and top-layer
 * stacking, so no dialog library is needed.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  onSubmit,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  /** When set, the body is a form and Enter submits it. */
  onSubmit?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const body = (
    <>
      <div className="px-6 pt-6">
        <h2 id={titleId} className="font-serif text-2xl leading-tight">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="px-6 pt-5">{children}</div> : null}
      <div className="mt-6 flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>
    </>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Escape fires `cancel`; keep React state as the source of truth.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Keys typed in a dialog must not reach page-level shortcuts behind it.
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        // A click on the backdrop targets the <dialog> element itself.
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] max-w-md rounded-xl border bg-card p-0 text-card-foreground shadow-2xl',
        'backdrop:bg-foreground/35',
        className,
      )}
    >
      {onSubmit ? (
        <form
          method="dialog"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {body}
        </form>
      ) : (
        body
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
