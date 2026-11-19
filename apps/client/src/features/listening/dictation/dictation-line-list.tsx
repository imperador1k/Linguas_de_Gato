import { formatAccuracy, formatTimestamp, type DictationSummary, type LineProgress, type SubtitleCue } from '@ldg/shared';
import { useEffect, useId, useRef } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Line picker for dictation. Shows timing and progress only; the text stays hidden. */
export function DictationLineList({
  cues,
  progress,
  summary,
  selectedIndex,
  onSelect,
}: {
  cues: readonly SubtitleCue[];
  progress: ReadonlyMap<string, LineProgress>;
  summary: DictationSummary;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const titleId = useId();

  useEffect(() => {
    const list = listRef.current;
    const item = list?.children[selectedIndex] as HTMLElement | undefined;
    if (!list || !item) return;
    const outOfView = item.offsetTop < list.scrollTop || item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight;
    if (outOfView) list.scrollTo({ top: item.offsetTop - list.clientHeight / 3 });
  }, [selectedIndex]);

  return (
    <Card aria-labelledby={titleId} className="flex flex-col">
      <CardHeader className="pb-4">
        <CardTitle id={titleId}>Lines</CardTitle>
        <CardDescription>
          {summary.practisedLines} of {summary.totalLines} practised
          {summary.averageLatestAccuracy !== null ? ` · average ${formatAccuracy(summary.averageLatestAccuracy)}` : ''}
        </CardDescription>
      </CardHeader>
      <ol
        ref={listRef}
        aria-label="Dictation lines"
        className="relative max-h-[26rem] overflow-y-auto border-t px-2 py-2 sm:px-3 xl:max-h-[min(34rem,60vh)]"
      >
        {cues.map((cue, index) => {
          const selected = index === selectedIndex;
          const line = progress.get(cue.id);
          return (
            <li key={cue.id}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors duration-150',
                  selected ? 'bg-brand-subtle' : 'hover:bg-accent/70',
                )}
              >
                <span className="flex items-baseline gap-3">
                  <span className={cn('font-medium', selected && 'text-foreground')}>Line {index + 1}</span>
                  <span className={cn('font-mono text-xs tabular-nums', selected ? 'text-brand' : 'text-muted-foreground')}>
                    {formatTimestamp(cue.startMs / 1000)}
                  </span>
                </span>
                {line ? (
                  <span className="font-mono text-xs tabular-nums">
                    <span className="sr-only">latest accuracy </span>
                    {formatAccuracy(line.latestAccuracy)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Not tried</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
