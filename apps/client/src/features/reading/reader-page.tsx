import type { ReadingTextRecord } from '@ldg/shared';
import { ArrowLeft, CircleCheck, ListChecks, Search, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Notice } from '@/components/ui/notice';
import { useCapabilities } from '@/hooks/use-capabilities';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { cn } from '@/lib/utils';
import { ComprehensionPanel, type EvidenceTarget } from './comprehension-panel';
import { LookupPanel } from './lookup-panel';
import { READING_DISCLAIMER, TEXT_TYPE_LABELS } from './reading-labels';
import { SIZE_CLASSES, SPACING_CLASSES, WIDTH_CLASSES, useReadingPreferences } from './reading-preferences';
import { readingStorage } from './storage/reading-repository';
import { useTextSelection, type TextSelection } from './use-text-selection';

function BackLink() {
  return (
    <Link to="/reading" className={cn(buttonVariants({ variant: 'secondary' }))}>
      <ArrowLeft aria-hidden="true" />
      Library
    </Link>
  );
}

/** A paragraph with an optional highlighted range (the current selection or a question's evidence). */
function Paragraph({ text, index, highlight, tone }: { text: string; index: number; highlight: { start: number; end: number } | null; tone: 'selection' | 'evidence' }) {
  if (!highlight || highlight.start >= highlight.end || highlight.end > text.length) {
    return (
      <p data-paragraph={index} className="mb-[1.1em] last:mb-0">
        {text}
      </p>
    );
  }
  return (
    <p data-paragraph={index} className="mb-[1.1em] last:mb-0">
      {text.slice(0, highlight.start)}
      <mark className={cn('rounded-sm px-0.5 text-foreground', tone === 'evidence' ? 'bg-success-subtle ring-1 ring-success/40' : 'bg-brand-subtle')}>{text.slice(highlight.start, highlight.end)}</mark>
      {text.slice(highlight.end)}
    </p>
  );
}

export function ReaderPage() {
  const { textId = '' } = useParams();
  const storage = readingStorage.use();
  const capabilities = useCapabilities();
  const { preferences, update: setPreference } = useReadingPreferences();
  const [text, setText] = useState<ReadingTextRecord | null | 'missing'>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'lookup' | 'questions'>('lookup');
  const [showSettings, setShowSettings] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const articleRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const furthestRef = useRef(0);
  const selection = useTextSelection(articleRef);
  const ids = { settings: useId(), panel: useId() };
  const available = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;
  const lookupAvailable = capabilities.status === 'ready' && capabilities.data.feedback.available;

  useEffect(() => {
    if (!storage) return;
    let active = true;
    storage.repository.texts
      .update(textId, (current) => ({ ...current, progress: { ...current.progress, lastOpenedAt: Date.now() } }))
      .then(
        (record) => {
          if (!active) return;
          furthestRef.current = record?.progress.furthestParagraph ?? 0;
          setText(record ?? 'missing');
        },
        (caught: unknown) => {
          if (!active) return;
          setError(describeStorageFailure(caught));
          setText('missing');
        },
      );
    return () => {
      active = false;
    };
  }, [storage, textId]);

  const saveProgress = useCallback(
    (change: (progress: ReadingTextRecord['progress']) => ReadingTextRecord['progress']) => {
      if (!storage) return;
      storage.repository.texts
        .update(textId, (current) => ({ ...current, progress: change(current.progress), updatedAt: Date.now() }))
        .then((record) => record && setText(record), (caught: unknown) => setError(describeStorageFailure(caught)));
    },
    [storage, textId],
  );

  // Reading progress: the furthest paragraph that has been fully on screen.
  const paragraphCount = text && text !== 'missing' ? text.paragraphs.length : 0;
  useEffect(() => {
    const article = articleRef.current;
    if (!article || paragraphCount === 0 || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (records) => {
        let furthest = furthestRef.current;
        for (const record of records) if (record.isIntersecting) furthest = Math.max(furthest, Number((record.target as HTMLElement).dataset.paragraph));
        if (furthest > furthestRef.current) {
          furthestRef.current = furthest;
          saveProgress((progress) => ({ ...progress, furthestParagraph: Math.max(progress.furthestParagraph, furthest) }));
        }
      },
      { threshold: 0.9 },
    );
    article.querySelectorAll('[data-paragraph]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [paragraphCount, saveProgress]);

  // The phone action bar is only needed while the tools panel is off screen.
  useEffect(() => {
    const element = panelRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([record]) => setPanelVisible(Boolean(record?.isIntersecting)), { threshold: 0.05 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [paragraphCount]);

  if (text === null) {
    return (
      <p role="status" className="py-24 text-center text-sm text-muted-foreground">
        Opening the text…
      </p>
    );
  }
  if (text === 'missing') {
    return <PageHeader eyebrow="Reading" title="Text not found" description={error ?? 'It may have been deleted, or it was saved in another browser.'} actions={<BackLink />} />;
  }

  const current = selection.state.kind === 'valid' ? selection.state.selection : null;
  const percent = text.progress.completedAt ? 100 : Math.round(((text.progress.furthestParagraph + 1) / text.paragraphs.length) * 100);

  function select(target: TextSelection) {
    selection.set(target);
    setEvidence(null);
    setPanel('lookup');
  }

  function showEvidence(target: EvidenceTarget) {
    setEvidence(target);
    const element = articleRef.current?.querySelector(`[data-paragraph="${target.paragraphIndex}"]`);
    element?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }

  return (
    <>
      <PageHeader
        eyebrow={text.source === 'imported' ? 'Your text' : text.textType ? TEXT_TYPE_LABELS[text.textType] : 'Reading'}
        title={<span className="font-serif break-words">{text.title}</span>}
        description={`${text.wordCount} words · about ${text.estimatedMinutes} min${text.level ? ` · ${text.level}` : ''}`}
        actions={<BackLink />}
      />
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-48 flex-1 items-center gap-3" aria-label={`Reading progress: ${percent}%`} role="group">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
              </div>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{percent}%</span>
            </div>
            <Button variant="ghost" size="sm" aria-expanded={showSettings} aria-controls={ids.settings} onClick={() => setShowSettings((value) => !value)}>
              <SlidersHorizontal aria-hidden="true" />
              Display
            </Button>
          </div>
          {showSettings ? (
            <div id={ids.settings} className="grid gap-4 rounded-lg border bg-card px-4 py-4 sm:grid-cols-2">
              <ChoiceGroup legend="Text size" value={preferences.size} options={(['small', 'medium', 'large', 'xlarge'] as const).map((value) => ({ value, label: { small: 'S', medium: 'M', large: 'L', xlarge: 'XL' }[value] }))} onChange={(value) => setPreference('size', value)} />
              <ChoiceGroup legend="Line spacing" value={preferences.spacing} options={(['compact', 'comfortable', 'airy'] as const).map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} onChange={(value) => setPreference('spacing', value)} />
              <ChoiceGroup legend="Width" value={preferences.width} options={(['narrow', 'medium', 'wide'] as const).map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} onChange={(value) => setPreference('width', value)} />
              <ChoiceGroup legend="Typeface" value={preferences.font} options={[{ value: 'serif' as const, label: 'Serif' }, { value: 'sans' as const, label: 'Sans' }]} onChange={(value) => setPreference('font', value)} />
            </div>
          ) : null}

          <article className="rounded-xl border bg-card px-5 py-7 shadow-xs sm:px-10 sm:py-10">
            <div
              ref={articleRef}
              lang="en"
              className={cn('mx-auto text-foreground selection:bg-brand-subtle', WIDTH_CLASSES[preferences.width], SIZE_CLASSES[preferences.size], SPACING_CLASSES[preferences.spacing], preferences.font === 'serif' ? 'font-serif' : 'font-sans')}
            >
              {text.paragraphs.map((paragraph, index) => {
                const evidenceHere = evidence && evidence.paragraphIndex === index && evidence.start !== null && evidence.end !== null ? { start: evidence.start, end: evidence.end } : null;
                const selectionHere = !evidenceHere && current?.programmatic && current.paragraphIndex === index ? current : null;
                return <Paragraph key={index} index={index} text={paragraph} highlight={evidenceHere ?? selectionHere} tone={evidenceHere ? 'evidence' : 'selection'} />;
              })}
            </div>
          </article>

          <div className="flex flex-wrap items-center gap-3">
            {text.progress.completedAt ? (
              <p className="inline-flex items-center gap-2 text-sm">
                <CircleCheck aria-hidden="true" className="size-4 text-success" />
                Finished reading
                <Button variant="ghost" size="sm" onClick={() => saveProgress((progress) => ({ ...progress, completedAt: null }))}>
                  Mark as unread
                </Button>
              </p>
            ) : (
              <Button variant="secondary" onClick={() => saveProgress((progress) => ({ ...progress, completedAt: Date.now(), furthestParagraph: text.paragraphs.length - 1 }))}>
                <CircleCheck aria-hidden="true" />
                I've finished reading
              </Button>
            )}
            {text.source === 'generated' ? <span className="text-xs text-muted-foreground">{READING_DISCLAIMER}</span> : null}
          </div>

          {text.objectives.length > 0 || text.vocabulary.length > 0 ? (
            <div className="grid gap-4 rounded-lg border px-4 py-4 sm:grid-cols-2">
              {text.objectives.length > 0 ? (
                <div>
                  <h2 className="mb-1.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Reading objectives</h2>
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
                    {text.objectives.map((objective) => (
                      <li key={objective}>{objective}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {text.vocabulary.length > 0 ? (
                <div>
                  <h2 className="mb-1.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Worth noticing</h2>
                  <ul className="flex flex-col gap-1">
                    {text.vocabulary.map((item) => (
                      <li key={item.expression}>
                        <button
                          type="button"
                          className="text-left text-sm hover:underline"
                          onClick={() => {
                            for (const [index, paragraph] of text.paragraphs.entries()) {
                              const at = paragraph.toLowerCase().indexOf(item.expression.toLowerCase());
                              if (at !== -1) {
                                select({ text: paragraph.slice(at, at + item.expression.length), paragraphIndex: index, start: at, end: at + item.expression.length });
                                panelRef.current?.scrollIntoView({ block: 'start' });
                                return;
                              }
                            }
                          }}
                        >
                          <span className="font-serif text-[1rem] font-medium">{item.expression}</span>
                          <span className="text-muted-foreground"> — {item.meaning}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside ref={panelRef} className="min-w-0 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:self-start xl:overflow-y-auto" aria-labelledby={ids.panel}>
          <div className="rounded-xl border bg-card">
            <h2 id={ids.panel} className="sr-only">
              Reading tools
            </h2>
            <div role="tablist" aria-label="Reading tools" className="flex gap-1 border-b px-2 pt-2">
              {(
                [
                  ['lookup', 'Look up', Search],
                  ['questions', 'Comprehension', ListChecks],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  id={`${ids.panel}-${value}`}
                  aria-selected={panel === value}
                  aria-controls={`${ids.panel}-content`}
                  onClick={() => setPanel(value)}
                  className={cn(
                    '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors duration-150',
                    panel === value ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                  {value === 'lookup' && current ? <Badge variant="brand" className="px-1.5 py-0">1</Badge> : null}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`${ids.panel}-content`} aria-labelledby={`${ids.panel}-${panel}`} className="px-4 py-4">
              {panel === 'lookup' ? (
                <LookupPanel text={text} selection={selection.state} available={lookupAvailable} onSelect={select} onClear={selection.clear} />
              ) : storage ? (
                <ComprehensionPanel text={text} repository={storage.repository} available={available} onShowEvidence={showEvidence} />
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      {/* Phones: a compact action bar for the current selection, so the lookup is one tap away. */}
      {current && panel === 'lookup' && !panelVisible ? (
        <div className="fixed inset-x-3 bottom-3 z-30 flex items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-lg xl:hidden">
          <span className="min-w-0 flex-1 truncate font-serif text-[1.0625rem]">“{current.text}”</span>
          <Button size="sm" onClick={() => panelRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })}>
            <Search aria-hidden="true" />
            Look up
          </Button>
        </div>
      ) : null}
    </>
  );
}
