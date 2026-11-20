import { summarizeListeningResults, type ListeningExerciseSet } from '@ldg/shared';
import { EyeOff, Plus, Trash } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { dateFormatter } from './exercise-labels';

function describeProgress(set: ListeningExerciseSet): string {
  const summary = summarizeListeningResults(set);
  if (set.submittedAt !== null) return `Checked · ${summary.correct}/${summary.total} correct`;
  if (summary.answered > 0) return `In progress · ${summary.answered}/${summary.total} answered`;
  return `Not started · ${summary.total} questions`;
}

/** Sidebar in comprehension mode: saved sets, with the transcript deliberately out of view. */
export function ExerciseSetList({
  sets,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  sets: readonly ListeningExerciseSet[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<ListeningExerciseSet | null>(null);
  const titleId = useId();

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle id={titleId}>Exercise sets</CardTitle>
          <CardDescription className="mt-1 flex items-center gap-1.5">
            <EyeOff aria-hidden="true" className="size-3.5" />
            Transcript hidden in this mode
          </CardDescription>
        </div>
        <Button variant="secondary" size="sm" onClick={onNew} aria-pressed={activeId === null}>
          <Plus aria-hidden="true" />
          New set
        </Button>
      </CardHeader>
      <CardContent className="pt-1">
        {sets.length === 0 ? (
          <p className="text-sm text-muted-foreground">Generated sets and your answers are saved here.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {sets.map((set) => (
              <li key={set.id} className={cn('flex items-center gap-2 px-2 py-1.5', set.id === activeId && 'bg-accent/50')}>
                <button
                  type="button"
                  aria-current={set.id === activeId ? 'true' : undefined}
                  onClick={() => onSelect(set.id)}
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="block text-sm font-medium">
                    {set.level} · {dateFormatter.format(set.createdAt)}
                  </span>
                  <span className="block text-xs text-muted-foreground">{describeProgress(set)}</span>
                </button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete exercise set from ${dateFormatter.format(set.createdAt)}`} onClick={() => setPendingDelete(set)}>
                  <Trash aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this exercise set?"
        description="Its questions and your answers will be removed from this browser."
        confirmLabel="Delete set"
        destructive
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </Card>
  );
}
