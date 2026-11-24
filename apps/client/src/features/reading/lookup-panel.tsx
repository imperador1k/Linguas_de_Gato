import {
  VOCABULARY_LIMITS,
  containsWords,
  parseAnswerList,
  sentenceAround,
  vocabularyLookupResponseSchema,
  type ReadingTextRecord,
  type SaveOutcome,
  type VocabularyLookupRequest,
  type VocabularyLookupResponse,
} from '@ldg/shared';
import { BookmarkPlus, CircleCheck, LoaderCircle, Search, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { useApiJob } from '@/lib/use-api-job';
import { saveToCollection, vocabularyStorage } from '../vocabulary/storage/vocabulary-repository';
import { LookupDetail } from '../vocabulary/vocabulary-detail';
import { KIND_LABELS } from '../vocabulary/vocabulary-labels';
import { useExplanationLanguage } from './reading-preferences';
import type { SelectionState, TextSelection } from './use-text-selection';

/** Finds typed words in the text (for keyboard users and precise phrases). */
export function findInText(paragraphs: readonly string[], query: string): TextSelection | null {
  const needle = query.replace(/\s+/g, ' ').trim();
  if (needle === '') return null;
  for (const [index, paragraph] of paragraphs.entries()) {
    const position = paragraph.toLowerCase().indexOf(needle.toLowerCase());
    if (position !== -1 && containsWords(paragraph, needle)) return { text: paragraph.slice(position, position + needle.length), paragraphIndex: index, start: position, end: position + needle.length };
  }
  return null;
}

const OUTCOME_MESSAGES: Record<SaveOutcome, string> = {
  created: 'Saved to your vocabulary.',
  added_sense: 'Added as a new meaning of an expression you already saved.',
  already_saved: 'Already in your vocabulary with this meaning.',
};

/**
 * Contextual lookup: the learner selects words (or types them), explicitly
 * asks for the analysis, and may save the result. Only the sentence and its
 * paragraph are sent.
 */
export function LookupPanel({
  text,
  selection,
  available,
  onSelect,
  onClear,
}: {
  text: ReadingTextRecord;
  selection: SelectionState;
  available: boolean;
  onSelect: (selection: TextSelection) => void;
  onClear: () => void;
}) {
  const vocabulary = vocabularyStorage.use();
  const job = useApiJob<VocabularyLookupRequest, VocabularyLookupResponse>('/api/vocabulary/lookups', vocabularyLookupResponseSchema, 'The lookup failed unexpectedly. Try again.');
  const [language, setLanguage] = useExplanationLanguage();
  const [result, setResult] = useState<{ response: VocabularyLookupResponse; sentence: string; selection: TextSelection } | null>(null);
  const [saved, setSaved] = useState<{ outcome: SaveOutcome; entryId: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Typed by the learner, never filled in by the AI: it becomes an accepted answer.
  const [translation, setTranslation] = useState('');
  const [queryError, setQueryError] = useState<string | null>(null);
  const id = useId();
  const current = selection.kind === 'valid' ? selection.selection : null;

  // A new selection replaces the previous analysis.
  const resetJob = job.reset;
  useEffect(() => {
    if (current && result && (current.paragraphIndex !== result.selection.paragraphIndex || current.start !== result.selection.start || current.end !== result.selection.end)) {
      setResult(null);
      setSaved(null);
      resetJob();
    }
  }, [current, result, resetJob]);

  async function analyse(target: TextSelection) {
    const paragraph = text.paragraphs[target.paragraphIndex] ?? '';
    const sentence = sentenceAround(paragraph, target.start, target.end).slice(0, 600);
    setSaved(null);
    setSaveError(null);
    const response = await job.start({ expression: target.text, sentence, paragraph: paragraph.slice(0, 4000), explanationLanguage: language });
    if (response) setResult({ response, sentence, selection: target });
  }

  async function save() {
    if (!result || !vocabulary) return;
    try {
      const { entry, outcome } = await saveToCollection(
        vocabulary.repository,
        result.response.lookup,
        {
          sentence: result.sentence,
          source: { kind: 'reading', textId: text.id, title: text.title, paragraphIndex: result.selection.paragraphIndex },
        },
        Date.now(),
        parseAnswerList(translation, VOCABULARY_LIMITS.maxTranslations),
      );
      setSaved({ outcome, entryId: entry.id });
      setTranslation('');
    } catch (caught) {
      setSaveError(describeStorageFailure(caught));
    }
  }

  const lookup = result?.response.lookup;

  return (
    <div className="flex flex-col gap-4">
      {!available ? (
        <Notice>
          Looking up expressions needs a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>.
        </Notice>
      ) : null}

      {current ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Selected:</span>
          <span className="rounded-md bg-brand-subtle px-2 py-0.5 font-serif text-[1.0625rem]">{current.text}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Clear the selection" onClick={onClear}>
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">Select a word or expression in the text (up to eight words), then look it up here.</p>
      )}
      {selection.kind === 'invalid' ? <p className="text-sm text-destructive">{selection.reason}</p> : null}

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const found = findInText(text.paragraphs, query);
          if (!found) {
            setQueryError('Those words are not in this text.');
            return;
          }
          setQueryError(null);
          onSelect(found);
        }}
      >
        <label htmlFor={`${id}-query`} className="sr-only">
          Find words in the text
        </label>
        <Input id={`${id}-query`} value={query} maxLength={80} placeholder="Or type words from the text" onChange={(event) => setQuery(event.target.value)} />
        <Button type="submit" variant="secondary" disabled={query.trim() === ''}>
          Find
        </Button>
      </form>
      {queryError ? <p className="-mt-2 text-sm text-destructive">{queryError}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        {job.state.phase === 'running' ? (
          <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            Analysing “{current?.text}” in context…
          </p>
        ) : (
          <Button onClick={() => current && void analyse(current)} disabled={!current || !available || (result !== null && result.selection === current)}>
            <Search aria-hidden="true" />
            Look up in context
          </Button>
        )}
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={language === 'pt'} onChange={(event) => setLanguage(event.target.checked ? 'pt' : 'en')} className="size-4 accent-[var(--brand)]" />
          Add a Portuguese explanation
        </label>
      </div>
      {job.state.phase === 'failed' ? (
        <Notice tone="error" role="alert">
          {job.state.message}
        </Notice>
      ) : null}

      {lookup && result ? (
        <section aria-labelledby={`${id}-result`} className="flex flex-col gap-4 rounded-lg border px-4 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`${id}-result`} className="font-serif text-2xl leading-tight">
                {lookup.expression}
              </h3>
              <Badge variant="brand">{KIND_LABELS[lookup.kind]}</Badge>
            </div>
            {lookup.lemma.toLowerCase() !== lookup.expression.toLowerCase() ? <p className="mt-0.5 text-sm text-muted-foreground">Dictionary form: {lookup.lemma}</p> : null}
          </div>
          <LookupDetail lookup={lookup} context={result.sentence} />
          <div className="flex flex-col gap-3 border-t pt-4">
            {saved ? (
              <p role="status" className="inline-flex flex-wrap items-center gap-2 text-sm">
                <CircleCheck aria-hidden="true" className="size-4 text-success" />
                {OUTCOME_MESSAGES[saved.outcome]}{' '}
                <Link to={`/vocabulary/entries/${saved.entryId}`} className="font-medium underline-offset-4 hover:underline">
                  {saved.outcome === 'already_saved' ? 'Open to edit' : 'Open'}
                </Link>
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-translation`} className="text-sm font-medium">
                    Portuguese meaning (optional)
                  </label>
                  <Input
                    id={`${id}-translation`}
                    value={translation}
                    maxLength={300}
                    lang="pt-PT"
                    autoComplete="off"
                    placeholder="e.g. reservar"
                    aria-describedby={`${id}-translation-hint`}
                    onChange={(event) => setTranslation(event.target.value)}
                  />
                  <p id={`${id}-translation-hint`} className="text-xs text-muted-foreground">
                    Your own translation of this meaning; separate alternatives with commas. With it, the word can be practised in both directions.
                  </p>
                </div>
                <Button className="self-start" onClick={() => void save()} disabled={!vocabulary}>
                  <BookmarkPlus aria-hidden="true" />
                  Save to my vocabulary
                </Button>
              </>
            )}
          </div>
          {saveError ? (
            <Notice tone="error" role="alert">
              {saveError}
            </Notice>
          ) : null}
        </section>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">Looking up sends the selected words, their sentence and paragraph to Groq. CEFR levels shown are AI estimates.</p>
    </div>
  );
}
