import { Pencil, X } from '../components/icons';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { Dialog } from '../components/Dialog';
import { formatNumber, t } from '../i18n';
import { formatIsoDisplay } from '../lib/calendar-system';
import { requestModal } from '../lib/modal-store';
import type { Meeting } from '../meetings/meeting-model';
import { useNowlyRepository } from '../data/RepositoryContext';
import { useOptionalTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { taskStatus, type Task } from '../tasks/task-model';
import { useContacts } from '../phonebook/useContacts';
import {
  projectDaysLeft,
  projectIsLate,
  projectProgress,
  type Project
} from './project-model';

type ProjectDetailDialogProps = {
  project: Project;
  todayIso: string;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onEdit(project: Project): void;
  onArchive(project: Project): void;
  onRestore(project: Project): void;
};

/**
 * The work behind one project. The counters come from the backend, the rows
 * come from the board, the archive and the meetings module, so the card is
 * always the same answer as the list, the report and the archive.
 */
export function ProjectDetailDialog({
  project,
  todayIso,
  restoreFocusRef,
  onClose,
  onEdit,
  onArchive,
  onRestore
}: ProjectDetailDialogProps) {
  const repository = useNowlyRepository();
  const workspace = useOptionalTaskWorkspace();
  const contacts = useContacts();
  const [archived, setArchived] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  useEffect(() => {
    const read = repository.listTaskArchive;
    if (!read) return;
    let cancelled = false;
    read
      .call(repository)
      .then((rows) => {
        if (!cancelled) setArchived(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(() => {
    const read = repository.listMeetings;
    if (!read) return;
    let cancelled = false;
    read
      .call(repository)
      .then((rows) => {
        if (!cancelled) setMeetings(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const boardTasks = useMemo(
    () => (workspace?.workspace.data.tasks ?? []).filter((task) => task.projectId === project.id),
    [workspace?.workspace.data.tasks, project.id]
  );
  const archivedTasks = useMemo(
    () => archived.filter((task) => task.projectId === project.id),
    [archived, project.id]
  );
  const projectMeetings = useMemo(
    () =>
      meetings
        .filter((meeting) => meeting.projectId === project.id)
        .sort((left, right) => right.startsAt.localeCompare(left.startsAt)),
    [meetings, project.id]
  );

  const owner = project.ownerContactId
    ? contacts.contacts.data.find((contact) => contact.id === project.ownerContactId) ?? null
    : null;
  const progress = Math.round(projectProgress(project) * 100);
  const late = projectIsLate(project, todayIso);
  const daysLeft = projectDaysLeft(project, todayIso);

  function openTask(id: string) {
    requestModal({ type: 'task-open', taskId: id, trigger: null });
  }

  function taskRow(task: Task) {
    const status = taskStatus(task);
    return (
      <li key={task.id}>
        <button type="button" className="project-detail__link" onClick={() => openTask(task.id)}>
          {task.title}
        </button>
        <span className={`project-detail__status project-detail__status--${status}`}>
          {t(`taskStatus.${status}`)}
        </span>
        {task.dueDate ? (
          <span className="project-detail__muted" dir="ltr">
            {formatIsoDisplay(task.dueDate.slice(0, 10))}
          </span>
        ) : null}
      </li>
    );
  }

  return (
    <Dialog
      title={t('projects.detailTitle')}
      ariaLabelledBy="project-detail-title"
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="project-detail"
      headerActions={
        <>
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('projects.edit', { name: project.name })}
            title={t('projects.edit', { name: project.name })}
            onClick={() => onEdit(project)}
          >
            <Pencil aria-hidden="true" />
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
        <div className="project-detail__footer">
          {project.archivedAt ? (
            <button type="button" className="good-button" onClick={() => onRestore(project)}>
              {t('projects.restore')}
            </button>
          ) : (
            <button type="button" className="good-button" onClick={() => onArchive(project)}>
              {t('projects.archive')}
            </button>
          )}
        </div>
      }
    >
      <div className="project-detail__body">
        <header className="project-detail__head">
          <span className="project-detail__dot" style={{ background: project.color }} aria-hidden="true" />
          <div className="project-detail__identity">
            <h3 id="project-detail-title">{project.name}</h3>
            <div className="project-detail__badges">
              <span className={`project-row__status project-row__status--${project.status}`}>
                {t(`projectStatus.${project.status}`)}
              </span>
              {project.archivedAt ? (
                <span className="project-detail__badge">{t('projects.archived')}</span>
              ) : null}
              {late ? <span className="project-detail__badge project-detail__badge--late">{t('projects.late')}</span> : null}
              {project.tags.map((tag) => (
                <span key={tag} className="project-detail__badge">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </header>

        <div className="project-detail__progress" role="group" aria-label={t('projects.progress')}>
          <div className="project-detail__bar" aria-hidden="true">
            <span style={{ width: `${progress}%`, background: project.color }} />
          </div>
          <span className="project-detail__progress-text">
            {t('projects.progressValue', {
              done: formatNumber(project.doneCount),
              total: formatNumber(project.taskCount),
              percent: formatNumber(progress)
            })}
          </span>
        </div>

        <dl className="project-detail__stats">
          <div>
            <dt>{t('projects.stats.open')}</dt>
            <dd>{formatNumber(project.openCount + project.inProgressCount)}</dd>
          </div>
          <div>
            <dt>{t('projects.stats.done')}</dt>
            <dd>{formatNumber(project.doneCount)}</dd>
          </div>
          <div className={project.overdueCount > 0 ? 'is-late' : undefined}>
            <dt>{t('projects.stats.overdue')}</dt>
            <dd>{formatNumber(project.overdueCount)}</dd>
          </div>
          <div>
            <dt>{t('projects.stats.meetings')}</dt>
            <dd>{formatNumber(project.meetingCount)}</dd>
          </div>
        </dl>

        <section className="project-detail__section">
          <h4>{t('projects.plan')}</h4>
          <dl className="project-detail__facts">
            <div>
              <dt>{t('projects.owner')}</dt>
              <dd>
                {owner ? (
                  <button
                    type="button"
                    className="project-detail__link"
                    onClick={() => requestModal({ type: 'contact-card', contactId: owner.id, trigger: null })}
                  >
                    {owner.name}
                  </button>
                ) : (
                  t('projects.ownerNone')
                )}
              </dd>
            </div>
            <div>
              <dt>{t('projects.startDate')}</dt>
              <dd>{project.startDate ? formatIsoDisplay(project.startDate, 'long') : '—'}</dd>
            </div>
            <div>
              <dt>{t('projects.dueDate')}</dt>
              <dd>
                {project.dueDate ? formatIsoDisplay(project.dueDate, 'long') : '—'}
                {daysLeft !== null && project.status !== 'done' ? (
                  <span className={`project-detail__muted${daysLeft < 0 ? ' is-late' : ''}`}>
                    {daysLeft < 0
                      ? t('projects.daysLate', { count: formatNumber(Math.abs(daysLeft)) })
                      : t('projects.daysLeft', { count: formatNumber(daysLeft) })}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>{t('projects.lastActivity')}</dt>
              <dd>{project.lastActivityAt ? formatIsoDisplay(project.lastActivityAt.slice(0, 10), 'long') : '—'}</dd>
            </div>
          </dl>
        </section>

        {project.description ? (
          <section className="project-detail__section">
            <h4>{t('projects.description')}</h4>
            <p className="project-detail__note">{project.description}</p>
          </section>
        ) : null}

        <section className="project-detail__section">
          <h4>{t('projects.detailTasks')}</h4>
          {boardTasks.length === 0 && archivedTasks.length === 0 ? (
            <p className="project-detail__muted">{t('projects.detailNoTasks')}</p>
          ) : (
            <>
              {boardTasks.length > 0 ? (
                <ul className="project-detail__list">{boardTasks.map(taskRow)}</ul>
              ) : null}
              {archivedTasks.length > 0 ? (
                <>
                  <h5 className="project-detail__subhead">{t('projects.detailArchived')}</h5>
                  <ul className="project-detail__list project-detail__list--muted">
                    {archivedTasks.slice(0, 40).map(taskRow)}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </section>

        <section className="project-detail__section">
          <h4>{t('projects.detailMeetings')}</h4>
          {projectMeetings.length === 0 ? (
            <p className="project-detail__muted">{t('projects.detailNoMeetings')}</p>
          ) : (
            <ul className="project-detail__list">
              {projectMeetings.map((meeting) => (
                <li key={meeting.id}>
                  <button
                    type="button"
                    className="project-detail__link"
                    onClick={() => requestModal({ type: 'meeting-edit', meetingId: meeting.id, trigger: null })}
                  >
                    {meeting.title}
                  </button>
                  <span className="project-detail__muted">
                    {formatIsoDisplay(meeting.startsAt.slice(0, 10), 'long')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}
