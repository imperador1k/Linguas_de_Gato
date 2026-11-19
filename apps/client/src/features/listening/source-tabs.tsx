import type { LucideIcon } from 'lucide-react';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SourceTab<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly content: ReactNode;
}

/** WAI-ARIA tabs with automatic activation and arrow/Home/End navigation. */
export function SourceTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<SourceTab<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.value === value);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;

    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.value);
    tabRefs.current[next]?.focus();
  }

  return (
    <div>
      {/* Scrolls rather than clipping if the labels ever outgrow a narrow screen. */}
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-0.5 overflow-x-auto border-b sm:gap-1">
        {tabs.map((tab, index) => {
          const selected = tab.value === value;
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`${baseId}-tab-${tab.value}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.value)}
              className={cn(
                'relative inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors duration-150 sm:gap-2 sm:px-3',
                selected
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.value}
          id={`${baseId}-panel-${tab.value}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.value}`}
          hidden={tab.value !== value}
          className="pt-6"
        >
          {tab.value === value ? tab.content : null}
        </div>
      ))}
    </div>
  );
}
