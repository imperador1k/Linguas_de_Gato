import { dueEntries, scheduleReview, type ReviewRating, type VocabularyEntry } from '@ldg/shared';
import { ArrowLeft, CircleCheck, Eye } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { cn } from '@/lib/utils';
import { vocabularyStorage } from './storage/vocabulary-repository';
import { HighlightedContext, SenseDetail, SourceLink } from './vocabulary-detail';
import { KIND_LABELS } from './vocabulary-labels';

const RATINGS: Array<{ rating: ReviewRating; label: string; hint: string; variant: 'secondary' | 'primary' }> = [
  { rating: 'again', label: 'Again', hint: 'Back tomorrow', variant: 'secondary' },
  { rating: 'good', label: 'Good', hint: 'Next step', variant: 'primary' },
  { rating: 'easy', label: 'Easy', hint: 'Skip ahead', variant: 'secondary' },
];

/**
 * Review of due expressions: recall the meaning from the context sentence,
 * reveal, then rate. Each rating is saved immediately, so leaving halfway
 * loses nothing.
 */
export function VocabularyReviewPage() {
  const storage = vocabularyStorage.use();
  const [queue, setQueue] = useState<VocabularyEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState<Record<ReviewRating, number>>({ again: 0, good: 0, easy: 0 });
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!storage) return;
    storage.repository.entries.list().then(
      (entries) => setQueue(dueEntries(entries, Date.now())),
      (caught: unknown) => {
        setError(describeStorageFailure(caught));
        setQueue([]);
      },
    );
  }, [storage]);

  useEffect(() => headingRef.current?.focus(), [index]);

  async function rate(entry: VocabularyEntry, rating: ReviewRating) {
    if (!storage) return;
    try {
      await storage.repository.entries.update(entry.id, (current) => ({ ...current, review: scheduleReview(current.review, rating, Date.now()), updatedAt: Date.now() }));
      setReviewed((counts) => ({ ...counts, [rating]: counts[rating] + 1 }));
      setRevealed(false);
      setIndex((value) => value + 1);
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  const back = (
    <Link to="/vocabulary" className={cn(buttonVariants({ variant: 'secondary' }))}>
      <ArrowLeft aria-hidden="true" />
      Vocabulary
    </Link>
  );

  if (queue === null) return null;
  const entry = queue[index];
  const total = queue.length;

  return (
    <>
      <PageHeader eyebrow="Vocabulary review" title={entry ? `${index + 1} of ${total}` : 'Review complete'} actions={back} />
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}
      {!entry ? (
        <Card className="mx-auto max-w-2xl">
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <p className="inline-flex items-center gap-2 font-medium">
              <CircleCheck aria-hidden="true" className="size-5 text-success" />
              {total === 0 ? 'Nothing is due right now.' : `You reviewed ${total} expression${total === 1 ? '' : 's'}.`}
            </p>
            {total > 0 ? (
              <p className="text-sm text-muted-foreground">
                Again {reviewed.again} · Good {reviewed.good} · Easy {reviewed.easy}. Each expression comes back on its next due date.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">New and difficult expressions come back first; known ones space out over weeks.</p>
            )}
            {back}
          </CardContent>
        </Card>
      ) : (
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full bg-brand" style={{ width: `${(index / total) * 100}%` }} />
          </div>
          <Card>
            <CardContent className="flex flex-col gap-5 py-6">
              <div>
                <p className="text-xs text-muted-foreground">{KIND_LABELS[entry.kind]}</p>
                <h2 ref={headingRef} tabIndex={-1} className="mt-1 font-serif text-3xl leading-tight outline-none">
                  {entry.expression}
                </h2>
              </div>
              {entry.senses[0] ? (
                <blockquote className="rounded-md border-l-2 border-brand bg-muted/50 px-4 py-3 font-serif text-[1.125rem] leading-relaxed">
                  <HighlightedContext sentence={entry.senses[0].context} expression={entry.expression} />
                </blockquote>
              ) : null}
              {!revealed ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-sm text-muted-foreground">What does it mean here? Say it to yourself, then check.</p>
                  <Button onClick={() => setRevealed(true)}>
                    <Eye aria-hidden="true" />
                    Show meaning
                  </Button>
                </div>
              ) : (
                <>
                  {entry.senses.map((sense) => (
                    <div key={sense.id} className="border-t pt-4">
                      <SenseDetail sense={sense} expression={entry.expression} source={<SourceLink sense={sense} />} />
                    </div>
                  ))}
                  <div role="group" aria-label="How well did you know it?" className="grid grid-cols-3 gap-2 border-t pt-4">
                    {RATINGS.map(({ rating, label, hint, variant }) => (
                      <Button key={rating} variant={variant} className="h-auto flex-col gap-0.5 py-2.5" onClick={() => void rate(entry, rating)}>
                        <span>{label}</span>
                        <span className="text-xs font-normal opacity-80">{hint}</span>
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
