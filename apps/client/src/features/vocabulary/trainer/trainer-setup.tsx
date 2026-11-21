import { NO_PACK_FILTERS, filterPackEntries, senseSupports, type AvailableTrainerMode, type PackFilters, type VocabularyEntry, type VocabularyPackSummary } from '@ldg/shared';
import { Dumbbell, LoaderCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Notice } from '@/components/ui/notice';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { usePack, usePackIndex } from '../library/pack-loader';
import type { VocabularyRepository } from '../storage/vocabulary-repository';
import { MODE_LABELS, ROUND_SIZES, TOPIC_LABELS } from './trainer-labels';
import { progressFrom, startRound } from './trainer-service';

function describeFilters(filters: PackFilters): string | null {
  const parts = [
    filters.cefr ? (filters.cefr === 'unrated' ? 'no CEFR level' : filters.cefr) : null,
    filters.topic ? TOPIC_LABELS[filters.topic] : null,
    filters.partOfSpeech,
    filters.mode ? `${filters.mode} mode` : null,
    filters.query ? `“${filters.query}”` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Setting up a local training round: which mode, how many words and in what
 * order. Everything happens in the browser; nothing is sent anywhere.
 */
export function TrainerSetup({ repository, collection, pack: chosen, filters = NO_PACK_FILTERS }: { repository: VocabularyRepository; collection: readonly VocabularyEntry[]; pack: VocabularyPackSummary | null; filters?: PackFilters }) {
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
  const known = useMemo(() => {
    if (!data) return 0;
    const progress = progressFrom(collection, data.id);
    return data.entries.filter((entry) => progress(entry) !== null).length;
  }, [data, collection]);
  const filterText = describeFilters(roundFilters);

  async function start() {
    if (!data) return;
    setStarting(true);
    setError(null);
    try {
      const set = await startRound(repository, { pack: data, filters: roundFilters, mode, count, collection: order === 'priority' ? collection : null });
      if (!set) {
        setError('No words match these filters for this mode.');
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
        <p className="font-medium">{data.title}</p>
        <p className="mt-0.5 text-muted-foreground">{filterText ? `Filtered: ${filterText}` : 'All words in this pack.'}</p>
      </div>

      <div className="flex flex-col gap-2">
        <ChoiceGroup
          legend="Exercise"
          wide
          value={mode}
          onChange={setMode}
          options={(['spelling', 'context', 'definition'] as const).map((value) => ({ value, label: MODE_LABELS[value].label, hint: MODE_LABELS[value].hint }))}
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
            { value: 'priority', label: 'Difficult and due first', hint: 'Words you got wrong or that are due for review, then new ones' },
            { value: 'mixed', label: 'Mixed', hint: 'A random selection' },
          ]}
        />
      ) : null}

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {available === 0
          ? `No words in this selection have what ${MODE_LABELS[mode].label} needs. Change the filters or the exercise.`
          : available < count
            ? `${available} word${available === 1 ? '' : 's'} available, so the round will have ${available} question${available === 1 ? '' : 's'}.`
            : `${available} words available.`}
      </p>

      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button size="lg" className="self-start" disabled={available === 0 || starting} onClick={() => void start()}>
          {starting ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Dumbbell aria-hidden="true" />}
          Start round
        </Button>
        <p className="text-xs text-muted-foreground">Runs in this browser; nothing is sent. Words you answer join your collection when the round ends.</p>
      </div>
    </div>
  );
}
