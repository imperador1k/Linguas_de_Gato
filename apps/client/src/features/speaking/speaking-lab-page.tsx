import {
  SPEAKING_CATEGORIES,
  SPEAKING_LIMITS,
  formatTimestamp,
  speakingPromptSchema,
  type CustomTopic,
  type SpeakingAttempt,
  type SpeakingCategory,
  type SpeakingLevel,
} from '@ldg/shared';
import { ArrowRight, Mic, Plus, Sparkles, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { useCapabilities } from '@/hooks/use-capabilities';
import { cn } from '@/lib/utils';
import { FORMAT_LABELS } from './generation-labels';
import { CATEGORY_LABELS, PROMPT_LIBRARY } from './prompt-library';
import { TopicGenerator } from './topic-generator';
import { describeSpeakingStorageError, forgetRecording, useSpeakingStorage, type SpeakingStorage } from './storage/speaking-storage';
import { SpeakingPrivacyNote } from './speaking-practice-page';

const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function FilterButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant={selected ? 'primary' : 'secondary'} size="sm" aria-pressed={selected} onClick={onClick}>
      {children}
    </Button>
  );
}

function PromptLibrary() {
  const [category, setCategory] = useState<SpeakingCategory | 'all'>('all');
  const [level, setLevel] = useState<SpeakingLevel | 'all'>('all');
  const prompts = PROMPT_LIBRARY.filter((prompt) => (category === 'all' || prompt.category === category) && (level === 'all' || prompt.level === level));
  const titleId = useId();

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>Choose a topic</CardTitle>
        <CardDescription>B2 tasks ask for a clear, supported opinion. C1 tasks ask you to weigh views and qualify your claims.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-1">
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Level" className="flex flex-wrap gap-2">
            <FilterButton selected={level === 'all'} onClick={() => setLevel('all')}>
              All levels
            </FilterButton>
            <FilterButton selected={level === 'B2'} onClick={() => setLevel('B2')}>
              B2
            </FilterButton>
            <FilterButton selected={level === 'C1'} onClick={() => setLevel('C1')}>
              C1
            </FilterButton>
          </div>
          <div role="group" aria-label="Category" className="flex flex-wrap gap-2">
            <FilterButton selected={category === 'all'} onClick={() => setCategory('all')}>
              All topics
            </FilterButton>
            {SPEAKING_CATEGORIES.map((value) => (
              <FilterButton key={value} selected={category === value} onClick={() => setCategory(value)}>
                {CATEGORY_LABELS[value]}
              </FilterButton>
            ))}
          </div>
        </div>

        <ul className="grid gap-3 md:grid-cols-2">
          {prompts.map((prompt) => (
            <li key={prompt.id}>
              <Link
                to={`/speaking/practice/library/${prompt.id}`}
                className="group flex h-full flex-col gap-2 rounded-lg border px-4 py-3.5 transition-colors duration-150 hover:border-border-strong hover:bg-accent/40"
              >
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{prompt.level}</Badge>
                  {CATEGORY_LABELS[prompt.category]} · {formatTimestamp(prompt.suggestedDurationSeconds)}
                </span>
                <span className="font-serif text-lg leading-snug">{prompt.title}</span>
                <span className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{prompt.instructions}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium">
                  Practise
                  <ArrowRight aria-hidden="true" className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {prompts.length === 0 ? <p className="text-sm text-muted-foreground">No topics match these filters.</p> : null}
      </CardContent>
    </Card>
  );
}

function CustomTopics({ storage, canGenerate }: { storage: SpeakingStorage; canGenerate: boolean }) {
  const navigate = useNavigate();
  const [topics, setTopics] = useState<CustomTopic[]>([]);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CustomTopic | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [points, setPoints] = useState('');
  const [category, setCategory] = useState<SpeakingCategory>('everyday');
  const [error, setError] = useState<string | null>(null);
  const ids = { title: useId(), instructions: useId(), points: useId(), category: useId(), heading: useId() };

  const refresh = useCallback(async () => {
    try {
      setTopics(await storage.repository.listTopics());
    } catch (caught) {
      setError(describeSpeakingStorageError(caught));
    }
  }, [storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = speakingPromptSchema.safeParse({
      source: 'custom',
      promptId: null,
      title,
      instructions,
      points: points
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      category,
      level: null,
    });
    if (!parsed.success) {
      setError(
        `Check the topic: a title (up to ${SPEAKING_LIMITS.maxTitleChars} characters), what to talk about (up to ${SPEAKING_LIMITS.maxInstructionsChars}), and at most ${SPEAKING_LIMITS.maxPoints} points.`,
      );
      return;
    }
    const topic: CustomTopic = { id: crypto.randomUUID(), prompt: parsed.data, createdAt: Date.now() };
    try {
      await storage.repository.putTopic(topic);
      navigate(`/speaking/practice/custom/${topic.id}`);
    } catch (caught) {
      setError(describeSpeakingStorageError(caught));
    }
  }

  return (
    <Card aria-labelledby={ids.heading}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle id={ids.heading}>Your own topics</CardTitle>
          <CardDescription className="mt-1">
            Practise for a real situation (an interview, a presentation, a meeting), or let AI design a task at B2, C1 or C2.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-1">
        {!open && !generating ? (
          <div className="flex flex-wrap gap-2">
            {canGenerate ? (
              <Button size="sm" onClick={() => setGenerating(true)}>
                <Sparkles aria-hidden="true" />
                Generate with AI
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              <Plus aria-hidden="true" />
              Write your own
            </Button>
          </div>
        ) : null}
        {saved ? (
          <Notice tone="success" role="status">
            Saved “{saved}” to your topics.
          </Notice>
        ) : null}
        {generating ? (
          <TopicGenerator
            storage={storage}
            onClose={() => setGenerating(false)}
            onSaved={(topic, practise) => {
              if (practise) {
                navigate(`/speaking/practice/custom/${topic.id}`);
                return;
              }
              setGenerating(false);
              setSaved(topic.prompt.title);
              void refresh();
            }}
          />
        ) : null}
        {open ? (
          <form onSubmit={(event) => void create(event)} className="flex flex-col gap-4 rounded-lg border px-4 py-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.title}>Title</Label>
              <Input id={ids.title} value={title} maxLength={SPEAKING_LIMITS.maxTitleChars} onChange={(event) => setTitle(event.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.instructions}>What should you talk about?</Label>
              <textarea
                id={ids.instructions}
                value={instructions}
                maxLength={SPEAKING_LIMITS.maxInstructionsChars}
                onChange={(event) => setInstructions(event.target.value)}
                rows={3}
                required
                className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[0.9375rem] hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.points}>Points to cover (optional, one per line)</Label>
              <textarea
                id={ids.points}
                value={points}
                onChange={(event) => setPoints(event.target.value)}
                rows={3}
                className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[0.9375rem] hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.category}>Category</Label>
              <select
                id={ids.category}
                value={category}
                onChange={(event) => setCategory(event.target.value as SpeakingCategory)}
                className="h-11 rounded-md border border-input bg-card px-3 text-[0.9375rem] hover:border-border-strong"
              >
                {SPEAKING_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save and practise</Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
        {error ? (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        ) : null}
        {topics.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {topics.map((topic) => (
              <li key={topic.id} className="flex items-center gap-2 px-3 py-1.5">
                <Link to={`/speaking/practice/custom/${topic.id}`} className="min-w-0 flex-1 rounded-md px-1 py-1.5 hover:underline">
                  <span className="block truncate text-sm font-medium">{topic.prompt.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {topic.generated ? (
                      <>
                        <Badge variant="brand" className="px-2 py-0">
                          AI · {topic.generated.level}
                        </Badge>
                        {FORMAT_LABELS[topic.generated.format].label} ·{' '}
                      </>
                    ) : null}
                    {CATEGORY_LABELS[topic.prompt.category]}
                  </span>
                </Link>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete topic ${topic.prompt.title}`} onClick={() => setPendingDelete(topic)}>
                  <Trash aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : !open && !generating ? (
          <p className="text-sm text-muted-foreground">No topics yet.</p>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this topic?"
        description="The topic is removed from this browser. Attempts you already recorded on it are kept."
        confirmLabel="Delete topic"
        destructive
        onConfirm={() => {
          const topic = pendingDelete;
          setPendingDelete(null);
          if (topic) void storage.repository.deleteTopic(topic.id).then(refresh, (caught: unknown) => setError(describeSpeakingStorageError(caught)));
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </Card>
  );
}

function AttemptHistory({ storage }: { storage: SpeakingStorage }) {
  const [attempts, setAttempts] = useState<SpeakingAttempt[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SpeakingAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  const refresh = useCallback(async () => {
    try {
      setAttempts(await storage.repository.listAttempts());
    } catch (caught) {
      setError(describeSpeakingStorageError(caught));
      setAttempts([]);
    }
  }, [storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remove() {
    if (!pendingDelete) return;
    try {
      await storage.repository.deleteAttempt(pendingDelete.id);
      forgetRecording(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
    } catch (caught) {
      setPendingDelete(null);
      setError(describeSpeakingStorageError(caught));
    }
  }

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>Your attempts</CardTitle>
        <CardDescription>{storage.repository.persistent ? 'Saved in this browser.' : 'Kept until you close this tab.'}</CardDescription>
      </CardHeader>
      <CardContent className="pt-1">
        {error ? (
          <Notice tone="error" role="alert" className="mb-3">
            {error}
          </Notice>
        ) : null}
        {attempts === null ? null : attempts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Your recorded answers and their feedback will appear here.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border" aria-label="Saved attempts">
            {attempts.map((attempt) => (
              <li key={attempt.id} className="flex items-center gap-2 px-3 py-1.5">
                <Link to={`/speaking/attempts/${attempt.id}`} className="min-w-0 flex-1 rounded-md px-1 py-1.5 hover:bg-accent/40">
                  <span className="block truncate text-sm font-medium">{attempt.prompt.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {dateFormatter.format(attempt.createdAt)} · {formatTimestamp(attempt.recordingDurationMs / 1000)} ·{' '}
                    {attempt.assessment ? 'Feedback ready' : 'Transcript only'}
                    {attempt.recording.stored ? ' · recording kept' : ''}
                  </span>
                </Link>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete attempt ${attempt.prompt.title}`} onClick={() => setPendingDelete(attempt)}>
                  <Trash aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this attempt?"
        description="Its transcript, feedback, exercise answers and any saved recording will be removed from this browser."
        confirmLabel="Delete attempt"
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </Card>
  );
}

export function SpeakingLabPage() {
  const storage = useSpeakingStorage();
  const capabilities = useCapabilities();
  const ready = capabilities.status === 'ready';

  return (
    <>
      <PageHeader
        eyebrow="Speaking"
        title="Speak, review, improve."
        description="Answer a question out loud, check what the app heard, and get detailed feedback tied to your own words, with exercises built from your mistakes."
      />

      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Attempts will last until you close this tab.</Notice> : null}
      {ready && !capabilities.data.feedback.available ? (
        <Notice className="mb-6">
          Recording works now. Transcription and feedback need a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>.
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <PromptLibrary />
          {storage ? <CustomTopics storage={storage} canGenerate={ready && capabilities.data.exerciseGeneration.available} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {storage ? <AttemptHistory storage={storage} /> : null}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic aria-hidden="true" className="size-4 text-muted-foreground" />
                How it works
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-1">
              <ol className={cn('flex flex-col gap-2.5 text-sm leading-relaxed text-muted-foreground')}>
                <li>
                  <span className="font-medium text-foreground">1. Record</span> your answer. The microphone is only used while you
                  record.
                </li>
                <li>
                  <span className="font-medium text-foreground">2. Check</span> the transcript and fix anything the app misheard.
                </li>
                <li>
                  <span className="font-medium text-foreground">3. Review</span> the feedback: every correction quotes what you said.
                </li>
                <li>
                  <span className="font-medium text-foreground">4. Practise</span> the exercises built from your answer.
                </li>
              </ol>
              <SpeakingPrivacyNote />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Pronunciation isn't scored: a transcript can't show it. That needs dedicated audio analysis, which is planned.
              </p>
              <Link to="/speaking/practice/library/work-remote-or-office" className={cn(buttonVariants({ variant: 'link' }), 'self-start text-sm')}>
                Try a B2 topic now
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
