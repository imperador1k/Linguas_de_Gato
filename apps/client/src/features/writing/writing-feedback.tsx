import {
  WRITING_DIMENSIONS,
  annotateText,
  applyCorrections,
  sortByPriority,
  type WritingAssessment,
  type WritingCorrection,
} from '@ldg/shared';
import { ArrowRight, CircleCheck, CircleDashed, Lightbulb } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CorrectionKindBadge, LevelLabel } from '@/components/ui/status';
import { TabList, tabPanelProps, type TabItem } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { DIMENSION_LABELS, ERROR_CATEGORY_LABELS } from './writing-labels';

const PRIORITY_LABELS = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' } as const;

/** Learner's text with verified corrections marked: errors with a solid underline, suggestions dotted. */
export function AnnotatedText({
  text,
  corrections,
  activeId,
  onSelect,
}: {
  text: string;
  corrections: readonly WritingCorrection[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const byId = new Map(corrections.map((correction) => [correction.id, correction]));
  return (
    <div className="font-serif text-[1.0625rem] leading-[1.85] whitespace-pre-wrap">
      {annotateText(text, corrections).map((piece, index) => {
        const correction = piece.correctionId ? byId.get(piece.correctionId) : undefined;
        if (!correction) return <span key={index}>{piece.text}</span>;
        const isError = correction.kind === 'error';
        return (
          <button
            key={index}
            type="button"
            onClick={() => onSelect(correction.id)}
            aria-label={`${isError ? 'Error' : 'Suggestion'}: “${correction.original}” → “${correction.correction}”`}
            aria-pressed={activeId === correction.id}
            className={cn(
              'cursor-pointer rounded-sm px-0.5 text-left underline underline-offset-4 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring',
              // Errors: solid red underline. Suggestions: dotted neutral underline, so they never read as mistakes.
              isError ? 'decoration-destructive decoration-2 hover:bg-destructive-subtle' : 'decoration-muted-foreground decoration-dotted decoration-2 hover:bg-accent',
              activeId === correction.id && (isError ? 'bg-destructive-subtle' : 'bg-accent'),
            )}
          >
            {piece.text}
          </button>
        );
      })}
    </div>
  );
}

function CorrectionCard({ correction, active, onSelect }: { correction: WritingCorrection; active: boolean; onSelect: () => void }) {
  const isError = correction.kind === 'error';
  return (
    <li
      id={`correction-${correction.id}`}
      className={cn('flex flex-col gap-2.5 rounded-lg border px-4 py-3.5 transition-colors duration-150', active && 'border-border-strong bg-accent/40')}
      onClick={onSelect}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <CorrectionKindBadge kind={correction.kind} />
        <Badge variant="neutral">{ERROR_CATEGORY_LABELS[correction.category]}</Badge>
        <span className="text-muted-foreground">{PRIORITY_LABELS[correction.priority]}</span>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-serif text-[1.0625rem] leading-relaxed">
        <span className={cn(isError && 'text-muted-foreground line-through decoration-destructive/70')}>{correction.original}</span>
        <ArrowRight aria-label="becomes" className="size-4 shrink-0 self-center text-muted-foreground" />
        <span className="font-medium">{correction.correction}</span>
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">{correction.explanation}</p>
      {correction.advancedAlternative ? (
        <p className="flex gap-2 text-sm leading-relaxed">
          <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>
            <span className="font-medium">More sophisticated option: </span>
            <span className="font-serif">{correction.advancedAlternative}</span>
          </span>
        </p>
      ) : null}
    </li>
  );
}

type Filter = 'all' | 'error' | 'suggestion';

export function CorrectionList({ corrections, activeId, onSelect }: { corrections: readonly WritingCorrection[]; activeId: string | null; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const errors = corrections.filter((correction) => correction.kind === 'error').length;
  const visible = sortByPriority(corrections.filter((correction) => filter === 'all' || correction.kind === filter));
  const options: Array<[Filter, string]> = [
    ['all', `All (${corrections.length})`],
    ['error', `Errors (${errors})`],
    ['suggestion', `Suggestions (${corrections.length - errors})`],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'h-8 rounded-full border px-3 text-sm transition-colors duration-150',
              filter === value ? 'border-foreground bg-primary text-primary-foreground' : 'border-input text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in this group.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map((correction) => (
            <CorrectionCard key={correction.id} correction={correction} active={activeId === correction.id} onSelect={() => onSelect(correction.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function AssessmentSummary({ assessment }: { assessment: WritingAssessment }) {
  const titleId = useId();
  return (
    <Card aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>Feedback</CardTitle>
        <CardDescription className="text-base leading-relaxed text-foreground">{assessment.overview}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-1">
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Work on next</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed">
            {assessment.priorities.map((priority) => (
              <li key={priority}>{priority}</li>
            ))}
          </ol>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {WRITING_DIMENSIONS.map((key) => {
            const dimension = assessment[key];
            return (
              <div key={key} className="flex flex-col gap-2 rounded-lg border px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{DIMENSION_LABELS[key]}</h3>
                  <LevelLabel level={dimension.level} />
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{dimension.summary}</p>
                {dimension.strengths.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-sm">
                    {dimension.strengths.map((strength) => (
                      <li key={strength} className="flex gap-2">
                        <CircleCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />
                        <span>{strength}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
        {assessment.requiredElements.length > 0 ? (
          <div>
            <h3 className="mb-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Required elements</h3>
            <ul className="flex flex-col gap-2">
              {assessment.requiredElements.map((item) => (
                <li key={item.element} className="flex gap-2.5 text-sm leading-relaxed">
                  {item.addressed ? (
                    <CircleCheck aria-label="Addressed" className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <CircleDashed aria-label="Not addressed" className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <span>
                    <span className="font-medium">{item.element}</span>
                    <span className="text-muted-foreground"> — {item.comment}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Levels describe this text against C1 standard for practice; they are not scores or an official CEFR result.
          {assessment.discarded > 0 ? ` ${assessment.discarded} suggested correction${assessment.discarded === 1 ? ' was' : 's were'} withheld because ${assessment.discarded === 1 ? 'it' : 'they'} didn't match your text.` : ''}
        </p>
      </CardContent>
    </Card>
  );
}

export type TextView = 'annotated' | 'original' | 'fixed' | 'improved';

export function TextTabs({
  view,
  onChange,
  improvedAvailable,
  children,
}: {
  view: TextView;
  onChange: (view: TextView) => void;
  improvedAvailable: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const tabs: Array<TabItem<TextView>> = [
    { value: 'annotated', label: 'Corrections' },
    { value: 'original', label: 'Your text' },
    { value: 'fixed', label: 'Errors fixed' },
    { value: 'improved', label: improvedAvailable ? 'Improved version' : 'Improved version (optional)' },
  ];
  return (
    <div>
      <TabList items={tabs} value={view} onChange={onChange} label="Text view" idBase={id} />
      <div {...tabPanelProps(id, view)} className="pt-5 outline-none">
        {children}
      </div>
    </div>
  );
}

export function textWithFixes(text: string, corrections: readonly WritingCorrection[]): string {
  return applyCorrections(text, corrections, 'errors');
}
