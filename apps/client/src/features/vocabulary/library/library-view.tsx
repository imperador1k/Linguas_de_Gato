import {
  CEFR_LEVELS,
  LANGUAGES,
  NO_PACK_FILTERS,
  entryModes,
  filterPackEntries,
  holdsPackEntry,
  type AvailableTrainerMode,
  type PackEntry,
  type PackFilters,
  type VocabularyEntry,
  type VocabularyPack,
  type VocabularyPackSummary,
} from '@ldg/shared';
import { Dumbbell, Library } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { FILTER_CONTROL, resultCount, SearchField } from '@/components/ui/search-field';
import { cn } from '@/lib/utils';
import { MODE_LABELS, POS_LABELS, TOPIC_LABELS } from '../trainer/trainer-labels';
import { usePack, usePackIndex } from './pack-loader';

/** Rendering thousands of rows at once would be slow; the list grows on request. */
const PAGE = 60;

function CefrBadge({ entry }: { entry: PackEntry }) {
  if (!entry.cefr) return <span className="text-xs text-muted-foreground">CEFR not rated</span>;
  return (
    <Badge variant="outline" className="px-2 py-0" title={entry.cefr.certainty === 'estimated' ? 'Estimated level, not an official list' : 'From the listed source'}>
      {entry.cefr.level}
      {entry.cefr.certainty === 'estimated' ? ' · est.' : ''}
    </Badge>
  );
}

function EntryRow({ entry, inCollection }: { entry: PackEntry; inCollection: boolean }) {
  const translations = [...new Set(entry.senses.flatMap((sense) => sense.translations['pt-PT'] ?? []))];
  const modes = entryModes(entry);
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-serif text-[1.125rem]" lang="en">
            {entry.lemma}
          </span>
          <span className="text-xs text-muted-foreground">{POS_LABELS[entry.partOfSpeech]}</span>
          {entry.senses.length > 1 ? <span className="text-xs text-muted-foreground">· {entry.senses.length} meanings</span> : null}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground" lang="pt-PT">
          {translations.join(', ')}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <CefrBadge entry={entry} />
          {entry.topics.map((topic) => (
            <span key={topic} className="text-muted-foreground">
              · {TOPIC_LABELS[topic]}
            </span>
          ))}
          {inCollection ? (
            <Badge variant="success" className="px-2 py-0">
              In your collection
            </Badge>
          ) : null}
        </p>
      </div>
      <ul className="flex shrink-0 flex-wrap gap-1" aria-label={`Exercises for ${entry.lemma}`}>
        {modes.map((mode) => (
          <li key={mode}>
            <Badge variant="neutral" className="px-2 py-0">
              {MODE_LABELS[mode].label}
            </Badge>
          </li>
        ))}
      </ul>
    </li>
  );
}

function PackInfo({ pack }: { pack: VocabularyPack }) {
  return (
    <section aria-label="About this pack" className="flex flex-col gap-1.5 rounded-lg border bg-card px-4 py-3.5 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{pack.title}</span>
        <span className="text-xs text-muted-foreground">v{pack.version}</span>
        {pack.demo ? <Badge variant="caution">Demonstration content</Badge> : null}
      </p>
      <p className="text-muted-foreground">{pack.description}</p>
      <p className="text-xs text-muted-foreground">
        {pack.licence.name}. {pack.licence.attribution}
      </p>
    </section>
  );
}

/**
 * The vocabulary library: static, versioned packs, browsed and filtered here
 * and trained in the trainer. Nothing in a pack is saved until a word is
 * trained; then it joins the learner's own collection.
 */
export function LibraryView({ collection, onTrain }: { collection: readonly VocabularyEntry[]; onTrain: (pack: VocabularyPackSummary, filters: PackFilters) => void }) {
  const index = usePackIndex();
  const packs = index.status === 'ready' ? index.data.packs : [];
  const [packId, setPackId] = useState<string | null>(null);
  const summary = packs.find((candidate) => candidate.id === packId) ?? packs[0] ?? null;
  const pack = usePack(summary);
  const [filters, setFilters] = useState<PackFilters>(NO_PACK_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const set = <K extends keyof PackFilters>(key: K, value: PackFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setShown(PAGE);
  };

  const data = pack.status === 'ready' ? pack.data : null;
  const visible = useMemo(() => (data ? filterPackEntries(data, filters) : []), [data, filters]);
  const topics = useMemo(() => (data ? [...new Set(data.entries.flatMap((entry) => entry.topics))].sort() : []), [data]);
  const parts = useMemo(() => (data ? [...new Set(data.entries.map((entry) => entry.partOfSpeech))] : []), [data]);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_PACK_FILTERS);

  if (index.status === 'loading') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading the library…
      </p>
    );
  }
  if (index.status === 'error') {
    return (
      <Notice tone="error" role="alert">
        {index.message}{' '}
        <button type="button" className="underline underline-offset-2" onClick={index.retry}>
          Try again
        </button>
      </Notice>
    );
  }
  if (!summary) return <EmptyState title="No vocabulary packs yet.">Packs of words to train will appear here.</EmptyState>;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="library-language" className="text-xs font-medium text-muted-foreground">
            Language
          </label>
          {/* Only languages the app supports are listed; more are planned, not pretended. */}
          <select id="library-language" className={FILTER_CONTROL} value="en" onChange={() => undefined}>
            <option value="en">{LANGUAGES.en.name}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="library-pack" className="text-xs font-medium text-muted-foreground">
            Pack
          </label>
          <select id="library-pack" className={cn(FILTER_CONTROL, 'min-w-0')} value={summary.id} onChange={(event) => setPackId(event.target.value)}>
            {packs.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title} · {candidate.entryCount} words
              </option>
            ))}
          </select>
        </div>
      </div>

      {pack.status === 'loading' ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading {summary.title}…
        </p>
      ) : pack.status === 'error' ? (
        <Notice tone="error" role="alert">
          {pack.message}{' '}
          <button type="button" className="underline underline-offset-2" onClick={pack.retry}>
            Try again
          </button>
        </Notice>
      ) : data ? (
        <>
          <PackInfo pack={data} />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <SearchField label="Search the library" placeholder="Search English or Portuguese" value={filters.query} onChange={(value) => set('query', value)} className="col-span-2 sm:flex-[1_1_14rem]" />
            <select aria-label="CEFR level" value={filters.cefr ?? ''} onChange={(event) => set('cefr', (event.target.value || null) as PackFilters['cefr'])} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_9rem]')}>
              <option value="">Any level</option>
              {CEFR_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
              <option value="unrated">Not rated</option>
            </select>
            <select aria-label="Topic" value={filters.topic ?? ''} onChange={(event) => set('topic', (event.target.value || null) as PackFilters['topic'])} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_10rem]')}>
              <option value="">Any topic</option>
              {topics.map((topic) => (
                <option key={topic} value={topic}>
                  {TOPIC_LABELS[topic]}
                </option>
              ))}
            </select>
            <select aria-label="Part of speech" value={filters.partOfSpeech ?? ''} onChange={(event) => set('partOfSpeech', (event.target.value || null) as PackFilters['partOfSpeech'])} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_12.5rem]')}>
              <option value="">Any part of speech</option>
              {parts.map((part) => (
                <option key={part} value={part}>
                  {POS_LABELS[part]}
                </option>
              ))}
            </select>
            <select aria-label="Exercise mode" value={filters.mode ?? ''} onChange={(event) => set('mode', (event.target.value || null) as AvailableTrainerMode | null)} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_10rem]')}>
              <option value="">Any mode</option>
              <option value="spelling">Spelling</option>
              <option value="context">Context</option>
              <option value="definition">Definition</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {resultCount(visible.length, data.entries.length, 'word')}
              {filtered ? (
                <button type="button" className="ml-2 underline-offset-2 hover:text-foreground hover:underline" onClick={() => setFilters(NO_PACK_FILTERS)}>
                  Clear filters
                </button>
              ) : null}
            </p>
            <Button size="sm" disabled={visible.length === 0} onClick={() => onTrain(summary, filters)}>
              <Dumbbell aria-hidden="true" />
              {filtered ? `Train these ${visible.length}` : 'Train'}
            </Button>
          </div>
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No words match these filters.</p>
          ) : (
            <>
              <ul className="divide-y rounded-lg border bg-card" aria-label={`Words in ${data.title}`}>
                {visible.slice(0, shown).map((entry) => (
                  <EntryRow key={entry.id} entry={entry} inCollection={collection.some((item) => holdsPackEntry(item, data.id, entry.id))} />
                ))}
              </ul>
              {visible.length > shown ? (
                <Button variant="ghost" size="sm" className="self-start" onClick={() => setShown((value) => value + PAGE)}>
                  Show more ({visible.length - shown} left)
                </Button>
              ) : null}
            </>
          )}
          <p className="flex gap-2 text-xs text-muted-foreground">
            <Library aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Words you train join your collection, so they come back in your reviews. Training runs entirely in this browser.
          </p>
        </>
      ) : null}
    </div>
  );
}
