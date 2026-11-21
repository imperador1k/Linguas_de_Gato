import {
  GENERATION_LEVELS,
  SPEAKING_CATEGORIES,
  SPEAKING_EXERCISE_FORMATS,
  SPEAKING_SKILL_FOCUSES,
  TARGET_DURATIONS_SECONDS,
  formatTimestamp,
  generatedExerciseToTopicDraft,
  generatedSpeakingDetailsSchema,
  speakingPromptSchema,
  type CustomTopic,
  type CustomTopicDraft,
  type SpeakingCategory,
  type SpeakingExerciseFormat,
  type SpeakingGenerationRequest,
  type SpeakingLevel,
  type SpeakingSkillFocus,
  type TargetDurationSeconds,
  type VocabularyItem,
} from '@ldg/shared';
import { LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Button } from '@/components/ui/button';
import { ChoiceGroup, FIELD_CLASS, SELECT_CLASS } from '@/components/ui/choice-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { useGenerationJob } from '@/lib/use-generation-job';
import { cn } from '@/lib/utils';
import { CEFR_DISCLAIMER, FORMAT_LABELS, LEVEL_DESCRIPTIONS, SKILL_FOCUS_LABELS } from './generation-labels';
import { CATEGORY_LABELS } from './prompt-library';
import { describeSpeakingStorageError, type SpeakingStorage } from './storage/speaking-storage';

const toLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

interface Settings {
  readonly level: SpeakingLevel;
  readonly category: SpeakingCategory;
  readonly format: SpeakingExerciseFormat;
  readonly targetDurationSeconds: TargetDurationSeconds;
  readonly skillFocus: SpeakingSkillFocus | null;
  readonly interest: string;
}

/** Editable copy of a generated task: what the learner sees and may change before saving. */
interface Editable {
  readonly title: string;
  readonly centralPrompt: string;
  readonly guidance: string;
  readonly points: string;
  readonly followUps: string;
  readonly vocabulary: readonly VocabularyItem[];
}

function toEditable(draft: CustomTopicDraft): Editable {
  return {
    title: draft.prompt.title,
    centralPrompt: draft.prompt.instructions,
    guidance: draft.generated?.guidance ?? '',
    points: draft.prompt.points.join('\n'),
    followUps: draft.generated?.followUpQuestions.join('\n') ?? '',
    vocabulary: draft.generated?.vocabulary ?? [],
  };
}

export interface TopicGeneratorProps {
  readonly storage: SpeakingStorage;
  /** Called with the saved topic; `practise` is true for "Save and practise". */
  readonly onSaved: (topic: CustomTopic, practise: boolean) => void;
  readonly onClose: () => void;
  /** Inside the creation side panel: no own frame or close button (the panel has them). */
  readonly embedded?: boolean;
  /** Reports unsaved work (a running generation or an unsaved preview) so the container can protect it. */
  readonly onDirtyChange?: (dirty: boolean) => void;
}

/**
 * "Generate with AI": the learner chooses level, category, format, duration
 * and an optional focus, previews the generated task, can regenerate or edit
 * it, and saves it as a personal topic. Nothing is sent until they press a
 * generate button, and nothing is saved until they press save.
 */
export function TopicGenerator({ storage, onSaved, onClose, embedded = false, onDirtyChange }: TopicGeneratorProps) {
  const job = useGenerationJob();
  const [settings, setSettings] = useState<Settings>({
    level: 'C1',
    category: 'society',
    format: 'guided',
    targetDurationSeconds: 120,
    skillFocus: null,
    interest: '',
  });
  const [draft, setDraft] = useState<CustomTopicDraft | null>(null);
  const [edit, setEdit] = useState<Editable | null>(null);
  const [shownTitles, setShownTitles] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const running = job.state.phase === 'running';
  const elapsed = useElapsedSeconds(job.state.phase === 'running' ? job.state.startedAt : null);
  const ids = {
    category: useId(),
    skill: useId(),
    interest: useId(),
    title: useId(),
    prompt: useId(),
    guidance: useId(),
    points: useId(),
    followUps: useId(),
    preview: useId(),
  };

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));

  const dirty = running || draft !== null;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  async function generate() {
    setSaveError(null);
    const request: SpeakingGenerationRequest = {
      kind: 'speaking',
      level: settings.level,
      category: settings.category,
      interest: settings.interest.trim() === '' ? null : settings.interest.trim(),
      format: settings.format,
      targetDurationSeconds: settings.targetDurationSeconds,
      skillFocus: settings.skillFocus,
      avoidTitles: shownTitles.slice(-10),
    };
    const response = await job.start(request);
    if (!response || response.result.kind !== 'speaking') return;
    const next = generatedExerciseToTopicDraft(response.result.exercise, request, response.model, response.createdAt);
    setDraft(next);
    setEdit(toEditable(next));
    setShownTitles((titles) => [...titles, next.prompt.title].slice(-10));
  }

  async function save(practise: boolean) {
    if (!draft || !edit || !draft.generated) return;
    const prompt = speakingPromptSchema.safeParse({
      ...draft.prompt,
      title: edit.title,
      instructions: edit.centralPrompt,
      points: toLines(edit.points),
    });
    const generated = generatedSpeakingDetailsSchema.safeParse({
      ...draft.generated,
      guidance: edit.guidance,
      followUpQuestions: toLines(edit.followUps),
      vocabulary: edit.vocabulary,
    });
    if (!prompt.success || !generated.success) {
      setSaveError('Check the task: it needs a title, a question and guidance; at most 6 discussion points and 5 follow-up questions.');
      return;
    }
    const topic: CustomTopic = { id: crypto.randomUUID(), prompt: prompt.data, generated: generated.data, createdAt: Date.now() };
    setSaving(true);
    try {
      await storage.repository.putTopic(topic);
      onSaved(topic, practise);
    } catch (caught) {
      setSaveError(describeSpeakingStorageError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn('flex flex-col gap-5', !embedded && 'rounded-lg border px-4 py-4')}>
      {embedded ? (
        <p className="text-sm text-muted-foreground">Choose what you want to practise. You can preview, regenerate and edit the task before saving it.</p>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-medium">
              <Sparkles aria-hidden="true" className="size-4 text-brand" />
              Generate a speaking task
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">Choose what you want to practise. You can preview, regenerate and edit the task before saving it.</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close the generator" onClick={onClose} disabled={running || saving}>
            <X aria-hidden="true" />
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-5">
        <ChoiceGroup
          legend="Target level"
          value={settings.level}
          disabled={running}
          options={GENERATION_LEVELS.map((level) => ({ value: level, label: level }))}
          onChange={(level) => update('level', level)}
        />
        <p className="-mt-3 text-xs text-muted-foreground">{LEVEL_DESCRIPTIONS[settings.level]}</p>

        <ChoiceGroup
          legend="Format"
          wide
          value={settings.format}
          disabled={running}
          options={SPEAKING_EXERCISE_FORMATS.map((format) => ({ value: format, label: FORMAT_LABELS[format].label, hint: FORMAT_LABELS[format].description }))}
          onChange={(format) => update('format', format)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.category}>Category</Label>
            <select
              id={ids.category}
              value={settings.category}
              disabled={running}
              onChange={(event) => update('category', event.target.value as SpeakingCategory)}
              className={SELECT_CLASS}
            >
              {SPEAKING_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.skill}>Language focus (optional)</Label>
            <select
              id={ids.skill}
              value={settings.skillFocus ?? ''}
              disabled={running}
              onChange={(event) => update('skillFocus', event.target.value === '' ? null : (event.target.value as SpeakingSkillFocus))}
              className={SELECT_CLASS}
            >
              <option value="">No particular focus</option>
              {SPEAKING_SKILL_FOCUSES.map((value) => (
                <option key={value} value={value}>
                  {SKILL_FOCUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ChoiceGroup
          legend="Suggested speaking time"
          value={settings.targetDurationSeconds}
          disabled={running}
          options={TARGET_DURATIONS_SECONDS.map((seconds) => ({ value: seconds, label: <span className="font-mono tabular-nums">{formatTimestamp(seconds)}</span> }))}
          onChange={(seconds) => update('targetDurationSeconds', seconds)}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.interest}>Topic or interest (optional)</Label>
          <Input
            id={ids.interest}
            value={settings.interest}
            maxLength={300}
            disabled={running}
            placeholder="e.g. remote teams in start-ups, a job interview for a nursing post"
            onChange={(event) => update('interest', event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Sent to Groq to shape the task. Leave it empty for a surprise within the category.</p>
        </div>

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
              <span className="text-sm text-muted-foreground tabular-nums" role="status">
                Designing your task · {elapsed}s
              </span>
            </>
          ) : (
            <Button onClick={() => void generate()} disabled={saving}>
              {draft ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
              {draft ? 'Regenerate' : 'Generate with AI'}
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

      {draft && edit ? (
        <section aria-labelledby={ids.preview} className={cn('flex flex-col gap-4 border-t pt-5', running && 'opacity-60')} aria-busy={running}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={ids.preview} className="text-sm font-medium">
              Preview
            </h3>
            <Badge variant="brand">AI-generated</Badge>
            <Badge variant="outline">{draft.prompt.level}</Badge>
            {draft.generated ? <Badge variant="neutral">{FORMAT_LABELS[draft.generated.format].label}</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">{CEFR_DISCLAIMER} Edit anything before saving.</p>

          <fieldset disabled={running || saving} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.title}>Title</Label>
              <Input id={ids.title} value={edit.title} maxLength={120} onChange={(event) => setEdit({ ...edit, title: event.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.prompt}>Speaking prompt</Label>
              <AutoGrowTextarea
                id={ids.prompt}
                value={edit.centralPrompt}
                maxLength={600}
                rows={3}
                onChange={(event) => setEdit({ ...edit, centralPrompt: event.target.value })}
                className={cn(FIELD_CLASS, 'font-serif text-lg')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.guidance}>Instructions</Label>
              <AutoGrowTextarea id={ids.guidance} value={edit.guidance} maxLength={600} rows={3} onChange={(event) => setEdit({ ...edit, guidance: event.target.value })} className={FIELD_CLASS} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.points}>Discussion points (one per line)</Label>
                <AutoGrowTextarea id={ids.points} value={edit.points} rows={5} onChange={(event) => setEdit({ ...edit, points: event.target.value })} className={FIELD_CLASS} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.followUps}>Follow-up questions (one per line)</Label>
                <AutoGrowTextarea id={ids.followUps} value={edit.followUps} rows={5} onChange={(event) => setEdit({ ...edit, followUps: event.target.value })} className={FIELD_CLASS} />
              </div>
            </div>

            {edit.vocabulary.length > 0 ? (
              <div>
                <h4 className="mb-2 text-sm font-medium">Useful language</h4>
                <ul className="grid gap-2 md:grid-cols-2">
                  {edit.vocabulary.map((item, index) => (
                    <li key={`${item.expression}-${index}`} className="flex items-start gap-2 rounded-md border px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{item.expression}</p>
                        <p className="text-xs text-muted-foreground">{item.meaning}</p>
                        <p className="mt-1 text-xs italic text-muted-foreground">{item.example}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${item.expression}`}
                        onClick={() => setEdit({ ...edit, vocabulary: edit.vocabulary.filter((_, position) => position !== index) })}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {draft.generated && draft.generated.objectives.length > 0 ? (
              <div>
                <h4 className="mb-2 text-sm font-medium">Speaking objectives</h4>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
                  {draft.generated.objectives.map((objective) => (
                    <li key={objective}>{objective}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </fieldset>

          {saveError ? (
            <Notice tone="error" role="alert">
              {saveError}
            </Notice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save(true)} disabled={running || saving}>
              Save and practise
            </Button>
            <Button variant="secondary" onClick={() => void save(false)} disabled={running || saving}>
              Save topic
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setEdit(null);
                job.reset();
              }}
              disabled={running || saving}
            >
              Discard
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
