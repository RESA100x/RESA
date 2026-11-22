import { Download, Mail, RefreshCw, X } from '../components/icons';
import { useEffect, useId, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Dialog } from '../components/Dialog';
import type { UpdateInfo } from '../data/nowly-repository';
import { useNowlyRepository } from '../data/RepositoryContext';
import { FEEDBACK_EMAIL, FEEDBACK_REPO_URL, openExternal } from '../lib/feedback';
import { t } from '../i18n';

type Props = {
  onClose(): void;
  // The launch-time update check result. Null while it is pending or when
  // GitHub could not be reached; the dialog then falls back to the build
  // version.
  update?: UpdateInfo | null;
};

// idle → downloading (with a percentage when the server sent a size) →
// installing (the app is about to exit and restart).
type Phase =
  | { kind: 'idle' }
  | { kind: 'downloading'; percent: number | null }
  | { kind: 'installing' };

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error as { message: string }).message
    : '';
}

// About / feedback entry. Shows the current software version, can re-check for
// a newer release, and downloads + installs it in place (the app restarts when
// the installer finishes). The release page stays available as a fallback.
export function AboutDialog({ onClose, update }: Props) {
  const titleId = useId();
  const repository = useNowlyRepository();
  const [info, setInfo] = useState<UpdateInfo | null>(update ?? null);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInfo(update ?? null);
  }, [update]);

  useEffect(() => {
    let disposed = false;
    const removers: Array<() => void> = [];
    const keep = (remove: () => void) => {
      if (disposed) remove();
      else removers.push(remove);
    };
    void listen<{ downloaded: number; total: number | null }>('update-download-progress', (event) => {
      const { downloaded, total } = event.payload;
      const percent = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
      setPhase({ kind: 'downloading', percent });
    }).then(keep).catch(() => undefined);
    void listen('update-installing', () => setPhase({ kind: 'installing' })).then(keep).catch(() => undefined);
    return () => {
      disposed = true;
      for (const remove of removers) remove();
    };
  }, []);

  const mailto = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(t('about.mailSubject'))}`;
  const currentVersion = info?.currentVersion ?? __APP_VERSION__;
  const updateAvailable = info?.updateAvailable ?? false;
  const busy = phase.kind !== 'idle';

  const recheck = async () => {
    const checkForUpdate = repository.checkForUpdate;
    if (!checkForUpdate || checking) return;
    setChecking(true);
    setError(null);
    try {
      setInfo(await checkForUpdate());
    } catch {
      setError(t('about.checkFailed'));
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    const installUpdate = repository.installUpdate;
    if (!installUpdate || busy) return;
    setError(null);
    setPhase({ kind: 'downloading', percent: 0 });
    try {
      await installUpdate();
    } catch (failure) {
      setPhase({ kind: 'idle' });
      setError(errorMessage(failure) || t('about.installFailed'));
    }
  };

  return (
    <Dialog
      title={t('about.title')}
      ariaLabelledBy={titleId}
      onRequestClose={onClose}
      className="about-dialog"
      headerActions={
        <button type="button" aria-label={t('common.close')} className="good-icon-button" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
      footer={
        <div className="about-dialog__actions">
          <button type="button" className="good-button good-button--primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      }
    >
      <div className="about-info">
        <section className="about-version">
          <div className="about-version__row">
            <span className="about-version__label">{t('about.versionLabel')}</span>
            <span className="about-version__value">{currentVersion}</span>
            {updateAvailable ? (
              <span className="about-version__badge">{t('about.updateAvailable')}</span>
            ) : (
              <span className="about-version__latest">{t('about.upToDate')}</span>
            )}
            <button
              type="button"
              className="about-version__recheck"
              aria-label={t('about.recheck')}
              title={t('about.recheck')}
              disabled={checking || busy}
              onClick={() => void recheck()}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </div>

          {updateAvailable ? (
            <div className="about-version__update">
              <button
                type="button"
                className="good-button good-button--primary about-version__download"
                disabled={busy}
                onClick={() => void install()}
              >
                <Download aria-hidden="true" />
                {phase.kind === 'idle' ? t('about.installUpdate') : t('about.installing')}
              </button>
              <button
                type="button"
                className="about-version__link"
                disabled={busy}
                onClick={() => void openExternal(info?.releaseUrl || FEEDBACK_REPO_URL)}
              >
                {t('about.openReleasePage')}
              </button>
            </div>
          ) : null}

          {phase.kind === 'downloading' ? (
            <div className="about-version__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase.percent ?? undefined}>
              <span className="about-version__progress-bar" style={{ width: `${phase.percent ?? 8}%` }} />
              <span className="about-version__progress-label">
                {phase.percent === null ? t('about.downloading') : t('about.downloadingPercent', { percent: phase.percent })}
              </span>
            </div>
          ) : null}

          {phase.kind === 'installing' ? (
            <p className="about-version__hint">{t('about.installHint')}</p>
          ) : null}

          {error ? <p className="about-version__error" role="alert">{error}</p> : null}
        </section>

        {FEEDBACK_EMAIL ? (
          <div className="feedback-channels">
            <button
              type="button"
              className="feedback-channel"
              onClick={() => void openExternal(mailto)}
            >
              <span className="feedback-channel__icon"><Mail aria-hidden="true" /></span>
              <span className="feedback-channel__body">
                <span className="feedback-channel__label">{t('about.emailLabel')}</span>
                <span className="feedback-channel__value">{FEEDBACK_EMAIL}</span>
              </span>
            </button>
          </div>
        ) : null}

        {/* CC BY 4.0 requires visible attribution for the icon set. */}
        <p className="about-attribution">{t('about.iconCredit')}</p>
      </div>
    </Dialog>
  );
}
