import type { RangePreset } from '@ldg/shared';
import { useState } from 'react';
import { Navigate, NavLink, useLocation, useParams, useSearchParams } from 'react-router';
import { isProgressSection, legacyProgressTarget, type ProgressSection } from '@/app/legacy-routes';
import { PageHeader } from '@/components/layout/page-header';
import { Notice } from '@/components/ui/notice';
import { RecurringErrorsSection, SkillsSection } from '@/features/learning-insights/insight-sections';
import { RecommendationsSection } from '@/features/learning-insights/recommendations-section';
import { TrainingSection } from '@/features/personalized-training/training-section';
import { cn } from '@/lib/utils';
import { OverviewSection } from './overview-section';
import { useLearningEngine } from './use-learning-engine';

/** Overview, Skills and Mistakes are in the main navigation; the other two are reached from here and from recommendations. */
const SECTIONS: ReadonlyArray<{ id: ProgressSection; label: string; path: string }> = [
  { id: 'overview', label: 'Overview', path: '/progress' },
  { id: 'skills', label: 'Skills', path: '/progress/skills' },
  { id: 'mistakes', label: 'Mistakes', path: '/progress/mistakes' },
  { id: 'recommendations', label: 'Recommendations', path: '/progress/recommendations' },
  { id: 'training', label: 'Targeted practice', path: '/progress/training' },
];

/**
 * The Personal Learning area. Every figure is derived on demand from the
 * records in this browser; the only server call is the optional, explicit
 * generation of targeted practice. Data management lives in Settings & data.
 */
export function ProgressPage() {
  const { section: param } = useParams();
  const { search } = useLocation();
  const [params] = useSearchParams();
  const [preset, setPreset] = useState<RangePreset>('30d');
  const engine = useLearningEngine();
  const { state, derived, storage } = engine;

  // Links from before M7.1 (`/progress?section=errors`, `?section=data`) keep working.
  const legacy = legacyProgressTarget(search);
  if (legacy) return <Navigate to={legacy} replace />;
  if (param !== undefined && !isProgressSection(param)) return <Navigate to="/progress" replace />;
  const section: ProgressSection = param ?? 'overview';
  const activeLabel = SECTIONS.find((candidate) => candidate.id === section)?.label ?? '';

  let body: React.ReactNode;
  if (state.phase === 'loading' || !storage) {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        Reading your practice history…
      </p>
    );
  } else if (state.phase === 'memory') {
    body = <Notice tone="error">This browser isn't letting the app save data, so there is no history to analyse. Practice in this tab is kept only until it closes.</Notice>;
  } else if (state.phase === 'error') {
    body = <Notice tone="error">{state.message}</Notice>;
  } else if (derived) {
    switch (section) {
      case 'overview':
        body = <OverviewSection snapshot={state.data.snapshot} now={derived.now} preset={preset} onPreset={setPreset} />;
        break;
      case 'skills':
        body = <SkillsSection derived={derived} />;
        break;
      case 'mistakes':
        body = <RecurringErrorsSection derived={derived} />;
        break;
      case 'recommendations':
        body = <RecommendationsSection derived={derived} repository={storage.repository} onChanged={engine.reload} />;
        break;
      case 'training':
        body = <TrainingSection key={params.get('category') ?? ''} derived={derived} repository={storage.repository} sessions={state.data.trainingSessions} initialCategory={params.get('category')} onCreated={engine.reload} />;
        break;
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Your progress" title={section === 'overview' ? 'Progress' : activeLabel} description="What you have practised and which mistakes keep coming back, with the evidence behind every figure. No points, no streaks, no invented scores." />
      <nav aria-label="Progress sections" className="mb-8">
        <ul className="-mx-1 flex gap-0.5 overflow-x-auto border-b px-1 sm:gap-1">
          {SECTIONS.map((candidate) => (
            <li key={candidate.id} className="shrink-0">
              <NavLink
                to={candidate.path}
                end
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-flex h-11 items-center border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors duration-150 sm:px-3',
                    isActive ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {candidate.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {state.phase === 'ready' && state.data.unreadable > 0 ? (
        <Notice className="mb-6">{state.data.unreadable} saved record(s) could not be read (outdated or damaged) and are left out of these figures. They are kept as they are.</Notice>
      ) : null}
      <section aria-label={activeLabel}>{body}</section>
    </div>
  );
}
