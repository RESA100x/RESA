import { t } from '../i18n';
import type { Book } from './book-model';

// Library dates are merged into the calendar as read-only chips, the same way
// task due dates and contact birthdays are. Nothing is written to the events
// table, so changing a book immediately changes or removes its chip.
export type BookCalendarChip = {
  id: string;
  bookId: string;
  title: string;
  date: string;
  color: string;
};

export const BOOK_CHIP_COLORS = {
  purchase: '#E7B75F',
  reading: '#6FA8DC',
  loan: '#E07A6B'
};

export function bookCalendarChips(books: Book[]): BookCalendarChip[] {
  const chips: BookCalendarChip[] = [];
  for (const book of books) {
    if (book.purchaseDate && book.ownership !== 'owned') {
      chips.push({
        id: `book-purchase:${book.id}`,
        bookId: book.id,
        title: t('library.calendar.purchase', { title: book.title }),
        date: book.purchaseDate,
        color: BOOK_CHIP_COLORS.purchase
      });
    }
    if (book.readingTarget && book.status !== 'read' && book.status !== 'abandoned') {
      chips.push({
        id: `book-reading:${book.id}`,
        bookId: book.id,
        title: t('library.calendar.reading', { title: book.title }),
        date: book.readingTarget,
        color: BOOK_CHIP_COLORS.reading
      });
    }
    if (book.loanDueDate) {
      chips.push({
        id: `book-loan:${book.id}`,
        bookId: book.id,
        title: t('library.calendar.loan', { title: book.title }),
        date: book.loanDueDate,
        color: BOOK_CHIP_COLORS.loan
      });
    }
  }
  return chips;
}
