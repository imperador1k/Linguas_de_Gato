import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import type { ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'Match system theme', icon: Monitor },
];

/** Radio group with roving focus (arrow keys move and select, per WAI-ARIA). */
export function ThemeSwitcher({
  preference,
  setPreference,
}: {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const current = OPTIONS.findIndex((option) => option.value === preference);
    const next = (current + delta + OPTIONS.length) % OPTIONS.length;
    const option = OPTIONS[next];
    if (!option) return;
    setPreference(option.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      onKeyDown={onKeyDown}
      className="inline-flex items-center gap-0.5 rounded-full border bg-card p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }, index) => {
        const checked = preference === value;
        return (
          <button
            key={value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked ? 0 : -1}
            onClick={() => setPreference(value)}
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-full transition-colors duration-150',
              checked ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
