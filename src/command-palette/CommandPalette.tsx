import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, FileText, ListCheck, Plus, Search, Settings, SquareKanban } from '../components/icons';
import { t } from '../i18n';
import type { SearchHit } from '../lib/search';
import './command-palette.css';

export type PaletteAction = {
  id: string;
  label: string;
  icon?: 'event' | 'task' | 'note' | 'settings' | 'notes';
  run(): void;
};

type Props = {
  open: boolean;
  actions: PaletteAction[];
  search(query: string): Promise<SearchHit[]>;
  onOpenHit(hit: SearchHit): void;
  onClose(): void;
};

type Entry =
  | { key: string; type: 'action'; label: string; icon?: PaletteAction['icon']; run(): void }
  | { key: string; type: 'hit'; hit: SearchHit };

function ActionIcon({ icon }: { icon?: PaletteAction['icon'] }) {
  if (icon === 'event') return <CalendarDays aria-hidden="true" />;
  if (icon === 'task') return <ListCheck aria-hidden="true" />;
  if (icon === 'note' || icon === 'notes') return <FileText aria-hidden="true" />;
  if (icon === 'settings') return <Settings aria-hidden="true" />;
  return <Plus aria-hidden="true" />;
}

function HitIcon({ kind }: { kind: SearchHit['kind'] }) {
  if (kind === 'event') return <CalendarDays aria-hidden="true" />;
  if (kind === 'task') return <SquareKanban aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
}

function hitKindLabel(kind: SearchHit['kind']) {
  if (kind === 'event') return t('commandPalette.kindEvent');
  if (kind === 'task') return t('commandPalette.kindTask');
  return t('commandPalette.kindNote');
}

// Global search + quick actions. Ctrl+K opens it from anywhere in the app.
export function CommandPalette({ open, actions, search, onOpenHit, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const requestId = useRef(0);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setHits([]);
    setActive(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const current = ++requestId.current;
    const timer = window.setTimeout(() => {
      void search(trimmed)
        .then((results) => {
          if (current !== requestId.current) return;
          setHits(results);
          setActive(0);
        })
        .catch(() => {
          if (current === requestId.current) setHits([]);
        })
        .finally(() => {
          if (current === requestId.current) setLoading(false);
        });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [open, query, search]);

  // Escape closes the palette even while the list, not the input, has focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const entries = useMemo<Entry[]>(() => {
    const needle = query.trim().toLowerCase();
    const matchingActions = actions
      .filter((action) => !needle || action.label.toLowerCase().includes(needle))
      .map((action) => ({
        key: `action:${action.id}`,
        type: 'action' as const,
        label: action.label,
        icon: action.icon,
        run: action.run
      }));
    const hitEntries = hits.map((hit) => ({ key: `hit:${hit.kind}:${hit.id}`, type: 'hit' as const, hit }));
    return [...matchingActions, ...hitEntries];
  }, [actions, hits, query]);

  useEffect(() => {
    if (active >= entries.length) setActive(0);
  }, [active, entries.length]);

  if (!open) return null;

  const choose = (entry: Entry) => {
    if (entry.type === 'action') {
      onClose();
      entry.run();
    } else {
      onClose();
      onOpenHit(entry.hit);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (entries.length === 0 ? 0 : (index + 1) % entries.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (entries.length === 0 ? 0 : (index - 1 + entries.length) % entries.length));
      return;
    }
    if (event.key === 'Enter') {
      const entry = entries[active];
      if (entry) {
        event.preventDefault();
        choose(entry);
      }
    }
  };

  const actionCount = entries.filter((entry) => entry.type === 'action').length;
  const activeId = entries[active] ? `${listId}-${active}` : undefined;

  return (
    <div
      className="command-palette"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="command-palette__panel" role="dialog" aria-modal="true" aria-label={t('commandPalette.title')}>
        <div className="command-palette__search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            className="command-palette__input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-label={t('commandPalette.placeholder')}
            placeholder={t('commandPalette.placeholder')}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
          />
          <kbd className="command-palette__kbd">Esc</kbd>
        </div>
        <ul className="command-palette__list" id={listId} role="listbox" aria-label={t('commandPalette.title')}>
          {entries.length === 0 ? (
            <li className="command-palette__empty" role="presentation">
              {loading ? t('commandPalette.searching') : query.trim() ? t('commandPalette.empty') : t('commandPalette.noActions')}
            </li>
          ) : null}
          {entries.map((entry, index) => (
            <li
              key={entry.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={`command-palette__item${index === active ? ' command-palette__item--active' : ''}${
                index === actionCount ? ' command-palette__item--section' : ''
              }`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => { event.preventDefault(); choose(entry); }}
            >
              {entry.type === 'action' ? (
                <>
                  <span className="command-palette__icon"><ActionIcon icon={entry.icon} /></span>
                  <span className="command-palette__label">{entry.label}</span>
                </>
              ) : (
                <>
                  <span className="command-palette__icon"><HitIcon kind={entry.hit.kind} /></span>
                  <span className="command-palette__copy">
                    <span className="command-palette__label">{entry.hit.title || entry.hit.snippet}</span>
                    {entry.hit.snippet && entry.hit.title ? (
                      <span className="command-palette__snippet">{entry.hit.snippet}</span>
                    ) : null}
                  </span>
                  <span className="command-palette__kind">{hitKindLabel(entry.hit.kind)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="command-palette__footer">
          <span>{t('commandPalette.hintNavigate')}</span>
          <span>{t('commandPalette.hintOpen')}</span>
          <span>{t('commandPalette.hintClose')}</span>
        </div>
      </div>
    </div>
  );
}
