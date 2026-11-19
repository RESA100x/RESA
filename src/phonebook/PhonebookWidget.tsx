import { Phone } from '../components/icons';
import { useRef, useState } from 'react';
import { t } from '../i18n';
import { PhonebookDialog } from './PhonebookDialog';
import { useContactCategories } from './useContactCategories';
import { useContacts } from './useContacts';
import './phonebook.css';

/**
 * The launcher shape: a one-cell block that owns no list of its own. A 1×1 cell
 * is roughly a third of a normal module's width, so anything that needs room to
 * breathe belongs in a modal the block itself opens. Any future block that wants
 * the same behaviour only has to copy this file: draw a tile, keep the modal
 * state here, and render a `Dialog` when it is open.
 */
export function PhonebookWidget({ readOnly = false }: { readOnly?: boolean }) {
  const { contacts, reload, createContact, updateContact, deleteContact, exportContacts, importContacts } = useContacts();
  const { categories, reloadCategories, createCategory, updateCategory, deleteCategory } = useContactCategories();
  const [open, setOpen] = useState(false);
  const tileRef = useRef<HTMLButtonElement>(null);

  const count = contacts.data.length;
  const failed = contacts.status === 'error';
  const ready = contacts.status === 'ready';
  const detail = failed
    ? (contacts.message ?? t('phonebook.readError'))
    : t('phonebook.count', { count });

  return (
    <div className="widget-content phonebook-widget">
      <button
        ref={tileRef}
        type="button"
        className="phonebook-tile"
        data-testid="phonebook-tile"
        // The wallpaper face has no pointer and must never pull the app to the
        // foreground, so the tile stays a plain, unclickable card there.
        disabled={readOnly}
        aria-label={readOnly ? t('phonebook.tileReadOnly', { count }) : t('phonebook.openTile', { count })}
        title={detail}
        onClick={() => setOpen(true)}
      >
        {/* The block is the icon: a full-bleed plate with one large glyph, no
            separate chip and no caption underneath — it reads as an app icon on
            the desktop. The name and the count live in the accessible label and
            the corner badge, so nothing small has to be legible in one cell. */}
        <span className="phonebook-tile__plate" aria-hidden="true">
          <Phone />
        </span>
        <span className="phonebook-tile__badge" aria-hidden="true">
          {failed ? '!' : ready ? count : '…'}
        </span>
      </button>

      {open ? (
        <PhonebookDialog
          resource={contacts}
          categories={categories}
          restoreFocusRef={tileRef}
          onRetry={reload}
          onRetryCategories={reloadCategories}
          onClose={() => setOpen(false)}
          onCreate={createContact}
          onUpdate={updateContact}
          onDelete={deleteContact}
          onCreateCategory={createCategory}
          onUpdateCategory={updateCategory}
          onDeleteCategory={deleteCategory}
          onExport={exportContacts}
          onImport={importContacts}
        />
      ) : null}
    </div>
  );
}
