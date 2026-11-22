import { useEffect, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { isBookCover, isCoverFileName } from './book-model';

type Props = {
  title: string;
  cover: string;
  bookId?: string;
  className?: string;
};

// Cover bytes are fetched once per book and kept for the session, so the grid,
// the spotlight and the card all share the same image without re-reading the
// file or bloating the shelf query.
const coverCache = new Map<string, string>();

// A book without a photo still needs a face. The placeholder derives a stable
// hue from the title, so the same book keeps the same colour everywhere, and
// shows its first letter large enough to read in a 1×1 cell.
function hueOf(title: string): number {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) {
    hash = (hash * 31 + title.charCodeAt(index)) % 360;
  }
  return hash;
}

export function BookCover({ title, cover, bookId, className }: Props) {
  const repository = useNowlyRepository();
  const classes = className ? `book-cover ${className}` : 'book-cover';
  const inline = isBookCover(cover) ? cover : '';
  const stored = !inline && isCoverFileName(cover) && bookId ? `${bookId}:${cover}` : '';
  const [loaded, setLoaded] = useState(() => (stored ? coverCache.get(stored) ?? '' : ''));

  useEffect(() => {
    if (!stored) {
      setLoaded('');
      return;
    }
    const hit = coverCache.get(stored);
    if (hit) {
      setLoaded(hit);
      return;
    }
    const read = repository.readBookCover;
    if (!read || !bookId) return;
    let alive = true;
    void read
      .call(repository, bookId)
      .then((url) => {
        if (!alive || !url) return;
        coverCache.set(stored, url);
        setLoaded(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [bookId, repository, stored]);

  const source = inline || loaded;
  if (source) {
    return <img className={classes} src={source} alt="" draggable={false} />;
  }
  const initial = title.trim().charAt(0) || '؟';
  return (
    <span
      className={`${classes} book-cover--placeholder`}
      style={{ '--book-hue': `${hueOf(title)}` } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="book-cover__initial">{initial}</span>
    </span>
  );
}
