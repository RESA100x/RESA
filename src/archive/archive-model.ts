import { getLocale, t } from '../i18n';
import { formatIsoDisplay, usesJalaliCalendar } from '../lib/calendar-system';
import type { Project } from '../projects/project-model';
import { taskStatus, type Task, type TaskEvent, type TaskStatus } from '../tasks/task-model';

export const ARCHIVE_TABS = ['all', 'done', 'suspended', 'cancelled', 'deleted'] as const;
export type ArchiveTab = (typeof ARCHIVE_TABS)[number];

// The tab follows the state the task reached, not how it left the board: a
// finished task that was then archived still belongs under "done", while a row
// archived while still open is a deletion.
export function archiveTabOf(task: Task): Exclude<ArchiveTab, 'all'> {
  const status = taskStatus(task);
  if (status === 'done' || status === 'suspended' || status === 'cancelled') return status;
  return 'deleted';
}

// The badge on a row: the reached state, or "deleted" when an open task was
// archived without ever being finished.
export function archiveStatusLabel(task: Task): string {
  const status = taskStatus(task);
  return status === 'open' ? t('archive.tab.deleted') : t(`taskStatus.${status}` as const);
}

export function filterArchive(
  tasks: Task[],
  options: { tab: ArchiveTab; query: string; projectId: string }
): Task[] {
  const query = options.query.trim().toLocaleLowerCase();
  return tasks.filter((task) => {
    if (options.tab !== 'all' && archiveTabOf(task) !== options.tab) return false;
    if (options.projectId && task.projectId !== options.projectId) return false;
    if (!query) return true;
    return (
      task.title.toLocaleLowerCase().includes(query) ||
      task.description.toLocaleLowerCase().includes(query)
    );
  });
}

export function projectName(projects: Project[], projectId: string | null | undefined): string {
  if (!projectId) return '';
  return projects.find((project) => project.id === projectId)?.name ?? '';
}

// The archive is ordered by "when it happened": completion, then the last write.
export function archiveStamp(task: Task): string {
  return task.completedAt ?? task.updatedAt;
}

export function formatStamp(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(getLocale(), {
    calendar: usesJalaliCalendar() ? 'persian' : 'gregory',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function eventDetailLabel(
  event: TaskEvent,
  projects: Project[],
  lanes: { id: string; name: string }[]
): string {
  const detail = event.detail ?? '';
  switch (event.kind) {
    case 'status':
      return detail ? t(`taskStatus.${detail}` as const) : '';
    case 'project':
      return detail ? projectName(projects, detail) : '';
    case 'moved':
      return lanes.find((lane) => lane.id === detail)?.name ?? '';
    case 'priority':
      return detail ? t(`quadrant.${detail}` as const) : '';
    case 'due':
      return detail ? formatIsoDisplay(detail, 'short') : '';
    default:
      return '';
  }
}

export function statusTone(status: TaskStatus): string {
  return `archive-status--${status}`;
}
