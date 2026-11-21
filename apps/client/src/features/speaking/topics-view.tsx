import { SPEAKING_CATEGORIES, SPEAKING_LEVELS, formatTimestamp, type SpeakingCategory, type SpeakingLevel } from '@ldg/shared';
import { ArrowRight, PenLine, Plus, Search, Sparkles, Trash, X } from 'lucide-react';
import { useId, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { CEFR_DISCLAIMER } from './generation-labels';
import { CATEGORY_LABELS } from './prompt-library';
import { filterTopics, hasFilters, NO_FILTERS, type TopicEntry, type TopicFilters, type TopicSource } from './topic-catalogue';

const CONTROL = 'h-10 rounded-md border border-input bg-card px-3 text-sm hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none';
const SECTION_HEADING = 'mb-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase';

/** Level · category · time · format, the same for every topic. */
function TopicMeta({ entry, className }: { entry: TopicEntry; className?: string }) {
  return (
    <span className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground', className)}>
      <Badge variant="outline" className="px-2 py-0">
        {entry.level ?? 'Any level'}
      </Badge>
      <span>{CATEGORY_LABELS[entry.category]}</span>
      <span aria-hidden="true">·</span>
      <span>{entry.durationSeconds !== null ? formatTimestamp(entry.durationSeconds) : 'Any length'}</span>
      <span aria-hidden="true">·</span>
      <span>{entry.formatLabel}</span>
    </span>
  );
}

function SourceTag({ entry }: { entry: TopicEntry }) {
  if (entry.source === 'curated') return null;
  return entry.generated ? (
    <Badge variant="brand" className="px-2 py-0">
      <Sparkles aria-hidden="true" />
      AI
    </Badge>
  ) : (
    <Badge variant="neutral" className="px-2 py-0">
      Yours
    </Badge>
  );
}

/** The whole topic: nothing truncated, plus the actions for it. */
export function TopicPreview({ entry, onEdit, onDelete, headingLevel = 'h2' }: { entry: TopicEntry; onEdit: () => void; onDelete: () => void; headingLevel?: 'h2' | 'h3' }) {
  const Heading = headingLevel;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <TopicMeta entry={entry} />
          <SourceTag entry={entry} />
        </span>
        <Heading className="font-serif text-2xl leading-snug">{entry.title}</Heading>
        <p className="font-serif text-[1.125rem] leading-relaxed">{entry.instructions}</p>
      </div>
      {entry.points.length > 0 ? (
        <div>
          <p className={SECTION_HEADING}>Points to cover</p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
            {entry.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {entry.structure.length > 0 ? (
        <div>
          <p className={SECTION_HEADING}>Suggested structure (guided mode)</p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed">
            {entry.structure.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {entry.generated ? (
        <>
          <div>
            <p className={SECTION_HEADING}>How to approach it</p>
            <p className="text-sm leading-relaxed">{entry.generated.guidance}</p>
          </div>
          {entry.generated.objectives.length > 0 ? (
            <div>
              <p className={SECTION_HEADING}>Aim to</p>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
                {entry.generated.objectives.map((objective) => (
                  <li key={objective}>{objective}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {entry.generated.vocabulary.length > 0 || entry.generated.followUpQuestions.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              The practice page also shows {entry.generated.vocabulary.length} useful expressions and {entry.generated.followUpQuestions.length} follow-up questions.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{CEFR_DISCLAIMER}</p>
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Link to={entry.practicePath} className={buttonVariants()}>
          Practise this topic
          <ArrowRight aria-hidden="true" />
        </Link>
        {entry.custom ? (
          <>
            <Button variant="secondary" onClick={onEdit}>
              <PenLine aria-hidden="true" />
              Edit
            </Button>
            <Button variant="ghost" onClick={onDelete} aria-label={`Delete topic ${entry.title}`}>
              <Trash aria-hidden="true" />
              Delete
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function FilterBar({ filters, onChange, count, total }: { filters: TopicFilters; onChange: (filters: TopicFilters) => void; count: number; total: number }) {
  const ids = { search: useId(), level: useId(), category: useId(), source: useId() };
  const set = <K extends keyof TopicFilters>(key: K, value: TopicFilters[K]) => onChange({ ...filters, [key]: value });
  const sources: Array<{ value: TopicSource | 'all'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'curated', label: 'Library' },
    { value: 'personal', label: 'Yours' },
  ];
  return (
    <div className="flex flex-col gap-2">
      {/* Phones: search, then level and category side by side, then source. Wider: one row. */}
      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
        <div className="relative col-span-2 min-w-0 sm:flex-[1_1_14rem]">
          <label htmlFor={ids.search} className="sr-only">
            Search topics
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input id={ids.search} type="search" value={filters.query} placeholder="Search topics" onChange={(event) => set('query', event.target.value)} className={cn(CONTROL, 'w-full pl-9')} />
        </div>
        <label htmlFor={ids.level} className="sr-only">
          Level
        </label>
        <select id={ids.level} value={filters.level} onChange={(event) => set('level', event.target.value as SpeakingLevel | 'all')} className={cn(CONTROL, 'min-w-0 sm:flex-[0_1_9rem]')}>
          <option value="all">All levels</option>
          {SPEAKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <label htmlFor={ids.category} className="sr-only">
          Category
        </label>
        <select id={ids.category} value={filters.category} onChange={(event) => set('category', event.target.value as SpeakingCategory | 'all')} className={cn(CONTROL, 'min-w-0 sm:flex-[0_1_12rem]')}>
          <option value="all">All categories</option>
          {SPEAKING_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <fieldset className="col-span-2 flex h-10 items-center rounded-md border border-input bg-card p-0.5 sm:col-span-1">
          <legend className="sr-only">Source</legend>
          {sources.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex h-full flex-1 cursor-pointer items-center justify-center rounded-[calc(var(--radius)*0.6)] px-3 text-sm transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring sm:flex-none',
                filters.source === option.value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <input type="radio" name={ids.source} value={option.value} checked={filters.source === option.value} onChange={() => set('source', option.value)} className="sr-only" />
              {option.label}
            </label>
          ))}
        </fieldset>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        {count === total ? `${total} topics` : `${count} of ${total} topics`}
        {hasFilters(filters) ? (
          <button type="button" onClick={() => onChange(NO_FILTERS)} className="inline-flex min-h-6 items-center gap-1 rounded underline-offset-2 hover:text-foreground hover:underline">
            <X aria-hidden="true" className="size-3" />
            Clear filters
          </button>
        ) : null}
      </p>
    </div>
  );
}

function TopicRow({ entry, selected, desktop, previewId, onSelect }: { entry: TopicEntry; selected: boolean; desktop: boolean; previewId: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-controls={previewId}
      // Desktop: picks the topic shown beside the list. Phones: opens its preview in place.
      {...(desktop ? { 'aria-pressed': selected } : { 'aria-expanded': selected })}
      className={cn(
        'flex w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors duration-150',
        selected ? 'bg-accent' : 'hover:bg-accent/40',
        desktop && selected && 'shadow-[inset_2px_0_0_var(--brand)]',
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-medium leading-snug">{entry.title}</span>
        <SourceTag entry={entry} />
      </span>
      <TopicMeta entry={entry} />
    </button>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 flex items-baseline gap-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {title}
        <span className="font-normal tracking-normal normal-case tabular-nums">{count}</span>
      </h2>
      {children}
    </section>
  );
}

export function TopicsView({
  catalogue,
  filters,
  onFiltersChange,
  selectedKey,
  onSelect,
  onNewTopic,
  onEdit,
  onDelete,
}: {
  catalogue: readonly TopicEntry[];
  filters: TopicFilters;
  onFiltersChange: (filters: TopicFilters) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onNewTopic: () => void;
  onEdit: (entry: TopicEntry) => void;
  onDelete: (entry: TopicEntry) => void;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const previewId = useId();
  const visible = useMemo(() => filterTopics(catalogue, filters), [catalogue, filters]);
  // On desktop something is always previewed; on phones nothing is open until chosen.
  const selected = visible.find((entry) => entry.key === selectedKey) ?? (desktop ? (visible[0] ?? null) : null);
  const personal = visible.filter((entry) => entry.source === 'personal');
  const curated = visible.filter((entry) => entry.source === 'curated');
  const personalTotal = catalogue.filter((entry) => entry.source === 'personal').length;

  const list = (entries: TopicEntry[]) => (
    <ul className="divide-y overflow-hidden rounded-lg border bg-card">
      {entries.map((entry) => {
        const isSelected = selected?.key === entry.key;
        return (
          <li key={entry.key}>
            <TopicRow entry={entry} selected={isSelected} desktop={desktop} previewId={previewId} onSelect={() => onSelect(desktop || !isSelected ? entry.key : null)} />
            {!desktop && isSelected ? (
              <div id={previewId} className="border-t bg-background px-4 py-5">
                <TopicPreview entry={entry} headingLevel="h3" onEdit={() => onEdit(entry)} onDelete={() => onDelete(entry)} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col gap-5">
      <FilterBar filters={filters} onChange={onFiltersChange} count={visible.length} total={catalogue.length} />
      {visible.length === 0 ? (
        <EmptyState
          title="No topics match these filters."
          action={
            <Button variant="secondary" size="sm" onClick={() => onFiltersChange(NO_FILTERS)}>
              Clear filters
            </Button>
          }
        >
          Hand-written topics have no level, so they appear only under “All levels”.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
          {/* Desktop: the list scrolls beside the sticky preview, so choosing never scrolls the page away from it. */}
          <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            {filters.source !== 'curated' ? (
              <Group title="Your topics" count={personal.length}>
                {personal.length > 0 ? (
                  list(personal)
                ) : (
                  <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground">
                    {personalTotal === 0 ? 'No topics of your own yet: generate one at B2, C1 or C2, or write one for a real situation.' : 'None of your topics match these filters.'}
                    {personalTotal === 0 ? (
                      <Button size="sm" variant="secondary" onClick={onNewTopic}>
                        <Plus aria-hidden="true" />
                        New topic
                      </Button>
                    ) : null}
                  </div>
                )}
              </Group>
            ) : null}
            {curated.length > 0 ? (
              <Group title="Library" count={curated.length}>
                {list(curated)}
              </Group>
            ) : null}
          </div>
          {desktop && selected ? (
            <aside id={previewId} aria-label="Topic preview" className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-lg border bg-card px-6 py-6">
              <TopicPreview entry={selected} onEdit={() => onEdit(selected)} onDelete={() => onDelete(selected)} />
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
