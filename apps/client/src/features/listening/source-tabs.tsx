import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { TabList, tabPanelProps } from '@/components/ui/tabs';

export interface SourceTab<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly content: ReactNode;
}

/** The session sources (Transcribe / File / YouTube) on the shared tab strip. */
export function SourceTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<SourceTab<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const baseId = useId();
  return (
    <div>
      <TabList items={tabs} value={value} onChange={onChange} label={label} idBase={baseId} />
      {tabs.map((tab) => (
        <div key={tab.value} {...tabPanelProps(baseId, tab.value)} hidden={tab.value !== value} className="pt-6 outline-none">
          {tab.value === value ? tab.content : null}
        </div>
      ))}
    </div>
  );
}
