import { Book as BookIcon, Plus, Search, X } from '../components/icons';
import { useId, useMemo, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { t } from '../i18n';
import { BookCover } from './BookCover';
import {
  BOOK_FORMATS,
  BOOK_OWNERSHIP,
  BOOK_STATUSES,
  bookFormatKey,
  bookLoanKey,
  bookOwnershipKey,
  bookProgressPercent,
  bookStats,
  bookStatusKey,
  sortBooksByActivity,
  type Book,
  type BookFormat,
  type BookOwnership,
  type BookStatus
} from './book-model';

type Props = {
  books: Book[];
  status: 'loading' | 'ready' | 'error';
  message?: string;
  onRetry(): void;
  onClose(): void;
  onAdd(): void;
  onOpenBook(book: Book): void;
};

type SortKey = 'activity' | 'title' | 'author' | 'rating' | 'finished';

function matches(book: Book, query: string): boolean {
  if (!query) return true;
  const haystack = [
    book.title,
    book.author,
    book.translator,
    book.publisher,
    book.category,
    book.location,
    book.recommender,
    book.loanPerson,
    ...book.tags
  ]
    .join(' ')
    .toLocaleLowerCase();
  return haystack.includes(query);
}

// The library itself: a searchable shelf with filters, a compact statistics
// strip and the book grid. Adding and opening a book happen in their own
// dialogs, so this one stays a list.
export function LibraryDialog({ books, status, message, onRetry, onClose, onAdd, onOpenBook }: Props) {
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | BookStatus>('all');
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | BookOwnership>('all');
  const [formatFilter, setFormatFilter] = useState<'all' | BookFormat>('all');
  const [sort, setSort] = useState<SortKey>('activity');

  const stats = useMemo(() => bookStats(books), [books]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = books.filter(
      (book) =>
        (statusFilter === 'all' || book.status === statusFilter) &&
        (ownershipFilter === 'all' || book.ownership === ownershipFilter) &&
        (formatFilter === 'all' || book.formats.includes(formatFilter)) &&
        matches(book, needle)
    );
    switch (sort) {
      case 'title':
        return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
      case 'author':
        return [...filtered].sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
      case 'rating':
        return [...filtered].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title));
      case 'finished':
        return [...filtered].sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '') || a.title.localeCompare(b.title));
      default:
        return sortBooksByActivity(filtered);
    }
  }, [books, formatFilter, ownershipFilter, query, sort, statusFilter]);

  const statusOptions = [
    { value: 'all', label: t('library.filterAll') },
    ...BOOK_STATUSES.map((value) => ({ value, label: t(bookStatusKey(value)) }))
  ];
  const ownershipOptions = [
    { value: 'all', label: t('library.filterAll') },
    ...BOOK_OWNERSHIP.map((value) => ({ value, label: t(bookOwnershipKey(value)) }))
  ];
  const formatOptions = [
    { value: 'all', label: t('library.filterAll') },
    ...BOOK_FORMATS.map((value) => ({ value, label: t(bookFormatKey(value)) }))
  ];
  const sortOptions: Array<{ value: SortKey; label: string }> = [
    { value: 'activity', label: t('library.sortActivity') },
    { value: 'title', label: t('library.sortTitle') },
    { value: 'author', label: t('library.sortAuthor') },
    { value: 'rating', label: t('library.sortRating') },
    { value: 'finished', label: t('library.sortFinished') }
  ];

  return (
    <Dialog
      title={t('library.title')}
      ariaLabelledBy={titleId}
      onRequestClose={onClose}
      className="library-dialog"
      headerActions={
        <>
          <button type="button" className="good-button good-button--primary library-dialog__add" onClick={onAdd}>
            <Plus aria-hidden="true" />
            {t('library.addBook')}
          </button>
          <button type="button" aria-label={t('common.close')} className="good-icon-button" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </>
      }
      footer={
        <div className="library-dialog__footer">
          <span className="library-dialog__count">{t('library.count', { count: books.length })}</span>
          <button type="button" className="good-button" onClick={onClose}>{t('common.close')}</button>
        </div>
      }
    >
      <div className="library-dialog__body">
        <section className="library-stats" aria-label={t('library.statsLabel')}>
          <div className="library-stat">
            <span className="library-stat__value">{stats.total}</span>
            <span className="library-stat__label">{t('library.statTotal')}</span>
          </div>
          <div className="library-stat">
            <span className="library-stat__value">{stats.read}</span>
            <span className="library-stat__label">{t('library.statRead')}</span>
          </div>
          <div className="library-stat">
            <span className="library-stat__value">{stats.reading}</span>
            <span className="library-stat__label">{t('library.statReading')}</span>
          </div>
          <div className="library-stat">
            <span className="library-stat__value">{stats.toBuy}</span>
            <span className="library-stat__label">{t('library.statToBuy')}</span>
          </div>
          <div className="library-stat">
            <span className="library-stat__value">{stats.pagesRead}</span>
            <span className="library-stat__label">{t('library.statPages')}</span>
          </div>
          <div className="library-stat">
            <span className="library-stat__value">{stats.averageRating ?? '—'}</span>
            <span className="library-stat__label">{t('library.statRating')}</span>
          </div>
        </section>

        <div className="library-toolbar">
          <label className="library-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={t('library.searchPlaceholder')}
              aria-label={t('library.searchPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Select id="library-filter-status" label={t('library.filterStatus')} hideLabel value={statusFilter} options={statusOptions} onChange={(value) => setStatusFilter(value as 'all' | BookStatus)} />
          <Select id="library-filter-ownership" label={t('library.filterOwnership')} hideLabel value={ownershipFilter} options={ownershipOptions} onChange={(value) => setOwnershipFilter(value as 'all' | BookOwnership)} />
          <Select id="library-filter-format" label={t('library.filterFormat')} hideLabel value={formatFilter} options={formatOptions} onChange={(value) => setFormatFilter(value as 'all' | BookFormat)} />
          <Select id="library-sort" label={t('library.sortBy')} hideLabel value={sort} options={sortOptions} onChange={(value) => setSort(value as SortKey)} />
        </div>

        {status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{message ?? t('library.readError')}</span>
            <div className="module-message__actions">
              <button type="button" className="good-button" onClick={onRetry}>{t('common.retry')}</button>
            </div>
          </div>
        ) : null}

        {status === 'loading' && books.length === 0 ? (
          <p className="library-empty">{t('library.loading')}</p>
        ) : null}

        {status !== 'loading' && books.length === 0 ? (
          <div className="library-empty">
            <BookIcon aria-hidden="true" />
            <p>{t('library.empty')}</p>
            <button type="button" className="good-button good-button--primary" onClick={onAdd}>
              {t('library.addFirst')}
            </button>
          </div>
        ) : null}

        {books.length > 0 && visible.length === 0 ? (
          <p className="library-empty">{t('library.noResults')}</p>
        ) : null}

        {visible.length > 0 ? (
          <ul className="library-grid">
            {visible.map((book) => {
              const percent = bookProgressPercent(book);
              return (
                <li key={book.id}>
                  <button type="button" className="library-card" onClick={() => onOpenBook(book)}>
                    <BookCover title={book.title} cover={book.cover} bookId={book.id} className="library-card__cover" />
                    <span className="library-card__body">
                      <span className="library-card__title">{book.title}</span>
                      {book.author ? <span className="library-card__author">{book.author}</span> : null}
                      <span className="library-card__chips">
                        <span className={`library-chip library-chip--${book.status}`}>{t(bookStatusKey(book.status))}</span>
                        {book.ownership !== 'owned' ? (
                          <span className={`library-chip library-chip--${book.ownership}`}>{t(bookOwnershipKey(book.ownership))}</span>
                        ) : null}
                        {book.loanDirection ? (
                          <span className={`library-chip library-chip--${book.loanDirection}`}>{t(bookLoanKey(book.loanDirection))}</span>
                        ) : null}
                        {book.isFavorite ? <span className="library-chip library-chip--favorite">★</span> : null}
                      </span>
                      {book.status !== 'unread' ? (
                        <span className="library-card__progress" aria-hidden="true">
                          <span style={{ width: `${percent}%` }} />
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}
