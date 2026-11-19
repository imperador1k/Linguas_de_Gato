import {
  MEDIA_ACCEPT_ATTRIBUTE,
  MAX_LOCAL_MEDIA_BYTES,
  SUPPORTED_MEDIA_LABEL,
  formatBytes,
  validateMediaFile,
  type AcceptedMediaFile,
} from '@ldg/shared';
import { Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/utils';

function hasFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function MediaDropzone({
  onAccept,
  prompt = 'Drag an audio or video file here',
}: {
  onAccept: (file: File, accepted: AcceptedMediaFile) => void;
  prompt?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const errorId = useId();

  // A file dropped just outside the zone would otherwise make the browser navigate away from the app.
  useEffect(() => {
    const preventNavigation = (event: globalThis.DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    window.addEventListener('dragover', preventNavigation);
    window.addEventListener('drop', preventNavigation);
    return () => {
      window.removeEventListener('dragover', preventNavigation);
      window.removeEventListener('drop', preventNavigation);
    };
  }, []);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setError('Drop one file at a time.');
      return;
    }
    const file = files[0];
    if (!file) return;

    const result = validateMediaFile(file);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    onAccept(file, result.value);
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  }

  return (
    <div>
      <div
        onDragEnter={onDragEnter}
        onDragOver={(event) => hasFiles(event) && event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors duration-150 sm:py-16',
          dragging ? 'border-brand bg-brand-subtle' : error ? 'border-destructive/60' : 'border-border-strong',
        )}
      >
        <span
          className={cn(
            'mb-5 inline-flex size-12 items-center justify-center rounded-full transition-colors duration-150',
            dragging ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          <Upload aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </span>
        <p className="font-medium">{dragging ? 'Drop to open' : prompt}</p>
        <p id={hintId} className="mt-1.5 text-sm text-muted-foreground">
          {SUPPORTED_MEDIA_LABEL} · up to {formatBytes(MAX_LOCAL_MEDIA_BYTES)} · stays on this device
        </p>
        <Button
          variant="secondary"
          className="mt-6"
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          onClick={() => inputRef.current?.click()}
        >
          Choose a file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={MEDIA_ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      {error ? (
        <Notice id={errorId} tone="error" role="alert" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
