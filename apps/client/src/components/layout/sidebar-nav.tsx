import { House, Settings2, type LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { MODULE_GROUP_LABELS, MODULE_GROUP_ORDER, MODULES, PROGRESS_NAV, type ModuleGroup } from '@/app/modules';
import { cn } from '@/lib/utils';

/**
 * The app's navigation, rendered in three densities from one structure:
 * - `full`: desktop sidebar and mobile drawer (labels and group headings);
 * - `rail`: tablet icon rail (icons only, with an accessible name and a
 *   tooltip on hover and keyboard focus).
 * Groups follow docs/M7_INFORMATION_ARCHITECTURE.md: Today, Practise,
 * Language, Your progress; Settings & data is pinned separately.
 */

export type NavDensity = 'full' | 'rail';

interface ItemProps {
  readonly to: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly end?: boolean | undefined;
  readonly density: NavDensity;
  readonly onNavigate?: (() => void) | undefined;
  /** Indented under a parent (Progress sections). */
  readonly nested?: boolean;
  readonly alsoActive?: ((pathname: string) => boolean) | undefined;
}

export function NavItem({ to, icon: Icon, label, end, density, onNavigate, nested = false, alsoActive }: ItemProps) {
  const rail = density === 'rail';
  const { pathname } = useLocation();
  const related = alsoActive?.(pathname) ?? false;
  return (
    <NavLink
      to={to}
      end={end ?? false}
      onClick={onNavigate}
      aria-label={rail ? label : undefined}
      className={({ isActive: exact }) => {
        const isActive = exact || related;
        return cn(
          'group/nav relative flex items-center gap-3 rounded-md text-sm transition-colors duration-150',
          rail ? 'size-11 justify-center' : cn('h-10 px-3', nested && 'pl-9'),
          isActive
            ? cn('bg-accent font-medium text-foreground', !rail && 'before:absolute before:inset-y-2 before:-left-px before:w-0.5 before:rounded-full before:bg-brand')
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        );
      }}
    >
      <Icon aria-hidden="true" className={cn('shrink-0', nested && !rail ? 'size-4' : 'size-[1.125rem]')} strokeWidth={1.75} />
      {rail ? (
        // Visible on hover and on keyboard focus; the accessible name comes from aria-label.
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-full z-40 ml-3 -translate-y-1/2 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium whitespace-nowrap text-background opacity-0 shadow-sm transition-opacity duration-100 group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100"
        >
          {label}
        </span>
      ) : (
        <span className="flex-1 truncate">{label}</span>
      )}
    </NavLink>
  );
}

function GroupHeading({ id, group, density }: { id: string; group: ModuleGroup; density: NavDensity }) {
  if (density === 'rail') {
    return (
      <h2 id={id} className="sr-only">
        {MODULE_GROUP_LABELS[group]}
      </h2>
    );
  }
  return (
    <h2 id={id} className="px-3 pb-1 text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
      {MODULE_GROUP_LABELS[group]}
    </h2>
  );
}

export function SidebarNav({ density = 'full', onNavigate, idPrefix = 'nav' }: { density?: NavDensity; onNavigate?: () => void; idPrefix?: string }) {
  const rail = density === 'rail';
  return (
    <nav aria-label="Main" className={cn('flex flex-col', rail ? 'items-center gap-4' : 'gap-6')}>
      <NavItem to="/" end icon={House} label="Today" density={density} onNavigate={onNavigate} />

      {MODULE_GROUP_ORDER.map((group) => {
        const headingId = `${idPrefix}-group-${group}`;
        const items =
          group === 'progress'
            ? PROGRESS_NAV.map((item) => ({ key: item.path, to: item.path, icon: item.icon, label: item.label, end: item.end, alsoActive: item.alsoActive }))
            : MODULES.filter((learningModule) => learningModule.group === group).map((learningModule) => ({
                key: learningModule.id,
                to: learningModule.path,
                icon: learningModule.icon,
                label: learningModule.label,
                end: false,
                alsoActive: undefined,
              }));
        return (
          <div key={group} className={cn('flex flex-col', rail ? 'items-center gap-1 border-t pt-4' : 'gap-1')}>
            <GroupHeading id={headingId} group={group} density={density} />
            <ul aria-labelledby={headingId} className={cn('flex flex-col', rail ? 'items-center gap-1' : 'gap-0.5')}>
              {items.map((item) => (
                <li key={item.key}>
                  <NavItem to={item.to} icon={item.icon} label={item.label} end={item.end} alsoActive={item.alsoActive} density={density} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Pinned at the bottom of every navigation variant. */
export function SettingsNavItem({ density = 'full', onNavigate }: { density?: NavDensity; onNavigate?: () => void }) {
  return (
    <nav aria-label="Settings">
      <NavItem to="/settings" icon={Settings2} label="Settings & data" density={density} onNavigate={onNavigate} />
    </nav>
  );
}
