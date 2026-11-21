import type { LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
  readonly icon?: LucideIcon;
  /** Extra content after the label (e.g. a count badge). */
  readonly adornment?: ReactNode;
}

/** Ids that tie a tab to its panel; callers render the panel with `tabPanelProps`. */
export const tabId = (base: string, value: string) => `${base}-tab-${value}`;
export const panelId = (base: string, value: string) => `${base}-panel-${value}`;

export function tabPanelProps(base: string, value: string) {
  return { id: panelId(base, value), role: 'tabpanel' as const, 'aria-labelledby': tabId(base, value), tabIndex: 0 };
}

/**
 * The app's one tab strip (WAI-ARIA tabs, automatic activation): arrow keys,
 * Home and End move between tabs; only the selected tab is in the tab order.
 * Underline style for switching views of the same content. Use `Segmented`
 * patterns (ChoiceGroup) for choices that change a setting instead.
 */
export function TabList<T extends string>({
  items,
  value,
  onChange,
  label,
  idBase,
  className,
}: {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  idBase: string;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = items.findIndex((item) => item.value === value);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % items.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.value);
    refs.current[next]?.focus();
  }

  return (
    // Scrolls rather than clipping if the labels outgrow a narrow screen.
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn('flex gap-0.5 overflow-x-auto border-b sm:gap-1', className)}>
      {items.map((item, index) => {
        const selected = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            id={tabId(idBase, item.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(idBase, item.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              '-mb-px inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors duration-150 sm:gap-2 sm:px-3',
              selected ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon ? <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} /> : null}
            {item.label}
            {item.adornment}
          </button>
        );
      })}
    </div>
  );
}
