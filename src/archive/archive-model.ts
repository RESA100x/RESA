import { getLocale, t } from '../i18n';
import {
  addDisplayMonths,
  displayMonthName,
  displayMonthOf,
  displayMonthStart,
  formatIsoDisplay,
  usesJalaliCalendar
} from '../lib/calendar-system';
import type { Project } from '../projects/project-model';
import { taskStatus, type Task, type TaskEvent, type TaskStatus } from '../tasks/task-model';

export const ARCHIVE_TABS = ['all', 'done', 'suspended', 'cancelled', 'deleted'] as const;
export type ArchiveTab = (typeof ARCHIVE_TABS)[number];

// How far back the list reaches. `custom` uses `from`/`to` from the options.
export const ARCHIVE_RANGES = ['all', 'thisMonth', 'lastMonth', 'last90', 'custom'] as const;
export type ArchiveRange = (typeof ARCHIVE_RANGES)[number];

export type ArchiveFilterOptions = {
  tab: ArchiveTab;
  query: string;
  projectId: string;
  range?: ArchiveRange;
  from?: string;
  to?: string;
  assigneeId?: string;
  tagId?: string;
  // Resolves an assignee id to a name so the search box also matches people.
  assigneeName?: (id: string) => string;
  // Injectable clock for tests; defaults to "now".
  now?: Date;
};

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

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

// Half-open [from, to) bounds so a task stamped exactly at midnight still lands
// on the right side of the range.
function rangeBounds(options: ArchiveFilterOptions): { from: Date | null; to: Date | null } {
  const now = options.now ?? new Date();
  switch (options.range) {
    case 'thisMonth': {
      const month = displayMonthOf(now);
      const next = addDisplayMonths(month.year, month.monthIndex, 1);
      return {
        from: displayMonthStart(month.year, month.monthIndex),
        to: displayMonthStart(next.year, next.monthIndex)
      };
    }
    case 'lastMonth': {
      const previous = addDisplayMonths(displayMonthOf(now).year, displayMonthOf(now).monthIndex, -1);
      const current = displayMonthOf(now);
      return {
        from: displayMonthStart(previous.year, previous.monthIndex),
        to: displayMonthStart(current.year, current.monthIndex)
      };
    }
    case 'last90': {
      const from = startOfDay(now);
      from.setDate(from.getDate() - 89);
      return { from, to: nextDay(startOfDay(now)) };
    }
    case 'custom': {
      const from = parseIsoDate(options.from);
      const to = parseIsoDate(options.to);
      return { from, to: to ? nextDay(to) : null };
    }
    default:
      return { from: null, to: null };
  }
}

function withinRange(task: Task, options: ArchiveFilterOptions): boolean {
  if (!options.range || options.range === 'all') return true;
  const stamp = new Date(archiveStamp(task));
  if (Number.isNaN(stamp.valueOf())) return true;
  const { from, to } = rangeBounds(options);
  if (from && stamp < from) return false;
  if (to && stamp >= to) return false;
  return true;
}

function matchesQuery(task: Task, query: string, options: ArchiveFilterOptions): boolean {
  if (!query) return true;
  const haystack = [task.title, task.description, task.archiveReason ?? ''];
  if (task.assigneeContactId && options.assigneeName) {
    haystack.push(options.assigneeName(task.assigneeContactId));
  }
  return haystack.some((value) => value.toLocaleLowerCase().includes(query));
}

export function filterArchive(tasks: Task[], options: ArchiveFilterOptions): Task[] {
  const query = options.query.trim().toLocaleLowerCase();
  return tasks.filter((task) => {
    if (options.tab !== 'all' && archiveTabOf(task) !== options.tab) return false;
    if (options.projectId && task.projectId !== options.projectId) return false;
    if (options.assigneeId && task.assigneeContactId !== options.assigneeId) return false;
    if (options.tagId && !task.tagIds.includes(options.tagId)) return false;
    if (!withinRange(task, options)) return false;
    return matchesQuery(task, query, options);
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

export type ArchiveMonthGroup = {
  key: string;
  label: string;
  tasks: Task[];
};

// Month headers in the list, labelled in the active calendar (Jalali for
// Persian). The list already arrives newest-first, so groups keep that order.
export function groupArchiveByMonth(tasks: Task[]): ArchiveMonthGroup[] {
  const groups: ArchiveMonthGroup[] = [];
  const byKey = new Map<string, ArchiveMonthGroup>();
  for (const task of tasks) {
    const stamp = new Date(archiveStamp(task));
    const display = Number.isNaN(stamp.valueOf()) ? null : displayMonthOf(stamp);
    const key = display ? `${display.year}-${display.monthIndex}` : 'unknown';
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: display ? `${displayMonthName(display.monthIndex)} ${display.year}` : t('archive.unknownDate'),
        tasks: []
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.tasks.push(task);
  }
  return groups;
}

export function closeDays(task: Task): number | null {
  if (!task.completedAt) return null;
  const created = new Date(task.createdAt).valueOf();
  const completed = new Date(task.completedAt).valueOf();
  if (Number.isNaN(created) || Number.isNaN(completed)) return null;
  return Math.max(0, (completed - created) / 86_400_000);
}

export type ArchiveStats = {
  total: number;
  averageCloseDays: number | null;
  oldestOpen: Task | null;
};

// The two numbers the tabs alone cannot show: how long work took on average,
// and the piece of work that has been sitting unfinished the longest.
export function archiveStats(tasks: Task[]): ArchiveStats {
  const closes = tasks.map(closeDays).filter((value): value is number => value !== null);
  const averageCloseDays = closes.length
    ? closes.reduce((sum, value) => sum + value, 0) / closes.length
    : null;
  let oldestOpen: Task | null = null;
  for (const task of tasks) {
    if (archiveTabOf(task) !== 'deleted') continue;
    if (!oldestOpen || new Date(task.createdAt).valueOf() < new Date(oldestOpen.createdAt).valueOf()) {
      oldestOpen = task;
    }
  }
  return { total: tasks.length, averageCloseDays, oldestOpen };
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
