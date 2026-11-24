import { ChevronLeft, ChevronRight, Pause, Play } from '../components/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDirection, t } from '../i18n';
import { prefersReducedMotion } from '../lib/motion';
import { BookCover } from './BookCover';
import { bookFormatKey, bookProgressPercent, bookStatusKey, type Book } from './book-model';

// The wallpaper face of the library: one book at a time, drawn large, walking
// the shelf on its own. The arrows, the dots and the play switch live on the
// slider itself — there is no separate navigation strip.
export const BOOK_SPOTLIGHT_INTERVAL_MS = 8_000;
const SWIPE_THRESHOLD_PX = 42;

type Props = {
  books: Book[];
  onOpen?(book: Book): void;
  readOnly?: boolean;
  className?: string;
};

export function BookSpotlight({ books, onOpen, readOnly = false, className }: Props) {
  const [index, setIndex] = useState(0);
  const [autoPaused, setAutoPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [dragX, setDragX] = useState(0);
  const dragRef = useRef<{ startX: number; pointerId: number } | null>(null);
  const keyHoldRef = useRef<number | null>(null);
  const reducedMotion = prefersReducedMotion();
  const rtl = getDirection() === 'rtl';
  const running = !autoPaused && !held;

  useEffect(() => {
    setIndex((current) => (books.length === 0 ? 0 : Math.min(current, books.length - 1)));
  }, [books.length]);

  useEffect(() => {
    if (!running || books.length <= 1) return;
    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % books.length);
    }, BOOK_SPOTLIGHT_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, running, books.length]);

  const go = useCallback((step: number) => {
    setIndex((current) => {
      if (books.length === 0) return 0;
      return (current + step + books.length) % books.length;
    });
  }, [books.length]);

  const visible = useMemo(() => {
    const count = books.length;
    if (count === 0) return [];
    const offsets = count <= 3 ? books.map((_, position) => position) : [(index - 1 + count) % count, index, (index + 1) % count];
    return [...new Set(offsets)].map((position) => ({ position, book: books[position] }));
  }, [index, books]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    dragRef.current = { startX: event.clientX, pointerId: event.pointerId };
    setHeld(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom and older engines may not implement pointer capture.
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setDragX(event.clientX - drag.startX);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    dragRef.current = null;
    setDragX(0);
    setHeld(false);
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    const forward = rtl ? dx > 0 : dx < 0;
    go(forward ? 1 : -1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight') go(rtl ? -1 : 1);
    else if (event.key === 'ArrowLeft') go(rtl ? 1 : -1);
    else if (event.key === 'Home') setIndex(0);
    else if (event.key === 'End') setIndex(Math.max(0, books.length - 1));
    else return;
    event.preventDefault();
    setHeld(true);
    if (keyHoldRef.current !== null) window.clearTimeout(keyHoldRef.current);
    keyHoldRef.current = window.setTimeout(() => setHeld(false), BOOK_SPOTLIGHT_INTERVAL_MS);
  }

  useEffect(
    () => () => {
      if (keyHoldRef.current !== null) window.clearTimeout(keyHoldRef.current);
    },
    []
  );

  if (books.length === 0) return null;

  const current = books[index];
  const percent = bookProgressPercent(current);

  return (
    <div
      className={className ? `book-spotlight ${className}` : 'book-spotlight'}
      data-testid="book-spotlight"
      data-paused={running ? 'false' : 'true'}
      data-reduced={reducedMotion ? 'true' : 'false'}
      style={{ '--book-spotlight-interval': `${BOOK_SPOTLIGHT_INTERVAL_MS}ms` } as React.CSSProperties}
      tabIndex={0}
      aria-label={t('library.spotlightLabel')}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="book-spotlight__stage">
        {visible.map(({ position, book }) => {
          const active = position === index;
          return (
            <div className="book-spotlight__slide" data-active={active ? 'true' : 'false'} key={book.id} aria-hidden={!active}>
              <div className="book-spotlight__scene" aria-hidden="true">
                <BookCover title={book.title} cover={book.cover} bookId={book.id} className="book-spotlight__ghost" />
              </div>
              <div
                className="book-spotlight__dragger"
                style={active && dragX ? { transform: `translateX(${dragX * 0.35}px)` } : undefined}
              >
                <button
                  type="button"
                  className="book-spotlight__figure"
                  disabled={readOnly || !onOpen}
                  aria-label={t('library.openBook', { title: book.title })}
                  onClick={() => onOpen?.(book)}
                >
                  <BookCover title={book.title} cover={book.cover} bookId={book.id} className="book-spotlight__cover" />
                </button>
              </div>
            </div>
          );
        })}

        {/* The desktop surface has no pointer, so the arrows and the play switch
            would be controls nobody can reach. The shelf still rotates on its
            own; only the chrome is dropped. */}
        {readOnly ? null : (
          <>
            <button
              type="button"
              className="book-spotlight__arrow book-spotlight__arrow--prev"
              aria-label={t('library.previousBook')}
              onClick={() => go(-1)}
            >
              {rtl ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="book-spotlight__arrow book-spotlight__arrow--next"
              aria-label={t('library.nextBook')}
              onClick={() => go(1)}
            >
              {rtl ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="book-spotlight__play"
              aria-label={autoPaused ? t('library.playSlides') : t('library.pauseSlides')}
              onClick={() => setAutoPaused((value) => !value)}
            >
              {autoPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            </button>
          </>
        )}

        <div className="book-spotlight__foot">
          <div className="book-spotlight__dots" role="tablist" aria-label={t('library.spotlightLabel')}>
            {books.map((book, position) => (
              <button
                type="button"
                key={book.id}
                role="tab"
                className="book-spotlight__dot"
                aria-selected={position === index}
                aria-label={t('library.showBook', { title: book.title })}
                disabled={readOnly}
                onClick={() => setIndex(position)}
              />
            ))}
          </div>
          <div className="book-spotlight__caption" key={current.id}>
            <div className="book-spotlight__heading">
              <h4 className="book-spotlight__title">{current.title}</h4>
              <span className={`library-chip library-chip--${current.status}`}>{t(bookStatusKey(current.status))}</span>
            </div>
            {current.author ? <p className="book-spotlight__author">{current.author}</p> : null}
            <div className="book-spotlight__meta">
              {current.formats.map((format) => (
                <span className="library-chip library-chip--format" key={format}>{t(bookFormatKey(format))}</span>
              ))}
              {current.location ? <span className="book-spotlight__place">{current.location}</span> : null}
            </div>
            {current.status !== 'unread' ? (
              <div className="book-spotlight__progress" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
