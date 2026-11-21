import {
  SPEAKING_CATEGORIES,
  WRITING_LEVELS,
  WRITING_RECORD_VERSION,
  WRITING_REGISTERS,
  writingTaskSchema,
  type WritingCategory,
  type WritingFormat,
  type WritingGenerationRequest,
  type WritingLevel,
  type WritingRegister,
  type WritingTask,
  type WritingTaskRecord,
  type TargetedPractice,
} from '@ldg/shared';
import { LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChoiceGroup, FIELD_CLASS, SELECT_CLASS } from '@/components/ui/choice-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { useGenerationJob } from '@/lib/use-generation-job';
import { cn } from '@/lib/utils';
import { LEVEL_DESCRIPTIONS } from '../speaking/generation-labels';
import { CATEGORY_LABELS } from '../speaking/prompt-library';
import type { WritingRepository } from './storage/writing-repository';
import { REGISTER_LABELS, TARGET_WORD_OPTIONS, WRITING_DISCLAIMER, WRITING_FORMAT_GROUPS, WRITING_FORMAT_LABELS } from './writing-labels';

const toLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

interface Settings {
  readonly level: WritingLevel;
  readonly format: WritingFormat;
  readonly category: WritingCategory;
  readonly register: WritingRegister;
  readonly targetWords: number;
  readonly interest: string;
  readonly objective: string;
}

/** The generated task as editable text fields. */
interface Editable {
  readonly title: string;
  readonly instructions: string;
  readonly context: string;
  readonly sourceText: string;
  readonly requiredElements: string;
  readonly evaluationCriteria: string;
  readonly objectives: string;
  readonly languageFeatures: string;
  readonly min: string;
  readonly target: string;
  readonly max: string;
}

const toEditable = (task: WritingTask): Editable => ({
  title: task.title,
  instructions: task.instructions,
  context: task.context,
  sourceText: task.sourceText ?? '',
  requiredElements: task.requiredElements.join('\n'),
  evaluationCriteria: task.evaluationCriteria.join('\n'),
  objectives: task.objectives.join('\n'),
  languageFeatures: task.languageFeatures.join('\n'),
  min: String(task.wordCount.min),
  target: String(task.wordCount.target),
  max: String(task.wordCount.max),
});

function fromEditable(task: WritingTask, edit: Editable) {
  return writingTaskSchema.safeParse({
    ...task,
    title: edit.title,
    instructions: edit.instructions,
    context: edit.context,
    sourceText: task.sourceText === null ? null : edit.sourceText.trim() || null,
    requiredElements: toLines(edit.requiredElements),
    evaluationCriteria: toLines(edit.evaluationCriteria),
    objectives: toLines(edit.objectives),
    languageFeatures: toLines(edit.languageFeatures),
    wordCount: { min: Number(edit.min), target: Number(edit.target), max: Number(edit.max) },
  });
}

function EditField({ id, label, value, onChange, rows = 2, serif, hint }: { id: string; label: string; value: string; onChange: (value: string) => void; rows?: number; serif?: boolean; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <AutoGrowTextarea id={id} value={value} rows={rows} onChange={(event) => onChange(event.target.value)} className={cn(FIELD_CLASS, serif && 'font-serif text-[1.0625rem]')} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export interface WritingTaskGeneratorProps {
  readonly repository: WritingRepository;
  readonly onSaved: (record: WritingTaskRecord, write: boolean) => void;
  readonly onClose: () => void;
  /** Inside the creation side panel: no own frame or close button. */
  readonly embedded?: boolean;
  /** Reports unsaved work (a running generation or an unsaved preview). */
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Pre-filled settings (personalized training). */
  readonly initial?: Partial<Pick<Settings, 'format' | 'register' | 'objective' | 'level'>>;
  /** Personalized training: the bounded profile from the learner's mistakes. */
  readonly targetedPractice?: TargetedPractice | null;
}

/**
 * Choose the kind of writing, preview the generated task, regenerate or edit
 * it, and save it. Nothing is sent until "Generate" is pressed, and the task
 * never includes a model answer.
 */
export function WritingTaskGenerator({ repository, onSaved, onClose, embedded = false, onDirtyChange, initial, targetedPractice = null }: WritingTaskGeneratorProps) {
  const job = useGenerationJob();
  const [settings, setSettings] = useState<Settings>({ level: 'C1', format: 'opinion_essay', category: 'society', register: 'neutral', targetWords: 250, interest: '', objective: '', ...initial });
  const [task, setTask] = useState<{ task: WritingTask; model: string; category: WritingCategory } | null>(null);
  const [edit, setEdit] = useState<Editable | null>(null);
  const [shownTitles, setShownTitles] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const running = job.state.phase === 'running';
  const elapsed = useElapsedSeconds(job.state.phase === 'running' ? job.state.startedAt : null);
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const set = (key: keyof Editable) => (value: string) => setEdit((current) => (current ? { ...current, [key]: value } : current));
  const dirty = running || task !== null;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  async function generate() {
    setSaveError(null);
    const request: WritingGenerationRequest = {
      kind: 'writing',
      level: settings.level,
      format: settings.format,
      category: settings.category,
      register: settings.register,
      targetWords: settings.targetWords,
      interest: settings.interest.trim() || null,
      objective: settings.objective.trim() || null,
      avoidTitles: shownTitles.slice(-10),
      ...(targetedPractice ? { targetedPractice } : {}),
    };
    const response = await job.start(request);
    if (!response || response.result.kind !== 'writing') return;
    setTask({ task: response.result.task, model: response.model, category: settings.category });
    setEdit(toEditable(response.result.task));
    setShownTitles((titles) => [...titles, response.result.kind === 'writing' ? response.result.task.title : ''].slice(-10));
  }

  async function save(write: boolean) {
    if (!task || !edit) return;
    const parsed = fromEditable(task.task, edit);
    if (!parsed.success) {
      setSaveError('Check the task: it needs a title, instructions and context, at least one required element and two criteria, and a word range whose minimum ≤ target ≤ maximum.');
      return;
    }
    const now = Date.now();
    const record: WritingTaskRecord = { id: crypto.randomUUID(), version: WRITING_RECORD_VERSION, task: parsed.data, category: task.category, model: task.model, createdAt: now, updatedAt: now };
    setSaving(true);
    try {
      await repository.tasks.put(record);
      onSaved(record, write);
    } catch (caught) {
      setSaveError(describeStorageFailure(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn('flex flex-col gap-5', !embedded && 'rounded-lg border px-4 py-4 sm:px-5')}>
      {embedded ? (
        <p className="text-sm text-muted-foreground">Choose what to practise. Preview, regenerate and edit the task before saving it.</p>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-medium">
              <Sparkles aria-hidden="true" className="size-4 text-brand" />
              Generate a writing task
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">Choose what to practise. Preview, regenerate and edit the task before saving it.</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close the generator" onClick={onClose} disabled={running || saving}>
            <X aria-hidden="true" />
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={field('format')}>Writing format</Label>
            <select id={field('format')} value={settings.format} disabled={running} onChange={(event) => update('format', event.target.value as WritingFormat)} className={SELECT_CLASS}>
              {WRITING_FORMAT_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.formats.map((format) => (
                    <option key={format} value={format}>
                      {WRITING_FORMAT_LABELS[format]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={field('category')}>Topic category</Label>
            <select id={field('category')} value={settings.category} disabled={running} onChange={(event) => update('category', event.target.value as WritingCategory)} className={SELECT_CLASS}>
              {SPEAKING_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <ChoiceGroup legend="Target level" value={settings.level} disabled={running} options={WRITING_LEVELS.map((level) => ({ value: level, label: level }))} onChange={(level) => update('level', level)} />
            <p className="text-xs text-muted-foreground">{LEVEL_DESCRIPTIONS[settings.level]}</p>
          </div>
          <ChoiceGroup
            legend="Register"
            value={settings.register}
            disabled={running}
            options={WRITING_REGISTERS.map((register) => ({ value: register, label: REGISTER_LABELS[register].label }))}
            onChange={(register) => update('register', register)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={field('words')}>Target length</Label>
          <select id={field('words')} value={settings.targetWords} disabled={running} onChange={(event) => update('targetWords', Number(event.target.value))} className={cn(SELECT_CLASS, 'sm:max-w-60')}>
            {TARGET_WORD_OPTIONS.map((words) => (
              <option key={words} value={words}>
                About {words} words
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={field('interest')}>Subject or interest (optional)</Label>
            <Input id={field('interest')} value={settings.interest} maxLength={300} disabled={running} placeholder="e.g. cycling in cities, a job application" onChange={(event) => update('interest', event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={field('objective')}>Learning objective (optional)</Label>
            <Input id={field('objective')} value={settings.objective} maxLength={200} disabled={running} placeholder="e.g. hedging, linking contrasting ideas" onChange={(event) => update('objective', event.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">These settings, including what you type here, are sent to Groq to create the task.</p>

        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <>
              <Button disabled>
                <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                Generating…
              </Button>
              <Button variant="ghost" onClick={job.cancel}>
                Cancel
              </Button>
              <span role="status" className="text-sm text-muted-foreground tabular-nums">
                Designing your task · {elapsed}s
              </span>
            </>
          ) : (
            <Button onClick={() => void generate()} disabled={saving}>
              {task ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
              {task ? 'Regenerate' : 'Generate'}
            </Button>
          )}
        </div>
        {job.state.phase === 'failed' ? (
          <Notice tone="error" role="alert">
            {job.state.message}
          </Notice>
        ) : null}
        {job.state.phase === 'cancelled' ? <p className="text-sm text-muted-foreground">Generation cancelled.</p> : null}
      </div>

      {task && edit ? (
        <section aria-labelledby={field('preview')} aria-busy={running} className={cn('flex flex-col gap-4 border-t pt-5', running && 'opacity-60')}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={field('preview')} className="text-sm font-medium">
              Preview
            </h3>
            <Badge variant="brand">AI-generated</Badge>
            <Badge variant="outline">{task.task.level}</Badge>
            <Badge variant="neutral">{WRITING_FORMAT_LABELS[task.task.format]}</Badge>
            <Badge variant="neutral">{REGISTER_LABELS[task.task.register].label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{WRITING_DISCLAIMER} Edit anything before saving.</p>

          <fieldset disabled={running || saving} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={field('title')}>Title</Label>
              <Input id={field('title')} value={edit.title} maxLength={120} onChange={(event) => set('title')(event.target.value)} />
            </div>
            <EditField id={field('instructions')} label="Instructions" value={edit.instructions} onChange={set('instructions')} serif />
            <EditField id={field('context')} label="Context" value={edit.context} onChange={set('context')} />
            {task.task.sourceText !== null ? <EditField id={field('source')} label="Source text" value={edit.sourceText} onChange={set('sourceText')} rows={6} serif /> : null}
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-medium">Word count</legend>
              <div className="grid grid-cols-3 gap-2 sm:max-w-md">
                {(['min', 'target', 'max'] as const).map((key) => (
                  <div key={key} className="flex flex-col gap-1">
                    <Label htmlFor={field(key)} className="text-xs text-muted-foreground">
                      {key === 'min' ? 'Minimum' : key === 'target' ? 'Target' : 'Maximum'}
                    </Label>
                    <Input id={field(key)} type="number" inputMode="numeric" min={5} max={1200} value={edit[key]} onChange={(event) => set(key)(event.target.value)} />
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 md:grid-cols-2">
              <EditField id={field('required')} label="Required elements (one per line)" value={edit.requiredElements} onChange={set('requiredElements')} rows={3} />
              <EditField id={field('criteria')} label="Evaluation criteria (one per line)" value={edit.evaluationCriteria} onChange={set('evaluationCriteria')} rows={3} />
              <EditField id={field('objectives')} label="Learning objectives (one per line)" value={edit.objectives} onChange={set('objectives')} rows={3} />
              <EditField id={field('features')} label="Useful language features (one per line)" value={edit.languageFeatures} onChange={set('languageFeatures')} rows={3} />
            </div>
          </fieldset>

          {saveError ? (
            <Notice tone="error" role="alert">
              {saveError}
            </Notice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save(true)} disabled={running || saving}>
              Save and start writing
            </Button>
            <Button variant="secondary" onClick={() => void save(false)} disabled={running || saving}>
              Save task
            </Button>
            <Button
              variant="ghost"
              disabled={running || saving}
              onClick={() => {
                setTask(null);
                setEdit(null);
                job.reset();
              }}
            >
              Discard
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
