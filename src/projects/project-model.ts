import type { HexColor } from '../lib/color';

export const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Project = {
  id: string;
  name: string;
  description: string;
  color: HexColor;
  status: ProjectStatus;
  // The accountable person, from the phone book.
  ownerContactId: string | null;
  startDate: string | null;
  dueDate: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  // Tasks ever attached to the project, archived ones included.
  taskCount: number;
  openCount: number;
  inProgressCount: number;
  doneCount: number;
  // Open work whose due date has passed.
  overdueCount: number;
  meetingCount: number;
  lastActivityAt: string | null;
};

export type ProjectDraft = {
  name: string;
  description?: string;
  color?: HexColor;
  status?: ProjectStatus;
  ownerContactId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  tags?: string[];
};

export const DEFAULT_PROJECT_COLOR: HexColor = '#4FC9DA';

export function projectStatusLabel(status: ProjectStatus) {
  return `projectStatus.${status}`;
}

/** Finished share of the work ever attached, 0..1. */
export function projectProgress(project: Pick<Project, 'doneCount' | 'taskCount'>): number {
  if (project.taskCount <= 0) return 0;
  return Math.min(1, Math.max(0, project.doneCount / project.taskCount));
}

/**
 * A project is late when it still has open work past its due date, or when the
 * planned end has passed while the project is not closed. A finished project is
 * never late, however old it is.
 */
export function projectIsLate(
  project: Pick<Project, 'status' | 'dueDate' | 'overdueCount'>,
  todayIso: string
): boolean {
  if (project.status === 'done') return false;
  if (project.overdueCount > 0) return true;
  return Boolean(project.dueDate) && project.dueDate! < todayIso;
}

/** Whole days from today to the due date; null when the project has no end. */
export function projectDaysLeft(
  project: Pick<Project, 'dueDate'>,
  todayIso: string
): number | null {
  if (!project.dueDate) return null;
  const [year, month, day] = project.dueDate.split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = todayIso.split('-').map(Number);
  const due = Date.UTC(year, month - 1, day);
  const today = Date.UTC(todayYear, todayMonth - 1, todayDay);
  return Math.round((due - today) / 86_400_000);
}

/** Accepts `a, b` / `a، b` / new lines, the same way the phone book does. */
export function parseProjectTags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.split(/[,\n،]/)) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag.slice(0, 40));
    if (tags.length === 12) break;
  }
  return tags;
}
