import { SUBTITLE_ACCEPT_ATTRIBUTE, formatTimestamp, type SubtitleCue } from '@ldg/shared';
import { Captions, Trash } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/utils';

export interface LoadedTranscript {
  readonly fileName: string;
  readonly cues: readonly SubtitleCue[];
  readonly skippedBlocks: number;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function TranscriptPanel({
  transcript,
  activeIndex,
  error,
  onImport,
  onClear,
  onSeek,
}: {
  transcript: LoadedTranscript | null;
  activeIndex: number;
  error: string | null;
  onImport: (file: File) => void;
  onClear: () => void;
  onSeek: (seconds: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [follow, setFollow] = useState(true);
  const followId = useId();
  const titleId = useId();

  useEffect(() => {
    const list = listRef.current;
    if (!follow || !list || activeIndex < 0) return;
    const item = list.children[activeIndex] as HTMLElement | undefined;
    if (!item) return;

    const outOfView = item.offsetTop < list.scrollTop || item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight;
    if (outOfView) {
      list.scrollTo({ top: item.offsetTop - list.clientHeight / 3, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }, [activeIndex, follow]);

  const importButton = (
    <>
      <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
        <Captions aria-hidden="true" />
        {transcript ? 'Replace' : 'Import SRT / VTT'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={SUBTITLE_ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImport(file);
          event.target.value = '';
        }}
      />
    </>
  );

  return (
    <Card aria-labelledby={titleId} className="flex flex-col">
      <CardHeader className="flex-row items-start justify-between gap-3 pb-4">
        <div>
          <CardTitle id={titleId}>Transcript</CardTitle>
          <CardDescription className="mt-1">
            {transcript ? `${transcript.cues.length} lines · ${transcript.fileName}` : 'Follow along line by line.'}
          </CardDescription>
        </div>
        {importButton}
      </CardHeader>

      {error ? (
        <div className="px-5 pb-4 sm:px-6">
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        </div>
      ) : null}

      {transcript ? (
        <>
          {transcript.skippedBlocks > 0 ? (
            <div className="px-5 pb-3 sm:px-6">
              <Notice>
                {transcript.skippedBlocks} malformed {transcript.skippedBlocks === 1 ? 'block was' : 'blocks were'} skipped.
              </Notice>
            </div>
          ) : null}
          <ol
            ref={listRef}
            aria-label="Transcript lines"
            className="relative max-h-[26rem] overflow-y-auto border-t px-2 py-2 sm:px-3 xl:max-h-[min(34rem,60vh)]"
          >
            {transcript.cues.map((cue, index) => {
              const active = index === activeIndex;
              return (
                <li key={cue.id}>
                  <button
                    type="button"
                    onClick={() => onSeek(cue.startMs / 1000)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'grid w-full grid-cols-[3.25rem_1fr] gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-150',
                      active ? 'bg-brand-subtle' : 'hover:bg-accent/70',
                    )}
                  >
                    <span
                      className={cn('pt-0.5 font-mono text-xs tabular-nums', active ? 'text-brand' : 'text-muted-foreground')}
                    >
                      {formatTimestamp(cue.startMs / 1000)}
                    </span>
                    <span className="font-serif text-[1.0625rem] leading-[1.6] whitespace-pre-line" lang="en">
                      {cue.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between gap-3 border-t px-5 py-3 sm:px-6">
            <div className="flex items-center gap-2">
              <input
                id={followId}
                type="checkbox"
                checked={follow}
                onChange={(event) => setFollow(event.target.checked)}
                className="size-4 accent-[var(--brand)]"
              />
              <label htmlFor={followId} className="text-sm text-muted-foreground">
                Follow playback
              </label>
            </div>
            <Button variant="ghost" size="sm" onClick={onClear}>
              <Trash aria-hidden="true" />
              Remove
            </Button>
          </div>
        </>
      ) : (
        <div className="border-t px-5 py-8 text-center sm:px-6">
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
            Import an SRT or WebVTT file for this recording. The current line is highlighted as you listen; select any line to
            jump to it.
          </p>
        </div>
      )}
    </Card>
  );
}
