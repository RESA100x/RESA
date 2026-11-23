import { useEffect, useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Download, FolderOpen, Plus } from '../components/icons';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { AppSettings } from '../data/nowly-repository';
import { t } from '../i18n';
import { formatDisplayDate } from '../lib/calendar-system';
import type { BackupManifest } from '../lib/backup';

function backupFileName() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `resa-backup-${stamp}.resa`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('backup.failed');
}

function daysSince(iso: string): number | null {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

const filters = [{ name: 'RESA', extensions: ['resa'] }];
const REMINDER_CHOICES = [1, 2, 3, 5, 7, 14, 30];

type Props = {
  /** Draft settings, so folder and toggles save with the dialog's Save button. */
  settings?: Pick<AppSettings, 'backupFolder' | 'backupReminderDays' | 'autoBackupOnClose' | 'lastBackupAt'>;
  onChange?(patch: Partial<AppSettings>): void;
  reload?(): void;
};

// One-click backup and restore. Both sides are a single `.resa` file, so the
// same archive can move the workspace to another machine.
export function BackupPanel({ settings, onChange, reload = () => window.location.reload() }: Props = {}) {
  const repository = useNowlyRepository();
  const [busy, setBusy] = useState<'export' | 'quick' | 'import' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [pendingImport, setPendingImport] = useState<{ path: string; manifest: BackupManifest | null } | null>(null);
  const [snapshotFolder, setSnapshotFolder] = useState('');
  // The last export can also be stamped by the backend, so refresh the shown
  // value from the repository after an export instead of trusting the draft.
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(settings?.lastBackupAt ?? null);
  const available = Boolean(repository.exportBackup && repository.importBackup);
  const folder = settings?.backupFolder ?? '';
  const reminderDays = settings?.backupReminderDays ?? 3;
  const autoOnClose = settings?.autoBackupOnClose ?? false;
  const configurable = Boolean(onChange);

  useEffect(() => {
    setLastBackupAt(settings?.lastBackupAt ?? null);
  }, [settings?.lastBackupAt]);

  // The daily snapshots are written by the backend before the window opens, so
  // this only has to show where they are.
  useEffect(() => {
    const read = repository.backupsFolder;
    if (!read) return;
    let live = true;
    read.call(repository)
      .then((value) => { if (live) setSnapshotFolder(value); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [repository]);

  async function openSnapshots() {
    const openFolder = repository.openBackupsFolder;
    if (!openFolder) return;
    try {
      setSnapshotFolder(await openFolder.call(repository));
    } catch (reason) {
      setError(message(reason));
    }
  }

  async function chooseFolder() {
    if (!onChange) return;
    const picked = await open({ directory: true, multiple: false }).catch(() => null);
    if (typeof picked === 'string') onChange({ backupFolder: picked });
  }

  async function runExport() {
    setError('');
    setStatus('');
    const path = await save({ defaultPath: backupFileName(), filters }).catch(() => null);
    if (!path || !repository.exportBackup) return;
    setBusy('export');
    try {
      const summary = await repository.exportBackup(path);
      setStatus(t('backup.exported', { path: summary.path, size: formatBytes(summary.byteSize) }));
      const now = new Date().toISOString();
      setLastBackupAt(now);
      // Keep the dialog's draft in step, so saving the settings does not write
      // the pre-export timestamp back over the one the backend just recorded.
      onChange?.({ lastBackupAt: now });
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(null);
    }
  }

  async function runQuickExport() {
    if (!repository.quickExportBackup) return;
    setError('');
    setStatus('');
    setBusy('quick');
    try {
      const summary = await repository.quickExportBackup();
      setStatus(t('backup.exported', { path: summary.path, size: formatBytes(summary.byteSize) }));
      const now = new Date().toISOString();
      setLastBackupAt(now);
      onChange?.({ lastBackupAt: now });
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    if (!pendingImport || !repository.importBackup) return;
    setError('');
    setStatus('');
    setBusy('import');
    try {
      await repository.importBackup(pendingImport.path);
      setStatus(t('backup.imported'));
      setPendingImport(null);
      // The whole workspace is replaced, so reload the webview instead of
      // patching every in-memory list.
      window.setTimeout(reload, 600);
    } catch (reason) {
      setError(message(reason));
      setPendingImport(null);
    } finally {
      setBusy(null);
    }
  }

  async function chooseImport() {
    setError('');
    const picked = await open({ multiple: false, filters }).catch(() => null);
    if (typeof picked !== 'string') return;
    let manifest: BackupManifest | null = null;
    const read = repository.readBackupManifest;
    if (read) {
      try {
        manifest = await read.call(repository, picked);
      } catch {
        // A file that cannot be read is reported by the import itself; the
        // preview is a convenience, not a gate.
        manifest = null;
      }
    }
    setPendingImport({ path: picked, manifest });
  }

  const staleDays = lastBackupAt ? daysSince(lastBackupAt) : null;
  const stale = staleDays === null || staleDays >= reminderDays;
  const lastExportText = lastBackupAt
    ? t('backup.lastExport', { date: formatDisplayDate(new Date(lastBackupAt), 'short') })
    : t('backup.lastExportNever');

  return (
    <div className="backup-panel">
      <p className="backup-panel__intro">{t('backup.description')}</p>
      {!available ? <p className="backup-panel__hint">{t('backup.unavailable')}</p> : null}

      <div className={`backup-panel__status-line${stale ? ' is-stale' : ''}`}>
        <span>{lastExportText}</span>
        {stale ? <span className="backup-panel__warn">{t('backup.staleWarning', { days: reminderDays })}</span> : null}
      </div>

      <div className="backup-panel__actions">
        <div className="backup-panel__action">
          <button type="button" className="good-button good-button--primary" disabled={!available || busy !== null}
            onClick={() => void runExport()}>
            <Download aria-hidden="true" />
            {busy === 'export' ? t('backup.exporting') : t('backup.export')}
          </button>
          <span className="backup-panel__hint">{t('backup.exportHint')}</span>
        </div>
        <div className="backup-panel__action">
          <button type="button" className="good-button" disabled={!repository.quickExportBackup || busy !== null}
            onClick={() => void runQuickExport()}>
            <Download aria-hidden="true" />
            {busy === 'quick' ? t('backup.exporting') : t('backup.quickExport')}
          </button>
          <span className="backup-panel__hint">{t('backup.quickExportHint')}</span>
        </div>
        <div className="backup-panel__action">
          <button type="button" className="good-button" disabled={!available || busy !== null}
            onClick={() => void chooseImport()}>
            <FolderOpen aria-hidden="true" />
            {busy === 'import' ? t('backup.importing') : t('backup.import')}
          </button>
          <span className="backup-panel__hint">{t('backup.importHint')}</span>
        </div>
        {snapshotFolder ? (
          <div className="backup-panel__action">
            <button type="button" className="good-button" onClick={() => void openSnapshots()}>
              <FolderOpen aria-hidden="true" />
              {t('backup.openFolder')}
            </button>
            <span className="backup-panel__hint">{t('backup.autoHint', { path: snapshotFolder })}</span>
          </div>
        ) : null}
      </div>

      {configurable ? (
        <fieldset className="backup-panel__settings">
          <legend>{t('backup.settingsLegend')}</legend>
          <div className="backup-panel__folder">
            <span className="backup-panel__folder-path" title={folder || undefined}>
              {folder || t('backup.folderUnset')}
            </span>
            <button type="button" className="good-button" onClick={() => void chooseFolder()}>
              <Plus aria-hidden="true" />
              {t('backup.chooseFolder')}
            </button>
          </div>
          <p className="backup-panel__hint">{t('backup.folderHint')}</p>
          <label className="form-check form-check-custom form-check-solid">
            <input
              className="form-check-input"
              type="checkbox"
              checked={autoOnClose}
              onChange={(event) => onChange?.({ autoBackupOnClose: event.target.checked })}
            />
            <span className="form-check-label">{t('backup.autoOnClose')}</span>
          </label>
          <p className="backup-panel__hint">{t('backup.autoOnCloseHint')}</p>
          <label className="backup-panel__reminder">
            <span>{t('backup.reminderDays')}</span>
            <select
              value={reminderDays}
              onChange={(event) => onChange?.({ backupReminderDays: Number(event.target.value) })}
            >
              {REMINDER_CHOICES.map((days) => (
                <option key={days} value={days}>{t('backup.reminderDaysOption', { days })}</option>
              ))}
            </select>
          </label>
        </fieldset>
      ) : null}

      {status ? <p className="backup-panel__status" role="status">{status}</p> : null}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      {pendingImport ? (
        <ConfirmDialog
          title={t('backup.confirmTitle')}
          description={
            <>
              <p>{t('backup.confirmDesc')}</p>
              <dl className="backup-preview">
                <dt>{t('backup.previewFile')}</dt>
                <dd>{pendingImport.path}</dd>
                {pendingImport.manifest ? (
                  <>
                    <dt>{t('backup.previewCreated')}</dt>
                    <dd>{formatDisplayDate(new Date(pendingImport.manifest.createdAt), 'short')}</dd>
                    <dt>{t('backup.previewVersion')}</dt>
                    <dd>{pendingImport.manifest.appVersion}</dd>
                    <dt>{t('backup.previewAttachments')}</dt>
                    <dd>{pendingImport.manifest.attachments}</dd>
                  </>
                ) : null}
              </dl>
            </>
          }
          tone="danger"
          confirmLabel={t('backup.importConfirm')}
          busyLabel={t('backup.importing')}
          busy={busy === 'import'}
          onCancel={() => setPendingImport(null)}
          onConfirm={() => void runImport()}
        />
      ) : null}
    </div>
  );
}
