import { AlertTriangle, Download, RotateCcw, Search, Trash2, X } from '../components/icons';
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { FilterSelect, type FilterOption } from '../components/FilterSelect';
import { formatNumber, t } from '../i18n';
import { formatIsoDisplay } from '../lib/calendar-system';
import type { Contact } from '../phonebook/contact-model';
import type { TaskTag } from '../tasks/task-model';
import {
  ARCHIVE_RANGES,
  ARCHIVE_TABS,
  archiveStamp,
  archiveStats,
  archiveStatusLabel,
  archiveTabOf,
  eventDetailLabel,
  filterArchive,
  formatStamp,
  groupArchiveByMonth,
  projectName,
  statusTone,
  type ArchiveRange,
  type ArchiveTab
} from './archive-model';
import { useTaskEvents, type ProjectsResource, type TaskArchiveResource } from './useTaskArchive';
import { BOARD_STATUSES, taskStatus, type Task, type TaskStatus } from '../tasks/task-model';
import './archive.css';

type ArchiveDialogProps = {
  archive: TaskArchiveResource;
  projects: ProjectsResource;
  contacts: Contact[];
  tags: Pick<TaskTag, 'id' | 'name' | 'color'>[];
  inline?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  canAnnotate: boolean;
  canPurge: boolean;
  onRetry(): void;
  onRestore(id: string, status: TaskStatus): Promise<void>;
  onRestoreMany?(ids: string[], status: TaskStatus): Promise<void>;
  onSetReason?(id: string, reason: string | null): Promise<unknown>;
  onPurge?(ids: string[]): Promise<number>;
  onExport?(path: string, ids?: string[]): Promise<{ path: string; tasks: number }>;
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
  'archived',
  'reason'
] as const;

function eventLabel(event: { kind: string }, detail: string) {
  const known = (EVENT_KINDS as readonly string[]).includes(event.kind);
  const base = known ? t(`taskEvent.${event.kind}` as const) : event.kind;
  return detail ? `${base}: ${detail}` : base;
}

function averageDaysLabel(value: number | null) {
  if (value === null) return t('archive.noData');
  return t('archive.statAverage', { count: formatNumber(Math.round(value * 10) / 10) });
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
  contacts,
  tags,
  inline = false,
  restoreFocusRef,
  canAnnotate,
  canPurge,
  onRetry,
  onRestore,
  onRestoreMany,
  onSetReason,
  onPurge,
  onExport,
  onClose
}: ArchiveDialogProps) {
  const titleId = useId();
  const [tab, setTab] = useState<ArchiveTab>('all');
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [range, setRange] = useState<ArchiveRange>('all');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [openPicker, setOpenPicker] = useState<'from' | 'to' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [restoreAs, setRestoreAs] = useState<TaskStatus>('open');
  const [reasonDraft, setReasonDraft] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [errorNote, setErrorNote] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<{ ids: string[]; title?: string } | null>(null);
  const [purgeAck, setPurgeAck] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeError, setPurgeError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const tasks = archive.data;
  const contactName = (id: string) => contacts.find((contact) => contact.id === id)?.name ?? '';
  const projectOptions = useMemo<FilterOption[]>(
    () => [
      { value: '', label: t('archive.allProjects') },
      ...projects.data.map((project) => ({ value: project.id, label: project.name, color: project.color }))
    ],
    [projects.data]
  );
  const assigneeOptions = useMemo<FilterOption[]>(
    () => [
      { value: '', label: t('archive.allAssignees') },
      ...contacts.map((contact) => ({ value: contact.id, label: contact.name }))
    ],
    [contacts]
  );
  const tagOptions = useMemo<FilterOption[]>(
    () => [
      { value: '', label: t('archive.allTags') },
      ...tags.map((tag) => ({ value: tag.id, label: tag.name, color: tag.color }))
    ],
    [tags]
  );
  const rangeOptions = useMemo<FilterOption[]>(
    () => ARCHIVE_RANGES.map((value) => ({ value, label: t(`archive.range.${value}` as const) })),
    []
  );
  const restoreAsOptions = useMemo<FilterOption[]>(
    () => BOARD_STATUSES.map((status) => ({ value: status, label: t(`taskStatus.${status}` as const) })),
    []
  );

  const visible = useMemo(
    () =>
      filterArchive(tasks, {
        tab,
        query,
        projectId: projectFilter,
        assigneeId: assigneeFilter,
        tagId: tagFilter,
        range,
        from: rangeFrom,
        to: rangeTo,
        assigneeName: contactName
      }),
    // contactName is derived from `contacts`, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, tab, query, projectFilter, assigneeFilter, tagFilter, range, rangeFrom, rangeTo, contacts]
  );
  const groups = useMemo(() => groupArchiveByMonth(visible), [visible]);
  const stats = useMemo(() => archiveStats(visible), [visible]);
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const { events, status: eventsStatus } = useTaskEvents(selected?.id ?? null);

  useEffect(() => {
    setReasonDraft(selected?.archiveReason ?? '');
  }, [selected?.id, selected?.archiveReason]);

  const counts = useMemo(() => {
    const map: Record<ArchiveTab, number> = { all: tasks.length, done: 0, suspended: 0, cancelled: 0, deleted: 0 };
    for (const task of tasks) map[archiveTabOf(task)] += 1;
    return map;
  }, [tasks]);

  const visibleIds = visible.map((task) => task.id);
  const selectedVisible = visibleIds.filter((id) => selection.has(id));
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const reasonDirty = selected ? reasonDraft.trim() !== (selected.archiveReason ?? '') : false;

  function chooseTab(value: ArchiveTab) {
    setTab(value);
    setSelection(new Set());
  }

  function toggleRow(id: string) {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelection((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function runExport() {
    if (!onExport) return;
    setErrorNote('');
    setStatusNote('');
    const ids = selectedVisible.length > 0 ? selectedVisible : undefined;
    const path = await save({ defaultPath: archiveFileName(), filters: csvFilters() }).catch(() => null);
    if (!path) return;
    setExportBusy(true);
    try {
      const summary = await onExport(path, ids);
      setStatusNote(t('archive.exported', { path: summary.path, count: formatNumber(summary.tasks) }));
    } catch (reason) {
      setErrorNote(message(reason));
    } finally {
      setExportBusy(false);
    }
  }

  async function restore(task: Task, status: TaskStatus) {
    setErrorNote('');
    setStatusNote('');
    setRestoringId(task.id);
    try {
      await onRestore(task.id, status);
      setSelection((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
      setStatusNote(t('archive.restored', { title: task.title }));
    } catch (reason) {
      setErrorNote(message(reason));
    } finally {
      setRestoringId(null);
    }
  }

  async function restoreSelected() {
    if (!onRestoreMany || selectedVisible.length === 0) return;
    setErrorNote('');
    setStatusNote('');
    setBulkBusy(true);
    try {
      await onRestoreMany(selectedVisible, restoreAs);
      setStatusNote(t('archive.restoredMany', { count: formatNumber(selectedVisible.length) }));
      setSelection(new Set());
    } catch (reason) {
      setErrorNote(message(reason));
    } finally {
      setBulkBusy(false);
    }
  }

  async function saveReason() {
    if (!onSetReason || !selected) return;
    setErrorNote('');
    setStatusNote('');
    try {
      await onSetReason(selected.id, reasonDraft.trim() ? reasonDraft.trim() : null);
      setStatusNote(t('archive.reasonSaved'));
    } catch (reason) {
      setErrorNote(message(reason));
    }
  }

  async function confirmPurge() {
    if (!onPurge || !purgeTarget || !purgeAck) return;
    setPurgeError('');
    setPurgeBusy(true);
    try {
      const removed = await onPurge(purgeTarget.ids);
      setStatusNote(t('archive.purged', { count: formatNumber(removed) }));
      setSelection((current) => {
        const next = new Set(current);
        purgeTarget.ids.forEach((id) => next.delete(id));
        return next;
      });
      if (selectedId && purgeTarget.ids.includes(selectedId)) setSelectedId(null);
      setPurgeTarget(null);
      setPurgeAck(false);
    } catch (reason) {
      setPurgeError(message(reason));
    } finally {
      setPurgeBusy(false);
    }
  }

  return (
    <Dialog
      title={t('widget.archive.name')}
      ariaLabelledBy={titleId}
      inline={inline}
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
              onClick={() => chooseTab(value)}
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
          <FilterSelect
            label={t('archive.assignee')}
            ariaLabel={t('archive.filterByAssignee')}
            options={assigneeOptions}
            value={assigneeFilter}
            onChange={setAssigneeFilter}
          />
          <FilterSelect
            label={t('archive.tag')}
            ariaLabel={t('archive.filterByTag')}
            options={tagOptions}
            value={tagFilter}
            onChange={setTagFilter}
          />
          <FilterSelect
            label={t('archive.range')}
            ariaLabel={t('archive.filterByRange')}
            options={rangeOptions}
            value={range}
            onChange={(value) => setRange(value as ArchiveRange)}
          />
          {range === 'custom' ? (
            <div className="archive-range">
              <DatePicker
                id="archive-range-from"
                label={t('archive.from')}
                hideLabel
                value={rangeFrom}
                open={openPicker === 'from'}
                onOpenChange={(next) => setOpenPicker(next ? 'from' : null)}
                onChange={setRangeFrom}
              />
              <DatePicker
                id="archive-range-to"
                label={t('archive.to')}
                hideLabel
                value={rangeTo}
                open={openPicker === 'to'}
                onOpenChange={(next) => setOpenPicker(next ? 'to' : null)}
                onChange={setRangeTo}
              />
            </div>
          ) : null}
        </div>

        <div className="archive-stats" aria-label={t('archive.statsLabel')}>
          <span className="archive-stat" data-testid="archive-stat-total">
            {t('archive.statTotal', { count: formatNumber(stats.total) })}
          </span>
          <span className="archive-stat" data-testid="archive-stat-average">
            {averageDaysLabel(stats.averageCloseDays)}
          </span>
          <span className="archive-stat" data-testid="archive-stat-oldest">
            {stats.oldestOpen
              ? t('archive.statOldest', { title: stats.oldestOpen.title })
              : t('archive.noOldestOpen')}
          </span>
        </div>

        <div className="archive-bulk">
          <label className="archive-bulk__all">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={visibleIds.length === 0}
              onChange={toggleAllVisible}
            />
            <span>{t('archive.selectAll')}</span>
          </label>
          {selectedVisible.length > 0 ? (
            <span className="archive-bulk__count">
              {t('archive.selectedCount', { count: formatNumber(selectedVisible.length) })}
            </span>
          ) : null}
          <div className="archive-bulk__actions">
            <FilterSelect
              label={t('archive.restoreAs')}
              ariaLabel={t('archive.restoreAs')}
              options={restoreAsOptions}
              value={restoreAs}
              onChange={(value) => setRestoreAs(value as TaskStatus)}
            />
            <button
              type="button"
              className="good-button"
              disabled={bulkBusy || selectedVisible.length === 0 || !onRestoreMany}
              onClick={() => void restoreSelected()}
            >
              <RotateCcw aria-hidden="true" />
              {t('archive.restoreSelected')}
            </button>
            {canPurge ? (
              <button
                type="button"
                className="good-button good-button--danger"
                disabled={bulkBusy || selectedVisible.length === 0}
                onClick={() => {
                  setPurgeError('');
                  setPurgeAck(false);
                  setPurgeTarget({ ids: selectedVisible });
                }}
              >
                <Trash2 aria-hidden="true" />
                {t('archive.deleteSelected')}
              </button>
            ) : null}
            {selectedVisible.length > 0 ? (
              <button type="button" className="good-button" onClick={() => setSelection(new Set())}>
                {t('archive.clearSelection')}
              </button>
            ) : null}
          </div>
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
            {groups.map((group) => (
              <div key={group.key} className="archive-group">
                <div className="archive-group__label">{group.label}</div>
                {group.tasks.map((task) => (
                  <div key={task.id} className="archive-row-wrap">
                    <input
                      type="checkbox"
                      className="archive-row__check"
                      checked={selection.has(task.id)}
                      aria-label={t('archive.selectRow', { title: task.title })}
                      onChange={() => toggleRow(task.id)}
                    />
                    <button
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
                  </div>
                ))}
              </div>
            ))}
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
                    <dt>{t('archive.assignee')}</dt>
                    <dd>
                      {selected.assigneeContactId
                        ? contactName(selected.assigneeContactId) || t('archive.noAssignee')
                        : t('archive.noAssignee')}
                    </dd>
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

                <div className="archive-detail__reason">
                  <label htmlFor={`${titleId}-reason`}>{t('archive.reason')}</label>
                  <textarea
                    id={`${titleId}-reason`}
                    value={reasonDraft}
                    placeholder={t('archive.reasonPlaceholder')}
                    rows={2}
                    readOnly={!canAnnotate}
                    onChange={(event) => setReasonDraft(event.target.value)}
                  />
                  {canAnnotate ? (
                    <button
                      type="button"
                      className="good-button"
                      disabled={!reasonDirty}
                      onClick={() => void saveReason()}
                    >
                      {t('archive.saveReason')}
                    </button>
                  ) : null}
                </div>

                <div className="archive-detail__actions">
                  <button
                    type="button"
                    className="good-button archive-detail__restore"
                    disabled={
                      restoringId === selected.id ||
                      (!selected.archivedAt && BOARD_STATUSES.includes(taskStatus(selected)))
                    }
                    onClick={() => void restore(selected, restoreAs)}
                  >
                    <RotateCcw aria-hidden="true" />
                    {t('archive.restore')}
                  </button>
                  {canPurge ? (
                    <button
                      type="button"
                      className="good-button good-button--danger"
                      disabled={!selected.archivedAt && !['done', 'suspended', 'cancelled'].includes(taskStatus(selected))}
                      onClick={() => {
                        setPurgeError('');
                        setPurgeAck(false);
                        setPurgeTarget({ ids: [selected.id], title: selected.title });
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      {t('archive.deletePermanently')}
                    </button>
                  ) : null}
                </div>

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

      {purgeTarget ? (
        <ConfirmDialog
          className="archive-purge-dialog"
          title={t('archive.confirmPurgeTitle')}
          tone="danger"
          confirmLabel={t('archive.deletePermanently')}
          busyLabel={t('archive.purging')}
          busy={purgeBusy}
          confirmDisabled={!purgeAck}
          errorMessage={purgeError || undefined}
          restoreFocusRef={restoreFocusRef}
          onCancel={() => {
            setPurgeTarget(null);
            setPurgeAck(false);
          }}
          onConfirm={() => void confirmPurge()}
          description={
            <>
              <p>{t('archive.confirmPurgeBody', { count: formatNumber(purgeTarget.ids.length) })}</p>
              {purgeTarget.title ? <p className="archive-purge-dialog__title">{purgeTarget.title}</p> : null}
              <label className="archive-purge-dialog__ack">
                <AlertTriangle aria-hidden="true" />
                <input type="checkbox" checked={purgeAck} onChange={(event) => setPurgeAck(event.target.checked)} />
                <span>{t('archive.confirmPurgeAcknowledge')}</span>
              </label>
            </>
          }
        />
      ) : null}
    </Dialog>
  );
}
