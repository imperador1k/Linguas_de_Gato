import { LayoutGrid, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { MODULE_GROUP_LABELS, MODULES, type ModuleGroup } from '@/app/modules';
import { cn } from '@/lib/utils';

const GROUP_ORDER: readonly ModuleGroup[] = ['practice', 'foundations', 'review'];

function NavItem({
  to,
  icon: Icon,
  label,
  planned,
  end,
  onNavigate,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  planned?: boolean;
  end?: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <NavLink
      to={to}
      end={end ?? false}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors duration-150',
          isActive
            ? 'bg-accent font-medium text-foreground before:absolute before:inset-y-2 before:-left-px before:w-0.5 before:rounded-full before:bg-brand'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        )
      }
    >
      <Icon aria-hidden="true" className="size-[1.125rem] shrink-0" strokeWidth={1.75} />
      <span className="flex-1 truncate">{label}</span>
      {planned ? <span className="text-[0.6875rem] font-normal text-muted-foreground">Planned</span> : null}
    </NavLink>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      <NavItem to="/" end icon={LayoutGrid} label="Overview" onNavigate={onNavigate} />

      {GROUP_ORDER.map((group) => {
        const headingId = `nav-group-${group}`;
        return (
          <div key={group} className="flex flex-col gap-1">
            <h2 id={headingId} className="px-3 pb-1 text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {MODULE_GROUP_LABELS[group]}
            </h2>
            <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
              {MODULES.filter((learningModule) => learningModule.group === group).map((learningModule) => (
                <li key={learningModule.id}>
                  <NavItem
                    to={learningModule.path}
                    icon={learningModule.icon}
                    label={learningModule.label}
                    planned={learningModule.status === 'planned'}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
