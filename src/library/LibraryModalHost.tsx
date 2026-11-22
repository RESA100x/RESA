import { useState } from 'react';
import { BookCardDialog } from './BookCardDialog';
import { BookDialog } from './BookDialog';
import { bookToDraft, type Book, type BookDraft } from './book-model';
import { useBooks } from './useBooks';

type Props = {
  bookId: string;
  onClose(): void;
};

// The calendar's book chips open the same card the widget uses. The card can
// jump into the edit form, so the host owns both dialogs and keeps the shelf
// fresh through the shared repository.
export function LibraryModalHost({ bookId, onClose }: Props) {
  const { books, createBook, updateBook, deleteBook } = useBooks();
  const [editing, setEditing] = useState<Book | null>(null);
  const book = books.data.find((item) => item.id === bookId) ?? null;

  if (!book) return null;

  const quickUpdate = (target: Book, patch: Partial<BookDraft>) =>
    updateBook(target, { ...bookToDraft(target), ...patch });

  if (editing) {
    return (
      <BookDialog
        mode={{ type: 'edit', book: editing }}
        onClose={() => setEditing(null)}
        onCreate={createBook}
        onUpdate={updateBook}
        onDelete={deleteBook}
      />
    );
  }

  return (
    <BookCardDialog
      book={book}
      onClose={onClose}
      onEdit={setEditing}
      onQuickUpdate={quickUpdate}
      onDelete={deleteBook}
    />
  );
}
