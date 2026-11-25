import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Lock, RefreshCw } from '../components/icons';
import { t } from '../i18n';
import { formatDisplayDate } from '../lib/calendar-system';
import './sync-panel.css';

type SyncStatus = {
  configured: boolean;
  enabled: boolean;
  endpoint: string | null;
  email: string | null;
  phone: string | null;
  signedIn: boolean;
  lastSyncAt: string | null;
  pendingChanges: number;
  deviceId: string;
  hasDefaults: boolean;
};

type Mode = 'signin' | 'signup';

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

// Optional online sync.
//
// The screen is built around the person, not the infrastructure: they see a
// sign-in form, never an endpoint or a key. The build carries the server
// address (`RESA_SYNC_ENDPOINT` / `RESA_SYNC_ANON_KEY` at compile time) and the
// panel applies it silently; the raw fields survive only inside a collapsed
// "administrator" section for the rare case of pointing a test build elsewhere.
export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const apply = useCallback((next: SyncStatus) => {
    setStatus(next);
    if (next.email) setEmail((current) => current || next.email || '');
  }, []);

  const refresh = useCallback(async () => {
    try {
      let next = await invoke<SyncStatus>('sync_get_status');
      // A build that knows its server configures itself on first open, so the
      // user is never asked for something they cannot know.
      if (!next.configured && next.hasDefaults) {
        next = await invoke<SyncStatus>('sync_apply_defaults');
      }
      apply(next);
      setLoadError('');
    } catch (reason) {
      setLoadError(message(reason));
    }
  }, [apply]);

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

  const canSubmit = status.configured && email.trim().length > 0 && password.length > 0;

  return (
    <div className="sync-panel">
      <header className="sync-hero">
        <span className="sync-hero__icon" aria-hidden="true">
          {status.signedIn ? <RefreshCw /> : <Lock />}
        </span>
        <div>
          <h3>{status.signedIn ? t('sync.accountLegend') : t('sync.loginTitle')}</h3>
          <p>{t('sync.loginSubtitle')}</p>
        </div>
      </header>

      {!status.configured ? (
        <p className="sync-note" role="status">{t('sync.needServer')}</p>
      ) : null}

      {!status.signedIn ? (
        <div className="sync-card">
          <div className="sync-switch" role="tablist" aria-label={t('sync.accountLegend')}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={mode === 'signin' ? 'is-active' : undefined}
              onClick={() => {
                setMode('signin');
                setError('');
                setNotice('');
              }}
            >
              {t('sync.signIn')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'is-active' : undefined}
              onClick={() => {
                setMode('signup');
                setError('');
                setNotice('');
              }}
            >
              {t('sync.signUp')}
            </button>
          </div>

          <label className="sync-field">
            <span>{t('sync.email')}</span>
            <input
              dir="ltr"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy !== null}
            />
          </label>
          <label className="sync-field">
            <span>{t('sync.password')}</span>
            <input
              dir="ltr"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy !== null}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !canSubmit) return;
                if (mode === 'signin') void run('signin', () => invoke('sync_sign_in', { email, password }), t('sync.signedIn'));
                else void run('signup', () => invoke('sync_sign_up', { email, password, phone }), t('sync.verifyHint'));
              }}
            />
          </label>
          {mode === 'signup' ? (
            <>
              <label className="sync-field">
                <span>{t('sync.phone')}</span>
                <input
                  dir="ltr"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+98912…"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  disabled={busy !== null}
                />
              </label>
              <p className="sync-panel__hint">{t('sync.phoneHint')}</p>
            </>
          ) : null}

          <button
            type="button"
            className="good-button good-button--primary sync-submit"
            disabled={busy !== null || !canSubmit}
            onClick={() =>
              mode === 'signin'
                ? void run('signin', () => invoke('sync_sign_in', { email, password }), t('sync.signedIn'))
                : void run('signup', () => invoke('sync_sign_up', { email, password, phone }), t('sync.verifyHint'))
            }
          >
            {busy === 'signin' || busy === 'signup'
              ? t('sync.working')
              : mode === 'signin'
                ? t('sync.signIn')
                : t('sync.signUp')}
          </button>

          {mode === 'signup' ? <p className="sync-panel__hint">{t('sync.verifyHint')}</p> : null}

          <button
            type="button"
            className="sync-link"
            disabled={busy !== null || !status.configured || !email.trim()}
            onClick={() => void run('resend', () => invoke('sync_resend_verification', { email }), t('sync.resent'))}
          >
            {busy === 'resend' ? t('sync.working') : t('sync.resend')}
          </button>
        </div>
      ) : (
        <div className="sync-card">
          <dl className="sync-facts">
            <dt>{t('sync.account')}</dt>
            <dd dir="ltr">{status.email ?? '—'}</dd>
            {status.phone ? (
              <>
                <dt>{t('sync.phone')}</dt>
                <dd dir="ltr">{status.phone}</dd>
              </>
            ) : null}
            <dt>{t('sync.lastSync')}</dt>
            <dd>{status.lastSyncAt ? formatMoment(status.lastSyncAt) : t('sync.never')}</dd>
            <dt>{t('sync.pending')}</dt>
            <dd>{status.pendingChanges}</dd>
          </dl>

          <label className="sync-check">
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={busy !== null}
              onChange={(event) => void run('toggle', () => invoke('sync_set_enabled', { enabled: event.target.checked }))}
            />
            <span>{t('sync.autoSync')}</span>
          </label>
          <p className="sync-panel__hint">{t('sync.autoSyncHint')}</p>

          <div className="sync-actions">
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
        </div>
      )}

      {notice ? <p className="sync-panel__status" role="status">{notice}</p> : null}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}


    </div>
  );
}
