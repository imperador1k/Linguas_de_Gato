import { containsWords, type ModelVocabularyLookup, type VocabularySense } from '@ldg/shared';
import { BookOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';

const HEADING = 'mb-1.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase';

function Chips({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item} className="rounded-md border px-2 py-0.5 text-sm">
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Highlights the expression inside its context sentence (case-insensitive, first occurrence). */
export function HighlightedContext({ sentence, expression }: { sentence: string; expression: string }) {
  const index = sentence.toLowerCase().indexOf(expression.toLowerCase());
  if (index === -1 || !containsWords(sentence, expression)) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, index)}
      <mark className="rounded-sm bg-brand-subtle px-0.5 text-foreground">{sentence.slice(index, index + expression.length)}</mark>
      {sentence.slice(index + expression.length)}
    </>
  );
}

type SenseLike = Pick<
  VocabularySense,
  'contextualMeaning' | 'dictionaryMeaning' | 'partOfSpeech' | 'examples' | 'collocations' | 'synonyms' | 'antonyms' | 'register' | 'patterns' | 'cefrEstimate' | 'portugueseExplanation'
> & { readonly cefr?: VocabularySense['cefr'] };

/**
 * One sense of an expression as a dictionary entry: meaning in context first,
 * then the general definition, usage and examples.
 */
export function SenseDetail({
  sense,
  context,
  expression,
  source,
  footer,
}: {
  sense: SenseLike;
  context?: string;
  expression: string;
  source?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="neutral">{sense.partOfSpeech}</Badge>
        <Badge variant="outline">{sense.register}</Badge>
        {sense.cefr ? (
          <span className="text-muted-foreground" title={`CEFR from ${sense.cefr.source}`}>
            {sense.cefr.level} · {sense.cefr.certainty === 'estimated' ? 'estimated' : 'listed'} by {sense.cefr.source}
          </span>
        ) : sense.cefrEstimate ? (
          <span className="text-muted-foreground" title="Estimated by AI; not an official level">
            ≈ {sense.cefrEstimate} <span className="sr-only">(AI estimate)</span>
            <span aria-hidden="true">· AI estimate</span>
          </span>
        ) : null}
      </div>
      {context ? (
        <blockquote className="rounded-md border-l-2 border-brand bg-muted/50 px-3.5 py-2.5 font-serif text-[1.0625rem] leading-relaxed">
          <HighlightedContext sentence={context} expression={expression} />
          {source ? <footer className="mt-1.5 font-sans text-xs text-muted-foreground">{source}</footer> : null}
        </blockquote>
      ) : null}
      <div>
        <h4 className={HEADING}>In this context</h4>
        <p className="text-[0.9375rem] leading-relaxed">{sense.contextualMeaning}</p>
      </div>
      <div>
        <h4 className={HEADING}>Definition</h4>
        <p className="text-sm leading-relaxed text-muted-foreground">{sense.dictionaryMeaning}</p>
      </div>
      {sense.portugueseExplanation ? (
        <div lang="pt-PT">
          <h4 className={HEADING}>Em português</h4>
          <p className="text-sm leading-relaxed text-muted-foreground">{sense.portugueseExplanation}</p>
        </div>
      ) : null}
      {sense.examples.length > 0 ? (
        <div>
          <h4 className={HEADING}>Examples</h4>
          <ul className="flex flex-col gap-1.5 font-serif text-[1.0625rem] leading-relaxed">
            {sense.examples.map((example) => (
              <li key={example}>
                <HighlightedContext sentence={example} expression={expression} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sense.collocations.length > 0 ? (
        <div>
          <h4 className={HEADING}>Collocations</h4>
          <Chips items={sense.collocations} />
        </div>
      ) : null}
      {sense.patterns.length > 0 ? (
        <div>
          <h4 className={HEADING}>Patterns</h4>
          <ul className="flex flex-col gap-1 font-mono text-[0.8125rem]">
            {sense.patterns.map((pattern) => (
              <li key={pattern}>{pattern}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {sense.synonyms.length > 0 || sense.antonyms.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {sense.synonyms.length > 0 ? (
            <div>
              <h4 className={HEADING}>Similar</h4>
              <Chips items={sense.synonyms} />
            </div>
          ) : null}
          {sense.antonyms.length > 0 ? (
            <div>
              <h4 className={HEADING}>Opposite</h4>
              <Chips items={sense.antonyms} />
            </div>
          ) : null}
        </div>
      ) : null}
      {footer}
    </div>
  );
}

export function LookupDetail({ lookup, context }: { lookup: ModelVocabularyLookup; context: string }) {
  return <SenseDetail sense={lookup} context={context} expression={lookup.contextEvidence} />;
}

export function SourceLink({ sense }: { sense: Pick<VocabularySense, 'source'> }) {
  if (sense.source.kind === 'library') {
    return (
      <Link to="/vocabulary?view=library" className="inline-flex items-center gap-1 hover:underline">
        <BookOpen aria-hidden="true" className="size-3" />
        Vocabulary library · {sense.source.packId} v{sense.source.packVersion}
      </Link>
    );
  }
  if (sense.source.kind !== 'reading') return null;
  return (
    <Link to={`/reading/texts/${sense.source.textId}`} className="inline-flex items-center gap-1 hover:underline">
      <BookOpen aria-hidden="true" className="size-3" />
      {sense.source.title}
    </Link>
  );
}
