import { BACKUP_LIMITS, BACKUP_STORE_NAMES, BACKUP_STORES, type ImportMode, type ValidatedBackup } from '@ldg/shared';
import { Download, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { SectionHeading } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { formatBytes, formatDate } from '@/features/progress/format';
import { openAppDatabase } from '@/lib/storage/app-database';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { StorageError } from '@/lib/storage/indexed-db';
import {
  MediaTooLargeError,
  applyImport,
  createBackup,
  downloadText,
  previewImport,
  readBackupFile,
  readEverything,
  summarizeMedia,
  type ImportPreview,
  type ImportReport,
  type MediaSummary,
} from './backup-service';

/** A dedicated connection: backups read and write every store in one transaction. */
let databasePromise: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  databasePromise ??= openAppDatabase().catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

interface Inventory {
  readonly counts: Record<string, number>;
  readonly media: MediaSummary;
}

function describeFailure(error: unknown): string {
  if (error instanceof StorageError) return describeStorageFailure(error);
  if (error instanceof Error && /damaged/.test(error.message)) return `${error.message} Nothing was imported.`;
  return 'The operation failed and nothing was changed.';
}

function ExportPanel({ inventory, onExported }: { inventory: Inventory; onExported: () => void }) {
  const [includeMedia, setIncludeMedia] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ fileName: string; size: number; omitted: MediaSummary['items'] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const media = inventory.media;

  async function exportNow() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const backup = await createBackup(await database(), { includeMedia });
      downloadText(backup.json, backup.fileName);
      setResult({ fileName: backup.fileName, size: backup.json.length, omitted: backup.envelope.media.omitted });
      onExported();
    } catch (caught) {
      setError(caught instanceof MediaTooLargeError ? 'The saved media is too large for one backup file. Export without media instead; your audio stays in this browser.' : describeFailure(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="data-export" className="flex flex-col gap-4 rounded-lg border bg-card px-4 py-4 sm:px-5">
      <div>
        <h3 id="data-export" className="font-medium">
          Export a backup
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          One JSON file with every session, transcript, attempt, task, set, text, expression, review, decision and preference. It is saved to your computer only: never uploaded, never sent to the AI.
        </p>
      </div>
      {media.count > 0 ? (
        <ChoiceGroup
          legend="Audio and video copies"
          wide
          value={includeMedia ? 'include' : 'exclude'}
          options={[
            { value: 'exclude', label: 'Leave them out', hint: `The backup lists the ${media.count} file${media.count === 1 ? '' : 's'} it leaves out.` },
            {
              value: 'include',
              label: 'Include them',
              hint: media.fitsInBackup ? `Adds about ${formatBytes(Math.ceil(media.totalBytes * 1.34))} to the file.` : `Too large (${formatBytes(media.totalBytes)}; limit ${formatBytes(BACKUP_LIMITS.maxMediaTotalBytes)}).`,
            },
          ]}
          onChange={(value) => setIncludeMedia(value === 'include' && media.fitsInBackup)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No audio or video copies are saved in this browser, so there is no media to include.</p>
      )}
      {media.count > 0 && !media.fitsInBackup ? (
        <Notice>
          Your saved media ({formatBytes(media.totalBytes)}, largest file {formatBytes(media.largestBytes)}) is over the limit of {formatBytes(BACKUP_LIMITS.maxMediaTotalBytes)} in total and {formatBytes(BACKUP_LIMITS.maxMediaItemBytes)} per file,
          which a browser cannot handle safely in one file. Export without media and keep the original audio files: you can attach them to their sessions again after a restore.
        </Notice>
      ) : null}
      <div>
        <Button onClick={() => void exportNow()} disabled={busy}>
          <Download aria-hidden="true" />
          {busy ? 'Preparing…' : 'Download backup'}
        </Button>
      </div>
      <div aria-live="polite">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {result ? (
          <Notice tone="success">
            Downloaded {result.fileName} ({formatBytes(result.size)}).
            {result.omitted.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer">
                  {result.omitted.length} media file{result.omitted.length === 1 ? ' was' : 's were'} left out
                </summary>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {result.omitted.map((item) => (
                    <li key={`${item.store}/${item.key}`}>
                      {item.label} ({formatBytes(item.size)})
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Notice>
        ) : null}
      </div>
    </section>
  );
}

const MODE_EXPLANATIONS: Record<ImportMode, string> = {
  merge:
    'Adds everything that is not in this browser yet. When both have the same item, the more recently changed copy wins, so newer work here is never overwritten by an older backup. Items without a change date keep the copy here. An expression already saved under another entry is skipped.',
  replace:
    'Deletes the current data and puts the backup in its place. Before anything changes, a safety backup of the current data is downloaded so you can undo this. Audio copies are kept only for sessions and recordings that are in the backup.',
};

function ImportPanel({ mediaFits, onImported }: { mediaFits: boolean; onImported: () => void }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [backup, setBackup] = useState<ValidatedBackup | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<(ImportReport & { safetyFile: string | null }) | null>(null);

  useEffect(() => {
    if (!backup) return;
    let active = true;
    setPreview(null);
    database()
      .then((db) => previewImport(db, backup, mode))
      .then(
        (value) => active && setPreview(value),
        (caught: unknown) => active && setError(describeFailure(caught)),
      );
    return () => {
      active = false;
    };
  }, [backup, mode]);

  async function select(file: File | undefined) {
    setError(null);
    setReport(null);
    setBackup(null);
    setPreview(null);
    if (!file) return;
    // Every new file starts from the safe choice: replacing is never carried over from a previous import.
    setMode('merge');
    setFileName(file.name);
    setBusy(true);
    const parsed = await readBackupFile(file);
    setBusy(false);
    if (!parsed.ok) setError(`${parsed.error} Nothing was imported.`);
    else setBackup(parsed.backup);
  }

  async function apply() {
    if (!backup) return;
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const db = await database();
      let safetyFile: string | null = null;
      if (mode === 'replace') {
        // The safety copy must exist before anything is deleted.
        const media = summarizeMedia(await readEverything(db));
        // Media goes into the safety copy whenever it fits; if it doesn't, the media itself is kept unless the backup lacks its record.
        const safety = await createBackup(db, { includeMedia: media.count > 0 && media.fitsInBackup });
        safetyFile = safety.fileName.replace('linguas-de-gato-backup', 'linguas-de-gato-before-import');
        downloadText(safety.json, safetyFile);
      }
      const result = await applyImport(db, backup, mode);
      setReport({ ...result, safetyFile });
      setBackup(null);
      setPreview(null);
      setFileName(null);
      if (inputRef.current) inputRef.current.value = '';
      onImported();
    } catch (caught) {
      setError(describeFailure(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="data-import" className="flex flex-col gap-4 rounded-lg border bg-card px-4 py-4 sm:px-5">
      <div>
        <h3 id="data-import" className="font-medium">
          Import a backup
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          The file is checked completely before anything changes: its format and version, then every record. You see what will happen first, and the import is applied all at once or not at all. Files up to{' '}
          {formatBytes(BACKUP_LIMITS.maxFileBytes)}.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          Backup file
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => void select(event.target.files?.[0])}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:border-border-strong"
        />
      </div>

      <div aria-live="polite">{error ? <Notice tone="error">{error}</Notice> : null}</div>

      {backup ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <span className="font-medium">{fileName}</span>
            <span className="text-muted-foreground">
              {' '}
              · exported {formatDate(backup.envelope.exportedAt)} by version {backup.envelope.app.version} · media {backup.media.length > 0 ? `included (${backup.media.length})` : 'not included'}
            </span>
          </p>
          {backup.warnings.length > 0 ? (
            <Notice>
              <ul className="list-disc pl-4">
                {backup.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              {backup.invalid.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer">Records that will be skipped</summary>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {backup.invalid.slice(0, 20).map((item) => (
                      <li key={`${item.store}-${item.index}`}>
                        {item.store} #{item.index + 1}: {item.reason}
                      </li>
                    ))}
                    {backup.invalid.length > 20 ? <li>…and {backup.invalid.length - 20} more</li> : null}
                  </ul>
                </details>
              ) : null}
            </Notice>
          ) : null}

          <ChoiceGroup
            legend="How to import"
            wide
            value={mode}
            disabled={busy}
            options={[
              { value: 'merge', label: 'Merge with my data', hint: 'Recommended. Nothing is deleted.' },
              { value: 'replace', label: 'Replace my data', hint: 'A safety backup is downloaded first.' },
            ]}
            onChange={setMode}
          />
          <p className="text-sm leading-relaxed text-muted-foreground">{MODE_EXPLANATIONS[mode]}</p>

          {preview ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <caption className="mb-2 text-left text-xs text-muted-foreground">What will happen</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Data
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Here now
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      In backup
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {mode === 'merge' ? 'Added / updated / kept' : 'After import'}
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {BACKUP_STORE_NAMES.filter((name) => preview.existingCounts[name] > 0 || backup.stores[name].length > 0).map((name) => {
                    const plan = preview.plan.stores[name];
                    return (
                      <tr key={name} className="border-t">
                        <th scope="row" className="py-1 pr-3 font-normal">
                          {BACKUP_STORES[name].label}
                        </th>
                        <td className="py-1 pr-3">{preview.existingCounts[name]}</td>
                        <td className="py-1 pr-3">{backup.stores[name].length}</td>
                        <td className="py-1 pr-3">
                          {mode === 'merge' ? `${plan.added} / ${plan.updated} / ${plan.kept}${plan.skippedDuplicates > 0 ? ` (${plan.skippedDuplicates} duplicates skipped)` : ''}` : backup.stores[name].length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                Media: {preview.mediaToWrite} file{preview.mediaToWrite === 1 ? '' : 's'} restored{mode === 'replace' ? `, ${preview.mediaToRemove} removed` : ''}. Preferences in the backup: {Object.keys(backup.preferences).length}.
              </p>
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              Comparing with your data…
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => (mode === 'replace' ? setConfirming(true) : void apply())} disabled={busy || !preview} variant={mode === 'replace' ? 'destructive' : 'primary'}>
              <Upload aria-hidden="true" />
              {busy ? 'Importing…' : mode === 'replace' ? 'Replace my data' : 'Merge into my data'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBackup(null);
                setFileName(null);
                if (inputRef.current) inputRef.current.value = '';
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {report ? (
        <Notice tone="success">
          <p className="font-medium">Import complete.</p>
          <p>
            {report.added} added, {report.updated} updated, {report.kept} kept as they were{report.skippedDuplicates > 0 ? `, ${report.skippedDuplicates} duplicates skipped` : ''}
            {report.skippedInvalid > 0 ? `, ${report.skippedInvalid} invalid records skipped` : ''}. Media: {report.mediaWritten} restored{report.mediaRemoved > 0 ? `, ${report.mediaRemoved} removed` : ''}. Preferences: {report.preferencesApplied}.
          </p>
          {report.safetyFile ? <p>Your previous data was saved first as {report.safetyFile}.</p> : null}
          {report.preferencesApplied > 0 ? (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => window.location.reload()}>
              Reload to apply preferences
            </Button>
          ) : null}
        </Notice>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="Replace all your data?"
        description={
          <>
            Everything currently saved in this browser will be replaced by the backup. A safety backup of your current data is downloaded first; keep it if you may want to undo this.
            {preview && preview.mediaToRemove > 0 && !mediaFits ? (
              <strong className="mt-2 block font-medium text-destructive">
                {preview.mediaToRemove} audio or video file{preview.mediaToRemove === 1 ? '' : 's'} will be deleted, and your media is too large to go into the safety backup, so they cannot be restored from it. Keep the original files, or merge instead.
              </strong>
            ) : null}
          </>
        }
        confirmLabel="Download safety backup and replace"
        destructive
        busy={busy}
        onConfirm={() => void apply()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

export function DataSection({ onChanged }: { onChanged: () => void }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    database()
      .then(readEverything)
      .then(
        (contents) =>
          active &&
          setInventory({
            counts: Object.fromEntries(BACKUP_STORE_NAMES.map((name) => [name, contents.stores[name].length])),
            media: summarizeMedia(contents),
          }),
        (caught: unknown) => active && setError(describeFailure(caught)),
      );
    return () => {
      active = false;
    };
  }, [version]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!inventory) return <p role="status" className="text-sm text-muted-foreground">Reading your data…</p>;
  const total = Object.values(inventory.counts).reduce((sum, value) => sum + value, 0);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="data-inventory">
        <SectionHeading id="data-inventory">Saved in this browser</SectionHeading>
        <p className="mb-3 text-sm text-muted-foreground">
          {total} records and {inventory.media.count} media file{inventory.media.count === 1 ? '' : 's'} ({formatBytes(inventory.media.totalBytes)}). Everything lives only here: clearing site data or switching browsers loses it unless you keep a backup.
        </p>
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {BACKUP_STORE_NAMES.map((name) => (
            <li key={name} className="flex justify-between gap-3 border-b py-1">
              <span>{BACKUP_STORES[name].label}</span>
              <span className="tabular-nums text-muted-foreground">{inventory.counts[name]}</span>
            </li>
          ))}
        </ul>
      </section>
      <ExportPanel inventory={inventory} onExported={() => undefined} />
      <ImportPanel
        mediaFits={inventory.media.fitsInBackup}
        onImported={() => {
          setVersion((value) => value + 1);
          onChanged();
        }}
      />
    </div>
  );
}
