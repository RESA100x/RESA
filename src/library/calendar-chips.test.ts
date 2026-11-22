import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/store';
import { bookCalendarChips } from './calendar-chips';
import type { Book } from './book-model';

function book(overrides: Partial<Book>): Book {
  return {
    id: 'book-1',
    title: 'Dune',
    author: '',
    translator: '',
    publisher: '',
    publishedYear: null,
    pages: null,
    isbn: '',
    category: '',
    tags: [],
    formats: ['physical'],
    status: 'unread',
    ownership: 'owned',
    location: '',
    loanDirection: null,
    loanPerson: '',
    loanDueDate: null,
    progressPages: 0,
    rating: null,
    isFavorite: false,
    recommender: '',
    notes: '',
    cover: '',
    purchaseDate: null,
    readingTarget: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides
  };
}

afterEach(() => setLanguage('zh'));

describe('bookCalendarChips', () => {
  it('turns purchase, reading and loan dates into calendar chips', () => {
    setLanguage('en');
    const chips = bookCalendarChips([
      book({
        ownership: 'toBuy',
        purchaseDate: '2026-12-01',
        readingTarget: '2027-01-10',
        loanDueDate: '2026-11-30'
      })
    ]);
    expect(chips.map((chip) => chip.id)).toEqual([
      'book-purchase:book-1',
      'book-reading:book-1',
      'book-loan:book-1'
    ]);
    expect(chips[0].title).toBe('Buy book: Dune');
    expect(chips[1].title).toBe('Finish reading: Dune');
    expect(chips[2].title).toBe('Return book: Dune');
    expect(chips.every((chip) => chip.bookId === 'book-1')).toBe(true);
  });

  it('drops a purchase reminder once the book is owned', () => {
    const chips = bookCalendarChips([book({ ownership: 'owned', purchaseDate: '2026-12-01' })]);
    expect(chips).toHaveLength(0);
  });

  it('drops the reading target once the book is finished or abandoned', () => {
    expect(bookCalendarChips([book({ status: 'read', readingTarget: '2027-01-10' })])).toHaveLength(0);
    expect(bookCalendarChips([book({ status: 'abandoned', readingTarget: '2027-01-10' })])).toHaveLength(0);
    expect(bookCalendarChips([book({ status: 'reading', readingTarget: '2027-01-10' })])).toHaveLength(1);
  });
});
