import { isBookCover, isCoverFileName, type Book, type BookDraft, type BookFormat, type BookLoanDirection, type BookOwnership, type BookStatus } from './book-model';

// The form keeps every number as text so a half-typed value ("3") does not jump
// to zero, and converts once, on save.
export type BookFormDraft = {
  title: string;
  author: string;
  translator: string;
  publisher: string;
  publishedYear: string;
  pages: string;
  isbn: string;
  category: string;
  tags: string;
  formats: BookFormat[];
  status: BookStatus;
  ownership: BookOwnership;
  location: string;
  loanDirection: '' | BookLoanDirection;
  loanPerson: string;
  loanDueDate: string;
  progressPages: string;
  rating: string;
  isFavorite: boolean;
  recommender: string;
  notes: string;
  cover: string;
  purchaseDate: string;
  readingTarget: string;
  startedAt: string;
  finishedAt: string;
};

export type BookFieldErrors = Partial<Record<keyof BookFormDraft, string>>;

export const BOOK_TITLE_MAX_LENGTH = 200;
export const BOOK_TAG_MAX_LENGTH = 40;
export const BOOK_MAX_TAGS = 20;

export function emptyBookForm(): BookFormDraft {
  return {
    title: '',
    author: '',
    translator: '',
    publisher: '',
    publishedYear: '',
    pages: '',
    isbn: '',
    category: '',
    tags: '',
    formats: ['physical'],
    status: 'unread',
    ownership: 'owned',
    location: '',
    loanDirection: '',
    loanPerson: '',
    loanDueDate: '',
    progressPages: '',
    rating: '',
    isFavorite: false,
    recommender: '',
    notes: '',
    cover: '',
    purchaseDate: '',
    readingTarget: '',
    startedAt: '',
    finishedAt: ''
  };
}

export function bookToForm(book: Book): BookFormDraft {
  return {
    title: book.title,
    author: book.author,
    translator: book.translator,
    publisher: book.publisher,
    publishedYear: book.publishedYear === null ? '' : String(book.publishedYear),
    pages: book.pages === null ? '' : String(book.pages),
    isbn: book.isbn,
    category: book.category,
    tags: book.tags.join('، '),
    formats: [...book.formats],
    status: book.status,
    ownership: book.ownership,
    location: book.location,
    loanDirection: book.loanDirection ?? '',
    loanPerson: book.loanPerson,
    loanDueDate: book.loanDueDate ?? '',
    progressPages: book.progressPages > 0 ? String(book.progressPages) : '',
    rating: book.rating === null ? '' : String(book.rating),
    isFavorite: book.isFavorite,
    recommender: book.recommender,
    notes: book.notes,
    cover: book.cover,
    purchaseDate: book.purchaseDate ?? '',
    readingTarget: book.readingTarget ?? '',
    startedAt: book.startedAt ?? '',
    finishedAt: book.finishedAt ?? ''
  };
}

// Tags are typed as one line; both the Latin and the Persian comma split them.
export function parseBookTags(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,،]/)) {
    const tag = part.replace(/\s+/g, ' ').trim().slice(0, BOOK_TAG_MAX_LENGTH);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= BOOK_MAX_TAGS) break;
  }
  return out;
}

function optionalInt(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function validateBookForm(form: BookFormDraft, messages: {
  title: string;
  pages: string;
  year: string;
  rating: string;
  cover: string;
  date: string;
}): BookFieldErrors {
  const errors: BookFieldErrors = {};
  const title = form.title.replace(/\s+/g, ' ').trim();
  if (!title) errors.title = messages.title;
  else if (title.length > BOOK_TITLE_MAX_LENGTH) errors.title = messages.title;

  const pages = optionalInt(form.pages);
  if (form.pages.trim() && (pages === null || pages < 1 || pages > 100_000)) errors.pages = messages.pages;

  const year = optionalInt(form.publishedYear);
  if (form.publishedYear.trim() && (year === null || year < 0 || year > 3000)) errors.publishedYear = messages.year;

  const rating = optionalInt(form.rating);
  if (form.rating.trim() && (rating === null || rating < 1 || rating > 5)) errors.rating = messages.rating;

  if (form.cover && !isBookCover(form.cover) && !isCoverFileName(form.cover)) errors.cover = messages.cover;

  if (form.loanDueDate.trim() && !validDate(form.loanDueDate)) errors.loanDueDate = messages.date;
  if (form.purchaseDate.trim() && !validDate(form.purchaseDate)) errors.purchaseDate = messages.date;
  if (form.readingTarget.trim() && !validDate(form.readingTarget)) errors.readingTarget = messages.date;
  if (form.startedAt.trim() && !validDate(form.startedAt)) errors.startedAt = messages.date;
  if (form.finishedAt.trim() && !validDate(form.finishedAt)) errors.finishedAt = messages.date;

  return errors;
}

export function toBookDraft(form: BookFormDraft): BookDraft {
  const pages = optionalInt(form.pages);
  const progress = Math.max(0, optionalInt(form.progressPages) ?? 0);
  return {
    title: form.title.replace(/\s+/g, ' ').trim(),
    author: form.author.replace(/\s+/g, ' ').trim(),
    translator: form.translator.replace(/\s+/g, ' ').trim(),
    publisher: form.publisher.replace(/\s+/g, ' ').trim(),
    publishedYear: optionalInt(form.publishedYear),
    pages,
    isbn: form.isbn.trim(),
    category: form.category.replace(/\s+/g, ' ').trim(),
    tags: parseBookTags(form.tags),
    formats: [...form.formats],
    status: form.status,
    ownership: form.ownership,
    location: form.location.replace(/\s+/g, ' ').trim(),
    loanDirection: form.loanDirection === '' ? null : form.loanDirection,
    loanPerson: form.loanPerson.replace(/\s+/g, ' ').trim(),
    loanDueDate: form.loanDueDate.trim() || null,
    progressPages: pages === null ? progress : Math.min(progress, pages),
    rating: optionalInt(form.rating),
    isFavorite: form.isFavorite,
    recommender: form.recommender.replace(/\s+/g, ' ').trim(),
    notes: form.notes.trim(),
    cover: form.cover,
    purchaseDate: form.purchaseDate.trim() || null,
    readingTarget: form.readingTarget.trim() || null,
    startedAt: form.startedAt.trim() || null,
    finishedAt: form.finishedAt.trim() || null
  };
}

export function isBookFormDirty(form: BookFormDraft, original: BookFormDraft): boolean {
  return JSON.stringify(form) !== JSON.stringify(original);
}
