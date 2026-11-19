import type { ComparisonOp } from '@ldg/shared';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';

/**
 * Word-by-word rendering of a comparison. Status is carried by typography
 * (strike-through, underline, dashed outline) and screen-reader text, never
 * by colour alone.
 */
export function DictationDiff({ alignment }: { alignment: readonly ComparisonOp[] }) {
  if (alignment.length === 0) {
    return <p className="text-sm text-muted-foreground">No words to compare.</p>;
  }

  return (
    <p className="font-serif text-[1.125rem] leading-[2.1]" lang="en">
      {alignment.map((op, index) => (
        <Fragment key={index}>
          {index > 0 ? ' ' : null}
          <DiffWord op={op} />
        </Fragment>
      ))}
    </p>
  );
}

function DiffWord({ op }: { op: ComparisonOp }) {
  switch (op.type) {
    case 'match':
      return <span>{op.reference.text}</span>;
    case 'substitution':
      return (
        <span className="whitespace-nowrap" title={op.nearMiss ? 'Close: a spelling-level difference' : undefined}>
          <span className="sr-only">You wrote</span>
          <del className="text-destructive decoration-destructive/70 decoration-1">{op.hypothesis.text}</del>
          <span className="sr-only">, correct word</span>{' '}
          <ins
            className={cn(
              'font-medium text-success no-underline',
              op.nearMiss ? 'underline decoration-dotted decoration-2 underline-offset-4' : 'underline underline-offset-4',
            )}
          >
            {op.reference.text}
          </ins>
          {op.nearMiss ? <span className="sr-only"> (close spelling)</span> : null}
        </span>
      );
    case 'deletion':
      return (
        <ins className="rounded-sm border border-dashed border-success/70 px-1 text-success no-underline">
          <span className="sr-only">Missed word: </span>
          {op.reference.text}
        </ins>
      );
    case 'insertion':
      return (
        <del className="text-destructive decoration-destructive/70 decoration-1">
          <span className="sr-only">Extra word: </span>
          {op.hypothesis.text}
        </del>
      );
  }
}

export function DictationLegend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-label="Legend">
      <li className="inline-flex items-center gap-1.5">
        <del className="text-destructive">word</del> <ins className="text-success underline underline-offset-4">word</ins>
        wrong word
      </li>
      <li className="inline-flex items-center gap-1.5">
        <ins className="text-success underline decoration-dotted decoration-2 underline-offset-4">word</ins>
        close spelling
      </li>
      <li className="inline-flex items-center gap-1.5">
        <ins className="rounded-sm border border-dashed border-success/70 px-1 text-success no-underline">word</ins>
        missed
      </li>
      <li className="inline-flex items-center gap-1.5">
        <del className="text-destructive">word</del>
        extra
      </li>
    </ul>
  );
}
