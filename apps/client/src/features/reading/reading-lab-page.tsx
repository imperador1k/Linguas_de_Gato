import {
  READING_LEVELS,
  READING_LIMITS,
  READING_RECORD_VERSION,
  READING_TEXT_TYPES,
  SPEAKING_CATEGORIES,
  checkImportedText,
  estimateReadingMinutes,
  type ReadingLevel,
  type ReadingTextRecord,
  type ReadingTextType,
  type WritingCategory,
} from '@ldg/shared';
import { ArrowRight, BookOpenText, CircleCheck, ClipboardPaste, LoaderCircle, Plus, ShieldCheck, Sparkles, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChoiceGroup, FIELD_CLASS, SELECT_CLASS } from '@/components/ui/choice-group';
import { ContinueCard } from '@/components/ui/continue-card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpDisclosure } from '@/components/ui/help-disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { PrivacyNote } from '@/components/ui/privacy-note';
import { FILTER_CONTROL, resultCount, SEARCH_THRESHOLD, SearchField } from '@/components/ui/search-field';
import { SidePanel } from '@/components/ui/side-panel';
import { TabList, tabPanelProps } from '@/components/ui/tabs';
import { useCapabilities } from '@/hooks/use-capabilities';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { useGenerationJob } from '@/lib/use-generation-job';
import { cn } from '@/lib/utils';
import { LEVEL_DESCRIPTIONS } from '../speaking/generation-labels';
import { CATEGORY_LABELS } from '../speaking/prompt-library';
import { dateFormatter, LENGTH_OPTIONS, TEXT_TYPE_LABELS } from './reading-labels';
import { deleteReadingText, readingStorage, type ReadingRepository } from './storage/reading-repository';

function newRecord(fields: Omit<ReadingTextRecord, 'id' | 'version' | 'language' | 'progress' | 'createdAt' | 'updatedAt'>): ReadingTextRecord {
  const now = Date.now();
  return { ...fields, id: crypto.randomUUID(), version: READING_RECORD_VERSION, language: 'en', progress: { furthestParagraph: 0, completedAt: null, lastOpenedAt: now }, createdAt: now, updatedAt: now };
}

type CreateProps = { repository: ReadingRepository; onCreated: (record: ReadingTextRecord) => void; onDirtyChange: (dirty: boolean) => void };

function GenerateText({ repository, onCreated, onDirtyChange }: CreateProps) {
  const job = useGenerationJob();
  const [level, setLevel] = useState<ReadingLevel>('C1');
  const [textType, setTextType] = useState<ReadingTextType>('article');
  const [category, setCategory] = useState<WritingCategory>('culture');
  const [targetWords, setTargetWords] = useState<number>(400);
  const [interest, setInterest] = useState('');
  const [focus, setFocus] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const running = job.state.phase === 'running';
  const elapsed = useElapsedSeconds(job.state.phase === 'running' ? job.state.startedAt : null);
  const id = useId();

  useEffect(() => onDirtyChange(running), [running, onDirtyChange]);

  async function generate() {
    setSaveError(null);
    const response = await job.start({ kind: 'reading', level, category, textType, targetWords, interest: interest.trim() || null, languageFocus: focus.trim() || null, avoidTitles: [] });
    if (!response || response.result.kind !== 'reading') return;
    const { text } = response.result;
    const record = newRecord({
      source: 'generated',
      title: text.title,
      paragraphs: text.paragraphs,
      wordCount: text.wordCount,
      estimatedMinutes: text.estimatedMinutes,
      level: text.level,
      textType: text.textType,
      category,
      objectives: text.objectives,
      vocabulary: text.vocabulary,
      model: response.model,
    });
    try {
      await repository.texts.put(record);
      onCreated(record);
    } catch (caught) {
      setSaveError(describeStorageFailure(caught));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <ChoiceGroup legend="Target level" value={level} disabled={running} options={READING_LEVELS.map((value) => ({ value, label: value }))} onChange={setLevel} />
          <p className="text-xs text-muted-foreground">{LEVEL_DESCRIPTIONS[level]}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-type`}>Text type</Label>
          <select id={`${id}-type`} value={textType} disabled={running} onChange={(event) => setTextType(event.target.value as ReadingTextType)} className={SELECT_CLASS}>
            {READING_TEXT_TYPES.map((value) => (
              <option key={value} value={value}>
                {TEXT_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-category`}>Topic</Label>
          <select id={`${id}-category`} value={category} disabled={running} onChange={(event) => setCategory(event.target.value as WritingCategory)} className={SELECT_CLASS}>
            {SPEAKING_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <ChoiceGroup
          legend="Length"
          value={targetWords}
          disabled={running}
          options={LENGTH_OPTIONS.map((value) => ({ value, label: <span className="tabular-nums">~{value}</span>, hint: `${estimateReadingMinutes(value)} min` }))}
          onChange={setTargetWords}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-interest`}>Personal interests (optional)</Label>
          <Input id={`${id}-interest`} value={interest} maxLength={300} disabled={running} placeholder="e.g. urban design, jazz, marine biology" onChange={(event) => setInterest(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-focus`}>Language focus (optional)</Label>
          <Input id={`${id}-focus`} value={focus} maxLength={200} disabled={running} placeholder="e.g. hedging, phrasal verbs" onChange={(event) => setFocus(event.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <>
            <Button disabled>
              <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              Writing…
            </Button>
            <Button variant="ghost" onClick={job.cancel}>
              Cancel
            </Button>
            <span role="status" className="text-sm text-muted-foreground tabular-nums">
              Writing your passage · {elapsed}s
            </span>
          </>
        ) : (
          <Button onClick={() => void generate()}>
            <Sparkles aria-hidden="true" />
            Generate
          </Button>
        )}
      </div>
      {job.state.phase === 'failed' ? (
        <Notice tone="error" role="alert">
          {job.state.message}
        </Notice>
      ) : null}
      {saveError ? (
        <Notice tone="error" role="alert">
          {saveError}
        </Notice>
      ) : null}
      {job.state.phase === 'cancelled' ? <p className="text-sm text-muted-foreground">Generation cancelled.</p> : null}
      <p className="text-xs text-muted-foreground">Your settings and anything you type here are sent to Groq to write the text. The level is a practice target, not an official CEFR assessment.</p>
    </div>
  );
}

function ImportText({ repository, onCreated, onDirtyChange }: CreateProps) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [level, setLevel] = useState<ReadingLevel | ''>('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const check = checkImportedText(text);
  const dirty = text.trim() !== '' || title.trim() !== '';
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function save() {
    if (check.problem) {
      setError(check.problem);
      return;
    }
    const record = newRecord({
      source: 'imported',
      title: title.trim() || (check.paragraphs[0] ?? 'Untitled').split(/\s+/).slice(0, 8).join(' ').slice(0, READING_LIMITS.maxTitleChars),
      paragraphs: check.paragraphs,
      wordCount: check.wordCount,
      estimatedMinutes: estimateReadingMinutes(check.wordCount),
      level: level === '' ? null : level,
      textType: null,
      category: null,
      objectives: [],
      vocabulary: [],
      model: null,
    });
    try {
      await repository.texts.put(record);
      onCreated(record);
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-title`}>Title (optional)</Label>
          <Input id={`${id}-title`} value={title} maxLength={READING_LIMITS.maxTitleChars} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-level`}>Level (optional)</Label>
          <select id={`${id}-level`} value={level} onChange={(event) => setLevel(event.target.value as ReadingLevel | '')} className={SELECT_CLASS}>
            <option value="">Not set</option>
            {READING_LEVELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-text`}>Text</Label>
        <AutoGrowTextarea
          id={`${id}-text`}
          value={text}
          rows={8}
          maxLength={READING_LIMITS.maxTextChars + 1}
          placeholder="Paste an article, essay or story you own or are allowed to use. Leave a blank line between paragraphs."
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          className={cn(FIELD_CLASS, 'max-h-[60vh] overflow-y-auto font-serif text-[1.0625rem]')}
        />
        <p className="text-xs text-muted-foreground tabular-nums">
          {check.wordCount} words · {check.paragraphs.length} paragraphs · up to {READING_LIMITS.maxTextChars.toLocaleString()} characters
        </p>
      </div>
      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <Button className="self-start" onClick={() => void save()} disabled={text.trim() === ''}>
        <ClipboardPaste aria-hidden="true" />
        Save and read
      </Button>
      <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>Your text is saved only in this browser. It is sent to Groq only when you ask for questions or look up a word (the sentence and its paragraph).</span>
      </p>
    </div>
  );
}

type TextStatus = 'not_started' | 'in_progress' | 'finished';

function statusOf(record: ReadingTextRecord): TextStatus {
  if (record.progress.completedAt) return 'finished';
  return record.progress.furthestParagraph > 0 ? 'in_progress' : 'not_started';
}

function percentRead(record: ReadingTextRecord): number {
  return record.progress.completedAt ? 100 : Math.round(((record.progress.furthestParagraph + 1) / record.paragraphs.length) * 100);
}

/** "New text": generate one for your level or paste your own, in the shared creation panel. */
function NewTextPanel({ open, repository, canGenerate, onClose, onCreated }: { open: boolean; repository: ReadingRepository; canGenerate: boolean; onClose: () => void; onCreated: (record: ReadingTextRecord) => void }) {
  const [mode, setMode] = useState<'generate' | 'import'>(canGenerate ? 'generate' : 'import');
  const [generateDirty, setGenerateDirty] = useState(false);
  const [importDirty, setImportDirty] = useState(false);
  const onGenerateDirty = useCallback((dirty: boolean) => setGenerateDirty(dirty), []);
  const onImportDirty = useCallback((dirty: boolean) => setImportDirty(dirty), []);
  const idBase = useId();
  return (
    <SidePanel open={open} onClose={onClose} dirty={generateDirty || importDirty} busy={generateDirty} title="New text" description="Generate a text for your level, or paste one of your own. No web pages are downloaded.">
      {open ? (
        <div className="flex flex-col gap-5">
          <TabList
            label="Where the text comes from"
            idBase={idBase}
            value={mode}
            onChange={setMode}
            items={[
              { value: 'generate', label: 'Generate', icon: Sparkles },
              { value: 'import', label: 'Paste your own', icon: ClipboardPaste },
            ]}
          />
          <div {...tabPanelProps(idBase, 'generate')} hidden={mode !== 'generate'} className="outline-none">
            {canGenerate ? (
              <GenerateText repository={repository} onCreated={onCreated} onDirtyChange={onGenerateDirty} />
            ) : (
              <Notice>
                Generating texts needs a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>. You can still paste your own.
              </Notice>
            )}
          </div>
          <div {...tabPanelProps(idBase, 'import')} hidden={mode !== 'import'} className="outline-none">
            <ImportText repository={repository} onCreated={onCreated} onDirtyChange={onImportDirty} />
          </div>
        </div>
      ) : null}
    </SidePanel>
  );
}

/**
 * The Reading hub: one "New text" action (generate or paste, in a side panel),
 * the text you were reading, and the library with search and status filters.
 */
export function ReadingLabPage() {
  const storage = readingStorage.use();
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [texts, setTexts] = useState<ReadingTextRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReadingTextRecord | null>(null);
  const [panel, setPanel] = useState({ open: false, key: 0 });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<TextStatus | 'all'>('all');
  const generationAvailable = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;
  const openPanel = () => setPanel((current) => ({ open: true, key: current.key + 1 }));

  const refresh = useCallback(async () => {
    if (!storage) return;
    try {
      setTexts((await storage.repository.texts.list()).sort((a, b) => b.progress.lastOpenedAt - a.progress.lastOpenedAt));
    } catch (caught) {
      setError(describeStorageFailure(caught));
      setTexts([]);
    }
  }, [storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = (record: ReadingTextRecord) => navigate(`/reading/texts/${record.id}`);
  const resume = useMemo(() => (texts ?? []).find((record) => statusOf(record) === 'in_progress') ?? null, [texts]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (texts ?? []).filter((record) => (status === 'all' || statusOf(record) === status) && (!needle || record.title.toLowerCase().includes(needle)));
  }, [texts, query, status]);
  const filtered = query.trim() !== '' || status !== 'all';

  return (
    <>
      <PageHeader
        eyebrow="Reading"
        title="Read closely, keep what matters."
        description="Read texts written for your level or your own articles, look up expressions in context, save them to your vocabulary, and check your understanding against the text."
        actions={
          storage ? (
            <Button onClick={openPanel}>
              <Plus aria-hidden="true" />
              New text
            </Button>
          ) : null
        }
      />
      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Your texts will last until you close this tab.</Notice> : null}
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}

      {resume ? <ContinueCard title={resume.title} detail={`${percentRead(resume)}% read · ${resume.estimatedMinutes} min`} to={`/reading/texts/${resume.id}`} action="Continue reading" /> : null}

      {texts === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading your library…
        </p>
      ) : texts.length === 0 ? (
        <EmptyState
          title="Your library is empty."
          action={
            <Button size="sm" onClick={openPanel}>
              <Plus aria-hidden="true" />
              New text
            </Button>
          }
        >
          Generate a text for your level or paste one of your own. While reading, select any word or phrase to look it up in context.
        </EmptyState>
      ) : (
        <section aria-labelledby="reading-library" className="flex flex-col gap-4">
          <h2 id="reading-library" className="sr-only">
            Your library
          </h2>
          {texts.length >= SEARCH_THRESHOLD ? (
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              <SearchField label="Search your library" value={query} onChange={setQuery} className="sm:flex-[1_1_16rem]" />
              <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value as TextStatus | 'all')} className={cn(FILTER_CONTROL, 'min-w-0 sm:flex-[0_1_11rem]')}>
                <option value="all">All texts</option>
                <option value="in_progress">In progress</option>
                <option value="not_started">Not started</option>
                <option value="finished">Finished</option>
              </select>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {resultCount(visible.length, texts.length, 'text')} · {storage?.persistent === false ? 'kept until you close this tab' : 'saved in this browser'}
            {filtered ? (
              <button
                type="button"
                className="ml-2 underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setQuery('');
                  setStatus('all');
                }}
              >
                Clear filters
              </button>
            ) : null}
          </p>
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No texts match.</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card" aria-label="Saved texts">
              {visible.map((record) => (
                <li key={record.id} className="flex items-center gap-2 px-3 py-2 sm:px-4">
                  <Link to={`/reading/texts/${record.id}`} className="group min-w-0 flex-1 rounded-md py-1.5">
                    <span className="flex items-center gap-2">
                      <span className="font-serif text-[1.0625rem] group-hover:underline">{record.title}</span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                      {record.level ? (
                        <Badge variant="outline" className="px-2 py-0">
                          {record.level}
                        </Badge>
                      ) : null}
                      <span>{record.source === 'imported' ? 'Your text' : record.textType ? TEXT_TYPE_LABELS[record.textType] : 'Text'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{record.estimatedMinutes} min</span>
                      <span aria-hidden="true">·</span>
                      <span>{dateFormatter.format(record.createdAt)}</span>
                      {record.progress.completedAt ? (
                        <Badge variant="success" className="px-2 py-0">
                          <CircleCheck aria-hidden="true" />
                          Finished
                        </Badge>
                      ) : statusOf(record) === 'in_progress' ? (
                        <Badge variant="outline" className="px-2 py-0">
                          {percentRead(record)}% read
                        </Badge>
                      ) : (
                        <Badge variant="neutral" className="px-2 py-0">
                          Not started
                        </Badge>
                      )}
                    </span>
                  </Link>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${record.title}`} onClick={() => setPendingDelete(record)}>
                    <Trash aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <HelpDisclosure id="reading" title="How reading practice works" className="mt-10">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>
            <BookOpenText aria-hidden="true" className="mr-1 inline size-3.5" />
            Select any word or phrase while reading to look it up in context, then save it to your vocabulary.
          </li>
          <li>Comprehension questions are generated from the text on request; answers are checked against evidence quoted from the passage.</li>
          <li>Levels are practice targets, not an official CEFR assessment.</li>
        </ul>
        <PrivacyNote className="mt-3">Your texts stay in this browser. A text is sent to Groq only when you ask for questions or look up a word (the sentence and its paragraph).</PrivacyNote>
      </HelpDisclosure>

      {storage ? <NewTextPanel key={panel.key} open={panel.open} repository={storage.repository} canGenerate={!(capabilities.status === 'ready' && !generationAvailable)} onClose={() => setPanel((current) => ({ ...current, open: false }))} onCreated={open} /> : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this text?"
        description="The text, your reading progress and its comprehension questions are removed from this browser. Expressions you saved to your vocabulary are kept."
        confirmLabel="Delete text"
        destructive
        onConfirm={() => {
          const record = pendingDelete;
          setPendingDelete(null);
          if (record && storage) void deleteReadingText(storage.repository, record.id).then(refresh, (caught: unknown) => setError(describeStorageFailure(caught)));
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
