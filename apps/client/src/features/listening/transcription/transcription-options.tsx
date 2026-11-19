import {
  DEFAULT_TRANSCRIPTION_MODEL,
  TRANSCRIPTION_MODELS,
  TRANSCRIPTION_MODEL_INFO,
  transcriptionOptionsSchema,
  type TranscriptionLanguage,
  type TranscriptionOptions,
} from '@ldg/shared';
import { useCallback, useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'ldg.transcription.options';
const DEFAULTS: TranscriptionOptions = { model: DEFAULT_TRANSCRIPTION_MODEL, language: 'en' };

function readStored(): TranscriptionOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = transcriptionOptionsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** Remembers the learner's last choice (a per-browser convenience; safe to lose). */
export function useTranscriptionPreferences(): [TranscriptionOptions, (next: TranscriptionOptions) => void] {
  const [options, setOptions] = useState<TranscriptionOptions>(readStored);
  const update = useCallback((next: TranscriptionOptions) => {
    setOptions(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the choice simply isn't remembered.
    }
  }, []);
  return [options, update];
}

const LANGUAGE_CHOICES: ReadonlyArray<{ value: TranscriptionLanguage; label: string; description: string }> = [
  { value: 'en', label: 'English', description: 'Most accurate for English recordings.' },
  { value: 'auto', label: 'Detect automatically', description: 'For mixed or uncertain languages.' },
];

function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  choices,
  disabled,
  onChange,
  compact,
}: {
  legend: string;
  name: string;
  value: T;
  choices: ReadonlyArray<{ value: T; label: string; description: ReactNode }>;
  disabled: boolean;
  onChange: (value: T) => void;
  compact: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
        {choices.map((choice) => {
          const checked = choice.value === value;
          return (
            <label
              key={choice.value}
              className={cn(
                'flex cursor-pointer gap-3 rounded-md border px-3.5 py-3 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                checked ? 'border-foreground bg-accent/60' : 'border-input hover:border-border-strong',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={choice.value}
                checked={checked}
                onChange={() => onChange(choice.value)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--brand)] focus-visible:outline-none"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{choice.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{choice.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Language and model selection, as native radio groups (arrow keys, labels, focus come for free). */
export function TranscriptionOptionsFields({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: TranscriptionOptions;
  onChange: (value: TranscriptionOptions) => void;
  disabled?: boolean;
  /** Single column, for the narrow session sidebar. */
  compact?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-5">
      <ChoiceGroup
        legend="Language"
        name={`${id}-language`}
        value={value.language}
        choices={LANGUAGE_CHOICES}
        disabled={disabled}
        compact={compact}
        onChange={(language) => onChange({ ...value, language })}
      />
      <ChoiceGroup
        legend="Model"
        name={`${id}-model`}
        value={value.model}
        choices={TRANSCRIPTION_MODELS.map((model) => ({
          value: model,
          label: TRANSCRIPTION_MODEL_INFO[model].label,
          description: TRANSCRIPTION_MODEL_INFO[model].description,
        }))}
        disabled={disabled}
        compact={compact}
        onChange={(model) => onChange({ ...value, model })}
      />
    </div>
  );
}
