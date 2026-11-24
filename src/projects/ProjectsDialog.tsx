import { Pencil, Plus, Search, X } from '../components/icons';
import { useId, useMemo, useState, type RefObject } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { FilterSelect } from '../components/FilterSelect';
import { colorStyle } from '../lib/color';
import { formatNumber, t } from '../i18n';
import { formatIsoDisplay } from '../lib/calendar-system';
import type { Project, ProjectDraft, ProjectStatus } from './project-model';
import { projectIsLate, projectProgress } from './project-model';
import { ProjectDetailDialog } from './ProjectDetailDialog';
import { ProjectDialog } from './ProjectDialog';
import type { ProjectsResource } from './useProjects';
import './projects.css';

type ProjectsDialogProps = {
  resource: ProjectsResource;
  inline?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onRetry(): void;
  onClose(): void;
  onCreate(draft: ProjectDraft): Promise<unknown>;
  onUpdate(project: Project, draft: ProjectDraft): Promise<unknown>;
  onArchive(id: string): Promise<void>;
  onRestore(id: string): Promise<void>;
};

type FormState = { type: 'create' } | { type: 'edit'; project: Project } | null;
type StatusFilter = '' | ProjectStatus | 'late';
type SortOrder = 'name' | 'due' | 'progress';

function localIsoDate(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('common.opFailed');
}

/**
 * The project list: every project ever defined, with its plan, its progress and
 * the number of tasks and meetings that went into it. A row opens the project
 * card; the pencil edits. Archiving hides a project from pickers but keeps the
 * rows, and restoring brings it back with the same id.
 */
export function ProjectsDialog({
  resource,
  inline = false,
  restoreFocusRef,
  onRetry,
  onClose,
  onCreate,
  onUpdate,
  onArchive,
  onRestore
}: ProjectsDialogProps) {
  const titleId = useId();
  const [form, setForm] = useState<FormState>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [sort, setSort] = useState<SortOrder>('name');
  const todayIso = localIsoDate();

  const detail = detailId ? resource.data.find((project) => project.id === detailId) ?? null : null;

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return resource.data.filter((project) => {
      if (statusFilter === 'late') {
        if (project.archivedAt || !projectIsLate(project, todayIso)) return false;
      } else if (statusFilter) {
        if (project.status !== statusFilter) return false;
      }
      if (!needle) return true;
      return (
        project.name.toLowerCase().includes(needle) ||
        project.description.toLowerCase().includes(needle) ||
        project.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [resource.data, query, statusFilter, todayIso]);

  const active = useMemo(() => {
    const rows = matching.filter((project) => !project.archivedAt);
    return sortProjects(rows, sort);
  }, [matching, sort]);
  const closed = useMemo(
    () => sortProjects(matching.filter((project) => project.archivedAt), sort),
    [matching, sort]
  );

  const filtering = query.trim().length > 0 || statusFilter !== '';

  async function archive(project: Project) {
    setBusy(true);
    setError('');
    try {
      await onArchive(project.id);
      setArchiving(null);
      setDetailId(null);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  async function restore(project: Project) {
    setBusy(true);
    setError('');
    try {
      await onRestore(project.id);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  function row(project: Project) {
    const progress = Math.round(projectProgress(project) * 100);
    const late = !project.archivedAt && projectIsLate(project, todayIso);
    return (
      <li key={project.id} className={`project-row${project.archivedAt ? ' project-row--closed' : ''}`}>
        <span className="project-row__dot" style={colorStyle(project.color)} aria-hidden="true" />
        <button
          type="button"
          className="project-row__main"
          aria-label={t('projects.openDetail', { name: project.name })}
          onClick={() => setDetailId(project.id)}
        >
          <span className="project-row__heading">
            <span className="project-row__name">{project.name}</span>
            {late ? <span className="project-row__late">{t('projects.late')}</span> : null}
            {project.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="project-row__tag">
                {tag}
              </span>
            ))}
          </span>
          {project.description ? <span className="project-row__desc">{project.description}</span> : null}
          <span className="project-row__meta">
            <span>{t('projects.tasks', { count: formatNumber(project.taskCount) })}</span>
            {project.meetingCount > 0 ? (
              <span>{t('projects.meetings', { count: formatNumber(project.meetingCount) })}</span>
            ) : null}
            {project.dueDate ? (
              <span>{t('projects.dueOn', { date: formatIsoDisplay(project.dueDate) })}</span>
            ) : null}
          </span>
          <span className="project-row__progress" aria-hidden="true">
            <span style={{ width: `${progress}%`, background: project.color }} />
          </span>
        </button>
        <span className={`project-row__status project-row__status--${project.status}`}>
          {t(`projectStatus.${project.status}`)}
        </span>
        <span className="project-row__percent">{formatNumber(progress)}%</span>
        {!project.archivedAt ? (
          <div className="project-row__actions">
            <button
              type="button"
              className="good-icon-button"
              aria-label={t('projects.edit', { name: project.name })}
              title={t('projects.edit', { name: project.name })}
              onClick={() => setForm({ type: 'edit', project })}
            >
              <Pencil aria-hidden="true" />
            </button>
            <button
              type="button"
              className="project-row__archive"
              onClick={() => setArchiving(project)}
            >
              {t('projects.archive')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="project-row__archive"
            disabled={busy}
            onClick={() => void restore(project)}
          >
            {t('projects.restore')}
          </button>
        )}
      </li>
    );
  }

  const statusOptions = [
    { value: '', label: t('projects.filterAny') },
    { value: 'active', label: t('projectStatus.active') },
    { value: 'paused', label: t('projectStatus.paused') },
    { value: 'done', label: t('projectStatus.done') },
    { value: 'late', label: t('projects.filterLate') }
  ];
  const sortOptions = [
    { value: 'name', label: t('projects.sortName') },
    { value: 'due', label: t('projects.sortDue') },
    { value: 'progress', label: t('projects.sortProgress') }
  ];

  return (
    <Dialog
      title={t('widget.projects.name')}
      ariaLabelledBy={titleId}
      inline={inline}
      isTopLayer={!form && !archiving && !detail}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="projects-dialog"
      headerActions={
        <>
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('projects.add')}
            title={t('projects.add')}
            onClick={() => setForm({ type: 'create' })}
          >
            <Plus aria-hidden="true" />
          </button>
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
        <div className="projects-dialog__footer">
          <span>{t('projects.count', { count: formatNumber(resource.data.length) })}</span>
          {filtering ? (
            <span className="projects-dialog__shown">
              {t('projects.showing', { count: formatNumber(active.length + closed.length) })}
            </span>
          ) : null}
          {error ? (
            <span className="dialog-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="projects-search">
        <Search className="projects-search__icon" aria-hidden="true" />
        <input
          type="search"
          className="good-input projects-search__input"
          autoComplete="off"
          aria-label={t('projects.search')}
          placeholder={t('projects.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="projects-filters">
        <FilterSelect
          label={t('projects.filterStatus')}
          ariaLabel={t('projects.filterStatus')}
          options={statusOptions}
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as StatusFilter)}
        />
        <FilterSelect
          label={t('projects.sort')}
          ariaLabel={t('projects.sort')}
          options={sortOptions}
          value={sort}
          onChange={(value) => setSort(value as SortOrder)}
        />
        {filtering ? (
          <button
            type="button"
            className="projects-filter-reset"
            onClick={() => {
              setQuery('');
              setStatusFilter('');
            }}
          >
            {t('projects.filterReset')}
          </button>
        ) : null}
      </div>

      <div className="projects-dialog__body">
        {resource.status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{resource.message ?? t('projects.readError')}</span>
            <button type="button" className="good-button" onClick={onRetry}>
              {t('common.retry')}
            </button>
          </div>
        ) : null}
        {resource.status === 'loading' && resource.data.length === 0 ? (
          <p className="projects-empty">{t('projects.loading')}</p>
        ) : null}
        {resource.status !== 'loading' && resource.data.length === 0 ? (
          <div className="projects-empty">
            <p>{t('projects.empty')}</p>
            <button type="button" className="good-button" onClick={() => setForm({ type: 'create' })}>
              {t('projects.add')}
            </button>
          </div>
        ) : null}
        {resource.data.length > 0 && active.length === 0 && closed.length === 0 ? (
          <p className="projects-empty">{t('projects.noMatch')}</p>
        ) : null}
        {active.length > 0 ? (
          <ul className="project-list" data-testid="project-list">
            {active.map(row)}
          </ul>
        ) : null}
        {closed.length > 0 ? (
          <>
            <h3 className="projects-section">{t('projects.archivedSection')}</h3>
            <ul className="project-list project-list--closed">{closed.map(row)}</ul>
          </>
        ) : null}
      </div>

      {form ? (
        <ProjectDialog
          mode={form}
          onClose={() => setForm(null)}
          onCreate={onCreate}
          onUpdate={onUpdate}
        />
      ) : null}

      {detail ? (
        <ProjectDetailDialog
          project={detail}
          todayIso={todayIso}
          onClose={() => setDetailId(null)}
          onEdit={(project) => {
            setDetailId(null);
            setForm({ type: 'edit', project });
          }}
          onArchive={(project) => {
            setDetailId(null);
            setArchiving(project);
          }}
          onRestore={(project) => void restore(project)}
        />
      ) : null}

      {archiving ? (
        <ConfirmDialog
          title={t('projects.archiveTitle', { name: archiving.name })}
          description={t('projects.archiveBody', { count: formatNumber(archiving.taskCount) })}
          confirmLabel={t('projects.archive')}
          busyLabel={t('common.saving')}
          busy={busy}
          errorMessage={error}
          onCancel={() => setArchiving(null)}
          onConfirm={() => void archive(archiving)}
        />
      ) : null}
    </Dialog>
  );
}

/** Name first, then the plan's end, then the work already finished. */
function sortProjects(rows: Project[], sort: SortOrder): Project[] {
  const copy = [...rows];
  if (sort === 'due') {
    copy.sort((left, right) => {
      if (left.dueDate === right.dueDate) return left.name.localeCompare(right.name, 'fa');
      if (!left.dueDate) return 1;
      if (!right.dueDate) return -1;
      return left.dueDate.localeCompare(right.dueDate);
    });
    return copy;
  }
  if (sort === 'progress') {
    copy.sort((left, right) => projectProgress(right) - projectProgress(left));
    return copy;
  }
  copy.sort((left, right) => left.name.localeCompare(right.name, 'fa'));
  return copy;
}
