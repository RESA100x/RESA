import { useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Download, FolderOpen } from '../components/icons';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';

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

const filters = [{ name: 'RESA', extensions: ['resa'] }];

// One-click backup and restore. Both sides are a single `.resa` file, so the
// same archive can move the workspace to another machine.
export function BackupPanel({ reload = () => window.location.reload() }: { reload?: () => void } = {}) {
  const repository = useNowlyRepository();
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const available = Boolean(repository.exportBackup && repository.importBackup);

  async function runExport() {
    setError('');
    setStatus('');
    const path = await save({ defaultPath: backupFileName(), filters }).catch(() => null);
    if (!path || !repository.exportBackup) return;
    setBusy('export');
    try {
      const summary = await repository.exportBackup(path);
      setStatus(t('backup.exported', { path: summary.path, size: formatBytes(summary.byteSize) }));
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
      await repository.importBackup(pendingImport);
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
    if (typeof picked === 'string') setPendingImport(picked);
  }

  return (
    <div className="backup-panel">
      <p className="backup-panel__intro">{t('backup.description')}</p>
      {!available ? <p className="backup-panel__hint">{t('backup.unavailable')}</p> : null}
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
          <button type="button" className="good-button" disabled={!available || busy !== null}
            onClick={() => void chooseImport()}>
            <FolderOpen aria-hidden="true" />
            {busy === 'import' ? t('backup.importing') : t('backup.import')}
          </button>
          <span className="backup-panel__hint">{t('backup.importHint')}</span>
        </div>
      </div>
      {status ? <p className="backup-panel__status" role="status">{status}</p> : null}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      {pendingImport ? (
        <ConfirmDialog
          title={t('backup.confirmTitle')}
          description={t('backup.confirmDesc')}
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
