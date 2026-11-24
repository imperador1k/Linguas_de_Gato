import {
  COLLECTION_EXERCISES,
  NO_PACK_FILTERS,
  TRAINING_FOCUSES,
  filterPackEntries,
  focusCounts,
  senseSupports,
  type AvailableTrainerMode,
  type CollectionExercise,
  type PackFilters,
  type TrainingFocus,
  type VocabularyEntry,
  type VocabularyPackSummary,
} from '@ldg/shared';
import { Dumbbell, LoaderCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Notice } from '@/components/ui/notice';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { usePack, usePackIndex } from '../library/pack-loader';
import type { VocabularyRepository } from '../storage/vocabulary-repository';
import { EXERCISE_LABELS, FOCUS_LABELS, MODE_LABELS, ROUND_SIZES, TOPIC_LABELS } from './trainer-labels';
import { startCollectionRound, startRound, trainedPackEntries } from './trainer-service';

export type TrainerSource = 'collection' | 'library';

function describeFilters(filters: PackFilters): string | null {
  const parts = [
    filters.cefr ? (filters.cefr === 'unrated' ? 'no CEFR level' : filters.cefr) : null,
    filters.topic ? TOPIC_LABELS[filters.topic] : null,
    filters.partOfSpeech,
    filters.query ? `“${filters.query}”` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function availability(available: number, count: number, empty: string): string {
  if (available === 0) return empty;
  if (available < count) return `${available} word${available === 1 ? '' : 's'} available, so the round will have ${available} question${available === 1 ? '' : 's'}.`;
  return `${available} words available.`;
}

function StartButton({ disabled, starting, onStart, note }: { disabled: boolean; starting: boolean; onStart: () => void; note: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" className="self-start" disabled={disabled || starting} onClick={onStart}>
        {starting ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Dumbbell aria-hidden="true" />}
        Start round
      </Button>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** A round on the learner's own words: which direction, which words, how many. */
function CollectionSetup({ repository, collection, initialFocus }: { repository: VocabularyRepository; collection: readonly VocabularyEntry[]; initialFocus: TrainingFocus }) {
  const navigate = useNavigate();
  const [exercise, setExercise] = useState<CollectionExercise>('mixed');
  const [focus, setFocus] = useState<TrainingFocus>(initialFocus);
  const [count, setCount] = useState<number>(10);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const counts = useMemo(() => focusCounts(collection, exercise, now), [collection, exercise, now]);
  const available = counts[focus];

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const set = await startCollectionRound(repository, { entries: collection, exercise, focus, count, now: Date.now() });
      if (!set) {
        setError('No words match this choice.');
        setStarting(false);
        return;
      }
      navigate(`/vocabulary/train/${set.id}`);
    } catch (caught) {
      setError(describeStorageFailure(caught));
      setStarting(false);
    }
  }

  const empty =
    focus === 'due'
      ? 'Nothing is due in this direction right now.'
      : focus === 'difficult'
        ? 'No difficult words in this direction.'
        : focus === 'new'
          ? 'Every word has been tested in this direction.'
          : `None of your words has what ${EXERCISE_LABELS[exercise].label} needs: add a Portuguese translation, or an example sentence that contains the word.`;

  return (
    <div className="flex flex-col gap-6">
      <ChoiceGroup legend="Exercise" wide value={exercise} onChange={setExercise} options={COLLECTION_EXERCISES.map((value) => ({ value, label: EXERCISE_LABELS[value].label, hint: EXERCISE_LABELS[value].hint }))} />
      <ChoiceGroup
        legend="Words"
        wide
        value={focus}
        onChange={setFocus}
        options={TRAINING_FOCUSES.map((value) => ({
          value,
          label: (
            <span className="flex items-baseline gap-2">
              {FOCUS_LABELS[value].label}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">{counts[value]}</span>
            </span>
          ),
          hint: FOCUS_LABELS[value].hint,
        }))}
      />
      <ChoiceGroup legend="Number of words" value={count} onChange={setCount} options={ROUND_SIZES.map((value) => ({ value, label: <span className="tabular-nums">{value}</span> }))} />
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {availability(available, count, empty)}
      </p>
      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <StartButton disabled={available === 0} starting={starting} onStart={() => void start()} note="Runs in this browser; nothing is sent. Each answer counts only for the word, meaning and direction it tested." />
    </div>
  );
}

/** A round on a vocabulary pack (demonstration content). */
function LibrarySetup({ repository, collection, pack: chosen, filters }: { repository: VocabularyRepository; collection: readonly VocabularyEntry[]; pack: VocabularyPackSummary | null; filters: PackFilters }) {
  const navigate = useNavigate();
  const index = usePackIndex(chosen === null);
  const summary = chosen ?? (index.status === 'ready' ? (index.data.packs[0] ?? null) : null);
  const pack = usePack(summary);
  const [mode, setMode] = useState<AvailableTrainerMode>(filters.mode ?? 'spelling');
  const [count, setCount] = useState<number>(10);
  const [order, setOrder] = useState<'priority' | 'mixed'>('priority');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = pack.status === 'ready' ? pack.data : null;
  const roundFilters = useMemo(() => ({ ...filters, mode: null }), [filters]);
  const available = useMemo(() => (data ? filterPackEntries(data, roundFilters).filter((entry) => entry.senses.some((sense) => senseSupports(sense, mode))).length : 0), [data, roundFilters, mode]);
  const known = useMemo(() => (data ? trainedPackEntries(collection, data.id) : 0), [data, collection]);
  const filterText = describeFilters(roundFilters);

  async function start() {
    if (!data) return;
    setStarting(true);
    setError(null);
    try {
      const set = await startRound(repository, { pack: data, filters: roundFilters, mode, count, collection: order === 'priority' ? collection : null });
      if (!set) {
        setError('No words match these filters for this exercise.');
        setStarting(false);
        return;
      }
      navigate(`/vocabulary/train/${set.id}`);
    } catch (caught) {
      setError(describeStorageFailure(caught));
      setStarting(false);
    }
  }

  if (index.status === 'error' || pack.status === 'error') {
    const failed = index.status === 'error' ? index : pack;
    return (
      <Notice tone="error" role="alert">
        {failed.status === 'error' ? failed.message : ''}
      </Notice>
    );
  }
  if (!data) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading the library…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border bg-card px-4 py-3 text-sm">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {data.title}
          {data.demo ? <Badge variant="caution">Demonstration content</Badge> : null}
        </p>
        <p className="mt-0.5 text-muted-foreground">{filterText ? `Filtered: ${filterText}` : 'All words in this pack.'}</p>
      </div>

      <div className="flex flex-col gap-2">
        <ChoiceGroup
          legend="Exercise"
          wide
          value={mode}
          onChange={setMode}
          options={(['spelling', 'recognition', 'context', 'definition'] as const).map((value) => ({ value, label: MODE_LABELS[value].label, hint: MODE_LABELS[value].hint }))}
        />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Audio</span> (hear a recording and write the word) is planned: it needs recorded pronunciations, which no pack has yet.
        </p>
      </div>

      <ChoiceGroup legend="Number of words" value={count} onChange={setCount} options={ROUND_SIZES.map((value) => ({ value, label: <span className="tabular-nums">{value}</span> }))} />

      {known > 0 ? (
        <ChoiceGroup
          legend="Order"
          wide
          value={order}
          onChange={setOrder}
          options={[
            { value: 'priority', label: 'Difficult and due first', hint: 'Words you got wrong or that are due in this direction, then new ones' },
            { value: 'mixed', label: 'Mixed', hint: 'A random selection' },
          ]}
        />
      ) : null}

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {availability(available, count, `No words in this selection have what ${MODE_LABELS[mode].label} needs. Change the filters or the exercise.`)}
      </p>

      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}

      <StartButton disabled={available === 0} starting={starting} onStart={() => void start()} note="Runs in this browser; nothing is sent. Words you answer join your collection when the round ends, with evidence for the direction you trained." />
    </div>
  );
}

/**
 * Setting up a local training round, on the learner's own words (the
 * default) or on a library pack. Everything happens in the browser.
 */
export function TrainerSetup({
  repository,
  collection,
  pack = null,
  filters = NO_PACK_FILTERS,
  source: initialSource,
  focus = 'mixed',
}: {
  repository: VocabularyRepository;
  collection: readonly VocabularyEntry[];
  pack?: VocabularyPackSummary | null;
  filters?: PackFilters;
  source: TrainerSource;
  focus?: TrainingFocus;
}) {
  const [source, setSource] = useState<TrainerSource>(initialSource);
  return (
    <div className="flex flex-col gap-6">
      <ChoiceGroup
        legend="Train"
        wide
        value={source}
        onChange={setSource}
        options={[
          { value: 'collection', label: 'My vocabulary', hint: `${collection.length} saved expression${collection.length === 1 ? '' : 's'}` },
          { value: 'library', label: 'Library pack', hint: 'Demonstration words shipped with the app' },
        ]}
      />
      {source === 'collection' ? <CollectionSetup repository={repository} collection={collection} initialFocus={focus} /> : <LibrarySetup repository={repository} collection={collection} pack={pack} filters={filters} />}
    </div>
  );
}
