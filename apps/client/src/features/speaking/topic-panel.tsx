import type { CustomTopic } from '@ldg/shared';
import { PenLine, Sparkles } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { Notice } from '@/components/ui/notice';
import { SidePanel } from '@/components/ui/side-panel';
import { TabList, tabPanelProps } from '@/components/ui/tabs';
import type { SpeakingStorage } from './storage/speaking-storage';
import { TopicForm } from './topic-form';
import { TopicGenerator } from './topic-generator';

type Mode = 'generate' | 'write';

/**
 * "New topic": one side panel with the two ways to make a topic — generate it
 * with AI or write it yourself — and the same panel for editing a saved topic.
 * Both modes stay mounted while the panel is open, so switching between them
 * never loses a preview or a half-written topic.
 */
export function TopicPanel({
  open,
  storage,
  canGenerate,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  storage: SpeakingStorage;
  canGenerate: boolean;
  /** A saved topic to edit; otherwise the panel creates a new one. */
  editing: CustomTopic | null;
  onClose: () => void;
  onSaved: (topic: CustomTopic, practise: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>(canGenerate ? 'generate' : 'write');
  const [generatorDirty, setGeneratorDirty] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const idBase = useId();
  const onGeneratorDirty = useCallback((dirty: boolean) => setGeneratorDirty(dirty), []);
  const onFormDirty = useCallback((dirty: boolean) => setFormDirty(dirty), []);

  const close = () => {
    setGeneratorDirty(false);
    setFormDirty(false);
    onClose();
  };

  return (
    <SidePanel
      open={open}
      onClose={close}
      dirty={generatorDirty || formDirty}
      title={editing ? 'Edit topic' : 'New topic'}
      description={editing ? 'Changes apply to future practice; past attempts keep the prompt they were recorded with.' : 'Generate a task at B2, C1 or C2, or write your own.'}
    >
      {open && editing ? (
        <TopicForm storage={storage} initial={editing} onDirtyChange={onFormDirty} onSaved={(topic, practise) => onSaved(topic, practise)} />
      ) : open ? (
        <div className="flex flex-col gap-5">
          <TabList
            label="How to make the topic"
            idBase={idBase}
            value={mode}
            onChange={setMode}
            items={[
              { value: 'generate', label: 'Generate with AI', icon: Sparkles },
              { value: 'write', label: 'Write your own', icon: PenLine },
            ]}
          />
          <div {...tabPanelProps(idBase, 'generate')} hidden={mode !== 'generate'} className="outline-none">
            {canGenerate ? (
              <TopicGenerator storage={storage} embedded onClose={close} onDirtyChange={onGeneratorDirty} onSaved={onSaved} />
            ) : (
              <Notice>AI generation needs the local server and a Groq API key in apps/server/.env. You can still write your own topic.</Notice>
            )}
          </div>
          <div {...tabPanelProps(idBase, 'write')} hidden={mode !== 'write'} className="outline-none">
            <TopicForm storage={storage} onDirtyChange={onFormDirty} onSaved={onSaved} />
          </div>
        </div>
      ) : null}
    </SidePanel>
  );
}
