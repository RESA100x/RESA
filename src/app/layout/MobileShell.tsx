import { useState, type ReactNode } from 'react';
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

type MobileShellProps = {
  modules: Partial<Record<WidgetId, ReactNode>>;
  time: string;
  dateText: string;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
};

export function MobileShell({ modules, time, dateText, onOpenSettings, onOpenSearch }: MobileShellProps) {
  const [active, setActive] = useState<WidgetId>('calendar');
  const [sheetOpen, setSheetOpen] = useState(false);

  const available = MORE_MODULES.filter((entry) => modules[entry.id] !== undefined);
  const inMore = available.some((entry) => entry.id === active);
  const activeLabel =
    [...PRIMARY_TABS, ...MORE_MODULES].find((entry) => entry.id === active)?.label ?? '';

  function pick(id: WidgetId) {
    setActive(id);
    setSheetOpen(false);
  }

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

      <nav className="mobile-shell__tabs" aria-label={t('mobile.tabs')}>
        {PRIMARY_TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = active === tab.id && !sheetOpen;
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
          className={`mobile-shell__tab${sheetOpen || inMore ? ' is-active' : ''}`}
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
        >
          <LayoutGrid aria-hidden="true" />
          <span>{t('mobile.more')}</span>
        </button>
      </nav>

      {sheetOpen ? (
        <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label={t('mobile.allModules')}>
          <button
            type="button"
            className="mobile-sheet__backdrop"
            aria-label={t('common.close')}
            onClick={() => setSheetOpen(false)}
          />
          <div className="mobile-sheet__panel">
            <div className="mobile-sheet__head">
              <span>{t('mobile.allModules')}</span>
              <button
                type="button"
                className="mobile-shell__icon"
                aria-label={t('common.close')}
                onClick={() => setSheetOpen(false)}
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
