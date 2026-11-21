import { CATEGORY_INFO, trainingOptionsFor, type LearningCategory, type TrainingOption, type TrainingSession } from '@ldg/shared';
import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { GRAMMAR_TOPIC_LABELS } from '@/features/grammar/grammar-labels';
import { STATUS_LABELS, formatDate } from '@/features/progress/format';
import type { DerivedLearning } from '@/features/progress/use-learning-engine';
import { cn } from '@/lib/utils';
import { practisePathIn } from './practise-links';

function optionLabel(option: TrainingOption): string {
  switch (option.module) {
    case 'grammar':
      return `Grammar · ${GRAMMAR_TOPIC_LABELS[option.topic]}`;
    case 'writing':
      return 'Writing task';
    case 'speaking':
      return 'Speaking task';
  }
}

function openPath(session: TrainingSession): string {
  return session.module === 'grammar' ? `/grammar/sets/${session.recordId}` : session.module === 'writing' ? `/writing/tasks/${session.recordId}` : `/speaking/practice/custom/${session.recordId}`;
}

/**
 * Targeted practice (M7.3): a launcher, not a form. Each weakness links to the
 * modules that can practise it; the module's own creation panel opens in
 * targeted mode, with the same settings, preview and validation as any other
 * exercise, and the same bounded profile (≤ 5 real examples, optional).
 */
export function TrainingSection({ derived, sessions, initialCategory }: { derived: DerivedLearning; sessions: readonly TrainingSession[]; initialCategory: string | null }) {
  const candidates = useMemo(() => derived.insights.filter((insight) => insight.errors > 0 && trainingOptionsFor(insight.category).length > 0), [derived.insights]);

  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Pick a weakness and where to practise it. The Grammar, Writing or Speaking creation panel opens with settings chosen for it. Only the area's name, a one-line description and, if you allow it, up to five of your own mistakes are sent; nothing else from your history leaves the browser.
      </p>

      {candidates.length === 0 ? (
        <EmptyState title="Nothing to target yet.">
          Targeted practice needs real mistakes in an area the exercise generators can practise (grammar, vocabulary, organisation, register or punctuation). Listening, reading and review practice is suggested under Recommendations instead.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Weaknesses you can practise">
          {candidates.map((insight) => {
            const info = CATEGORY_INFO[insight.category as LearningCategory];
            return (
              <li key={insight.category} className={cn('flex flex-col gap-3 rounded-lg border bg-card px-4 py-3.5', insight.category === initialCategory && 'border-border-strong')}>
                <div>
                  <p className="font-medium">
                    {info.label}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {insight.errors} mistake{insight.errors === 1 ? '' : 's'} · {STATUS_LABELS[insight.status].toLowerCase()}
                    </span>
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{insight.explanation}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {trainingOptionsFor(insight.category).map((option) => (
                    <Link
                      key={option.module}
                      to={practisePathIn(option.module, insight.category)}
                      // Long grammar areas must wrap on a phone rather than push the page sideways.
                      className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }), 'h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal')}
                    >
                      {optionLabel(option)}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {sessions.length > 0 ? (
        <section aria-labelledby="training-history">
          <h2 id="training-history" className="mb-3 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Targeted practice you generated
          </h2>
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {[...sessions]
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 20)
              .map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    {session.title}
                    <span className="text-muted-foreground">
                      {' '}
                      · {CATEGORY_INFO[session.category as LearningCategory]?.label ?? session.category} · {session.level} · {formatDate(session.createdAt)}
                    </span>
                  </span>
                  <Link to={openPath(session)} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
                    Open
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
