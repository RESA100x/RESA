import { Book as BookIcon } from '../components/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { BookCover } from './BookCover';
import { BookCardDialog } from './BookCardDialog';
import { BookDialog } from './BookDialog';
import { BookSpotlight } from './BookSpotlight';
import { LibraryDialog } from './LibraryDialog';
import { bookToDraft, sortBooksByActivity, type Book, type BookDraft } from './book-model';
import { useBooks } from './useBooks';
import './library.css';

// Below this width a single cell only fits an app-icon tile; above it the shelf
// becomes the slideshow. The switch is driven by the cell the user gave the
// module, so the same widget is both a launcher and a showcase.
const SPOTLIGHT_MIN_WIDTH = 300;

type FormState = { type: 'create' } | { type: 'edit'; book: Book } | null;

export function LibraryWidget({ readOnly = false }: { readOnly?: boolean }) {
  const { books, reload, createBook, updateBook, deleteBook } = useBooks();
  const [open, setOpen] = useState(false);
  const [cardId, setCardId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [wide, setWide] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tileRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setWide(width >= SPOTLIGHT_MIN_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const ordered = useMemo(() => sortBooksByActivity(books.data), [books.data]);
  const card = cardId ? books.data.find((book) => book.id === cardId) ?? null : null;
  const spotlight = wide && ordered.length > 0;
  const count = books.data.length;
  // The single cell shows the book the shelf would open first, so the module
  // always looks like a book rather than a generic icon.
  const featured = ordered[0] ?? null;

  const quickUpdate = (book: Book, patch: Partial<BookDraft>) =>
    updateBook(book, { ...bookToDraft(book), ...patch });

  return (
    <div className="widget-content library-widget" ref={rootRef}>
      {spotlight ? (
        <>
          <BookSpotlight
            books={ordered}
            readOnly={readOnly}
            onOpen={(book) => setCardId(book.id)}
          />
          <button
            type="button"
            className="library-widget__open"
            aria-label={t('library.openLibrary')}
            title={t('library.openLibrary')}
            disabled={readOnly}
            onClick={() => setOpen(true)}
          >
            <BookIcon aria-hidden="true" />
            <span>{t('library.openLibrary')}</span>
          </button>
        </>
      ) : (
        <button
          ref={tileRef}
          type="button"
          className="library-tile"
          data-testid="library-tile"
          disabled={readOnly}
          aria-label={readOnly ? t('library.tileReadOnly', { count }) : t('library.openTile', { count })}
          title={books.status === 'error' ? books.message ?? t('library.readError') : t('library.count', { count })}
          onClick={() => setOpen(true)}
        >
          {featured ? (
            <BookCover
              title={featured.title}
              cover={featured.cover}
              bookId={featured.id}
              className="library-tile__cover"
            />
          ) : (
            <span className="library-tile__plate" aria-hidden="true">
              <BookIcon />
            </span>
          )}
          <span className="library-tile__badge" aria-hidden="true">
            {books.status === 'error' ? '!' : books.status === 'ready' ? count : '…'}
          </span>
        </button>
      )}

      {open ? (
        <LibraryDialog
          books={ordered}
          status={books.status}
          message={books.message}
          onRetry={reload}
          onClose={() => setOpen(false)}
          onAdd={() => setForm({ type: 'create' })}
          onOpenBook={(book) => setCardId(book.id)}
        />
      ) : null}

      {form ? (
        <BookDialog
          mode={form}
          onClose={() => setForm(null)}
          onCreate={createBook}
          onUpdate={updateBook}
          onDelete={deleteBook}
        />
      ) : null}

      {card ? (
        <BookCardDialog
          book={card}
          onClose={() => setCardId(null)}
          onEdit={(book) => setForm({ type: 'edit', book })}
          onQuickUpdate={quickUpdate}
          onDelete={deleteBook}
        />
      ) : null}
    </div>
  );
}
