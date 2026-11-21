import { SPEAKING_CATEGORIES, SPEAKING_LIMITS, speakingPromptSchema, type CustomTopic, type SpeakingCategory } from '@ldg/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Button } from '@/components/ui/button';
import { FIELD_CLASS, SELECT_CLASS } from '@/components/ui/choice-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { CATEGORY_LABELS } from './prompt-library';
import { describeSpeakingStorageError, type SpeakingStorage } from './storage/speaking-storage';

const toLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * "Write your own" topic, and editing a saved one. Editing changes only the
 * prompt (title, question, points, category): an AI-generated topic keeps its
 * level, format and generated details, and past attempts keep the prompt as
 * it was when they were recorded.
 */
export function TopicForm({
  storage,
  initial,
  onSaved,
  onDirtyChange,
}: {
  storage: SpeakingStorage;
  /** Present when editing. */
  initial?: CustomTopic;
  onSaved: (topic: CustomTopic, practise: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const start = {
    title: initial?.prompt.title ?? '',
    instructions: initial?.prompt.instructions ?? '',
    points: initial?.prompt.points.join('\n') ?? '',
    category: initial?.prompt.category ?? ('everyday' as SpeakingCategory),
  };
  const [title, setTitle] = useState(start.title);
  const [instructions, setInstructions] = useState(start.instructions);
  const [points, setPoints] = useState(start.points);
  const [category, setCategory] = useState<SpeakingCategory>(start.category);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), instructions: useId(), points: useId(), category: useId() };

  const dirty = title !== start.title || instructions !== start.instructions || points !== start.points || category !== start.category;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  async function save(practise: boolean) {
    setError(null);
    const parsed = speakingPromptSchema.safeParse({
      source: 'custom',
      promptId: null,
      title,
      instructions,
      points: toLines(points),
      category,
      level: initial?.prompt.level ?? null,
    });
    if (!parsed.success) {
      setError(
        `Check the topic: a title (up to ${SPEAKING_LIMITS.maxTitleChars} characters), what to talk about (up to ${SPEAKING_LIMITS.maxInstructionsChars}), and at most ${SPEAKING_LIMITS.maxPoints} points of up to ${SPEAKING_LIMITS.maxPointChars} characters.`,
      );
      return;
    }
    const topic: CustomTopic = initial ? { ...initial, prompt: parsed.data } : { id: crypto.randomUUID(), prompt: parsed.data, createdAt: Date.now() };
    setSaving(true);
    try {
      await storage.repository.putTopic(topic);
      onSaved(topic, practise);
    } catch (caught) {
      setError(describeSpeakingStorageError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void save(!initial);
      }}
    >
      {initial ? null : <p className="text-sm text-muted-foreground">Practise for a real situation: an interview, a presentation, a meeting or a conversation you expect to have.</p>}
      <fieldset disabled={saving} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.title}>Title</Label>
          <Input id={ids.title} value={title} maxLength={SPEAKING_LIMITS.maxTitleChars} onChange={(event) => setTitle(event.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.instructions}>What should you talk about?</Label>
          <AutoGrowTextarea id={ids.instructions} value={instructions} maxLength={SPEAKING_LIMITS.maxInstructionsChars} rows={3} onChange={(event) => setInstructions(event.target.value)} required className={FIELD_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.points}>Points to cover (optional, one per line)</Label>
          <AutoGrowTextarea id={ids.points} value={points} rows={3} onChange={(event) => setPoints(event.target.value)} className={FIELD_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.category}>Category</Label>
          <select id={ids.category} value={category} onChange={(event) => setCategory(event.target.value as SpeakingCategory)} className={SELECT_CLASS}>
            {SPEAKING_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {initial ? (
          <Button type="submit" disabled={saving || !dirty}>
            Save changes
          </Button>
        ) : (
          <>
            <Button type="submit" disabled={saving}>
              Save and practise
            </Button>
            <Button variant="secondary" disabled={saving} onClick={() => void save(false)}>
              Save topic
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
