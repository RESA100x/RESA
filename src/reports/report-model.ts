import type { TaskPriority } from '../tasks/task-model';

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

export type TaskReport = {
  days: ReportDay[];
  totals: ReportTotals;
  quadrants: ReportQuadrant[];
  lanes: ReportLane[];
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

export function hasActivity(report: TaskReport): boolean {
  return (
    report.totals.created > 0 ||
    report.totals.completed > 0 ||
    report.totals.open > 0 ||
    report.totals.archived > 0
  );
}
