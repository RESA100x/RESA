import type { Recurrence, Weekday } from '../calendar/calendar-model';

/**
 * Next due date for a recurring task series. Mirrors the Rust implementation
 * (`src-tauri/src/task_recurrence.rs`) so the browser shim behaves like the
 * desktop app; both are covered by tests.
 */

function parseDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const WEEKDAY_CODES: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function weekdayOf(date: Date): Weekday {
  return WEEKDAY_CODES[(date.getDay() + 6) % 7];
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function addMonthsClamped(date: Date, months: number): Date {
  const total = date.getFullYear() * 12 + date.getMonth() + months;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  return new Date(year, month, Math.min(date.getDate(), daysInMonth(year, month + 1)));
}

function addYearsClamped(date: Date, years: number): Date {
  const year = date.getFullYear() + years;
  return new Date(year, date.getMonth(), Math.min(date.getDate(), daysInMonth(year, date.getMonth() + 1)));
}

function weekStart(date: Date): Date {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

function nextCandidate(rule: Recurrence, anchor: Date, current: Date): Date | null {
  const interval = Math.max(1, Math.trunc(rule.interval));
  switch (rule.freq) {
    case 'daily':
      return addDays(current, interval);
    case 'weekly': {
      if (rule.byDay.length === 0) return addDays(current, 7 * interval);
      const start = weekStart(anchor);
      let candidate = addDays(current, 1);
      for (let step = 0; step < 7 * interval + 7; step += 1) {
        const weeks = Math.round((weekStart(candidate).getTime() - start.getTime()) / (7 * 86_400_000));
        if (weeks >= 0 && weeks % interval === 0 && rule.byDay.includes(weekdayOf(candidate))) {
          return candidate;
        }
        candidate = addDays(candidate, 1);
      }
      return null;
    }
    case 'monthly':
      return addMonthsClamped(current, interval);
    case 'yearly':
      return addYearsClamped(current, interval);
    default:
      return null;
  }
}

export function nextTaskDueDate(
  rule: Recurrence,
  anchor: string,
  current: string,
  occurrences: number
): string | null {
  const next = nextCandidate(rule, parseDate(anchor), parseDate(current));
  if (!next) return null;
  const nextIso = formatDate(next);
  if (nextIso <= current.slice(0, 10)) return null;
  if (rule.end.kind === 'until' && nextIso > rule.end.date) return null;
  if (rule.end.kind === 'count' && occurrences >= rule.end.count) return null;
  return nextIso;
}
