import { Copy, Pencil, Plus, Trash2, X } from '../components/icons';
import { useEffect, useId, useRef, useState } from 'react';
import { ColorPicker } from '../components/ColorPicker';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DESIGN_COLORS, normalizeHexColor, type ColorPreset, type HexColor } from '../lib/color';
import { t } from '../i18n';
import { copyText } from './clipboard';
import type { Contact, ContactCategory, ContactCategoryDraft } from './contact-model';

type PhonebookGroupsPanelProps = {
  categories: ContactCategory[];
  contacts: Contact[];
  onCreate(draft: ContactCategoryDraft): Promise<unknown>;
  onUpdate(id: string, draft: ContactCategoryDraft): Promise<unknown>;
  onDelete(id: string): Promise<void>;
};

function groupColorPresets(): readonly ColorPreset[] {
  return [
    { value: DESIGN_COLORS.primary, label: t('color.teal') },
    { value: DESIGN_COLORS.danger, label: t('color.coral') },
    { value: DESIGN_COLORS.success, label: t('color.green') },
    { value: DESIGN_COLORS.warning, label: t('color.amber') },
    { value: DESIGN_COLORS.info, label: t('color.indigo') }
  ];
}

const DEFAULT_NEW_COLOR = DESIGN_COLORS.primary as HexColor;

type EditorState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; category: ContactCategory };

/**
 * One copyable line per contact: a colleague copies the whole group and pastes
 * it into a chat, so the line has to read well on its own — name first, then the
 * line the contact is reachable on.
 */
function numberLines(contacts: Contact[]): string {
  return contacts
    .map((contact) => {
      const number = contact.extension || contact.phone;
      const label = contact.extension ? t('phonebook.extensionShort', { extension: contact.extension }) : number;
      return number ? `${contact.name} — ${label}` : contact.name;
    })
    .join('\n');
}

/**
 * The "groups" tab: a real manager, not just a filter. Each group shows its
 * colour, its name and how many people sit in it, with the actions that make a
 * group useful — copy every number at once, rename, recolor, delete. Deleting a
 * group never deletes a contact; it only returns them to "no group", and the
 * confirmation says so.
 */
export function PhonebookGroupsPanel({
  categories,
  contacts,
  onCreate,
  onUpdate,
  onDelete
}: PhonebookGroupsPanelProps) {
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<HexColor>(DEFAULT_NEW_COLOR);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ContactCategory | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const editorId = useId();

  useEffect(() => {
    if (editor.mode !== 'closed') nameInputRef.current?.focus();
  }, [editor.mode]);

  useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  function membersOf(categoryId: string) {
    return contacts.filter((contact) => contact.categoryId === categoryId);
  }

  function resetEditor() {
    setEditor({ mode: 'closed' });
    setDraftName('');
    setDraftColor(DEFAULT_NEW_COLOR);
    setFormError('');
  }

  function beginCreate() {
    setEditor({ mode: 'create' });
    setDraftName('');
    setDraftColor(DEFAULT_NEW_COLOR);
    setFormError('');
  }

  function beginEdit(category: ContactCategory) {
    setEditor({ mode: 'edit', category });
    setDraftName(category.name);
    setDraftColor(normalizeHexColor(category.color) ?? DEFAULT_NEW_COLOR);
    setFormError('');
  }

  async function submitEditor() {
    const name = draftName.trim();
    if (!name) {
      setFormError(t('category.errorName'));
      return;
    }
    const color = normalizeHexColor(draftColor);
    if (!color) {
      setFormError(t('category.errorColor'));
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      if (editor.mode === 'create') {
        await onCreate({ name, color });
        resetEditor();
      } else if (editor.mode === 'edit') {
        await onUpdate(editor.category.id, { name, color });
        resetEditor();
      }
    } catch (error) {
      setFormError(errorMessage(error) || t('category.errorSave'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoval() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await onDelete(confirmDelete.id);
      setConfirmDelete(null);
    } catch (error) {
      setFormError(errorMessage(error) || t('category.errorSave'));
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  }

  async function copyGroup(category: ContactCategory) {
    const members = membersOf(category.id);
    if (members.length === 0) return;
    if (await copyText(numberLines(members))) setCopiedId(category.id);
  }

  return (
    <div className="phonebook-groups">
      <div className="phonebook-groups__head">
        <span className="phonebook-groups__hint">{t('phonebook.groups.hint')}</span>
        <button type="button" className="good-button good-button--subtle" disabled={busy} onClick={beginCreate}>
          <Plus aria-hidden="true" />
          {t('phonebook.groups.add')}
        </button>
      </div>

      {editor.mode !== 'closed' ? (
        <div className="phonebook-groups__editor" role="group" aria-label={editor.mode === 'create' ? t('category.addTitle') : t('category.editTitle')}>
          <div className="phonebook-groups__editor-head">
            <span>{editor.mode === 'create' ? t('category.addTitle') : t('category.editTitle')}</span>
            <button type="button" className="good-icon-button" aria-label={t('common.cancel')} disabled={busy} onClick={resetEditor}>
              <X aria-hidden="true" />
            </button>
          </div>
          <input
            ref={nameInputRef}
            id={editorId}
            className="good-input"
            value={draftName}
            placeholder={t('category.namePlaceholder')}
            disabled={busy}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitEditor(); } }}
          />
          <ColorPicker
            legend={t('category.colorLegend')}
            name={`${editorId}-color`}
            value={draftColor}
            presets={groupColorPresets()}
            recentColors={[]}
            disabled={busy}
            onChange={setDraftColor}
          />
          {formError ? <div role="alert" className="dialog-error">{formError}</div> : null}
          <div className="phonebook-groups__editor-actions">
            <button type="button" className="good-button" disabled={busy} onClick={resetEditor}>{t('common.cancel')}</button>
            <button type="button" className="good-button good-button--primary" disabled={busy} onClick={() => void submitEditor()}>
              {editor.mode === 'create' ? t('category.add') : t('category.save')}
            </button>
          </div>
        </div>
      ) : null}

      {categories.length === 0 ? (
        <p className="phonebook-dialog__empty">{t('phonebook.groups.empty')}</p>
      ) : (
        <ul className="phonebook-groups__list">
          {categories.map((category) => {
            const members = membersOf(category.id);
            return (
              <li key={category.id} className="phonebook-group-row" data-testid={`phonebook-group-${category.id}`}>
                <span className="phonebook-group-row__dot" style={{ background: category.color }} aria-hidden="true" />
                <span className="phonebook-group-row__name">{category.name}</span>
                <span className="phonebook-group-row__count">{t('phonebook.count', { count: members.length })}</span>
                <span className="phonebook-group-row__tools">
                  <button
                    type="button"
                    className="good-icon-button"
                    disabled={members.length === 0}
                    aria-label={t('phonebook.copyGroup', { name: category.name })}
                    title={t('phonebook.copyGroup', { name: category.name })}
                    onClick={() => void copyGroup(category)}
                  >
                    <Copy aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="good-icon-button"
                    aria-label={t('category.edit', { name: category.name })}
                    onClick={() => beginEdit(category)}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="good-icon-button"
                    aria-label={t('category.delete', { name: category.name })}
                    onClick={() => setConfirmDelete(category)}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
                {copiedId === category.id ? <span className="phonebook-group-row__copied" role="status">{t('phonebook.copied')}</span> : null}
              </li>
            );
          })}
        </ul>
      )}

      {confirmDelete ? (
        <ConfirmDialog
          title={t('category.deleteTitle', { name: confirmDelete.name })}
          description={t('phonebook.groups.deleteBody')}
          tone="danger"
          confirmLabel={t('category.deleteConfirm')}
          busyLabel={t('common.deleting')}
          busy={busy}
          onConfirm={() => void confirmRemoval()}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error as { message: string }).message
    : '';
}
