// Display-calendar abstraction: the rest of the app speaks Gregorian ISO dates,
// while the visible month grid and month navigation follow the active calendar
// system. Persian switches the display to the Jalali (Solar Hijri) calendar.

import { getLanguage, getLocale } from '../i18n';
import {
  formatJalali,
  fromJalali,
  jalaliMonthLength,
  jalaliMonthName,
  toJalali,
  type JalaliFormat
} from './jalali';

export type DisplayMonth = { year: number; monthIndex: number };

export function usesJalaliCalendar(): boolean {
  return getLanguage() === 'fa';
}

/**
 * Whether a day-of-week (0 = Sunday … 6 = Saturday) is a weekend in the active
 * locale. Persian weeks rest on Friday; the other locales keep Saturday/Sunday.
 */
export function isWeekendDow(dayOfWeek: number): boolean {
  if (usesJalaliCalendar()) return dayOfWeek === 5;
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/** The month a date belongs to, in the active display calendar. */
export function displayMonthOf(date: Date): DisplayMonth {
  if (usesJalaliCalendar()) {
    const jalali = toJalali(date);
    return { year: jalali.year, monthIndex: jalali.month - 1 };
  }
  return { year: date.getFullYear(), monthIndex: date.getMonth() };
}

/** First day (local midnight) of a display-calendar month. */
export function displayMonthStart(year: number, monthIndex: number): Date {
  if (usesJalaliCalendar()) return fromJalali(year, monthIndex + 1, 1);
  return new Date(year, monthIndex, 1);
}

/** Step a display-calendar month by `delta` months. */
export function addDisplayMonths(year: number, monthIndex: number, delta: number): DisplayMonth {
  if (usesJalaliCalendar()) {
    const total = year * 12 + monthIndex + delta;
    return { year: Math.floor(total / 12), monthIndex: ((total % 12) + 12) % 12 };
  }
  const date = new Date(year, monthIndex + delta, 1);
  return { year: date.getFullYear(), monthIndex: date.getMonth() };
}

/** Day-of-month of a date in the active display calendar. */
export function displayDayOfMonth(date: Date): number {
  return usesJalaliCalendar() ? toJalali(date).day : date.getDate();
}

/** Number of days in a display-calendar month. */
export function displayMonthLength(year: number, monthIndex: number): number {
  if (usesJalaliCalendar()) return jalaliMonthLength(year, monthIndex + 1);
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function displayMonthName(monthIndex: number): string {
  if (usesJalaliCalendar()) return jalaliMonthName(monthIndex + 1);
  return new Intl.DateTimeFormat(getLocale(), { month: 'long' }).format(new Date(2026, monthIndex, 1));
}

export function isSameDisplayMonth(date: Date, year: number, monthIndex: number): boolean {
  const month = displayMonthOf(date);
  return month.year === year && month.monthIndex === monthIndex;
}

/** Month/day pair of an ISO date in the active display calendar. */
export function displayMonthDayOf(isoDate: string): { month: number; day: number } {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (usesJalaliCalendar()) {
    const jalali = toJalali(date);
    return { month: jalali.month, day: jalali.day };
  }
  return { month: date.getMonth() + 1, day: date.getDate() };
}

/** Render a `YYYY-MM-DD` string in the active display calendar. */
export function formatIsoDisplay(isoDate: string, format: JalaliFormat = 'short'): string {
  if (!usesJalaliCalendar()) return isoDate;
  const [year, month, day] = isoDate.split('-').map(Number);
  return formatJalali(new Date(year, month - 1, day), format);
}

/** Format a date in the active display calendar. */
export function formatDisplayDate(date: Date, format: JalaliFormat = 'long'): string {
  if (usesJalaliCalendar()) return formatJalali(date, format);
  if (format === 'monthYear') {
    return new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(date);
  }
  if (format === 'full') {
    return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'full' }).format(date);
  }
  return new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

/** `YYYY-MM-DD` of a local date, without a trip through UTC. */
function isoOfLocalDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The occurrence of a yearly anniversary inside a display-calendar year.
 *
 * A birthday is stored once as a Gregorian date, but it is *celebrated* on the
 * same day of the active display calendar every year: 22 Ordibehesht for a
 * Persian user, 12 May otherwise. Clamping to the month's length keeps 29/30/31
 * edges honest instead of inventing a date that does not exist.
 */
export function anniversaryOccurrence(isoDate: string, displayYear: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate.trim())) return null;
  const monthDay = displayMonthDayOf(isoDate);
  const length = displayMonthLength(displayYear, monthDay.month - 1);
  if (length <= 0) return null;
  const day = Math.min(monthDay.day, length);
  const start = displayMonthStart(displayYear, monthDay.month - 1);
  return isoOfLocalDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + day - 1));
}
