import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
import type { Book, BookDraft } from './book-model';

type BooksResource = {
  status: 'loading' | 'ready' | 'error';
  data: Book[];
  message?: string;
};

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('library.readError');
}

function missing(command: string) {
  return new Error(t('library.unavailable', { command }));
}

export function useBooks() {
  const repository = useNowlyRepository();
  const [books, setBooks] = useState<BooksResource>({ status: 'loading', data: [] });
  const requestIdRef = useRef(0);

  const readBooks = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setBooks((current) => ({ status: 'loading', data: current.data }));
    try {
      const read = repository.listBooks;
      if (!read) throw missing('listBooks');
      const data = await read.call(repository);
      if (requestId === requestIdRef.current) {
        setBooks({ status: 'ready', data: data.map((book) => ({ ...book })) });
      }
    } catch (error) {
      if (!silent && requestId === requestIdRef.current) {
        setBooks((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [repository]);
  const loadBooks = useCallback(() => readBooks(false), [readBooks]);

  useEffect(() => { void loadBooks(); }, [loadBooks]);

  const createBook = useCallback(async (draft: BookDraft) => {
    const write = repository.createBook;
    if (!write) throw missing('createBook');
    const created = await write.call(repository, draft);
    await loadBooks();
    return created;
  }, [loadBooks, repository]);

  const updateBook = useCallback(async (book: Book, draft: BookDraft) => {
    const write = repository.updateBook;
    if (!write) throw missing('updateBook');
    const updated = await write.call(repository, book.id, draft);
    await loadBooks();
    return updated;
  }, [loadBooks, repository]);

  const deleteBook = useCallback(async (book: Book) => {
    const write = repository.deleteBook;
    if (!write) throw missing('deleteBook');
    await write.call(repository, book.id);
    await loadBooks();
  }, [loadBooks, repository]);

  return { books, reload: loadBooks, createBook, updateBook, deleteBook };
}
