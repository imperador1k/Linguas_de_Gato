import { formatTimestamp, type SpeakingAttempt } from '@ldg/shared';
import { ArrowRight, AudioLines, CircleCheck, CircleDot, RotateCcw, Trash } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { CATEGORY_LABELS, findLibraryPrompt } from './prompt-library';

const dateFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

/**
 * Every recorded attempt, newest first, grouped by month. Each row opens the
 * attempt (transcript, feedback, exercises and the recording if it was kept).
 */
export function HistoryView({ attempts, persistent, onBrowseTopics, onDelete }: { attempts: readonly SpeakingAttempt[]; persistent: boolean; onBrowseTopics: () => void; onDelete: (attempt: SpeakingAttempt) => void }) {
  if (attempts.length === 0) {
    return (
      <EmptyState
        title="No attempts yet."
        action={
          <Button size="sm" variant="secondary" onClick={onBrowseTopics}>
            Choose a topic
          </Button>
        }
      >
        Record an answer to any topic. Each attempt keeps its transcript, its feedback and, if you choose to, the recording.
      </EmptyState>
    );
  }

  const groups: Array<{ month: string; attempts: SpeakingAttempt[] }> = [];
  for (const attempt of attempts) {
    const month = monthFormatter.format(attempt.createdAt);
    const group = groups.at(-1);
    if (group && group.month === month) group.attempts.push(attempt);
    else groups.push({ month, attempts: [attempt] });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {attempts.length} attempt{attempts.length === 1 ? '' : 's'}, {persistent ? 'saved in this browser' : 'kept until you close this tab'}. Open one to see its transcript, feedback and exercises.
      </p>
      {groups.map((group) => (
        <section key={group.month} aria-label={group.month}>
          <h2 className="mb-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">{group.month}</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {group.attempts.map((attempt) => {
              // Only offered when the library still has this prompt (ids come from stored records).
              const libraryId = attempt.prompt.source === 'library' && attempt.prompt.promptId && findLibraryPrompt(attempt.prompt.promptId) ? attempt.prompt.promptId : null;
              return (
                <li key={attempt.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
                  <Link to={`/speaking/attempts/${attempt.id}`} className="group min-w-0 flex-1 rounded-md">
                    <span className="flex items-center gap-2">
                      <span className="font-medium leading-snug group-hover:underline">{attempt.prompt.title}</span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                      <span>{dateFormatter.format(attempt.createdAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatTimestamp(attempt.recordingDurationMs / 1000)} spoken</span>
                      <span aria-hidden="true">·</span>
                      <span>{attempt.mode === 'guided' ? 'Guided' : 'Free'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{CATEGORY_LABELS[attempt.prompt.category]}</span>
                      {attempt.prompt.level ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{attempt.prompt.level}</span>
                        </>
                      ) : null}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {attempt.assessment ? (
                        <Badge variant="success">
                          <CircleCheck aria-hidden="true" />
                          Feedback ready
                        </Badge>
                      ) : (
                        <Badge variant="caution">
                          <CircleDot aria-hidden="true" />
                          Transcript only · feedback not requested
                        </Badge>
                      )}
                      {attempt.recording.stored ? (
                        <Badge variant="outline">
                          <AudioLines aria-hidden="true" />
                          Recording kept
                        </Badge>
                      ) : null}
                    </span>
                  </Link>
                  <div className="flex shrink-0 items-center gap-1">
                    {libraryId ? (
                      <Link to={`/speaking/practice/library/${libraryId}`} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                        <RotateCcw aria-hidden="true" />
                        Practise again
                      </Link>
                    ) : null}
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete attempt ${attempt.prompt.title}`} onClick={() => onDelete(attempt)}>
                      <Trash aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
