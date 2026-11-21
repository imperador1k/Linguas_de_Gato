import { CircleCheck, CircleMinus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { APP_VERSION } from '@/features/data-management/backup-service';
import { TranscriptionOptionsFields, useTranscriptionPreferences } from '@/features/listening/transcription/transcription-options';
import { useExplanationLanguage, useReadingPreferences } from '@/features/reading/reading-preferences';
import { useCapabilities } from '@/hooks/use-capabilities';
import { APP_DB_VERSION } from '@/lib/storage/app-database';
import { useTheme, type ThemePreference } from '@/lib/theme';

/** A titled group of settings: the same look for every section. */
export function SettingsGroup({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card px-4 py-5 sm:px-6">
      <div>
        <h3 className="font-medium">{title}</h3>
        {description ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

const SAVED_NOTE = 'Saved automatically on this device. Changing it here is the same as changing it where you use it.';

export function AppearanceSettings() {
  const { preference, setPreference } = useTheme();
  return (
    <SettingsGroup title="Colour theme" description="Light and dark keep the same paper palette. “System” follows your device and switches with it.">
      <ChoiceGroup<ThemePreference>
        legend="Theme"
        value={preference}
        onChange={setPreference}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'system', label: 'System' },
        ]}
      />
      <p className="text-xs text-muted-foreground">The switch at the bottom of the navigation changes the same setting.</p>
    </SettingsGroup>
  );
}

export function LearningSettings() {
  const [transcription, setTranscription] = useTranscriptionPreferences();
  const { preferences, update } = useReadingPreferences();
  const [explanation, setExplanation] = useExplanationLanguage();
  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title="Transcription" description={`Used when you transcribe a recording in Listening or Speaking. ${SAVED_NOTE}`}>
        <TranscriptionOptionsFields value={transcription} onChange={setTranscription} />
      </SettingsGroup>

      <SettingsGroup title="Reading view" description={`How texts look in the reader. The Display menu in the reader changes the same settings. ${SAVED_NOTE}`}>
        <div className="grid gap-5 md:grid-cols-2">
          <ChoiceGroup legend="Text size" value={preferences.size} options={(['small', 'medium', 'large', 'xlarge'] as const).map((value) => ({ value, label: { small: 'S', medium: 'M', large: 'L', xlarge: 'XL' }[value] }))} onChange={(value) => update('size', value)} />
          <ChoiceGroup legend="Line spacing" value={preferences.spacing} options={(['compact', 'comfortable', 'airy'] as const).map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} onChange={(value) => update('spacing', value)} />
          <ChoiceGroup legend="Width" value={preferences.width} options={(['narrow', 'medium', 'wide'] as const).map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} onChange={(value) => update('width', value)} />
          <ChoiceGroup legend="Typeface" value={preferences.font} options={[{ value: 'serif' as const, label: 'Serif' }, { value: 'sans' as const, label: 'Sans' }]} onChange={(value) => update('font', value)} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Explanations" description="Vocabulary lookups are always explained in English. You can add a short Portuguese explanation to each lookup.">
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--brand)]" checked={explanation === 'pt'} onChange={(event) => setExplanation(event.target.checked ? 'pt' : 'en')} />
          <span>
            Add a Portuguese explanation to lookups
            <span className="block text-xs text-muted-foreground">The lookup panel offers the same choice.</span>
          </span>
        </label>
      </SettingsGroup>
    </div>
  );
}

const SENT: ReadonlyArray<{ action: string; sent: string }> = [
  { action: 'Transcribe (Listening, Speaking)', sent: 'The audio file or recording.' },
  { action: 'Speaking feedback', sent: 'Your confirmed transcript and the task — never the audio.' },
  { action: 'Writing feedback, improved version', sent: 'Your text and the task.' },
  { action: 'Generate a task, text or exercises', sent: 'Your settings and any topic, interest or focus you type; for listening questions, the session’s transcript text.' },
  { action: 'Grammar second opinion', sent: 'The question and your answer.' },
  { action: 'Reading questions', sent: 'The text.' },
  { action: 'Look up a word or phrase', sent: 'The selected words, their sentence and paragraph.' },
  { action: 'Vocabulary practice and its feedback', sent: 'The chosen expressions, their meanings and context sentences, and your open answers.' },
  { action: 'Targeted practice (Progress)', sent: 'One weakness’s name and description and, if you allow it, up to five of your own mistakes with corrections.' },
];

export function PrivacySettings() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title="What stays on this device">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
          <li>All your practice: sessions, transcripts, the audio files and recordings you keep (kept by default for reasonable sizes; you can opt out or remove them at any time), texts, attempts, feedback, vocabulary, reviews and progress. It is stored in this browser (IndexedDB), not on a server and not in an account.</li>
          <li>Your preferences, in this browser’s local storage.</li>
          <li>Backups are files you download. They are never uploaded and contain no API keys.</li>
          <li>Progress, insights and recommendations are calculated in the browser.</li>
          <li>There are no accounts, no analytics and no tracking.</li>
        </ul>
      </SettingsGroup>

      <SettingsGroup title="What is sent, and when" description="Only when you press the button for that action. The local server forwards the request to Groq, the AI provider, and returns the validated result.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-4 font-medium">
                  When you…
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  What is sent
                </th>
              </tr>
            </thead>
            <tbody>
              {SENT.map((row) => (
                <tr key={row.action} className="border-t align-top">
                  <th scope="row" className="py-2 pr-4 font-normal">
                    {row.action}
                  </th>
                  <td className="py-2 text-muted-foreground">{row.sent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsGroup>

      <SettingsGroup title="On the local server">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
          <li>Uploaded audio is kept only in a temporary file for the length of the request and deleted afterwards, also when it fails or is cancelled.</li>
          <li>Logs record metadata (sizes, durations, status), never your text or audio.</li>
          <li>The Groq API key lives only in the server’s environment file and never reaches the browser.</li>
          <li>Groq’s own handling and retention are governed by your Groq account settings and Groq’s policies, which this app does not control.</li>
        </ul>
      </SettingsGroup>

      <SettingsGroup title="About AI feedback">
        <p className="text-sm leading-relaxed">
          Feedback and generated material are written by an AI model and can be wrong. Corrections are checked against your own words before they are shown, levels are practice targets rather than official CEFR results, and pronunciation is not assessed.
        </p>
      </SettingsGroup>
    </div>
  );
}

function Availability({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {ok === null ? null : ok ? <CircleCheck aria-hidden="true" className="size-4 text-success" /> : <CircleMinus aria-hidden="true" className="size-4 text-muted-foreground" />}
      {children}
    </span>
  );
}

export function AboutSettings() {
  const capabilities = useCapabilities();
  const [storage, setStorage] = useState<{ usage: number | null; persisted: boolean | null }>({ usage: null, persisted: null });

  useEffect(() => {
    let active = true;
    const estimate = navigator.storage?.estimate?.().catch(() => null) ?? Promise.resolve(null);
    const persisted = navigator.storage?.persisted?.().catch(() => null) ?? Promise.resolve(null);
    void Promise.all([estimate, persisted]).then(([usage, isPersisted]) => {
      if (active) setStorage({ usage: usage?.usage ?? null, persisted: isPersisted });
    });
    return () => {
      active = false;
    };
  }, []);

  const feature = (key: 'transcription' | 'feedback' | 'exerciseGeneration') => {
    if (capabilities.status === 'loading') return <Availability ok={null}>Checking…</Availability>;
    if (capabilities.status === 'error') return <Availability ok={false}>Unknown (server not reachable)</Availability>;
    const value = capabilities.data[key];
    return <Availability ok={value.available}>{value.available ? 'Available' : value.configured ? 'Configured, not available' : 'Not configured'}</Availability>;
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title="Local server" description="Transcription, feedback and generation need the local server and a Groq API key in apps/server/.env.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">Server</dt>
          <dd aria-live="polite">
            {capabilities.status === 'loading' ? (
              <Availability ok={null}>Checking…</Availability>
            ) : capabilities.status === 'error' ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <Availability ok={false}>Not reachable</Availability>
                <button type="button" className="text-sm underline underline-offset-4" onClick={capabilities.retry}>
                  Try again
                </button>
              </span>
            ) : (
              <Availability ok>Connected</Availability>
            )}
          </dd>
          <dt className="text-muted-foreground">Transcription</dt>
          <dd>{feature('transcription')}</dd>
          <dt className="text-muted-foreground">Feedback</dt>
          <dd>{feature('feedback')}</dd>
          <dt className="text-muted-foreground">Generation</dt>
          <dd>{feature('exerciseGeneration')}</dd>
        </dl>
      </SettingsGroup>

      <SettingsGroup title="This app">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="tabular-nums">{APP_VERSION}</dd>
          <dt className="text-muted-foreground">Database version</dt>
          <dd className="tabular-nums">{APP_DB_VERSION}</dd>
          <dt className="text-muted-foreground">Target language</dt>
          <dd>English (B2 → C1)</dd>
          <dt className="text-muted-foreground">Browser storage used</dt>
          <dd className="tabular-nums">{storage.usage === null ? 'Not reported by this browser' : `${(storage.usage / 1024 / 1024).toFixed(1)} MB`}</dd>
          <dt className="text-muted-foreground">Protected from automatic clearing</dt>
          <dd>{storage.persisted === null ? 'Not reported by this browser' : storage.persisted ? 'Yes' : 'No — keep regular backups'}</dd>
        </dl>
      </SettingsGroup>
    </div>
  );
}
