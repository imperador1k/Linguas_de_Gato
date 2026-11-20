import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared field styling for native inputs that don't have a primitive yet (textarea, select). */
export const FIELD_CLASS =
  'w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[0.9375rem] leading-relaxed hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none';
export const SELECT_CLASS =
  'h-11 w-full rounded-md border border-input bg-card px-3 text-[0.9375rem] hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none';

export interface ChoiceOption<T> {
  readonly value: T;
  readonly label: ReactNode;
  readonly hint?: string;
}

/** A labelled group of radio choices rendered as selectable tiles (keyboard and screen-reader friendly). */
export function ChoiceGroup<T extends string | number>({
  legend,
  value,
  options,
  onChange,
  disabled,
  wide,
}: {
  legend: string;
  value: T;
  options: ReadonlyArray<ChoiceOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Two columns of descriptive tiles instead of a row of short ones. */
  wide?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className={cn('grid gap-2', wide ? 'sm:grid-cols-2' : 'grid-cols-3 sm:flex sm:flex-wrap')}>
        {options.map((option) => (
          <label
            key={String(option.value)}
            className={cn(
              'flex cursor-pointer flex-col justify-center rounded-md border px-3.5 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              value === option.value ? 'border-foreground bg-accent/60' : 'border-input hover:border-border-strong',
            )}
          >
            <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />
            <span className="text-sm font-medium">{option.label}</span>
            {option.hint ? <span className="mt-0.5 text-xs text-muted-foreground">{option.hint}</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Multi-select tiles (checkboxes) with the same look. */
export function CheckGroup<T extends string>({
  legend,
  values,
  options,
  onChange,
  disabled,
}: {
  legend: string;
  values: readonly T[];
  options: ReadonlyArray<ChoiceOption<T>>;
  onChange: (values: T[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const checked = values.includes(option.value);
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer flex-col rounded-md border px-3.5 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                checked ? 'border-foreground bg-accent/60' : 'border-input hover:border-border-strong',
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() =>
                  onChange(checked ? values.filter((value) => value !== option.value) : options.map((item) => item.value).filter((value) => value === option.value || values.includes(value)))
                }
              />
              <span className="text-sm font-medium">{option.label}</span>
              {option.hint ? <span className="mt-0.5 text-xs text-muted-foreground">{option.hint}</span> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
