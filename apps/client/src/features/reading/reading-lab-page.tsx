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
import { BookOpenText, CircleCheck, ClipboardPaste, LoaderCircle, ShieldCheck, Sparkles, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChoiceGroup, FIELD_CLASS, SELECT_CLASS } from '@/components/ui/choice-group';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
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

function GenerateText({ repository, onCreated }: { repository: ReadingRepository; onCreated: (record: ReadingTextRecord) => void }) {
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
            Generate a text
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

function ImportText({ repository, onCreated }: { repository: ReadingRepository; onCreated: (record: ReadingTextRecord) => void }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [level, setLevel] = useState<ReadingLevel | ''>('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const check = checkImportedText(text);

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

export function ReadingLabPage() {
  const storage = readingStorage.use();
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'generate' | 'import'>('generate');
  const [texts, setTexts] = useState<ReadingTextRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReadingTextRecord | null>(null);
  const ids = { add: useId(), library: useId() };
  const generationAvailable = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;

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

  return (
    <>
      <PageHeader
        eyebrow="Reading"
        title="Read closely, keep what matters."
        description="Read texts written for your level or your own articles, look up expressions in context, save them to your vocabulary, and check your understanding against the text."
      />
      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Your texts will last until you close this tab.</Notice> : null}
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card aria-labelledby={ids.add} className="min-w-0">
          <CardHeader>
            <CardTitle id={ids.add}>New text</CardTitle>
            <CardDescription>Generate a text for your level, or paste one of your own. No web pages are downloaded.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 pt-1">
            <div role="group" aria-label="Source" className="inline-flex self-start rounded-lg border bg-card p-1">
              {(
                [
                  ['generate', 'Generate', Sparkles],
                  ['import', 'Paste your own', ClipboardPaste],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                  className={cn('inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm transition-colors duration-150', mode === value ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </button>
              ))}
            </div>
            {!storage ? null : mode === 'import' ? (
              <ImportText repository={storage.repository} onCreated={open} />
            ) : capabilities.status === 'ready' && !generationAvailable ? (
              <Notice>
                Generating texts needs a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>. You can still paste your own.
              </Notice>
            ) : (
              <GenerateText repository={storage.repository} onCreated={open} />
            )}
          </CardContent>
        </Card>

        <Card aria-labelledby={ids.library} className="min-w-0">
          <CardHeader>
            <CardTitle id={ids.library}>Your library</CardTitle>
            <CardDescription>{storage?.persistent === false ? 'Kept until you close this tab.' : 'Saved in this browser.'}</CardDescription>
          </CardHeader>
          <CardContent className="pt-1">
            {texts === null ? null : texts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Texts you generate or paste appear here.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border" aria-label="Saved texts">
                {texts.map((record) => {
                  const progress = record.progress.completedAt ? 100 : Math.round(((record.progress.furthestParagraph + 1) / record.paragraphs.length) * 100);
                  return (
                    <li key={record.id} className="flex items-center gap-2 px-3 py-2">
                      <Link to={`/reading/texts/${record.id}`} className="min-w-0 flex-1 rounded-md px-1 py-1 hover:bg-accent/40">
                        <span className="block truncate font-serif text-[1.0625rem]">{record.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {record.level ? (
                            <Badge variant="outline" className="px-2 py-0">
                              {record.level}
                            </Badge>
                          ) : null}
                          {record.source === 'imported' ? 'Your text' : record.textType ? TEXT_TYPE_LABELS[record.textType] : 'Text'} · {record.estimatedMinutes} min ·{' '}
                          {record.progress.completedAt ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <CircleCheck aria-hidden="true" className="size-3" />
                              Finished
                            </span>
                          ) : (
                            `${progress}% read`
                          )}{' '}
                          · {dateFormatter.format(record.createdAt)}
                        </span>
                      </Link>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${record.title}`} onClick={() => setPendingDelete(record)}>
                        <Trash aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-4 flex gap-2 text-xs text-muted-foreground">
              <BookOpenText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Select any word or phrase while reading to look it up in context.
            </p>
          </CardContent>
        </Card>
      </div>

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
