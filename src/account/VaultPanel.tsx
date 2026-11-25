import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isMobileShell } from '../app/layout/platform';
import { DatePicker } from '../components/DatePicker';
import { Check, Download, FileText, Lock, Plus, Search, Trash2, X } from '../components/icons';
import { t } from '../i18n';
import { formatDisplayDate } from '../lib/calendar-system';
import {
  VAULT_CATEGORIES,
  accountApi,
  draftOf,
  emptyVaultDraft,
  formatBytes,
  type VaultDocument,
  type VaultDraft,
  type VaultStatus
} from './account-api';

function messageOf(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : t('common.opFailed');
}

function categoryLabel(category: string) {
  return t(`vault.cat.${category}`);
}

function displayDate(value: string | null) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : formatDisplayDate(date, 'short');
}

/** Days until expiry; negative once it has passed. */
function daysUntil(value: string | null) {
  if (!value) return null;
  const target = new Date(`${value}T00:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((target - start) / 86_400_000);
}

function fileStem(path: string) {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.[^.]+$/, '');
}

/// The phone picker gives a File, not a path. Reading it here keeps the same
/// 64 MB ceiling the Rust side enforces and lets the bytes travel as base64.
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export function VaultPanel() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [hint, setHint] = useState('');
  const [unlockPin, setUnlockPin] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; draft: VaultDraft } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ document: VaultDocument; url: string; text?: string } | null>(null);
  const [changingPin, setChangingPin] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const previewUrl = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mobile = isMobileShell();

  const loadDocuments = useCallback(async () => {
    try {
      setDocuments(await accountApi.vaultList());
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await accountApi.vaultStatus();
      setStatus(next);
      if (next.unlocked) await loadDocuments();
      else setDocuments([]);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [loadDocuments]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return documents.filter((document) => {
      if (category !== 'all' && document.category !== category) return false;
      if (!needle) return true;
      return [document.title, document.docNumber, document.tags, document.fileName, document.notes]
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [documents, query, category]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setup() {
    if (pin !== pinConfirm) {
      setError(t('vault.mismatch'));
      return;
    }
    await run('setup', async () => {
      setStatus(await accountApi.vaultSetup(pin, hint));
      setPin('');
      setPinConfirm('');
      setHint('');
      await loadDocuments();
      setNotice(t('vault.ready'));
    });
  }

  async function unlock() {
    await run('unlock', async () => {
      setStatus(await accountApi.vaultUnlock(unlockPin));
      setUnlockPin('');
      await loadDocuments();
    });
  }

  async function lock() {
    await run('lock', async () => {
      await accountApi.vaultLock();
      setStatus((current) => (current ? { ...current, unlocked: false } : current));
      setDocuments([]);
      setSelected(new Set());
      setEditing(null);
      setPreview(null);
    });
  }

  async function addDocuments() {
    // Android has no filesystem path to hand the backend, so the hidden file
    // input does the picking and the bytes go through IPC.
    if (mobile) {
      fileInput.current?.click();
      return;
    }
    await run('add', async () => {
      const paths = await accountApi.vaultPickFiles();
      if (paths.length === 0) return;
      let added = 0;
      for (const path of paths) {
        await accountApi.vaultImport(path, emptyVaultDraft(fileStem(path)));
        added += 1;
      }
      await loadDocuments();
      await refresh();
      setNotice(t('vault.added', { count: added }));
    });
  }

  async function addPickedFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    await run('add', async () => {
      let added = 0;
      for (const file of Array.from(files)) {
        if (file.size > MAX_IMPORT_BYTES) continue;
        const base64 = await readBase64(file);
        await accountApi.vaultImportBytes(
          file.name,
          file.type,
          base64,
          emptyVaultDraft(fileStem(file.name))
        );
        added += 1;
      }
      await loadDocuments();
      await refresh();
      setNotice(t('vault.added', { count: added }));
    });
  }

  async function saveEdit() {
    if (!editing) return;
    await run('edit', async () => {
      await accountApi.vaultUpdate(editing.id, editing.draft);
      setEditing(null);
      await loadDocuments();
      setNotice(t('vault.updated'));
    });
  }

  async function remove(ids: string[]) {
    await run('delete', async () => {
      await accountApi.vaultDelete(ids);
      setConfirmDelete(null);
      setSelected(new Set());
      await loadDocuments();
      await refresh();
      setNotice(t('vault.deleted'));
    });
  }

  async function openPreview(document: VaultDocument) {
    await run('preview', async () => {
      const file = await accountApi.vaultRead(document.id);
      const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      if (file.mime.startsWith('image/')) {
        const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
        previewUrl.current = url;
        setPreview({ document, url });
      } else if (file.mime === 'application/pdf') {
        const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
        previewUrl.current = url;
        setPreview({ document, url });
      } else if (file.mime.startsWith('text/')) {
        setPreview({ document, url: '', text: new TextDecoder().decode(bytes) });
      } else {
        await accountApi.vaultOpen(document.id);
      }
    });
  }

  async function saveCopy(document: VaultDocument) {
    await run('save', async () => {
      const path = await accountApi.vaultSaveCopy(document.id);
      if (path) setNotice(t('vault.downloaded', { path }));
    });
  }

  async function exportZip() {
    await run('zip', async () => {
      const result = await accountApi.vaultExportZip([...selected]);
      if (result.path) setNotice(t('vault.exported', { count: result.count, path: result.path }));
    });
  }

  async function changePin() {
    await run('pin', async () => {
      await accountApi.vaultChangePin(oldPin, newPin);
      setChangingPin(false);
      setOldPin('');
      setNewPin('');
      setNotice(t('vault.pinChanged'));
    });
  }

  if (!status) {
    return error ? (
      <p className="dialog-error" role="alert">{error}</p>
    ) : (
      <p className="account-hint">{t('vault.loading')}</p>
    );
  }

  if (!status.initialized) {
    return (
      <div className="vault-gate">
        <div className="vault-gate__icon"><Lock aria-hidden="true" /></div>
        <h3>{t('vault.setupTitle')}</h3>
        <p className="account-hint">{t('vault.setupHint')}</p>
        <label className="account-field">
          <span>{t('vault.pin')}</span>
          <input
            dir="ltr"
            type="password"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            disabled={busy !== null}
          />
        </label>
        <label className="account-field">
          <span>{t('vault.pinConfirm')}</span>
          <input
            dir="ltr"
            type="password"
            value={pinConfirm}
            onChange={(event) => setPinConfirm(event.target.value)}
            disabled={busy !== null}
          />
        </label>
        <label className="account-field">
          <span>{t('vault.hintLabel')}</span>
          <input
            value={hint}
            onChange={(event) => setHint(event.target.value)}
            disabled={busy !== null}
            placeholder={t('vault.hintPlaceholder')}
          />
        </label>
        <p className="vault-warning">{t('vault.pinWarning')}</p>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <button
          type="button"
          className="good-button good-button--primary"
          onClick={() => void setup()}
          disabled={busy !== null || pin.length < 6 || !pinConfirm}
        >
          {busy === 'setup' ? t('vault.working') : t('vault.create')}
        </button>
      </div>
    );
  }

  if (!status.unlocked) {
    return (
      <div className="vault-gate">
        <div className="vault-gate__icon"><Lock aria-hidden="true" /></div>
        <h3>{t('vault.unlockTitle')}</h3>
        <p className="account-hint">
          {t('vault.countLabel', { count: status.documentCount, size: formatBytes(status.totalBytes) })}
        </p>
        <label className="account-field">
          <span>{t('vault.pin')}</span>
          <input
            dir="ltr"
            type="password"
            autoFocus
            value={unlockPin}
            onChange={(event) => setUnlockPin(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void unlock();
            }}
            disabled={busy !== null}
          />
        </label>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <button
          type="button"
          className="good-button good-button--primary"
          onClick={() => void unlock()}
          disabled={busy !== null || !unlockPin}
        >
          {busy === 'unlock' ? t('vault.working') : t('vault.unlock')}
        </button>
      </div>
    );
  }

  if (editing) {
    const draft = editing.draft;
    const update = (changes: Partial<VaultDraft>) =>
      setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...changes } } : current));
    return (
      <div className="vault-editor">
        <div className="vault-editor__head">
          <h3>{t('vault.editTitle')}</h3>
          <button type="button" className="good-icon-button" aria-label={t('common.close')} onClick={() => setEditing(null)}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="account-grid">
          <label className="account-field">
            <span>{t('vault.title')}</span>
            <input value={draft.title} onChange={(event) => update({ title: event.target.value })} />
          </label>
          <label className="account-field">
            <span>{t('vault.category')}</span>
            <select value={draft.category} onChange={(event) => update({ category: event.target.value })}>
              {VAULT_CATEGORIES.map((value) => (
                <option key={value} value={value}>{categoryLabel(value)}</option>
              ))}
            </select>
          </label>
          <label className="account-field">
            <span>{t('vault.docNumber')}</span>
            <input value={draft.docNumber} onChange={(event) => update({ docNumber: event.target.value })} />
          </label>
          <div className="account-field">
            <span>{t('vault.issuedAt')}</span>
            <DatePicker
              id="vault-issued"
              label={t('vault.issuedAt')}
              hideLabel
              value={draft.issuedAt ?? ''}
              open={openDate === 'issued'}
              onOpenChange={(open) => setOpenDate(open ? 'issued' : null)}
              onChange={(value) => update({ issuedAt: value || null })}
            />
          </div>
          <div className="account-field">
            <span>{t('vault.expiresAt')}</span>
            <DatePicker
              id="vault-expires"
              label={t('vault.expiresAt')}
              hideLabel
              value={draft.expiresAt ?? ''}
              open={openDate === 'expires'}
              onOpenChange={(open) => setOpenDate(open ? 'expires' : null)}
              onChange={(value) => update({ expiresAt: value || null })}
            />
          </div>
          <label className="account-field">
            <span>{t('vault.tags')}</span>
            <input value={draft.tags} onChange={(event) => update({ tags: event.target.value })} />
          </label>
          <label className="account-field account-field--wide">
            <span>{t('vault.notes')}</span>
            <textarea rows={3} value={draft.notes} onChange={(event) => update({ notes: event.target.value })} />
          </label>
        </div>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="account-actions">
          <button type="button" className="good-button good-button--primary" onClick={() => void saveEdit()} disabled={busy !== null}>
            {busy === 'edit' ? t('common.saving') : t('common.save')}
          </button>
          <button type="button" className="good-button" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="vault">
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.doc,.docx,.xls,.xlsx,.txt"
        onChange={(event) => {
          void addPickedFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <div className="vault-toolbar">
        <button type="button" className="good-button good-button--primary" onClick={() => void addDocuments()} disabled={busy !== null}>
          <Plus aria-hidden="true" />
          {t('vault.add')}
        </button>
        <button type="button" className="good-button" onClick={() => void exportZip()} disabled={busy !== null || documents.length === 0}>
          <Download aria-hidden="true" />
          {selected.size ? t('vault.exportSelected', { count: selected.size }) : t('vault.exportZip')}
        </button>
        <button type="button" className="good-button good-button--ghost" onClick={() => void lock()} disabled={busy !== null}>
          <Lock aria-hidden="true" />
          {t('vault.lock')}
        </button>
        <span className="vault-summary">
          {t('vault.countLabel', { count: status.documentCount, size: formatBytes(status.totalBytes) })}
        </span>
      </div>

      <div className="vault-filters">
        <label className="vault-search">
          <Search aria-hidden="true" />
          <input
            value={query}
            placeholder={t('vault.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label={t('vault.category')}>
          <option value="all">{t('vault.allCategories')}</option>
          {VAULT_CATEGORIES.map((value) => (
            <option key={value} value={value}>{categoryLabel(value)}</option>
          ))}
        </select>
        {selected.size ? (
          <button type="button" className="good-button good-button--ghost" onClick={() => setSelected(new Set())}>
            {t('vault.clearSelection')}
          </button>
        ) : null}
      </div>

      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      {notice ? <p className="account-notice" role="status">{notice}</p> : null}

      {confirmDelete ? (
        <div className="vault-confirm" role="alertdialog">
          <span>{t('vault.deleteConfirm', { count: confirmDelete.length })}</span>
          <button type="button" className="good-button good-button--danger" onClick={() => void remove(confirmDelete)} disabled={busy !== null}>
            {t('common.delete')}
          </button>
          <button type="button" className="good-button" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
        </div>
      ) : null}

      {preview ? (
        <div className="vault-preview">
          <div className="vault-preview__head">
            <strong>{preview.document.title}</strong>
            <button type="button" className="good-icon-button" aria-label={t('common.close')} onClick={() => setPreview(null)}>
              <X aria-hidden="true" />
            </button>
          </div>
          {preview.text !== undefined ? (
            <pre className="vault-preview__text">{preview.text}</pre>
          ) : preview.document.mime.startsWith('image/') ? (
            <img src={preview.url} alt={preview.document.title} />
          ) : (
            <iframe src={preview.url} title={preview.document.title} />
          )}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="account-hint">{documents.length === 0 ? t('vault.empty') : t('vault.noMatch')}</p>
      ) : (
        <ul className="vault-list">
          {visible.map((document) => {
            const remaining = daysUntil(document.expiresAt);
            return (
              <li key={document.id} className={`vault-item${selected.has(document.id) ? ' is-selected' : ''}`}>
                <label className="vault-item__check">
                  <input
                    type="checkbox"
                    checked={selected.has(document.id)}
                    onChange={() => toggle(document.id)}
                    aria-label={document.title}
                  />
                  <span aria-hidden="true">{selected.has(document.id) ? <Check /> : null}</span>
                </label>
                <div className="vault-item__icon"><FileText aria-hidden="true" /></div>
                <div className="vault-item__body">
                  <div className="vault-item__title">
                    <strong>{document.title}</strong>
                    <span className="vault-chip">{categoryLabel(document.category)}</span>
                    {remaining !== null && remaining < 0 ? (
                      <span className="vault-chip vault-chip--danger">{t('vault.expired')}</span>
                    ) : remaining !== null && remaining <= 30 ? (
                      <span className="vault-chip vault-chip--warn">{t('vault.expiringSoon')}</span>
                    ) : null}
                  </div>
                  <div className="vault-item__meta">
                    <span>{document.fileName}</span>
                    <span>{formatBytes(document.byteSize)}</span>
                    {document.docNumber ? <span dir="ltr">{document.docNumber}</span> : null}
                    {document.issuedAt ? <span>{displayDate(document.issuedAt)}</span> : null}
                    {document.expiresAt ? <span>{t('vault.expiresShort', { date: displayDate(document.expiresAt) })}</span> : null}
                  </div>
                  {document.notes ? <p className="vault-item__notes">{document.notes}</p> : null}
                </div>
                <div className="vault-item__actions">
                  <button type="button" className="good-button good-button--ghost" onClick={() => void openPreview(document)} disabled={busy !== null}>
                    {t('vault.view')}
                  </button>
                  <button type="button" className="good-button good-button--ghost" onClick={() => void saveCopy(document)} disabled={busy !== null}>
                    {t('vault.download')}
                  </button>
                  <button
                    type="button"
                    className="good-button good-button--ghost"
                    onClick={() => setEditing({ id: document.id, draft: draftOf(document) })}
                    disabled={busy !== null}
                  >
                    {t('vault.edit')}
                  </button>
                  <button
                    type="button"
                    className="good-icon-button vault-item__delete"
                    aria-label={t('common.delete')}
                    onClick={() => setConfirmDelete([document.id])}
                    disabled={busy !== null}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="vault-foot">
        {changingPin ? (
          <div className="vault-pin-change">
            <label className="account-field">
              <span>{t('vault.oldPin')}</span>
              <input dir="ltr" type="password" value={oldPin} onChange={(event) => setOldPin(event.target.value)} />
            </label>
            <label className="account-field">
              <span>{t('vault.newPin')}</span>
              <input dir="ltr" type="password" value={newPin} onChange={(event) => setNewPin(event.target.value)} />
            </label>
            <button type="button" className="good-button good-button--primary" onClick={() => void changePin()} disabled={busy !== null || !oldPin || newPin.length < 6}>
              {t('common.save')}
            </button>
            <button type="button" className="good-button" onClick={() => setChangingPin(false)}>{t('common.cancel')}</button>
          </div>
        ) : (
          <button type="button" className="good-button good-button--ghost" onClick={() => setChangingPin(true)}>
            {t('vault.changePin')}
          </button>
        )}
        <p className="account-hint">{t('vault.secureNote')}</p>
      </div>
    </div>
  );
}
