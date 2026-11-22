import { Check, GalleryCircle, Plus, Trash2, X } from '../components/icons';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { t } from '../i18n';
import { BookCover } from './BookCover';
import { BookCoverError, prepareBookCover } from './book-cover';
import {
  bookToForm,
  emptyBookForm,
  isBookFormDirty,
  toBookDraft,
  validateBookForm,
  type BookFieldErrors,
  type BookFormDraft
} from './book-draft';
import {
  BOOK_FORMATS,
  BOOK_LOAN_DIRECTIONS,
  BOOK_OWNERSHIP,
  BOOK_STATUSES,
  bookFormatKey,
  bookLoanKey,
  bookOwnershipKey,
  bookStatusKey,
  type Book,
  type BookDraft,
  type BookFormat,
  type BookLoanDirection,
  type BookOwnership,
  type BookStatus
} from './book-model';

type Props = {
  mode: { type: 'create' } | { type: 'edit'; book: Book };
  onClose(): void;
  onCreate(draft: BookDraft): Promise<unknown>;
  onUpdate(book: Book, draft: BookDraft): Promise<unknown>;
  onDelete(book: Book): Promise<unknown>;
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error.message as string)
    : t('common.opFailed');
}

export function BookDialog({ mode, onClose, onCreate, onUpdate, onDelete }: Props) {
  const titleId = useId();
  const original = useRef<BookFormDraft>(mode.type === 'edit' ? bookToForm(mode.book) : emptyBookForm());
  const [form, setForm] = useState<BookFormDraft>(original.current);
  const [errors, setErrors] = useState<BookFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [openPicker, setOpenPicker] = useState('');
  const coverInputRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<BookFormDraft>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const picker = (id: string) => ({
    open: openPicker === id,
    onOpenChange: (open: boolean) => setOpenPicker(open ? id : '')
  });

  const dirty = isBookFormDirty(form, original.current);

  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  async function pickCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCoverBusy(true);
    setFormError('');
    try {
      update({ cover: await prepareBookCover(file) });
    } catch (error) {
      setFormError(error instanceof BookCoverError ? t('library.form.errorPhoto') : message(error));
    } finally {
      setCoverBusy(false);
    }
  }

  async function save() {
    const found = validateBookForm(form, {
      title: t('library.form.errorTitle'),
      pages: t('library.form.errorPages'),
      year: t('library.form.errorYear'),
      rating: t('library.form.errorRating'),
      cover: t('library.form.errorPhoto'),
      date: t('library.form.errorDate')
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFormError('');
    try {
      const draft = toBookDraft(form);
      if (mode.type === 'edit') await onUpdate(mode.book, draft);
      else await onCreate(draft);
      onClose();
    } catch (error) {
      setFormError(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (mode.type !== 'edit') return;
    setBusy(true);
    setFormError('');
    try {
      await onDelete(mode.book);
      setConfirmDelete(false);
      onClose();
    } catch (error) {
      setConfirmDelete(false);
      setFormError(message(error));
    } finally {
      setBusy(false);
    }
  }

  const statusOptions = BOOK_STATUSES.map((value) => ({ value, label: t(bookStatusKey(value)) }));
  const ownershipOptions = BOOK_OWNERSHIP.map((value) => ({ value, label: t(bookOwnershipKey(value)) }));
  const loanOptions = [
    { value: '', label: t('library.form.loanNone') },
    ...BOOK_LOAN_DIRECTIONS.map((value) => ({ value, label: t(bookLoanKey(value)) }))
  ];

  return (
    <>
      <Dialog
        title={mode.type === 'edit' ? t('library.form.editTitle') : t('library.form.createTitle')}
        ariaLabelledBy={titleId}
        isTopLayer={!confirmDelete && !confirmDiscard}
        onRequestClose={requestClose}
        className="library-form-dialog"
        headerActions={
          <button type="button" aria-label={t('common.close')} className="good-icon-button" onClick={requestClose}>
            <X aria-hidden="true" />
          </button>
        }
        footer={
          <div className="library-form__actions">
            {mode.type === 'edit' ? (
              <button type="button" className="good-button library-form__delete" disabled={busy} onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
                {t('common.delete')}
              </button>
            ) : null}
            <span className="library-form__spacer" />
            <button type="button" className="good-button" disabled={busy} onClick={requestClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="good-button good-button--primary" disabled={busy || coverBusy} onClick={() => void save()}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        }
      >
        <div className="library-form">
          {formError ? <p className="library-form__error" role="alert">{formError}</p> : null}

          <div className="library-form__cover">
            <BookCover
              title={form.title || t('library.form.coverEmpty')}
              cover={form.cover}
              bookId={mode.type === 'edit' ? mode.book.id : undefined}
              className="library-form__cover-image"
            />
            <div className="library-form__cover-actions">
              <button type="button" className="good-button" disabled={busy || coverBusy} onClick={() => coverInputRef.current?.click()}>
                <GalleryCircle aria-hidden="true" />
                {coverBusy ? t('library.form.coverBusy') : t('library.form.coverPick')}
              </button>
              {form.cover ? (
                <button type="button" className="good-button" disabled={busy || coverBusy} onClick={() => update({ cover: '' })}>
                  {t('library.form.coverRemove')}
                </button>
              ) : null}
              <span className="library-form__hint">{t('library.form.coverHint')}</span>
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={(event) => void pickCover(event)} />
          </div>

          <section className="library-form__section">
            <h3 className="library-form__heading">{t('library.form.sectionIdentity')}</h3>
            <Field id="book-title" label={t('library.form.title')} value={form.title} required disabled={busy} error={errors.title} onChange={(title) => update({ title })} />
            <div className="library-form__grid">
              <Field id="book-author" label={t('library.form.author')} value={form.author} disabled={busy} onChange={(author) => update({ author })} />
              <Field id="book-translator" label={t('library.form.translator')} value={form.translator} disabled={busy} onChange={(translator) => update({ translator })} />
              <Field id="book-publisher" label={t('library.form.publisher')} value={form.publisher} disabled={busy} onChange={(publisher) => update({ publisher })} />
              <Field id="book-year" label={t('library.form.year')} value={form.publishedYear} disabled={busy} inputMode="numeric" error={errors.publishedYear} onChange={(publishedYear) => update({ publishedYear })} />
              <Field id="book-pages" label={t('library.form.pages')} value={form.pages} disabled={busy} inputMode="numeric" error={errors.pages} onChange={(pages) => update({ pages })} />
              <Field id="book-isbn" label={t('library.form.isbn')} value={form.isbn} disabled={busy} onChange={(isbn) => update({ isbn })} />
              <Field id="book-category" label={t('library.form.category')} value={form.category} disabled={busy} onChange={(category) => update({ category })} />
              <Field id="book-tags" label={t('library.form.tags')} value={form.tags} disabled={busy} hint={t('library.form.tagsHint')} onChange={(tags) => update({ tags })} />
            </div>
            <fieldset className="library-choice">
              <legend>{t('library.form.formats')}</legend>
              <div className="library-choice__row">
                {BOOK_FORMATS.map((format) => {
                  const on = form.formats.includes(format);
                  return (
                    <label key={format} className="library-check">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={busy}
                        onChange={() =>
                          update({
                            formats: on ? form.formats.filter((item) => item !== format) : [...form.formats, format]
                          })
                        }
                      />
                      <span className="library-check__box" aria-hidden="true">{on ? <Check /> : null}</span>
                      {t(bookFormatKey(format))}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </section>

          <section className="library-form__section">
            <h3 className="library-form__heading">{t('library.form.sectionReading')}</h3>
            <div className="library-form__grid">
              <Select id="book-status" label={t('library.form.status')} value={form.status} options={statusOptions} disabled={busy} onChange={(value) => update({ status: value as BookStatus })} />
              <Select id="book-ownership" label={t('library.form.ownership')} value={form.ownership} options={ownershipOptions} disabled={busy} onChange={(value) => update({ ownership: value as BookOwnership })} />
              <Field id="book-progress" label={t('library.form.progress')} value={form.progressPages} disabled={busy} inputMode="numeric" hint={t('library.form.progressHint')} onChange={(progressPages) => update({ progressPages })} />
              <Field id="book-rating" label={t('library.form.rating')} value={form.rating} disabled={busy} inputMode="numeric" error={errors.rating} hint={t('library.form.ratingHint')} onChange={(rating) => update({ rating })} />
            </div>
            <div className="library-form__grid">
              <DatePicker id="book-started" label={t('library.form.startedAt')} value={form.startedAt} disabled={busy} errorId={errors.startedAt ? 'book-started-error' : undefined} onChange={(startedAt) => update({ startedAt })} {...picker('startedAt')} />
              <DatePicker id="book-finished" label={t('library.form.finishedAt')} value={form.finishedAt} disabled={busy} errorId={errors.finishedAt ? 'book-finished-error' : undefined} onChange={(finishedAt) => update({ finishedAt })} {...picker('finishedAt')} />
              <DatePicker id="book-reading-target" label={t('library.form.readingTarget')} value={form.readingTarget} disabled={busy} errorId={errors.readingTarget ? 'book-reading-target-error' : undefined} onChange={(readingTarget) => update({ readingTarget })} {...picker('readingTarget')} />
            </div>
            <label className="library-check">
              <input type="checkbox" checked={form.isFavorite} disabled={busy} onChange={(event) => update({ isFavorite: event.target.checked })} />
              <span className="library-check__box" aria-hidden="true">{form.isFavorite ? <Check /> : null}</span>
              {t('library.form.favorite')}
            </label>
          </section>

          <section className="library-form__section">
            <h3 className="library-form__heading">{t('library.form.sectionPlace')}</h3>
            <div className="library-form__grid">
              <Field id="book-location" label={t('library.form.location')} value={form.location} disabled={busy} hint={t('library.form.locationHint')} onChange={(location) => update({ location })} />
              <Field id="book-recommender" label={t('library.form.recommender')} value={form.recommender} disabled={busy} hint={t('library.form.recommenderHint')} onChange={(recommender) => update({ recommender })} />
              <DatePicker id="book-purchase" label={t('library.form.purchaseDate')} value={form.purchaseDate} disabled={busy} errorId={errors.purchaseDate ? 'book-purchase-error' : undefined} onChange={(purchaseDate) => update({ purchaseDate })} {...picker('purchaseDate')} />
              <Select id="book-loan" label={t('library.form.loan')} value={form.loanDirection} options={loanOptions} disabled={busy} onChange={(value) => update({ loanDirection: value as '' | BookLoanDirection })} />
              <Field id="book-loan-person" label={t('library.form.loanPerson')} value={form.loanPerson} disabled={busy} onChange={(loanPerson) => update({ loanPerson })} />
            </div>
            {form.loanDirection ? (
              <div className="library-form__grid">
                <DatePicker id="book-loan-due" label={t('library.form.loanDue')} value={form.loanDueDate} disabled={busy} errorId={errors.loanDueDate ? 'book-loan-due-error' : undefined} onChange={(loanDueDate) => update({ loanDueDate })} {...picker('loanDueDate')} />
              </div>
            ) : null}
          </section>

          <section className="library-form__section">
            <h3 className="library-form__heading">{t('library.form.sectionNotes')}</h3>
            <div className="good-field">
              <label className="phonebook-label" htmlFor="book-notes">{t('library.form.notes')}</label>
              <textarea
                id="book-notes"
                className="good-input library-form__notes"
                rows={4}
                maxLength={5000}
                disabled={busy}
                value={form.notes}
                placeholder={t('library.form.notesPlaceholder')}
                onChange={(event) => update({ notes: event.target.value })}
              />
            </div>
          </section>
        </div>
      </Dialog>

      {confirmDelete && mode.type === 'edit' ? (
        <ConfirmDialog
          title={t('library.form.deleteTitle')}
          description={t('library.form.deleteDesc', { title: mode.book.title })}
          tone="danger"
          confirmLabel={t('common.delete')}
          busyLabel={t('common.deleting')}
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
      {confirmDiscard ? (
        <ConfirmDialog
          title={t('common.discardTitle')}
          description={t('common.discardDesc')}
          confirmLabel={t('common.discard')}
          busyLabel={t('common.discarding')}
          onConfirm={() => { setConfirmDiscard(false); onClose(); }}
          onCancel={() => setConfirmDiscard(false)}
        />
      ) : null}
    </>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
  inputMode?: 'numeric' | 'text';
  required?: boolean;
  hint?: string;
};

function Field({ id, label, value, onChange, disabled, error, placeholder, inputMode, required, hint }: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="good-field">
      <span className="phonebook-label">
        <label htmlFor={id}>{label}</label>
        {required ? <span className="phonebook-label__required" aria-hidden="true">*</span> : null}
      </span>
      <input
        id={id}
        className="good-input"
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        maxLength={500}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && !error ? <span className="phonebook-hint">{hint}</span> : null}
      {error ? <span id={errorId} className="field-error">{error}</span> : null}
    </div>
  );
}
