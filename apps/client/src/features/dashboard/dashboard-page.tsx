import { computeMetrics, dueEntries, rangeFor, todayWork, type LearningModule as ModuleId, type Recommendation, type WorkItem, type WorkStatus } from '@ldg/shared';
import { ArrowRight, CircleCheck, RotateCcw } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { MODULES } from '@/app/modules';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { MediaStateBadge } from '@/components/ui/media-state-badge';
import { recallSessionMedia } from '@/features/listening/storage/session-media-cache';
import { practisePath } from '@/features/personalized-training/targeted-practice';
import { useLearningEngine } from '@/features/progress/use-learning-engine';
import { useCapabilities } from '@/hooks/use-capabilities';
import { cn } from '@/lib/utils';

/*
 * Today: what to continue, what to review, what to practise next and how the
 * last week went. Every line comes from saved records or the deterministic
 * M6 engine; nothing is estimated, and missing data is said plainly.
 */

const DAY = 86_400_000;
const LEARNING_MODULES = MODULES.filter((learningModule) => learningModule.group !== 'progress');
const MODULE_BY_ID = new Map(MODULES.map((learningModule) => [learningModule.id, learningModule]));

const STATUS: Record<WorkStatus, { label: string; variant: 'outline' | 'neutral' | 'caution' | 'success' }> = {
  in_progress: { label: 'In progress', variant: 'outline' },
  not_started: { label: 'Not started', variant: 'neutral' },
  awaiting_feedback: { label: 'Feedback missing', variant: 'caution' },
  completed: { label: 'Completed', variant: 'success' },
};

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function daysAgo(at: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(at)) / DAY);
}

function whenLabel(at: number, now: number): string {
  const days = daysAgo(at, now);
  if (days === 0) return `today, ${timeFormat.format(at)}`;
  if (days < 7) return relative.format(-days, 'day');
  return dateFormat.format(at);
}

function dayHeading(at: number, now: number): string {
  const days = daysAgo(at, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }).format(at);
}

function greeting(now: number): string {
  const hour = new Date(now).getHours();
  return hour < 5 ? 'Good evening.' : hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';
}

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

function ModuleIcon({ module, className }: { module: ModuleId; className?: string }) {
  const learningModule = MODULE_BY_ID.get(module);
  if (!learningModule) return null;
  const Icon = learningModule.icon;
  return <Icon aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground', className)} strokeWidth={1.75} />;
}

function ServerNotice() {
  const capabilities = useCapabilities();
  if (capabilities.status !== 'error') return null;
  return (
    <Notice tone="error" className="mb-8">
      The local server isn't reachable, so transcription, feedback and generation are unavailable. Your saved practice is still here. Start it with <code className="font-mono text-[0.8125rem]">npm run dev</code>, then{' '}
      <button type="button" className="underline underline-offset-4" onClick={capabilities.retry}>
        try again
      </button>
      .
    </Notice>
  );
}

/** A unit of the learner's work as a single link: module, title, what state it is in and when. */
function WorkRow({ item, now, emphasis = false }: { item: WorkItem; now: number; emphasis?: boolean }) {
  const status = STATUS[item.status];
  const moduleLabel = MODULE_BY_ID.get(item.module)?.label ?? item.module;
  // Only problems are worth a badge here: the audio needs the file, or is open but not saved.
  const media = item.media === 'needs-file' && item.sessionId ? (recallSessionMedia(item.sessionId) ? 'this-visit' : 'needs-file') : null;
  return (
    <Link to={item.path} className="group flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-accent/40">
      <ModuleIcon module={item.module} className="mt-1" />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate', emphasis ? 'font-serif text-[1.0625rem]' : 'text-sm font-medium')}>{item.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{moduleLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{item.detail}</span>
          <span aria-hidden="true">·</span>
          <span>{whenLabel(item.at, now)}</span>
          {media ? <MediaStateBadge state={media} /> : null}
        </span>
      </span>
      <Badge variant={status.variant} className="mt-0.5 hidden sm:inline-flex">
        {status.label}
      </Badge>
      <ArrowRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
      {/* Small screens hide the badge; screen readers still hear the status there (and only once on wider screens). */}
      <span className="sr-only sm:hidden">{status.label}</span>
    </Link>
  );
}

function ContinueSection({ items, now }: { items: readonly WorkItem[]; now: number }) {
  return (
    <section aria-labelledby="today-continue">
      <SectionHeading id="today-continue">Continue learning</SectionHeading>
      {items.length > 0 ? (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((item) => (
            <li key={item.id}>
              <WorkRow item={item} now={now} emphasis />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing is waiting to be finished.">Drafts, partly answered exercises, texts you are reading and recordings without feedback appear here.</EmptyState>
      )}
    </section>
  );
}

function RecommendedSection({ recommendations }: { recommendations: readonly Recommendation[] }) {
  return (
    <section aria-labelledby="today-recommended">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <SectionHeading id="today-recommended" className="mb-0">
          Recommended next
        </SectionHeading>
        <Link to="/progress/recommendations" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          All recommendations
        </Link>
      </div>
      {recommendations.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {recommendations.map((recommendation) => {
            const action = recommendation.action;
            const to = action.type === 'train' ? (practisePath(action.category) ?? `/progress/training?category=${action.category}`) : action.path;
            const label = action.type === 'train' ? 'Practise this' : action.label;
            return (
              <li key={recommendation.id} className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {recommendation.title}
                    {recommendation.preliminary ? <Badge variant="outline">Preliminary</Badge> : null}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{recommendation.nextStep}</p>
                </div>
                <Link to={to} className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }), 'shrink-0 self-start sm:self-center')}>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No recommendations yet.">They appear once your feedback, checked exercises or dictation show a mistake that repeats.</EmptyState>
      )}
    </section>
  );
}

function ReviewsSection({ due, nextDueAt, total, now }: { due: ReadonlyArray<{ id: string; expression: string }>; nextDueAt: number | null; total: number; now: number }) {
  return (
    <section aria-labelledby="today-reviews">
      <SectionHeading id="today-reviews">Vocabulary reviews</SectionHeading>
      <div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-4">
        {due.length > 0 ? (
          <>
            <p>
              <span className="text-2xl font-medium tabular-nums">{due.length}</span>{' '}
              <span className="text-sm text-muted-foreground">{due.length === 1 ? 'expression is due' : 'expressions are due'}</span>
            </p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Due expressions">
              {due.slice(0, 5).map((entry) => (
                <li key={entry.id} className="rounded-md bg-muted px-2 py-0.5 font-serif text-[0.9375rem]">
                  {entry.expression}
                </li>
              ))}
              {due.length > 5 ? <li className="px-1 py-0.5 text-sm text-muted-foreground">+{due.length - 5} more</li> : null}
            </ul>
            <Link to="/vocabulary/review" className={cn(buttonVariants({ size: 'sm' }), 'self-start')}>
              <RotateCcw aria-hidden="true" />
              Review now
            </Link>
          </>
        ) : total > 0 ? (
          <p className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
            <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              Nothing is due.
              {nextDueAt !== null ? ` The next review is ${daysAgo(nextDueAt, now) >= 0 ? 'today' : relative.format(-daysAgo(nextDueAt, now), 'day')}.` : ''}
            </span>
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            No saved expressions yet. Look up words while{' '}
            <Link to="/reading" className="underline underline-offset-4 hover:text-foreground">
              reading
            </Link>{' '}
            and save them to review them here.
          </p>
        )}
      </div>
    </section>
  );
}

/** Recent activity starts short; the rest is one click away rather than a long scroll on a phone. */
const RECENT_PREVIEW = 4;

function RecentSection({ items, now, week }: { items: readonly WorkItem[]; now: number; week: { activeDays: number; completedExercises: number } }) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const shown = showAll ? items : items.slice(0, RECENT_PREVIEW);
  const groups: Array<{ heading: string; items: WorkItem[] }> = [];
  for (const item of shown) {
    const heading = dayHeading(item.at, now);
    const group = groups.at(-1);
    if (group && group.heading === heading) group.items.push(item);
    else groups.push({ heading, items: [item] });
  }
  return (
    <section aria-labelledby="today-recent">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <SectionHeading id="today-recent" className="mb-0">
          Recent activity
        </SectionHeading>
        <p className="text-sm text-muted-foreground">
          {/* Active days are already in the page description, so only the exercise count is repeated here. */}
          Last 7 days: {plural(week.completedExercises, 'completed exercise')} ·{' '}
          <Link to="/progress" className="underline-offset-4 hover:text-foreground hover:underline">
            Progress
          </Link>
        </p>
      </div>
      {groups.length > 0 ? (
        <div className="flex flex-col gap-4">
          <div id={listId} className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.heading}>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">{group.heading}</h3>
                <ul className="divide-y rounded-lg border bg-card">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <WorkRow item={item} now={now} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {items.length > RECENT_PREVIEW ? (
            <Button variant="ghost" size="sm" className="self-start" aria-expanded={showAll} aria-controls={listId} onClick={() => setShowAll((current) => !current)}>
              {showAll ? 'Show less' : `Show all (${items.length})`}
            </Button>
          ) : null}
        </div>
      ) : (
        <EmptyState title="No other activity yet.">Completed recordings, essays, checked exercises, finished texts and reviews appear here with the time you did them.</EmptyState>
      )}
    </section>
  );
}

/** Compact shortcuts: one small link per learning module, not another card grid. */
function QuickStart({ heading = 'Quick start' }: { heading?: string }) {
  return (
    <section aria-labelledby="today-quick">
      <SectionHeading id="today-quick">{heading}</SectionHeading>
      <ul className="grid grid-cols-2 gap-2">
        {LEARNING_MODULES.map((learningModule) => {
          const Icon = learningModule.icon;
          return (
            <li key={learningModule.id}>
              <Link to={learningModule.path} className="flex h-11 items-center gap-2.5 rounded-md border bg-card px-3 text-sm transition-colors duration-150 hover:border-border-strong hover:bg-accent/40">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                {learningModule.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** First use: what this page will show, every module in one line each, and a way to restore a backup. */
function FirstRun() {
  return (
    <div className="flex flex-col gap-8">
      <EmptyState title="No practice is saved in this browser yet.">
        Once you practise, this page shows what to continue, what to review and what to work on next, all from your own work. Everything stays on this device.
      </EmptyState>
      <section aria-labelledby="first-run-modules">
        <SectionHeading id="first-run-modules">Where to start</SectionHeading>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LEARNING_MODULES.map((learningModule) => {
            const Icon = learningModule.icon;
            return (
              <li key={learningModule.id}>
                <Link to={learningModule.path} className="group flex h-full flex-col gap-1.5 rounded-lg border bg-card p-4 transition-colors duration-150 hover:border-border-strong">
                  <span className="flex items-center gap-2 font-medium">
                    <Icon aria-hidden="true" className="size-4 text-muted-foreground" strokeWidth={1.75} />
                    {learningModule.label}
                    <ArrowRight aria-hidden="true" className="ml-auto size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{learningModule.summary}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <p className="text-sm text-muted-foreground">
        Practised elsewhere?{' '}
        <Link to="/settings/data" className="underline underline-offset-4 hover:text-foreground">
          Restore a backup in Settings &amp; data
        </Link>
        .
      </p>
    </div>
  );
}

function formatToday(now: number): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(now));
}

export function DashboardPage() {
  const { state, derived } = useLearningEngine();

  const today = useMemo(() => {
    if (state.phase !== 'ready' || !derived) return null;
    const { snapshot, writingDrafts, writingTasks } = state.data;
    const now = derived.now;
    const work = todayWork({ ...snapshot, writingDrafts, writingTasks }, now);
    const due = dueEntries([...snapshot.vocabularyEntries], now);
    const upcoming = snapshot.vocabularyEntries.map((entry) => entry.review.dueAt).filter((at) => at > now);
    return {
      now,
      work,
      week: computeMetrics(snapshot, rangeFor('7d', now)),
      // Due reviews have their own section, so they are not repeated as a recommendation.
      recommendations: derived.recommendations.active
        .filter((recommendation) => recommendation.category !== null && !(recommendation.action.type === 'open' && recommendation.action.path === '/vocabulary/review'))
        .slice(0, 3),
      due: due.map((entry) => ({ id: entry.id, expression: entry.expression })),
      nextDueAt: upcoming.length > 0 ? Math.min(...upcoming) : null,
      vocabularyTotal: snapshot.vocabularyEntries.length,
      empty: work.continueItems.length === 0 && work.activity.length === 0 && snapshot.vocabularyEntries.length === 0,
    };
  }, [state, derived]);

  const now = today?.now ?? Date.now();
  let description = 'What to continue, what to review and what to practise next, from the work saved in this browser.';
  if (today && !today.empty) {
    const parts = [
      today.due.length > 0 ? plural(today.due.length, 'review is due', 'reviews are due') : null,
      today.work.unfinishedCount > 0 ? plural(today.work.unfinishedCount, 'piece of work is unfinished', 'pieces of work are unfinished') : null,
      `you practised on ${today.week.activeDays} of the last 7 days`,
    ].filter(Boolean);
    const sentence = parts.join(', ');
    description = `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
  }

  return (
    <>
      <PageHeader eyebrow={formatToday(now)} title={greeting(now)} description={description} />
      <ServerNotice />

      {state.phase === 'loading' ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading your practice history…
        </p>
      ) : state.phase === 'memory' ? (
        <Notice tone="error">This browser isn't letting the app save data, so there is no history to show. Practice in this tab is kept only until it closes.</Notice>
      ) : state.phase === 'error' ? (
        <Notice tone="error">{state.message}</Notice>
      ) : today && today.empty ? (
        <FirstRun />
      ) : today ? (
        // Phones read top to bottom: continue, reviews, recommendations, a short activity list, then shortcuts
        // (the navigation drawer already lists every module, so they come last there).
        // On desktop the side column spans every row, so the main column's sections never wait for it.
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10">
          <div className="lg:col-start-1 lg:row-start-1">
            <ContinueSection items={today.work.continueItems} now={today.now} />
          </div>
          <div className="flex flex-col gap-10 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
            <ReviewsSection due={today.due} nextDueAt={today.nextDueAt} total={today.vocabularyTotal} now={today.now} />
            <div className="hidden lg:block">
              <QuickStart />
            </div>
          </div>
          <div className="lg:col-start-1 lg:row-start-2">
            <RecommendedSection recommendations={today.recommendations} />
          </div>
          <div className="lg:col-start-1 lg:row-start-3">
            <RecentSection items={today.work.activity} now={today.now} week={today.week} />
          </div>
          <div className="lg:hidden">
            <QuickStart />
          </div>
        </div>
      ) : null}
    </>
  );
}
