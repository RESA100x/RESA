import { Pencil, Plus, X } from '../components/icons';
import { useId, useMemo, useState, type RefObject } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { colorStyle } from '../lib/color';
import { formatNumber, t } from '../i18n';
import type { Project, ProjectDraft } from './project-model';
import { ProjectDialog } from './ProjectDialog';
import type { ProjectsResource } from './useProjects';
import './projects.css';

type ProjectsDialogProps = {
  resource: ProjectsResource;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onRetry(): void;
  onClose(): void;
  onCreate(draft: ProjectDraft): Promise<unknown>;
  onUpdate(project: Project, draft: ProjectDraft): Promise<unknown>;
  onArchive(id: string): Promise<void>;
};

type FormState = { type: 'create' } | { type: 'edit'; project: Project } | null;

/**
 * The project list: every project ever defined, with the number of tasks that
 * went into it. Archiving hides a project from pickers but keeps the rows, so
 * the per-project history in the archive stays readable.
 */
export function ProjectsDialog({
  resource,
  restoreFocusRef,
  onRetry,
  onClose,
  onCreate,
  onUpdate,
  onArchive
}: ProjectsDialogProps) {
  const titleId = useId();
  const [form, setForm] = useState<FormState>(null);
  const [archiving, setArchiving] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const active = useMemo(() => resource.data.filter((project) => !project.archivedAt), [resource.data]);
  const closed = useMemo(() => resource.data.filter((project) => project.archivedAt), [resource.data]);

  async function archive(project: Project) {
    setBusy(true);
    setError('');
    try {
      await onArchive(project.id);
      setArchiving(null);
    } catch (reason) {
      setError(
        typeof reason === 'object' && reason !== null && 'message' in reason && typeof reason.message === 'string'
          ? reason.message
          : t('common.opFailed')
      );
    } finally {
      setBusy(false);
    }
  }

  function row(project: Project) {
    return (
      <li key={project.id} className={`project-row${project.archivedAt ? ' project-row--closed' : ''}`}>
        <span className="project-row__dot" style={colorStyle(project.color)} aria-hidden="true" />
        <div className="project-row__main">
          <span className="project-row__name">{project.name}</span>
          {project.description ? <span className="project-row__desc">{project.description}</span> : null}
        </div>
        <span className={`project-row__status project-row__status--${project.status}`}>
          {t(`projectStatus.${project.status}`)}
        </span>
        <span className="project-row__count">{t('projects.tasks', { count: formatNumber(project.taskCount ?? 0) })}</span>
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
          <span className="project-row__closed">{t('projects.archived')}</span>
        )}
      </li>
    );
  }

  return (
    <Dialog
      title={t('widget.projects.name')}
      ariaLabelledBy={titleId}
      isTopLayer={!form && !archiving}
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
        </div>
      }
    >
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

      {archiving ? (
        <ConfirmDialog
          title={t('projects.archiveTitle', { name: archiving.name })}
          description={t('projects.archiveBody', { count: formatNumber(archiving.taskCount ?? 0) })}
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
