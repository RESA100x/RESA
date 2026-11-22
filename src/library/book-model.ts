import { toJalali } from '../lib/jalali';

// Stable ids only: labels are looked up at render time, so switching the
// interface language never changes a stored book.
export const BOOK_STATUSES = ['unread', 'reading', 'read', 'paused', 'abandoned'] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

export const BOOK_FORMATS = ['physical', 'ebook', 'audio'] as const;
export type BookFormat = (typeof BOOK_FORMATS)[number];

// Ownership answers "do I have it?"; a purchase is a separate state so a book
// can be wanted, ordered, and finally owned without losing its history.
export const BOOK_OWNERSHIP = ['owned', 'toBuy', 'ordered'] as const;
export type BookOwnership = (typeof BOOK_OWNERSHIP)[number];

export const BOOK_LOAN_DIRECTIONS = ['borrowed', 'lent'] as const;
export type BookLoanDirection = (typeof BOOK_LOAN_DIRECTIONS)[number];

export type Book = {
  id: string;
  title: string;
  author: string;
  translator: string;
  publisher: string;
  publishedYear: number | null;
  pages: number | null;
  isbn: string;
  category: string;
  tags: string[];
  formats: BookFormat[];
  status: BookStatus;
  ownership: BookOwnership;
  location: string;
  loanDirection: BookLoanDirection | null;
  loanPerson: string;
  loanDueDate: string | null;
  progressPages: number;
  rating: number | null;
  isFavorite: boolean;
  recommender: string;
  notes: string;
  cover: string;
  purchaseDate: string | null;
  readingTarget: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BookDraft = Omit<Book, 'id' | 'createdAt' | 'updatedAt'>;

// The editable half of a row, for quick actions that only change one field.
export function bookToDraft(book: Book): BookDraft {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = book;
  return draft;
}

export function isBookStatus(value: unknown): value is BookStatus {
  return typeof value === 'string' && (BOOK_STATUSES as readonly string[]).includes(value);
}

export function isBookFormat(value: unknown): value is BookFormat {
  return typeof value === 'string' && (BOOK_FORMATS as readonly string[]).includes(value);
}

export function isBookOwnership(value: unknown): value is BookOwnership {
  return typeof value === 'string' && (BOOK_OWNERSHIP as readonly string[]).includes(value);
}

export function isBookCover(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(value);
}

// Covers live on disk; the row keeps only the file name. A stored name never
// carries a path separator, so it cannot escape the covers directory.
export function isCoverFileName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 120 &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('..')
  );
}

export const bookStatusKey = (status: BookStatus) => `library.status.${status}`;
export const bookFormatKey = (format: BookFormat) => `library.format.${format}`;
export const bookOwnershipKey = (ownership: BookOwnership) => `library.ownership.${ownership}`;
export const bookLoanKey = (direction: BookLoanDirection) => `library.loan.${direction}`;

// How far through the book we are. A finished book is always 100% even if the
// page count was never filled in.
export function bookProgressPercent(book: Pick<Book, 'status' | 'pages' | 'progressPages'>): number {
  if (book.status === 'read') return 100;
  if (!book.pages || book.pages <= 0) return book.progressPages > 0 ? 1 : 0;
  return Math.max(0, Math.min(100, Math.round((book.progressPages / book.pages) * 100)));
}

// Pages actually read: a finished book counts its whole length, a book in
// progress counts the pages reached.
export function bookReadPages(book: Pick<Book, 'status' | 'pages' | 'progressPages'>): number {
  if (book.status === 'read') return book.pages ?? book.progressPages;
  return book.progressPages;
}

export type BookStats = {
  total: number;
  read: number;
  reading: number;
  unread: number;
  toBuy: number;
  pagesRead: number;
  averageRating: number | null;
  favorites: number;
  borrowed: number;
  lent: number;
  readThisYear: number;
  byFormat: Record<BookFormat, number>;
  topAuthors: Array<{ name: string; count: number }>;
  topCategories: Array<{ name: string; count: number }>;
};

function topCounts(values: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const name = value.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3);
}

export function bookStats(books: Book[], now: Date = new Date()): BookStats {
  const thisYear = toJalali(now).year;
  const rated = books.filter((book) => typeof book.rating === 'number' && book.rating > 0);
  const byFormat: Record<BookFormat, number> = { physical: 0, ebook: 0, audio: 0 };
  for (const book of books) {
    for (const format of book.formats) byFormat[format] += 1;
  }
  return {
    total: books.length,
    read: books.filter((book) => book.status === 'read').length,
    reading: books.filter((book) => book.status === 'reading').length,
    unread: books.filter((book) => book.status === 'unread').length,
    toBuy: books.filter((book) => book.ownership === 'toBuy').length,
    pagesRead: books.reduce((sum, book) => sum + bookReadPages(book), 0),
    averageRating: rated.length
      ? Math.round((rated.reduce((sum, book) => sum + (book.rating ?? 0), 0) / rated.length) * 10) / 10
      : null,
    favorites: books.filter((book) => book.isFavorite).length,
    borrowed: books.filter((book) => book.loanDirection === 'borrowed').length,
    lent: books.filter((book) => book.loanDirection === 'lent').length,
    readThisYear: books.filter((book) => {
      if (!book.finishedAt) return false;
      const date = new Date(`${book.finishedAt}T00:00:00`);
      return !Number.isNaN(date.getTime()) && toJalali(date).year === thisYear;
    }).length,
    byFormat,
    topAuthors: topCounts(books.map((book) => book.author)),
    topCategories: topCounts(books.map((book) => book.category))
  };
}

// The order the shelf shows by default: what is being read first, then what is
// waiting, then the finished ones.
const statusOrder: Record<BookStatus, number> = {
  reading: 0,
  unread: 1,
  paused: 2,
  read: 3,
  abandoned: 4
};

export function sortBooksByActivity(books: Book[]): Book[] {
  return [...books].sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.title.localeCompare(b.title)
  );
}
