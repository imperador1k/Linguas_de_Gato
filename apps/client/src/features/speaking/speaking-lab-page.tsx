import type { CustomTopic, SpeakingAttempt } from '@ldg/shared';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { HelpDisclosure } from '@/components/ui/help-disclosure';
import { Notice } from '@/components/ui/notice';
import { PrivacyNote } from '@/components/ui/privacy-note';
import { TabList, tabPanelProps } from '@/components/ui/tabs';
import { useCapabilities } from '@/hooks/use-capabilities';
import { cn } from '@/lib/utils';
import { HistoryView } from './history-view';
import { PROMPT_LIBRARY } from './prompt-library';
import { describeSpeakingStorageError, forgetRecording, useSpeakingStorage } from './storage/speaking-storage';
import { buildCatalogue, NO_FILTERS, type TopicEntry, type TopicFilters } from './topic-catalogue';
import { TopicPanel } from './topic-panel';
import { TopicsView } from './topics-view';

type View = 'topics' | 'history';

/**
 * The Speaking hub: two views (Topics to choose what to practise, History to
 * revisit attempts) and one "New topic" action that opens the creation panel.
 * The view is in the URL (`?view=history`) so it can be linked and survives
 * going back from an attempt.
 */
export function SpeakingLabPage() {
  const storage = useSpeakingStorage();
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'history' ? 'history' : 'topics';
  const [topics, setTopics] = useState<CustomTopic[]>([]);
  const [attempts, setAttempts] = useState<SpeakingAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TopicFilters>(NO_FILTERS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ open: boolean; key: number; editing: CustomTopic | null }>({ open: false, key: 0, editing: null });
  const [saved, setSaved] = useState<string | null>(null);
  const [pendingTopic, setPendingTopic] = useState<TopicEntry | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState<SpeakingAttempt | null>(null);
  const idBase = useId();
  const ready = capabilities.status === 'ready';
  const canGenerate = ready && capabilities.data.exerciseGeneration.available;

  const refresh = useCallback(async () => {
    if (!storage) return;
    try {
      const [nextTopics, nextAttempts] = await Promise.all([storage.repository.listTopics(), storage.repository.listAttempts()]);
      setTopics(nextTopics);
      setAttempts(nextAttempts);
    } catch (caught) {
      setError(describeSpeakingStorageError(caught));
      setAttempts((current) => current ?? []);
    }
  }, [storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const catalogue = useMemo(() => buildCatalogue(PROMPT_LIBRARY, topics), [topics]);

  const setView = (next: View) => setParams(next === 'history' ? { view: 'history' } : {}, { replace: true });
  const openPanel = (editing: CustomTopic | null = null) => setPanel((current) => ({ open: true, key: current.key + 1, editing }));
  const closePanel = () => setPanel((current) => ({ ...current, open: false }));

  async function onSaved(topic: CustomTopic, practise: boolean) {
    if (practise) {
      navigate(`/speaking/practice/custom/${topic.id}`);
      return;
    }
    const edited = panel.editing !== null;
    closePanel();
    await refresh();
    // Show the saved topic: clear filters that might hide it and select it.
    setFilters(NO_FILTERS);
    setSelectedKey(`custom:${topic.id}`);
    setView('topics');
    setSaved(`${edited ? 'Saved changes to' : 'Saved'} “${topic.prompt.title}”.`);
  }

  async function deleteTopic() {
    const entry = pendingTopic;
    setPendingTopic(null);
    if (!storage || !entry?.custom) return;
    try {
      await storage.repository.deleteTopic(entry.custom.id);
      if (selectedKey === entry.key) setSelectedKey(null);
      setSaved(`Deleted “${entry.title}”.`);
      await refresh();
    } catch (caught) {
      setError(describeSpeakingStorageError(caught));
    }
  }

  async function deleteAttempt() {
    const attempt = pendingAttempt;
    setPendingAttempt(null);
    if (!storage || !attempt) return;
    try {
      await storage.repository.deleteAttempt(attempt.id);
      forgetRecording(attempt.id);
      await refresh();
    } catch (caught) {
      setError(describeSpeakingStorageError(caught));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Speaking"
        title="Speak, review, improve."
        description="Answer a question out loud, check what the app heard, and get feedback tied to your own words."
        actions={
          storage ? (
            <Button onClick={() => openPanel()}>
              <Plus aria-hidden="true" />
              New topic
            </Button>
          ) : null
        }
      />

      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Attempts will last until you close this tab.</Notice> : null}
      {ready && !capabilities.data.feedback.available ? (
        <Notice className="mb-6">
          Recording works now. Transcription and feedback need a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}
      <div aria-live="polite">
        {saved ? (
          <Notice tone="success" className="mb-6">
            {saved}
          </Notice>
        ) : null}
      </div>

      <TabList
        label="Speaking"
        idBase={idBase}
        value={view}
        onChange={setView}
        className="mb-6"
        items={[
          { value: 'topics', label: 'Topics', adornment: <span className="text-xs font-normal text-muted-foreground tabular-nums">{catalogue.length}</span> },
          { value: 'history', label: 'History', adornment: attempts ? <span className="text-xs font-normal text-muted-foreground tabular-nums">{attempts.length}</span> : null },
        ]}
      />

      <div {...tabPanelProps(idBase, view)} className="outline-none">
        {view === 'topics' ? (
          <TopicsView
            catalogue={catalogue}
            filters={filters}
            onFiltersChange={setFilters}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            onNewTopic={() => openPanel()}
            onEdit={(entry) => entry.custom && openPanel(entry.custom)}
            onDelete={setPendingTopic}
          />
        ) : attempts === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Reading your attempts…
          </p>
        ) : (
          <HistoryView attempts={attempts} persistent={storage?.repository.persistent ?? false} onBrowseTopics={() => setView('topics')} onDelete={setPendingAttempt} />
        )}
      </div>

      <HelpDisclosure id="speaking" className="mt-10">
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col gap-2.5 text-sm leading-relaxed text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">1. Choose</span> a topic, or make your own with New topic.
            </li>
            <li>
              <span className="font-medium text-foreground">2. Record</span> your answer. The microphone is only used while you record.
            </li>
            <li>
              <span className="font-medium text-foreground">3. Check</span> the transcript and fix anything the app misheard.
            </li>
            <li>
              <span className="font-medium text-foreground">4. Review</span> the feedback (every correction quotes what you said) and practise the exercises built from your answer.
            </li>
          </ol>
          <p className="text-xs leading-relaxed text-muted-foreground">Pronunciation isn't scored: a transcript can't show it. That needs dedicated audio analysis, which is planned.</p>
          <PrivacyNote>Nothing is sent until you press Transcribe on the practice page.</PrivacyNote>
          <Link to="/speaking/practice/library/work-remote-or-office" className={cn(buttonVariants({ variant: 'link' }), 'self-start text-sm')}>
            Try a B2 topic now
          </Link>
        </div>
      </HelpDisclosure>

      {storage ? <TopicPanel key={panel.key} open={panel.open} storage={storage} canGenerate={canGenerate} editing={panel.editing} onClose={closePanel} onSaved={(topic, practise) => void onSaved(topic, practise)} /> : null}

      <ConfirmDialog
        open={pendingTopic !== null}
        title="Delete this topic?"
        description="The topic is removed from this browser. Attempts you already recorded on it are kept."
        confirmLabel="Delete topic"
        destructive
        onConfirm={() => void deleteTopic()}
        onCancel={() => setPendingTopic(null)}
      />
      <ConfirmDialog
        open={pendingAttempt !== null}
        title="Delete this attempt?"
        description="Its transcript, feedback, exercise answers and any saved recording will be removed from this browser."
        confirmLabel="Delete attempt"
        destructive
        onConfirm={() => void deleteAttempt()}
        onCancel={() => setPendingAttempt(null)}
      />
    </>
  );
}
