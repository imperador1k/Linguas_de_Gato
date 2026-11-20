import { withoutSense, type VocabularyEntry, type VocabularySense } from '@ldg/shared';
import { ArrowLeft, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { cn } from '@/lib/utils';
import { vocabularyStorage } from './storage/vocabulary-repository';
import { SenseDetail, SourceLink } from './vocabulary-detail';
import { dateFormatter, describeDue, KIND_LABELS, STATUS_LABELS } from './vocabulary-labels';

function BackLink() {
  return (
    <Link to="/vocabulary" className={cn(buttonVariants({ variant: 'secondary' }))}>
      <ArrowLeft aria-hidden="true" />
      Vocabulary
    </Link>
  );
}

export function VocabularyEntryPage() {
  const { entryId = '' } = useParams();
  const navigate = useNavigate();
  const storage = vocabularyStorage.use();
  const [entry, setEntry] = useState<VocabularyEntry | null | 'missing'>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: 'entry' } | { kind: 'sense'; sense: VocabularySense } | null>(null);

  useEffect(() => {
    if (!storage) return;
    let active = true;
    storage.repository.entries.get(entryId).then(
      (row) => active && setEntry(row ?? 'missing'),
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
  if (entry === 'missing') return <PageHeader eyebrow="Vocabulary" title="Expression not found" description={error ?? 'It may have been deleted.'} actions={<BackLink />} />;

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

  const now = Date.now();
  return (
    <>
      <PageHeader
        eyebrow={KIND_LABELS[entry.kind]}
        title={<span className="font-serif">{entry.expression}</span>}
        description={entry.lemma.toLowerCase() !== entry.expression.toLowerCase() ? `Dictionary form: ${entry.lemma}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BackLink />
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
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {entry.senses.map((sense, index) => (
            <Card key={sense.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <CardTitle className="text-base">{entry.senses.length > 1 ? `Meaning ${index + 1}` : 'Meaning'}</CardTitle>
                {entry.senses.length > 1 ? (
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove meaning ${index + 1}`} onClick={() => setPending({ kind: 'sense', sense })}>
                    <Trash aria-hidden="true" />
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="pt-1">
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
              </CardContent>
            </Card>
          ))}
        </div>
        <aside className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-1 text-sm">
              <p className="flex items-center gap-2">
                <Badge variant={entry.review.status === 'known' ? 'success' : 'neutral'}>{STATUS_LABELS[entry.review.status]}</Badge>
                {describeDue(entry.review.dueAt, now)}
              </p>
              {entry.review.lastReviewedAt ? <p className="text-muted-foreground">Last reviewed {dateFormatter.format(entry.review.lastReviewedAt)}</p> : <p className="text-muted-foreground">Not reviewed yet.</p>}
              {entry.review.history.length > 0 ? (
                <p className="text-xs text-muted-foreground">Recent: {entry.review.history.slice(-6).map((item) => item.rating).join(' · ')}</p>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'entry' ? 'Delete this expression?' : 'Remove this meaning?'}
        description={pending?.kind === 'entry' ? 'The expression, all its meanings and its review history are removed from this browser.' : 'This meaning and its context are removed; the expression and its other meanings are kept.'}
        confirmLabel={pending?.kind === 'entry' ? 'Delete expression' : 'Remove meaning'}
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
