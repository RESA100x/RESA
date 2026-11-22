import { Check, Pencil, Play, RotateCcw, Trash2, X } from '../components/icons';
import { useId, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import { formatIsoDisplay } from '../lib/calendar-system';
import { BookCover } from './BookCover';
import {
  bookFormatKey,
  bookLoanKey,
  bookOwnershipKey,
  bookProgressPercent,
  bookStatusKey,
  type Book,
  type BookDraft
} from './book-model';

type Props = {
  book: Book;
  onClose(): void;
  onEdit(book: Book): void;
  onQuickUpdate(book: Book, patch: Partial<BookDraft>): Promise<unknown>;
  onDelete(book: Book): Promise<unknown>;
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error.message as string)
    : t('common.opFailed');
}

export function BookCardDialog({ book, onClose, onEdit, onQuickUpdate, onDelete }: Props) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const percent = bookProgressPercent(book);

  async function quick(patch: Partial<BookDraft>) {
    setBusy(true);
    setError('');
    try {
      await onQuickUpdate(book, patch);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await onDelete(book);
      setConfirmDelete(false);
      onClose();
    } catch (failure) {
      setConfirmDelete(false);
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        title={book.title}
        ariaLabelledBy={titleId}
        isTopLayer={!confirmDelete}
        onRequestClose={onClose}
        className="book-card-dialog"
        headerActions={
          <button type="button" aria-label={t('common.close')} className="good-icon-button" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        }
        footer={
          <div className="book-card__actions">
            <button type="button" className="good-button book-card__delete" disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" />
              {t('common.delete')}
            </button>
            <span className="library-form__spacer" />
            <button type="button" className="good-button" disabled={busy} onClick={() => onEdit(book)}>
              <Pencil aria-hidden="true" />
              {t('library.card.edit')}
            </button>
            {book.status !== 'read' ? (
              <button type="button" className="good-button good-button--primary" disabled={busy} onClick={() => void quick({ status: 'read' })}>
                <Check aria-hidden="true" />
                {t('library.card.finish')}
              </button>
            ) : (
              <button type="button" className="good-button good-button--primary" disabled={busy} onClick={() => void quick({ status: 'reading', progressPages: 0, finishedAt: null })}>
                <RotateCcw aria-hidden="true" />
                {t('library.card.reopen')}
              </button>
            )}
          </div>
        }
      >
        <div className="book-card">
          {error ? <p className="library-form__error" role="alert">{error}</p> : null}
          <div className="book-card__head">
            <BookCover title={book.title} cover={book.cover} bookId={book.id} className="book-card__cover" />
            <div className="book-card__intro">
              <h3 className="book-card__title">{book.title}</h3>
              {book.author ? <p className="book-card__author">{book.author}</p> : null}
              <div className="book-card__chips">
                <span className={`library-chip library-chip--${book.status}`}>{t(bookStatusKey(book.status))}</span>
                <span className={`library-chip library-chip--${book.ownership}`}>{t(bookOwnershipKey(book.ownership))}</span>
                {book.formats.map((format) => (
                  <span className="library-chip library-chip--format" key={format}>{t(bookFormatKey(format))}</span>
                ))}
                {book.loanDirection ? (
                  <span className={`library-chip library-chip--${book.loanDirection}`}>{t(bookLoanKey(book.loanDirection))}</span>
                ) : null}
              </div>
              {book.rating ? (
                <p className="book-card__rating" aria-label={t('library.form.rating')}>
                  {'★'.repeat(book.rating)}
                  <span className="book-card__rating-dim">{'★'.repeat(5 - book.rating)}</span>
                </p>
              ) : null}
              {book.status !== 'unread' ? (
                <div className="book-card__progress">
                  <div className="book-card__progress-track" aria-hidden="true">
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <span className="book-card__progress-label">
                    {book.pages
                      ? t('library.card.progressOf', { read: book.progressPages, total: book.pages, percent })
                      : t('library.card.percentOnly', { percent })}
                  </span>
                </div>
              ) : null}
              <div className="book-card__quick">
                {book.status !== 'reading' && book.status !== 'read' ? (
                  <button type="button" className="good-button" disabled={busy} onClick={() => void quick({ status: 'reading' })}>
                    <Play aria-hidden="true" />
                    {t('library.card.start')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="good-button"
                  disabled={busy}
                  aria-pressed={book.isFavorite}
                  onClick={() => void quick({ isFavorite: !book.isFavorite })}
                >
                  {book.isFavorite ? t('library.card.unfavorite') : t('library.card.favorite')}
                </button>
              </div>
            </div>
          </div>

          <dl className="book-card__meta">
            {book.translator ? <div><dt>{t('library.form.translator')}</dt><dd>{book.translator}</dd></div> : null}
            {book.publisher ? <div><dt>{t('library.form.publisher')}</dt><dd>{book.publisher}</dd></div> : null}
            {book.publishedYear ? <div><dt>{t('library.form.year')}</dt><dd>{book.publishedYear}</dd></div> : null}
            {book.pages ? <div><dt>{t('library.form.pages')}</dt><dd>{book.pages}</dd></div> : null}
            {book.isbn ? <div><dt>{t('library.form.isbn')}</dt><dd>{book.isbn}</dd></div> : null}
            {book.category ? <div><dt>{t('library.form.category')}</dt><dd>{book.category}</dd></div> : null}
            {book.tags.length ? <div><dt>{t('library.form.tags')}</dt><dd>{book.tags.join('، ')}</dd></div> : null}
            {book.location ? <div><dt>{t('library.form.location')}</dt><dd>{book.location}</dd></div> : null}
            {book.recommender ? <div><dt>{t('library.form.recommender')}</dt><dd>{book.recommender}</dd></div> : null}
            {book.loanDirection ? (
              <div>
                <dt>{t(book.loanDirection === 'lent' ? 'library.card.lentTo' : 'library.card.borrowedFrom')}</dt>
                <dd>{book.loanPerson || '—'}</dd>
              </div>
            ) : null}
            {book.loanDueDate ? <div><dt>{t('library.form.loanDue')}</dt><dd>{formatIsoDisplay(book.loanDueDate)}</dd></div> : null}
            {book.purchaseDate ? <div><dt>{t('library.form.purchaseDate')}</dt><dd>{formatIsoDisplay(book.purchaseDate)}</dd></div> : null}
            {book.readingTarget ? <div><dt>{t('library.form.readingTarget')}</dt><dd>{formatIsoDisplay(book.readingTarget)}</dd></div> : null}
            {book.startedAt ? <div><dt>{t('library.form.startedAt')}</dt><dd>{formatIsoDisplay(book.startedAt)}</dd></div> : null}
            {book.finishedAt ? <div><dt>{t('library.form.finishedAt')}</dt><dd>{formatIsoDisplay(book.finishedAt)}</dd></div> : null}
          </dl>

          {book.notes ? (
            <section className="book-card__notes">
              <h4>{t('library.form.notes')}</h4>
              <p>{book.notes}</p>
            </section>
          ) : null}
        </div>
      </Dialog>

      {confirmDelete ? (
        <ConfirmDialog
          title={t('library.form.deleteTitle')}
          description={t('library.form.deleteDesc', { title: book.title })}
          tone="danger"
          confirmLabel={t('common.delete')}
          busyLabel={t('common.deleting')}
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </>
  );
}
