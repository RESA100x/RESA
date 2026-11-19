import { Download, RotateCcw, Search, X } from '../components/icons';
import { useId, useMemo, useRef, useState, type RefObject } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { Dialog } from '../components/Dialog';
import { FilterSelect, type FilterOption } from '../components/FilterSelect';
import { formatNumber, t } from '../i18n';
import { formatIsoDisplay } from '../lib/calendar-system';
import {
  ARCHIVE_TABS,
  archiveStamp,
  archiveStatusLabel,
  archiveTabOf,
  eventDetailLabel,
  filterArchive,
  formatStamp,
  projectName,
  statusTone,
  type ArchiveTab
} from './archive-model';
import { useTaskEvents, type ProjectsResource, type TaskArchiveResource } from './useTaskArchive';
import { BOARD_STATUSES, taskStatus, type Task } from '../tasks/task-model';
import './archive.css';

type ArchiveDialogProps = {
  archive: TaskArchiveResource;
  projects: ProjectsResource;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onRetry(): void;
  onRestore(id: string): Promise<void>;
  onExport?(path: string): Promise<{ path: string; tasks: number }>;
  onClose(): void;
};

function csvFilters() {
  return [{ name: t('archive.csvFilter'), extensions: ['csv'] }];
}

function archiveFileName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `resa-archive-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.csv`;
}

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('archive.readError');
}

const EVENT_KINDS = [
  'created',
  'status',
  'completed',
  'reopened',
  'updated',
  'moved',
  'priority',
  'due',
  'project',
  'archived'
] as const;

function eventLabel(event: { kind: string }, detail: string) {
  const known = (EVENT_KINDS as readonly string[]).includes(event.kind);
  const base = known ? t(`taskEvent.${event.kind}` as const) : event.kind;
  return detail ? `${base}: ${detail}` : base;
}

/**
 * The archive answers three questions months later: what was done, what was
 * dropped, and what happened on the way. The list is filtered on the client
 * because it is bounded and has to feel instant while typing; the history of
 * the selected row is read on demand.
 */
export function ArchiveDialog({
  archive,
  projects,
  restoreFocusRef,
  onRetry,
  onRestore,
  onExport,
  onClose
}: ArchiveDialogProps) {
  const titleId = useId();
  const [tab, setTab] = useState<ArchiveTab>('all');
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [errorNote, setErrorNote] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const tasks = archive.data;
  const projectOptions = useMemo<FilterOption[]>(
    () => [
      { value: '', label: t('archive.allProjects') },
      ...projects.data.map((project) => ({ value: project.id, label: project.name, color: project.color }))
    ],
    [projects.data]
  );
  const visible = useMemo(
    () => filterArchive(tasks, { tab, query, projectId: projectFilter }),
    [tasks, tab, query, projectFilter]
  );
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const { events, status: eventsStatus } = useTaskEvents(selected?.id ?? null);

  const counts = useMemo(() => {
    const map: Record<ArchiveTab, number> = { all: tasks.length, done: 0, suspended: 0, cancelled: 0, deleted: 0 };
    for (const task of tasks) map[archiveTabOf(task)] += 1;
    return map;
  }, [tasks]);

  async function runExport() {
    if (!onExport) return;
    setErrorNote('');
    setStatusNote('');
    const path = await save({ defaultPath: archiveFileName(), filters: csvFilters() }).catch(() => null);
    if (!path) return;
    setExportBusy(true);
    try {
      const summary = await onExport(path);
      setStatusNote(t('archive.exported', { path: summary.path, count: formatNumber(summary.tasks) }));
    } catch (reason) {
      setErrorNote(message(reason));
    } finally {
      setExportBusy(false);
    }
  }

  async function restore(task: Task) {
    setErrorNote('');
    setStatusNote('');
    setRestoringId(task.id);
    try {
      await onRestore(task.id);
      setStatusNote(t('archive.restored', { title: task.title }));
    } catch (reason) {
      setErrorNote(message(reason));
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <Dialog
      title={t('widget.archive.name')}
      ariaLabelledBy={titleId}
      initialFocusRef={searchRef}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="archive-dialog"
      headerActions={
        <>
          {onExport ? (
            <button
              type="button"
              className="good-icon-button"
              aria-label={t('archive.export')}
              title={t('archive.export')}
              disabled={exportBusy}
              onClick={() => void runExport()}
            >
              <Download aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </>
      }
      footer={
        <div className="archive-dialog__footer">
          <span>{t('archive.count', { count: formatNumber(tasks.length) })}</span>
          {statusNote ? <span className="archive-dialog__status" role="status">{statusNote}</span> : null}
          {errorNote ? <span className="dialog-error" role="alert">{errorNote}</span> : null}
        </div>
      }
    >
      <div className="archive-dialog__body">
        <div className="archive-tabs" role="tablist" aria-label={t('archive.tabsLabel')}>
          {ARCHIVE_TABS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={`archive-tab${tab === value ? ' archive-tab--active' : ''}`}
              onClick={() => setTab(value)}
            >
              {t(`archive.tab.${value}` as const)}
              <span className="archive-tab__count">{formatNumber(counts[value])}</span>
            </button>
          ))}
        </div>

        <div className="archive-filters">
          <label className="archive-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={t('archive.searchPlaceholder')}
              aria-label={t('archive.search')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <FilterSelect
            label={t('archive.project')}
            ariaLabel={t('archive.filterByProject')}
            options={projectOptions}
            value={projectFilter}
            onChange={setProjectFilter}
          />
        </div>

        {archive.status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{archive.message ?? t('archive.readError')}</span>
            <button type="button" className="good-button" onClick={onRetry}>
              {t('common.retry')}
            </button>
          </div>
        ) : null}

        <div className="archive-panes">
          <div className="archive-list" data-testid="archive-list">
            {archive.status === 'loading' && tasks.length === 0 ? (
              <p className="archive-empty">{t('archive.loading')}</p>
            ) : null}
            {archive.status !== 'loading' && tasks.length === 0 ? (
              <p className="archive-empty">{t('archive.empty')}</p>
            ) : null}
            {tasks.length > 0 && visible.length === 0 ? (
              <p className="archive-empty">{t('archive.noMatch')}</p>
            ) : null}
            {visible.map((task) => {
              return (
                <button
                  key={task.id}
                  type="button"
                  className={`archive-row${selectedId === task.id ? ' archive-row--active' : ''}`}
                  data-task-id={task.id}
                  onClick={() => setSelectedId(task.id)}
                >
                  <span className="archive-row__title">{task.title}</span>
                  <span className={`archive-status ${statusTone(task.status ?? (task.completed ? 'done' : 'open'))}`}>
                    {archiveStatusLabel(task)}
                  </span>
                  {task.projectId ? (
                    <span className="archive-row__project">{projectName(projects.data, task.projectId)}</span>
                  ) : null}
                  <span className="archive-row__date">{formatStamp(archiveStamp(task))}</span>
                </button>
              );
            })}
          </div>

          <div className="archive-detail" data-testid="archive-detail">
            {!selected ? (
              <p className="archive-empty">{t('archive.selectHint')}</p>
            ) : (
              <>
                <div className="archive-detail__head">
                  <h3 className="archive-detail__title">{selected.title}</h3>
                  <span className={`archive-status ${statusTone(selected.status ?? 'open')}`}>
                    {archiveStatusLabel(selected)}
                  </span>
                </div>
                <dl className="archive-detail__facts">
                  <div>
                    <dt>{t('archive.factProject')}</dt>
                    <dd>{projectName(projects.data, selected.projectId) || t('archive.noProject')}</dd>
                  </div>
                  <div>
                    <dt>{t('archive.factDue')}</dt>
                    <dd>{selected.dueDate ? formatIsoDisplay(selected.dueDate, 'long') : t('archive.noDue')}</dd>
                  </div>
                  <div>
                    <dt>{t('archive.factCreated')}</dt>
                    <dd>{formatStamp(selected.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>{t('archive.factCompleted')}</dt>
                    <dd>{selected.completedAt ? formatStamp(selected.completedAt) : '—'}</dd>
                  </div>
                </dl>
                {selected.description ? (
                  <p className="archive-detail__description">{selected.description}</p>
                ) : null}
                <button
                  type="button"
                  className="good-button archive-detail__restore"
                  disabled={
                    restoringId === selected.id ||
                    (!selected.archivedAt && BOARD_STATUSES.includes(taskStatus(selected)))
                  }
                  onClick={() => void restore(selected)}
                >
                  <RotateCcw aria-hidden="true" />
                  {t('archive.restore')}
                </button>

                <h4 className="archive-history__title">{t('archive.history')}</h4>
                {eventsStatus === 'loading' ? (
                  <p className="archive-empty">{t('archive.historyLoading')}</p>
                ) : null}
                {eventsStatus === 'error' ? (
                  <p className="archive-empty">{t('archive.historyError')}</p>
                ) : null}
                {eventsStatus === 'ready' && events.length === 0 ? (
                  <p className="archive-empty">{t('archive.historyEmpty')}</p>
                ) : null}
                {events.length > 0 ? (
                  <ol className="archive-history">
                    {events.map((event) => (
                      <li key={event.id} className="archive-history__item">
                        <span className="archive-history__dot" aria-hidden="true" />
                        <span className="archive-history__label">
                          {eventLabel(event, eventDetailLabel(event, projects.data, []))}
                        </span>
                        <time className="archive-history__time" dateTime={event.at}>
                          {formatStamp(event.at)}
                        </time>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
