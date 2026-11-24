import { translationsOf, withoutSense, type VocabularyEntry, type VocabularySense } from '@ldg/shared';
import { Pencil, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { SidePanel } from '@/components/ui/side-panel';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { SenseKnowledge } from './knowledge-view';
import { PersonalWordForm } from './personal-word-form';
import { vocabularyStorage } from './storage/vocabulary-repository';
import { SenseDetail, SourceLink } from './vocabulary-detail';
import { dateFormatter, describeDue, KIND_LABELS, STATUS_LABELS } from './vocabulary-labels';

const BACK = { to: '/vocabulary', label: 'Vocabulary' } as const;
const HEADING = 'mb-1.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase';

/** The learner's own answer data for a sense: what each exercise accepts. */
function AnswerData({ entry, sense }: { entry: VocabularyEntry; sense: VocabularySense }) {
  const translations = translationsOf(sense);
  const rows = [
    { label: 'Portuguese', value: translations.length ? translations.join(', ') : null, lang: 'pt-PT' },
    { label: 'Also accepted in English', value: sense.alternatives?.length ? sense.alternatives.join(', ') : null, lang: 'en' },
    { label: 'Forms', value: [entry.lemma, ...(sense.forms ?? [])].length > 1 ? [entry.lemma, ...(sense.forms ?? [])].join(', ') : null, lang: 'en' },
  ].filter((row) => row.value !== null);
  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 ? (
        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd lang={row.lang} className="font-serif text-[1.0625rem]">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {translations.length === 0 ? <p className="text-sm text-muted-foreground">No Portuguese translation yet: add one to practise this meaning in both directions.</p> : null}
      {sense.notes ? (
        <div>
          <h4 className={HEADING}>Notes</h4>
          <p className="text-sm leading-relaxed whitespace-pre-line">{sense.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

type PanelState = { open: false } | { open: true; key: number; target: { kind: 'edit'; sense: VocabularySense } | { kind: 'add' } };

export function VocabularyEntryPage() {
  const { entryId = '' } = useParams();
  const navigate = useNavigate();
  const storage = vocabularyStorage.use();
  const [entry, setEntry] = useState<VocabularyEntry | null | 'missing'>(null);
  const [allEntries, setAllEntries] = useState<VocabularyEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: 'entry' } | { kind: 'sense'; sense: VocabularySense } | null>(null);
  const [panel, setPanel] = useState<PanelState>({ open: false });
  const [dirty, setDirty] = useState(false);
  const [panelKey, setPanelKey] = useState(0);

  useEffect(() => {
    if (!storage) return;
    let active = true;
    Promise.all([storage.repository.entries.get(entryId), storage.repository.entries.list()]).then(
      ([row, rows]) => {
        if (!active) return;
        setEntry(row ?? 'missing');
        setAllEntries(rows);
      },
      (caught: unknown) => {
        if (!active) return;
        setError(describeStorageFailure(caught));
        setEntry('missing');
      },
    );
    return () => {
      active = false;
    };
  }, [storage, entryId]);

  if (entry === null) return null;
  if (entry === 'missing') return <PageHeader eyebrow="Vocabulary" title="Expression not found" description={error ?? 'It may have been deleted.'} back={BACK} />;

  async function confirmDelete() {
    if (!storage || !pending || entry === null || entry === 'missing') return;
    const target = pending;
    setPending(null);
    try {
      if (target.kind === 'entry') {
        await storage.repository.entries.delete(entry.id);
        navigate('/vocabulary', { replace: true });
        return;
      }
      const next = withoutSense(entry, target.sense.id, Date.now());
      if (next === null) {
        await storage.repository.entries.delete(entry.id);
        navigate('/vocabulary', { replace: true });
      } else {
        await storage.repository.entries.put(next);
        setEntry(next);
      }
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  const openPanel = (target: { kind: 'edit'; sense: VocabularySense } | { kind: 'add' }) => {
    setPanelKey((value) => value + 1);
    setDirty(false);
    setPanel({ open: true, key: panelKey + 1, target });
  };

  const now = Date.now();
  const savedByLearner = entry.senses.some((sense) => sense.source.kind !== 'library');
  return (
    <>
      <PageHeader
        back={BACK}
        eyebrow={KIND_LABELS[entry.kind]}
        title={<span className="font-serif">{entry.expression}</span>}
        description={entry.lemma.toLowerCase() !== entry.expression.toLowerCase() ? `Dictionary form: ${entry.lemma}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => openPanel({ kind: 'add' })} disabled={entry.senses.length >= 10}>
              Add another meaning
            </Button>
            <Button variant="ghost" size="icon" aria-label="Delete this expression" title="Delete" onClick={() => setPending({ kind: 'entry' })}>
              <Trash aria-hidden="true" />
            </Button>
          </div>
        }
      />
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}
      <div className="flex flex-col gap-6">
        {entry.senses.map((sense, index) => (
          <div key={sense.id} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Card className="min-w-0">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <CardTitle className="text-base">
                  {entry.senses.length > 1 ? `Meaning ${index + 1}` : 'Meaning'}
                  {sense.partOfSpeech ? <span className="ml-2 text-sm font-normal text-muted-foreground">{sense.partOfSpeech}</span> : null}
                </CardTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit meaning ${index + 1}`} title="Edit" onClick={() => openPanel({ kind: 'edit', sense })}>
                    <Pencil aria-hidden="true" />
                  </Button>
                  {entry.senses.length > 1 ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove meaning ${index + 1}`} title="Remove" onClick={() => setPending({ kind: 'sense', sense })}>
                      <Trash aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-5 pt-1">
                <AnswerData entry={entry} sense={sense} />
                {sense.source.kind === 'manual' ? (
                  sense.context ? (
                    <blockquote className="rounded-md border-l-2 border-brand bg-muted/50 px-3.5 py-2.5 font-serif text-[1.0625rem] leading-relaxed" lang="en">
                      {sense.context}
                      <footer className="mt-1.5 font-sans text-xs text-muted-foreground">Added by you · {dateFormatter.format(sense.addedAt)}</footer>
                    </blockquote>
                  ) : (
                    <p className="text-xs text-muted-foreground">Added by you · {dateFormatter.format(sense.addedAt)}</p>
                  )
                ) : (
                  <SenseDetail
                    sense={sense}
                    context={sense.context}
                    expression={entry.expression}
                    source={
                      <span className="flex flex-wrap items-center gap-2">
                        <SourceLink sense={sense} />
                        <span>Added {dateFormatter.format(sense.addedAt)}</span>
                      </span>
                    }
                  />
                )}
              </CardContent>
            </Card>
            <Card className="min-w-0 self-start">
              <CardHeader>
                <CardTitle className="text-base">What you have shown</CardTitle>
              </CardHeader>
              <CardContent className="pt-1">
                <SenseKnowledge entry={entry} sense={sense} now={now} />
              </CardContent>
            </Card>
          </div>
        ))}
        {savedByLearner ? (
          <Card className="xl:max-w-[20rem] xl:self-end">
            <CardHeader>
              <CardTitle className="text-base">Self-rated meaning check</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-1 text-sm">
              <p className="flex items-center gap-2">
                <Badge variant={entry.review.status === 'known' ? 'success' : 'neutral'}>{STATUS_LABELS[entry.review.status]}</Badge>
                {describeDue(entry.review.dueAt, now)}
              </p>
              {entry.review.lastReviewedAt ? <p className="text-muted-foreground">Last checked {dateFormatter.format(entry.review.lastReviewedAt)}</p> : <p className="text-muted-foreground">Not checked yet.</p>}
              {entry.review.history.length > 0 ? <p className="text-xs text-muted-foreground">Recent: {entry.review.history.slice(-6).map((item) => item.rating).join(' · ')}</p> : null}
              <p className="text-xs text-muted-foreground">Your own rating of the whole expression. It is kept apart from the tested evidence above.</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
      {storage ? (
        <SidePanel
          key={`entry-panel-${panelKey}`}
          open={panel.open}
          onClose={() => {
            setPanel({ open: false });
            setDirty(false);
          }}
          dirty={dirty}
          title={panel.open && panel.target.kind === 'edit' ? `Edit “${entry.lemma}”` : `Add a meaning of “${entry.lemma}”`}
          description={panel.open && panel.target.kind === 'edit' ? 'Change what this meaning accepts. Your progress on it is kept.' : 'A different meaning gets its own progress.'}
        >
          {panel.open ? (
            <PersonalWordForm
              repository={storage.repository}
              entries={allEntries}
              target={panel.target.kind === 'edit' ? { kind: 'edit', entry, sense: panel.target.sense } : { kind: 'add', initial: entry.lemma }}
              onDirtyChange={setDirty}
              onSaved={(saved) => {
                if (saved.id === entry.id) setEntry(saved);
                setAllEntries((current) => current.map((row) => (row.id === saved.id ? saved : row)));
                setDirty(false);
                setPanel({ open: false });
                if (saved.id !== entry.id) navigate(`/vocabulary/entries/${saved.id}`);
              }}
            />
          ) : null}
        </SidePanel>
      ) : null}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'entry' ? 'Delete this expression?' : 'Remove this meaning?'}
        description={
          pending?.kind === 'entry'
            ? 'The expression, all its meanings and their progress are removed from this browser. Practice rounds you did are kept.'
            : 'This meaning, its context and its progress are removed; the expression and its other meanings are kept.'
        }
        confirmLabel={pending?.kind === 'entry' ? 'Delete expression' : 'Remove meaning'}
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
