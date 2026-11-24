import {
  PARTS_OF_SPEECH,
  VOCABULARY_LIMITS,
  checkDuplicate,
  contextsOf,
  inputFromSense,
  parseAnswerList,
  personalSenseInputSchema,
  translationsOf,
  vocabularyKey,
  type PersonalSenseInput,
  type VocabularyEntry,
  type VocabularySense,
} from '@ldg/shared';
import { CircleCheck, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { FIELD_CLASS, SELECT_CLASS } from '@/components/ui/choice-group';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { cn } from '@/lib/utils';
import { addPersonalWord, editPersonalWord, type VocabularyRepository } from './storage/vocabulary-repository';
import { POS_LABELS } from './trainer/trainer-labels';

interface Draft {
  expression: string;
  translation: string;
  otherTranslations: string;
  partOfSpeech: PersonalSenseInput['partOfSpeech'];
  example: string;
  alternatives: string;
  forms: string;
  notes: string;
}

const EMPTY: Draft = { expression: '', translation: '', otherTranslations: '', partOfSpeech: '', example: '', alternatives: '', forms: '', notes: '' };

function draftFrom(entry: VocabularyEntry, sense: VocabularySense): Draft {
  const input = inputFromSense(entry, sense);
  return {
    expression: input.expression,
    translation: input.translations[0] ?? '',
    otherTranslations: input.translations.slice(1).join(', '),
    partOfSpeech: input.partOfSpeech,
    example: input.example,
    alternatives: input.alternatives.join(', '),
    forms: input.forms.join(', '),
    notes: input.notes,
  };
}

function toInput(draft: Draft): PersonalSenseInput {
  return {
    expression: draft.expression.replace(/\s+/g, ' ').trim(),
    translations: parseAnswerList([draft.translation, draft.otherTranslations].join(','), VOCABULARY_LIMITS.maxTranslations),
    partOfSpeech: draft.partOfSpeech,
    example: draft.example.replace(/\s+/g, ' ').trim(),
    alternatives: parseAnswerList(draft.alternatives, VOCABULARY_LIMITS.maxAlternatives),
    forms: parseAnswerList(draft.forms, VOCABULARY_LIMITS.maxForms),
    notes: draft.notes.trim(),
  };
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const describeSense = (sense: VocabularySense) => [sense.partOfSpeech, translationsOf(sense).join(', ') || sense.contextualMeaning].filter(Boolean).join(' · ');

export type WordFormTarget = { readonly kind: 'add'; readonly initial?: string } | { readonly kind: 'edit'; readonly entry: VocabularyEntry; readonly sense: VocabularySense };

/**
 * Adding a word met outside the app, or editing what a saved meaning accepts.
 * The same word with a new meaning becomes another sense of it; the same
 * meaning twice is refused, with a link to the one already saved.
 */
export function PersonalWordForm({
  repository,
  entries,
  target,
  onSaved,
  onDirtyChange,
}: {
  repository: VocabularyRepository;
  entries: readonly VocabularyEntry[];
  target: WordFormTarget;
  onSaved: (entry: VocabularyEntry) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const id = useId();
  const initial = useMemo(() => (target.kind === 'edit' ? draftFrom(target.entry, target.sense) : { ...EMPTY, expression: target.initial ?? '' }), [target]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ entry: VocabularyEntry; message: string } | null>(null);
  const editing = target.kind === 'edit' ? target : null;
  const manual = editing === null || editing.sense.source.kind === 'manual';
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  useEffect(() => onDirtyChange?.(dirty && !saving), [dirty, saving, onDirtyChange]);

  const input = toInput(draft);
  const parsed = personalSenseInputSchema.safeParse(input);
  const issues = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]));
  const show = (field: string) => (submitted ? ((issues as Record<string, string>)[field] ?? null) : null);

  // What saving would do, shown while typing.
  const key = vocabularyKey(input.expression);
  const sameWord = key ? (entries.find((entry) => entry.key === key && entry.id !== editing?.entry.id) ?? (editing && editing.entry.key === key ? editing.entry : null)) : null;
  const check = input.translations.length > 0 ? checkDuplicate(sameWord, input, editing?.sense.id) : null;
  const conflict = editing && sameWord && sameWord.id !== editing.entry.id ? sameWord : null;
  const contexts = manual && input.example ? contextsOf({ lemma: input.expression, expression: input.expression }, { context: input.example, examples: [], forms: input.forms }) : [];
  const blocked = check?.kind === 'duplicate' || check?.kind === 'full' || conflict !== null;

  const set = (field: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaved(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!parsed.success || blocked) return;
    setSaving(true);
    try {
      if (editing) {
        const outcome = await editPersonalWord(repository, editing.entry.id, editing.sense.id, parsed.data);
        if (outcome.kind === 'saved') onSaved(outcome.entry);
        else if (outcome.kind === 'missing') setError('This word was deleted meanwhile.');
        else if (outcome.kind === 'conflict') setError(`“${outcome.other.lemma}” is already saved as a separate expression.`);
        else setError(`Another meaning of this word already has that translation (${describeSense(outcome.sense)}).`);
      } else {
        const result = await addPersonalWord(repository, parsed.data);
        if (result.outcome === 'already_saved') setError('This meaning is already saved.');
        else if (result.outcome === 'full') setError('This word already has the most meanings one entry can hold.');
        else {
          const message = result.outcome === 'created' ? `Saved “${result.entry.lemma}”.` : `Added a new meaning to “${result.entry.lemma}”.`;
          setSaved({ entry: result.entry, message });
          setDraft(EMPTY);
          setSubmitted(false);
          onSaved(result.entry);
        }
      }
    } catch (caught) {
      setError(describeStorageFailure(caught));
    } finally {
      setSaving(false);
    }
  }

  const described = (field: string, hint: boolean) => (show(field) ? `${id}-${field}-error` : hint ? `${id}-${field}-hint` : undefined);

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5" noValidate>
      {saved ? (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-success/40 bg-success-subtle px-3.5 py-2.5 text-sm">
          <CircleCheck aria-hidden="true" className="size-4 text-success" />
          {saved.message}
          <Link to={`/vocabulary/entries/${saved.entry.id}`} className="font-medium underline-offset-4 hover:underline">
            Open
          </Link>
          <span className="text-muted-foreground">You can add another below.</span>
        </p>
      ) : null}

      <Field id={`${id}-expression`} label="English word or expression" hint="Its dictionary form: “eat”, not “ate”; “look forward to”." error={show('expression')}>
        <Input
          id={`${id}-expression`}
          value={draft.expression}
          maxLength={VOCABULARY_LIMITS.maxExpressionChars}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          lang="en"
          aria-invalid={show('expression') ? true : undefined}
          aria-describedby={described('expression', true)}
          onChange={(event) => set('expression')(event.target.value)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field id={`${id}-translation`} label="Meaning in Portuguese" hint="The main translation of this meaning, e.g. “comer”." error={show('translations')}>
          <Input
            id={`${id}-translation`}
            value={draft.translation}
            maxLength={80}
            autoComplete="off"
            lang="pt-PT"
            aria-invalid={show('translations') ? true : undefined}
            aria-describedby={described('translations', true)}
            onChange={(event) => set('translation')(event.target.value)}
          />
        </Field>
        <Field id={`${id}-pos`} label="Part of speech">
          <select id={`${id}-pos`} value={draft.partOfSpeech} onChange={(event) => set('partOfSpeech')(event.target.value)} className={SELECT_CLASS}>
            <option value="">Not specified</option>
            {PARTS_OF_SPEECH.map((value) => (
              <option key={value} value={value}>
                {POS_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field id={`${id}-other`} label="Other accepted translations (optional)" hint="Separated by commas. In English → Portuguese practice these count as correct too; nothing else does.">
        <Input id={`${id}-other`} value={draft.otherTranslations} maxLength={400} autoComplete="off" lang="pt-PT" aria-describedby={`${id}-other-hint`} onChange={(event) => set('otherTranslations')(event.target.value)} />
      </Field>

      {manual ? (
        <Field
          id={`${id}-example`}
          label="Example sentence (optional)"
          hint={
            !input.example
              ? 'A sentence where you met or would use it. If it contains the word (or one of its forms), it becomes a context exercise.'
              : contexts[0]
                ? `Context practice will ask for “${contexts[0].answer}” in this sentence.`
                : 'This sentence does not contain the word or one of its listed forms, so it will only be shown as an example. Add the form it uses below.'
          }
        >
          <textarea
            id={`${id}-example`}
            value={draft.example}
            rows={2}
            maxLength={VOCABULARY_LIMITS.maxSentenceChars}
            lang="en"
            aria-describedby={`${id}-example-hint`}
            onChange={(event) => set('example')(event.target.value)}
            className={cn(FIELD_CLASS, 'resize-y')}
          />
        </Field>
      ) : editing ? (
        <p className="text-xs text-muted-foreground">The original sentence and meanings of this {editing.sense.source.kind === 'reading' ? 'Reading save' : 'library word'} are kept as they are.</p>
      ) : null}

      <details className="group rounded-lg border px-4 py-3" open={draft.forms !== '' || draft.alternatives !== '' || draft.notes !== '' || undefined}>
        <summary className="cursor-pointer text-sm font-medium">Forms, accepted English answers and notes</summary>
        <div className="mt-4 flex flex-col gap-5">
          <Field id={`${id}-forms`} label="Other forms" hint="Separated by commas, e.g. “eats, ate, eaten, eating”. Never guessed: list the ones you want recognised as “right word, wrong form”.">
            <Input id={`${id}-forms`} value={draft.forms} maxLength={400} autoComplete="off" spellCheck={false} lang="en" aria-describedby={`${id}-forms-hint`} onChange={(event) => set('forms')(event.target.value)} />
          </Field>
          <Field id={`${id}-alternatives`} label="Other accepted English answers" hint="For Portuguese → English practice: true equivalents for this meaning only, e.g. a US spelling.">
            <Input id={`${id}-alternatives`} value={draft.alternatives} maxLength={400} autoComplete="off" spellCheck={false} lang="en" aria-describedby={`${id}-alternatives-hint`} onChange={(event) => set('alternatives')(event.target.value)} />
          </Field>
          <Field id={`${id}-notes`} label="Notes" error={show('notes')}>
            <textarea id={`${id}-notes`} value={draft.notes} rows={2} maxLength={VOCABULARY_LIMITS.maxNoteChars} onChange={(event) => set('notes')(event.target.value)} className={cn(FIELD_CLASS, 'resize-y')} />
          </Field>
        </div>
      </details>

      <div aria-live="polite">
        {conflict ? (
          <Notice tone="error">
            “{conflict.lemma}” is already saved as its own expression.{' '}
            <Link to={`/vocabulary/entries/${conflict.id}`} className="font-medium underline underline-offset-2">
              Open it
            </Link>
          </Notice>
        ) : check?.kind === 'duplicate' ? (
          <Notice tone="error">
            This meaning is already saved: {check.entry.lemma} ({describeSense(check.sense)}).{' '}
            <Link to={`/vocabulary/entries/${check.entry.id}`} className="font-medium underline underline-offset-2">
              Open it
            </Link>
          </Notice>
        ) : check?.kind === 'full' ? (
          <Notice tone="error">“{check.entry.lemma}” already has ten meanings, the most one entry holds.</Notice>
        ) : check?.kind === 'new_sense' && !editing ? (
          <Notice>
            “{check.entry.lemma}” is already saved with {check.entry.senses.length === 1 ? 'one meaning' : `${check.entry.senses.length} meanings`} ({check.entry.senses.map(describeSense).join('; ')}). This will be added as a separate meaning, with its own progress.
          </Notice>
        ) : null}
      </div>

      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving || (submitted && (!parsed.success || blocked))}>
          {editing ? null : <Plus aria-hidden="true" />}
          {editing ? 'Save changes' : 'Save word'}
        </Button>
      </div>
    </form>
  );
}
