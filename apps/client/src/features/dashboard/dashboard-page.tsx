import { activityEvents, computeMetrics, dueEntries, rangeFor, type ActivityEvent, type LearningModule as ModuleId } from '@ldg/shared';
import { ArrowRight, BookOpenText, Headphones, Mic, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { MODULE_GROUP_LABELS, MODULE_GROUP_ORDER, MODULES } from '@/app/modules';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { useLearningEngine } from '@/features/progress/use-learning-engine';
import { useCapabilities } from '@/hooks/use-capabilities';
import { cn } from '@/lib/utils';

/*
 * Interim home (M7.1). It shows only what the saved records can support:
 * when each skill was last practised, this week's measured activity and
 * reviews that are due. The full "Today" page (next steps, continue where
 * you left off) is M7.2. Nothing here is estimated or invented.
 */

const DAY = 86_400_000;
const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

function formatToday(): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function whenLabel(at: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  return days < 7 ? relative.format(-days, 'day') : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(at));
}

interface ModuleActivity {
  readonly last: ActivityEvent | null;
  readonly lastWeek: number;
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

/** First run: three ways in, and a way to bring an existing history back. */
function FirstRun() {
  const starts = [
    { to: '/listening', icon: Headphones, label: 'Listen', text: 'Bring in a recording or a YouTube lesson and practise line by line.' },
    { to: '/reading', icon: BookOpenText, label: 'Read', text: 'Generate a text at your level or paste your own.' },
    { to: '/speaking', icon: Mic, label: 'Speak', text: 'Answer a question out loud and get feedback on your own words.' },
  ];
  return (
    <section aria-labelledby="start-heading">
      <SectionHeading id="start-heading">Start practising</SectionHeading>
      <EmptyState title="No practice is saved in this browser yet.">
        Everything you do is kept here, on this device. Choose a skill to begin, or restore a backup if you have practised elsewhere.
      </EmptyState>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {starts.map(({ to, icon: Icon, label, text }) => (
          <li key={to}>
            <Link to={to} className="group flex h-full flex-col gap-2 rounded-lg border bg-card p-4 transition-colors duration-150 hover:border-border-strong">
              <span className="flex items-center gap-2 font-medium">
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" strokeWidth={1.75} />
                {label}
                <ArrowRight aria-hidden="true" className="ml-auto size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">{text}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted-foreground">
        Have a backup?{' '}
        <Link to="/settings/data" className="underline underline-offset-4 hover:text-foreground">
          Restore it in Settings &amp; data
        </Link>
        .
      </p>
    </section>
  );
}

export function DashboardPage() {
  const { state, derived } = useLearningEngine();

  const summary = useMemo(() => {
    if (state.phase !== 'ready' || !derived) return null;
    const { snapshot } = state.data;
    const now = derived.now;
    const events = activityEvents(snapshot);
    const weekFrom = now - 7 * DAY;
    const byModule = new Map<ModuleId, ModuleActivity>();
    for (const event of events) {
      const current = byModule.get(event.module) ?? { last: null, lastWeek: 0 };
      byModule.set(event.module, { last: !current.last || event.at > current.last.at ? event : current.last, lastWeek: current.lastWeek + (event.at >= weekFrom ? 1 : 0) });
    }
    return {
      now,
      total: events.length,
      byModule,
      week: computeMetrics(snapshot, rangeFor('7d', now)),
      due: dueEntries([...snapshot.vocabularyEntries], now).length,
    };
  }, [state, derived]);

  return (
    <>
      <PageHeader
        eyebrow={formatToday()}
        title="Deliberate practice, one skill at a time."
        description="Pick up where you left off or start something new. Everything on this page comes from the practice saved in this browser."
      />
      <ServerNotice />

      {state.phase === 'loading' ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading your practice history…
        </p>
      ) : state.phase === 'memory' ? (
        <Notice tone="error">This browser isn't letting the app save data, so there is no history to show. Practice in this tab is kept only until it closes.</Notice>
      ) : state.phase === 'error' ? (
        <Notice tone="error">{state.message}</Notice>
      ) : summary && summary.total === 0 ? (
        <FirstRun />
      ) : summary ? (
        <div className="flex flex-col gap-12">
          {summary.due > 0 ? (
            <div className="flex flex-col items-start justify-between gap-4 rounded-lg border bg-card px-5 py-4 sm:flex-row sm:items-center">
              <p>
                <span className="font-medium">
                  {summary.due} expression{summary.due === 1 ? ' is' : 's are'} due for review.
                </span>{' '}
                <span className="text-muted-foreground">Recall each meaning from its sentence before revealing it.</span>
              </p>
              <Link to="/vocabulary/review" className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}>
                <RotateCcw aria-hidden="true" />
                Review now
              </Link>
            </div>
          ) : null}

          <section aria-labelledby="week-heading">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <SectionHeading id="week-heading" className="mb-0">
                Last 7 days
              </SectionHeading>
              <Link to="/progress" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                See Progress
              </Link>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
              <div className="rounded-lg border bg-card px-4 py-3.5">
                <dt className="text-sm text-muted-foreground">Active study days</dt>
                <dd className="mt-1 text-2xl font-medium tabular-nums">
                  {summary.week.activeDays}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">of 7</span>
                </dd>
              </div>
              <div className="rounded-lg border bg-card px-4 py-3.5">
                <dt className="text-sm text-muted-foreground">Completed exercises</dt>
                <dd className="mt-1 text-2xl font-medium tabular-nums">{summary.week.completedExercises}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Counted from your saved records; the definitions are on the Progress page.</p>
          </section>

          <section aria-labelledby="recent-heading">
            <SectionHeading id="recent-heading">Recent practice</SectionHeading>
            {MODULE_GROUP_ORDER.filter((group) => group !== 'progress').map((group) => (
              <div key={group} className="mb-6 last:mb-0">
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">{MODULE_GROUP_LABELS[group]}</h3>
                <ul className="divide-y rounded-lg border bg-card">
                  {MODULES.filter((learningModule) => learningModule.group === group).map((learningModule) => {
                    const activity = summary.byModule.get(learningModule.id as ModuleId);
                    const Icon = learningModule.icon;
                    return (
                      <li key={learningModule.id}>
                        <Link to={learningModule.path} className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-accent/40">
                          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                          <span className="w-24 shrink-0 font-medium">{learningModule.label}</span>
                          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                            {activity?.last ? `${activity.last.label} · ${whenLabel(activity.last.at, summary.now)}` : 'Not practised yet'}
                          </span>
                          {activity && activity.lastWeek > 0 ? (
                            <span className="hidden shrink-0 text-sm text-muted-foreground tabular-nums sm:inline">{activity.lastWeek} this week</span>
                          ) : null}
                          <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        </div>
      ) : null}
    </>
  );
}
