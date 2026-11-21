import { Database, Info, Palette, ShieldCheck, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router';
import { isSettingsSection, type SettingsSection } from '@/app/legacy-routes';
import { PageHeader } from '@/components/layout/page-header';
import { DataSection } from '@/features/data-management/data-section';
import { cn } from '@/lib/utils';
import { AboutSettings, AppearanceSettings, LearningSettings, PrivacySettings } from './settings-sections';

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string; icon: LucideIcon; description: string }> = [
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Colour theme.' },
  { id: 'learning', label: 'Learning preferences', icon: SlidersHorizontal, description: 'Transcription, reading view and explanations.' },
  { id: 'privacy', label: 'Privacy & AI', icon: ShieldCheck, description: 'What stays on this device and what is sent, and when.' },
  { id: 'data', label: 'Data & backups', icon: Database, description: 'Everything saved in this browser; export a backup or import one.' },
  { id: 'about', label: 'About', icon: Info, description: 'Server status, versions and browser storage.' },
];

/**
 * Settings & data: the one place for preferences, privacy information and
 * personal data. Section pages are routes (`/settings/data`), so they can be
 * linked to from anywhere in the app.
 */
export function SettingsPage() {
  const { section: param } = useParams();
  if (param !== undefined && !isSettingsSection(param)) return <Navigate to="/settings" replace />;
  const section: SettingsSection = param ?? 'appearance';
  const current = SECTIONS.find((candidate) => candidate.id === section)!;

  return (
    <>
      <PageHeader eyebrow="Settings & data" title={current.label} description={current.description} />
      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* min-w-0: as a grid item the strip would otherwise grow to its content and overflow narrow screens. */}
        <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <ul className="-mx-1 flex gap-0.5 overflow-x-auto border-b px-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:border-b-0 lg:px-0">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id} className="shrink-0">
                <Link
                  to={id === 'appearance' ? '/settings' : `/settings/${id}`}
                  // A plain Link: `/settings` and `/settings/appearance` are the same page, so "current" is computed here.
                  aria-current={id === section ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-11 items-center gap-2 text-sm whitespace-nowrap transition-colors duration-150 lg:flex lg:h-10 lg:rounded-md lg:px-3',
                    '-mb-px border-b-2 px-2.5 lg:mb-0 lg:border-b-0',
                    id === section
                      ? 'border-foreground font-medium text-foreground lg:bg-accent'
                      : 'border-transparent text-muted-foreground hover:text-foreground lg:hover:bg-accent/60',
                  )}
                >
                  <Icon aria-hidden="true" className="hidden size-4 lg:block" strokeWidth={1.75} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          {section === 'appearance' ? <AppearanceSettings /> : null}
          {section === 'learning' ? <LearningSettings /> : null}
          {section === 'privacy' ? <PrivacySettings /> : null}
          {section === 'data' ? <DataSection onChanged={() => undefined} /> : null}
          {section === 'about' ? <AboutSettings /> : null}
        </div>
      </div>
    </>
  );
}
