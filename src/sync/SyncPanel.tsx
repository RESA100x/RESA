import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../i18n';
import { formatDisplayDate } from '../lib/calendar-system';
import './sync-panel.css';

type SyncStatus = {
  configured: boolean;
  enabled: boolean;
  endpoint: string | null;
  email: string | null;
  signedIn: boolean;
  lastSyncAt: string | null;
  pendingChanges: number;
  deviceId: string;
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('sync.failed');
}

function formatMoment(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
  return `${formatDisplayDate(date, 'short')} · ${time}`;
}

// Optional online sync. Everything here is opt-in: the app keeps working from
// SQLite with no account, and this panel only appears as its own settings tab.
export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<SyncStatus>('sync_get_status');
      setStatus(next);
      setLoadError('');
      if (next.endpoint) setEndpoint((current) => current || next.endpoint || '');
      if (next.email) setEmail((current) => current || next.email || '');
    } catch (reason) {
      setLoadError(message(reason));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(label: string, action: () => Promise<unknown>, success?: string) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await action();
      if (success) setNotice(success);
      await refresh();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return <p className="dialog-error" role="alert">{loadError}</p>;
  }
  if (!status) {
    return <p className="sync-panel__hint">{t('sync.loading')}</p>;
  }

  return (
    <div className="sync-panel">
      <p className="sync-panel__hint">{t('sync.intro')}</p>

      {!status.configured ? (
        <fieldset className="sync-panel__group">
          <legend>{t('sync.serverLegend')}</legend>
          <p className="sync-panel__hint">{t('sync.serverHint')}</p>
          <label className="sync-panel__field">
            <span>{t('sync.endpoint')}</span>
            <input
              dir="ltr"
              value={endpoint}
              placeholder="https://xxxxx.baas.arianet.app"
              onChange={(event) => setEndpoint(event.target.value)}
              disabled={busy !== null}
            />
          </label>
          <label className="sync-panel__field">
            <span>{t('sync.anonKey')}</span>
            <input
              dir="ltr"
              value={anonKey}
              placeholder="eyJ…"
              onChange={(event) => setAnonKey(event.target.value)}
              disabled={busy !== null}
            />
          </label>
          <button
            type="button"
            className="good-button good-button--primary"
            disabled={busy !== null || !endpoint.trim() || !anonKey.trim()}
            onClick={() => void run('configure', () => invoke('sync_configure', { endpoint, anonKey }), t('sync.serverSaved'))}
          >
            {busy === 'configure' ? t('sync.saving') : t('sync.saveServer')}
          </button>
        </fieldset>
      ) : null}

      {status.configured && !status.signedIn ? (
        <fieldset className="sync-panel__group">
          <legend>{t('sync.accountLegend')}</legend>
          <p className="sync-panel__hint">{t('sync.accountHint')}</p>
          <label className="sync-panel__field">
            <span>{t('sync.email')}</span>
            <input
              dir="ltr"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy !== null}
            />
          </label>
          <label className="sync-panel__field">
            <span>{t('sync.password')}</span>
            <input
              dir="ltr"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy !== null}
            />
          </label>
          <div className="sync-panel__actions">
            <button
              type="button"
              className="good-button good-button--primary"
              disabled={busy !== null || !email.trim() || !password}
              onClick={() => void run('signin', () => invoke('sync_sign_in', { email, password }), t('sync.signedIn'))}
            >
              {busy === 'signin' ? t('sync.working') : t('sync.signIn')}
            </button>
            <button
              type="button"
              className="good-button"
              disabled={busy !== null || !email.trim() || !password}
              onClick={() => void run('signup', () => invoke('sync_sign_up', { email, password }), t('sync.signedIn'))}
            >
              {busy === 'signup' ? t('sync.working') : t('sync.signUp')}
            </button>
          </div>
        </fieldset>
      ) : null}

      {status.signedIn ? (
        <>
          <dl className="sync-panel__facts">
            <dt>{t('sync.account')}</dt>
            <dd dir="ltr">{status.email ?? '—'}</dd>
            <dt>{t('sync.server')}</dt>
            <dd dir="ltr">{status.endpoint ?? '—'}</dd>
            <dt>{t('sync.lastSync')}</dt>
            <dd>{status.lastSyncAt ? formatMoment(status.lastSyncAt) : t('sync.never')}</dd>
            <dt>{t('sync.pending')}</dt>
            <dd>{status.pendingChanges}</dd>
          </dl>

          <label className="form-check form-check-custom form-check-solid">
            <input
              className="form-check-input"
              type="checkbox"
              checked={status.enabled}
              disabled={busy !== null}
              onChange={(event) => void run('toggle', () => invoke('sync_set_enabled', { enabled: event.target.checked }))}
            />
            <span className="form-check-label">{t('sync.autoSync')}</span>
          </label>
          <p className="sync-panel__hint">{t('sync.autoSyncHint')}</p>

          <div className="sync-panel__actions">
            <button
              type="button"
              className="good-button good-button--primary"
              disabled={busy !== null}
              onClick={() => void run('now', () => invoke('sync_now'), t('sync.done'))}
            >
              {busy === 'now' ? t('sync.syncing') : t('sync.syncNow')}
            </button>
            <button
              type="button"
              className="good-button"
              disabled={busy !== null}
              onClick={() => void run('signout', () => invoke('sync_sign_out'), t('sync.signedOut'))}
            >
              {t('sync.signOut')}
            </button>
          </div>
        </>
      ) : null}

      {notice ? <p className="sync-panel__status" role="status">{notice}</p> : null}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    </div>
  );
}
