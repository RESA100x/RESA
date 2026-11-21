import { displayMonthName, displayMonthOf } from '../lib/calendar-system';
import type { TaskPriority, TaskStatus } from '../tasks/task-model';

// Mirrors `src-tauri/src/reports.rs`. The backend buckets by local calendar day
// and hands the days over as they are; grouping into weeks happens here so the
// labels can follow the active calendar (Jalali for Persian).

export type ReportDay = {
  date: string;
  created: number;
  completed: number;
  focusSeconds: number;
};

export type ReportTotals = {
  created: number;
  completed: number;
  open: number;
  overdue: number;
  archived: number;
  completionRate: number;
  averageCloseDays: number | null;
  medianCloseDays: number | null;
};

export type ReportQuadrant = {
  priority: TaskPriority;
  open: number;
  completed: number;
};

export type ReportLane = {
  id: string;
  name: string;
  open: number;
  completed: number;
};

export type ReportProject = {
  id: string;
  name: string;
  open: number;
  completed: number;
  overdue: number;
  completionRate: number;
  averageCloseDays: number | null;
};

export type ReportStuckTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectName: string | null;
  dueDate: string | null;
  ageDays: number;
  overdueDays: number | null;
};

export type ReportMeeting = {
  id: string;
  title: string;
  startsAt: string;
  status: string;
  attendees: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  unknown: number;
  lateMinutes: number;
  agendaItems: number;
  agendaTasks: number;
  agendaDone: number;
};

export type ReportActivity = {
  id: string;
  at: string;
  taskId: string;
  taskTitle: string;
  kind: string;
  detail: string | null;
};

export type ReportComparison = {
  created: number;
  completed: number;
  archived: number;
  averageCloseDays: number | null;
};

/** What `exportTaskReport` wrote: the file and the format it chose. */
export type ReportExportSummary = {
  path: string;
  format: 'csv' | 'markdown';
};

export type TaskReport = {
  days: ReportDay[];
  totals: ReportTotals;
  quadrants: ReportQuadrant[];
  lanes: ReportLane[];
  projects: ReportProject[];
  stuck: ReportStuckTask[];
  meetings: ReportMeeting[];
  activity: ReportActivity[];
  previous: ReportComparison;
  generatedAt: string;
};

export const REPORT_RANGES = [7, 30, 90, 365] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export type ReportWeek = {
  start: string;
  end: string;
  created: number;
  completed: number;
  focusSeconds: number;
};

export const QUADRANT_ORDER: TaskPriority[] = [
  'important_urgent',
  'important_not_urgent',
  'not_important_urgent',
  'not_important_not_urgent'
];

function dayOfWeek(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

/**
 * Fold the daily series into weeks that start on `weekStart` (6 = Saturday for
 * the Persian calendar). A leading partial week keeps its own bucket instead of
 * being dropped, so the first bar never silently loses days.
 */
export function groupByWeek(days: ReportDay[], weekStart: 0 | 1 | 6): ReportWeek[] {
  const weeks: ReportWeek[] = [];
  let current: ReportWeek | null = null;
  for (const day of days) {
    const startsWeek = dayOfWeek(day.date) === weekStart;
    if (!current || (startsWeek && current.start !== day.date)) {
      if (current) weeks.push(current);
      current = { start: day.date, end: day.date, created: 0, completed: 0, focusSeconds: 0 };
    }
    current.end = day.date;
    current.created += day.created;
    current.completed += day.completed;
    current.focusSeconds += day.focusSeconds;
  }
  if (current) weeks.push(current);
  return weeks;
}

/** Largest single bar value, used to scale the chart. Never returns 0. */
export function peakValue(weeks: ReportWeek[]): number {
  let peak = 0;
  for (const week of weeks) peak = Math.max(peak, week.created, week.completed);
  return Math.max(peak, 1);
}

export function totalFocusSeconds(days: ReportDay[]): number {
  return days.reduce((sum, day) => sum + day.focusSeconds, 0);
}

export type ReportMonth = {
  key: string;
  label: string;
  year: number;
  monthIndex: number;
  created: number;
  completed: number;
  focusSeconds: number;
};

/**
 * Fold the daily series into display months. The display calendar decides what
 * a month is, so a Persian report groups by Jalali months and an English one by
 * Gregorian months from the same data.
 */
export function groupByMonth(days: ReportDay[]): ReportMonth[] {
  const months: ReportMonth[] = [];
  let current: ReportMonth | null = null;
  for (const day of days) {
    const [year, month, date] = day.date.split('-').map(Number);
    const display = displayMonthOf(new Date(year, month - 1, date));
    const key = `${display.year}-${display.monthIndex}`;
    if (!current || current.key !== key) {
      if (current) months.push(current);
      current = {
        key,
        label: `${displayMonthName(display.monthIndex)} ${display.year}`,
        year: display.year,
        monthIndex: display.monthIndex,
        created: 0,
        completed: 0,
        focusSeconds: 0
      };
    }
    current.created += day.created;
    current.completed += day.completed;
    current.focusSeconds += day.focusSeconds;
  }
  if (current) months.push(current);
  return months;
}

/** Focus time spent per finished task; null when nothing was finished. */
export function focusPerCompleted(days: ReportDay[]): number | null {
  const completed = days.reduce((sum, day) => sum + day.completed, 0);
  if (completed === 0) return null;
  return totalFocusSeconds(days) / completed;
}

export function hasActivity(report: TaskReport): boolean {
  return (
    report.totals.created > 0 ||
    report.totals.completed > 0 ||
    report.totals.open > 0 ||
    report.totals.archived > 0
  );
}
