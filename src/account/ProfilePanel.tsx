import { useEffect, useRef, useState } from 'react';
import { DatePicker } from '../components/DatePicker';
import { UserCircle, X } from '../components/icons';
import { t } from '../i18n';
import { accountApi, type ProfileDraft, type UserProfile } from './account-api';

function messageOf(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : t('common.opFailed');
}

/// Profile pictures are shrunk before they leave the page: the avatar travels
/// through IPC as a data URL, and a 12 MP phone photo would otherwise be a
/// multi-megabyte JSON string for a 64 px circle.
async function readAvatar(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('decode failed'));
    element.src = source;
  });
  const scale = Math.min(1, 512 / Math.max(image.width, image.height));
  if (scale === 1 && source.length < 400_000) return source;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.86);
}

function draftOf(profile: UserProfile): ProfileDraft {
  return {
    fullName: profile.fullName,
    birthDate: profile.birthDate,
    nationalId: profile.nationalId,
    phone: profile.phone,
    email: profile.email,
    jobTitle: profile.jobTitle,
    organization: profile.organization,
    address: profile.address,
    bio: profile.bio,
    avatar: profile.avatar
  };
}

export function ProfilePanel() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void accountApi
      .profile()
      .then((next) => {
        if (!alive) return;
        setProfile(next);
        setDraft(draftOf(next));
      })
      .catch((reason) => {
        if (alive) setError(messageOf(reason));
      });
    return () => {
      alive = false;
    };
  }, []);

  function patch(changes: Partial<ProfileDraft>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      patch({ avatar: await readAvatar(file) });
    } catch {
      setError(t('account.avatarFailed'));
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await accountApi.saveProfile(draft);
      setProfile(saved);
      setDraft(draftOf(saved));
      setNotice(t('account.saved'));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  async function shareCard() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const path = await accountApi.exportVcard();
      if (path) setNotice(t('account.shared', { path }));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return error ? (
      <p className="dialog-error" role="alert">{error}</p>
    ) : (
      <p className="account-hint">{t('account.loading')}</p>
    );
  }

  return (
    <div className="account-form">
      <div className="account-avatar">
        <button
          type="button"
          className="account-avatar__frame"
          onClick={() => fileRef.current?.click()}
          aria-label={t('account.changeAvatar')}
        >
          {draft.avatar ? (
            <img src={draft.avatar} alt="" />
          ) : (
            <UserCircle aria-hidden="true" />
          )}
        </button>
        <div className="account-avatar__actions">
          <button type="button" className="good-button" onClick={() => fileRef.current?.click()} disabled={busy}>
            {t('account.changeAvatar')}
          </button>
          {draft.avatar ? (
            <button
              type="button"
              className="good-button good-button--ghost"
              onClick={() => patch({ avatar: '' })}
              disabled={busy}
            >
              <X aria-hidden="true" />
              {t('account.removeAvatar')}
            </button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            void pickAvatar(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>

      <div className="account-grid">
        <label className="account-field">
          <span>{t('account.fullName')}</span>
          <input
            value={draft.fullName}
            disabled={busy}
            onChange={(event) => patch({ fullName: event.target.value })}
          />
        </label>
        <div className="account-field">
          <span>{t('account.birthDate')}</span>
          <DatePicker
            id="account-birth-date"
            label={t('account.birthDate')}
            hideLabel
            value={draft.birthDate ?? ''}
            disabled={busy}
            open={dateOpen}
            onOpenChange={setDateOpen}
            onChange={(value) => patch({ birthDate: value || null })}
          />
        </div>
        <label className="account-field">
          <span>{t('account.nationalId')}</span>
          <input
            dir="ltr"
            value={draft.nationalId}
            disabled={busy}
            onChange={(event) => patch({ nationalId: event.target.value })}
          />
        </label>
        <label className="account-field">
          <span>{t('account.phone')}</span>
          <input
            dir="ltr"
            value={draft.phone}
            disabled={busy}
            placeholder="+98912…"
            onChange={(event) => patch({ phone: event.target.value })}
          />
        </label>
        <label className="account-field">
          <span>{t('account.email')}</span>
          <input
            dir="ltr"
            type="email"
            value={draft.email}
            disabled={busy}
            onChange={(event) => patch({ email: event.target.value })}
          />
        </label>
        <label className="account-field">
          <span>{t('account.jobTitle')}</span>
          <input
            value={draft.jobTitle}
            disabled={busy}
            onChange={(event) => patch({ jobTitle: event.target.value })}
          />
        </label>
        <label className="account-field">
          <span>{t('account.organization')}</span>
          <input
            value={draft.organization}
            disabled={busy}
            onChange={(event) => patch({ organization: event.target.value })}
          />
        </label>
        <label className="account-field account-field--wide">
          <span>{t('account.address')}</span>
          <input
            value={draft.address}
            disabled={busy}
            onChange={(event) => patch({ address: event.target.value })}
          />
        </label>
        <label className="account-field account-field--wide">
          <span>{t('account.bio')}</span>
          <textarea
            rows={3}
            value={draft.bio}
            disabled={busy}
            onChange={(event) => patch({ bio: event.target.value })}
          />
        </label>
      </div>

      <p className="account-hint">{t('account.profileHint')}</p>
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      {notice ? <p className="account-notice" role="status">{notice}</p> : null}

      <div className="account-actions">
        <button type="button" className="good-button good-button--primary" onClick={() => void save()} disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="good-button" onClick={() => void shareCard()} disabled={busy}>
          {t('account.shareCard')}
        </button>
        {profile?.updatedAt ? (
          <span className="account-stamp">{t('account.updatedAt')}</span>
        ) : null}
      </div>
    </div>
  );
}
