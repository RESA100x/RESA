import { useEffect, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Book,
  CalendarDays,
  Clock3,
  Droplets,
  FolderOpen,
  History,
  LayoutGrid,
  Mosaic,
  Pencil,
  Phone,
  Search,
  Settings,
  SmileCircle,
  SquareKanban,
  Text,
  UserCircle,
  X,
  type AppIcon
} from '../../components/icons';
import { t } from '../../i18n';
import type { WidgetId } from '../../widgets/widget-registry';
import { MobileShortcutsSheet } from './MobileShortcutsSheet';
import {
  SHORTCUT_CATALOG,
  loadShortcutPrefs,
  saveShortcutPrefs,
  type MobileShortcutId,
  type MobileShortcutPrefs
} from './mobile-shortcuts';
import './mobile-shell.css';

type Tab = { id: WidgetId; label: string; icon: AppIcon };

// The four screens a phone is used for all day, plus a sheet for everything
// else. The desktop grid's drag/resize has no meaning here: one module owns the
// whole screen and the bar switches between them.
const PRIMARY_TABS: Tab[] = [
  { id: 'calendar', label: t('widget.calendar.name'), icon: CalendarDays },
  { id: 'kanban', label: t('widget.kanban.name'), icon: SquareKanban },
  { id: 'matrix', label: t('widget.matrix.name'), icon: Mosaic },
  { id: 'notes', label: t('widget.notes.name'), icon: Text }
];

const MORE_MODULES: Tab[] = [
  { id: 'phonebook', label: t('widget.phonebook.name'), icon: Phone },
  { id: 'meetings', label: t('widget.meetings.name'), icon: UserCircle },
  { id: 'projects', label: t('widget.projects.name'), icon: FolderOpen },
  { id: 'library', label: t('widget.library.name'), icon: Book },
  { id: 'reports', label: t('widget.reports.name'), icon: BarChart3 },
  { id: 'archive', label: t('widget.archive.name'), icon: History },
  { id: 'time', label: t('widget.time.name'), icon: Clock3 },
  { id: 'stickers', label: t('widget.stickers.name'), icon: SmileCircle },
  { id: 'plants', label: t('widget.plants.name'), icon: Droplets }
];

// Actions the shell cannot perform on its own; the app opens the matching
// dialog for them.
export type MobileQuickAction = 'new-event' | 'new-task' | 'new-note';

type MobileShellProps = {
  modules: Partial<Record<WidgetId, ReactNode>>;
  time: string;
  dateText: string;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onQuickAction?: (action: MobileQuickAction) => void;
};

type Sheet = 'modules' | 'shortcuts' | null;

const SHORTCUT_BY_ID = new Map(SHORTCUT_CATALOG.map((entry) => [entry.id, entry]));

export function MobileShell({ modules, time, dateText, onOpenSettings, onOpenSearch, onQuickAction }: MobileShellProps) {
  const [active, setActive] = useState<WidgetId>('calendar');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [shortcuts, setShortcuts] = useState<MobileShortcutPrefs>(() => loadShortcutPrefs());

  const available = MORE_MODULES.filter((entry) => modules[entry.id] !== undefined);
  const inMore = available.some((entry) => entry.id === active);
  const activeLabel =
    [...PRIMARY_TABS, ...MORE_MODULES].find((entry) => entry.id === active)?.label ?? '';

  // Portaled surfaces (dialogs, popovers) live outside `.mobile-shell`, so the
  // phone-only rules that must reach them key off this marker instead.
  useEffect(() => {
    document.documentElement.classList.add('is-mobile-shell');
    return () => document.documentElement.classList.remove('is-mobile-shell');
  }, []);

  useEffect(() => {
    saveShortcutPrefs(shortcuts);
  }, [shortcuts]);

  function pick(id: WidgetId) {
    setActive(id);
    setSheet(null);
  }

  function runShortcut(id: MobileShortcutId) {
    if (id === 'search') {
      onOpenSearch();
      return;
    }
    if (id === 'settings') {
      onOpenSettings();
      return;
    }
    if (id === 'new-event' || id === 'new-task' || id === 'new-note') {
      onQuickAction?.(id);
      return;
    }
    pick(id as WidgetId);
  }

  // The bar keeps the order the user chose, so a shortcut stays where they
  // put it instead of snapping back to the catalogue order.
  const dockItems = shortcuts.items
    .map((id) => SHORTCUT_BY_ID.get(id))
    .filter((entry): entry is (typeof SHORTCUT_CATALOG)[number] => entry !== undefined);

  return (
    <div className="mobile-shell" data-testid="mobile-shell">
      <header className="mobile-shell__bar">
        <div className="mobile-shell__clock">
          <span className="mobile-shell__time">{time}</span>
          <span className="mobile-shell__date">{dateText}</span>
        </div>
        <div className="mobile-shell__actions">
          <button
            type="button"
            className="mobile-shell__icon"
            data-testid="mobile-search"
            aria-label={t('commandPalette.open')}
            onClick={onOpenSearch}
          >
            <Search aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mobile-shell__icon"
            data-testid="mobile-settings"
            aria-label={t('settings.title')}
            onClick={onOpenSettings}
          >
            <Settings aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="mobile-shell__content" aria-label={activeLabel}>
        <section className="card module-frame mobile-shell__module" data-widget-id={active}>
          <div className="module-frame__body">{modules[active]}</div>
        </section>
      </main>

      {shortcuts.enabled && dockItems.length > 0 ? (
        <div className="mobile-dock" role="toolbar" aria-label={t('mobile.shortcuts')}>
          {dockItems.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                className="mobile-dock__btn"
                data-testid={`mobile-shortcut-${entry.id}`}
                onClick={() => runShortcut(entry.id)}
              >
                <Icon aria-hidden="true" />
                <span>{t(entry.labelKey)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <nav className="mobile-shell__tabs" aria-label={t('mobile.tabs')}>
        {PRIMARY_TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = active === tab.id && sheet === null;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`mobile-tab-${tab.id}`}
              className={`mobile-shell__tab${selected ? ' is-active' : ''}`}
              aria-current={selected ? 'page' : undefined}
              onClick={() => pick(tab.id)}
            >
              <Icon aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          data-testid="mobile-tab-more"
          className={`mobile-shell__tab${sheet === 'modules' || inMore ? ' is-active' : ''}`}
          aria-expanded={sheet === 'modules'}
          onClick={() => setSheet('modules')}
        >
          <LayoutGrid aria-hidden="true" />
          <span>{t('mobile.more')}</span>
        </button>
      </nav>

      {sheet === 'modules' ? (
        <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label={t('mobile.allModules')}>
          <button
            type="button"
            className="mobile-sheet__backdrop"
            aria-label={t('common.close')}
            onClick={() => setSheet(null)}
          />
          <div className="mobile-sheet__panel">
            <div className="mobile-sheet__head">
              <span>{t('mobile.allModules')}</span>
              <button
                type="button"
                className="mobile-shell__icon"
                aria-label={t('common.close')}
                onClick={() => setSheet(null)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="mobile-sheet__grid">
              {available.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    data-testid={`mobile-sheet-${entry.id}`}
                    className="mobile-sheet__tile"
                    onClick={() => pick(entry.id)}
                  >
                    <span className="mobile-sheet__glyph" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="mobile-sheet__label">{entry.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="mobile-sheet__manage"
              data-testid="mobile-shortcuts-manage"
              onClick={() => setSheet('shortcuts')}
            >
              <Pencil aria-hidden="true" />
              <span>{t('mobile.shortcutsManage')}</span>
            </button>
          </div>
        </div>
      ) : null}

      {sheet === 'shortcuts' ? (
        <MobileShortcutsSheet
          prefs={shortcuts}
          onChange={setShortcuts}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}
