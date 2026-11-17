import type { CalendarDay } from '../calendar/calendar-model';
import { getLanguage, getLocale } from '../i18n';
import {
  displayDayOfMonth,
  displayMonthLength,
  displayMonthOf,
  displayMonthStart,
  formatDisplayDate,
  isSameDisplayMonth,
  usesJalaliCalendar
} from './calendar-system';
import { formatJalali, jalaliWeekdayName } from './jalali';

const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const weekdayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const monthNamesEn = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Full, human-friendly date used in dialog titles and date-picker aria labels.
// Language-aware: Chinese uses the native year/month/day form, English uses a
// long-form date with weekday.
export function formatChineseDate(date: Date): string {
  if (usesJalaliCalendar()) return formatJalali(date, 'full');
  if (getLanguage() !== 'zh' && getLanguage() !== 'en') {
    return new Intl.DateTimeFormat(getLocale(), { calendar: 'gregory', dateStyle: 'full' }).format(date);
  }
  if (getLanguage() === 'en') {
    return `${weekdayNamesEn[date.getDay()]}, ${monthNamesEn[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdayNames[date.getDay()]}`;
}

export type WeekStart = 'monday' | 'sunday' | 'saturday';

/**
 * The week-start column actually used for rendering. Persian follows the
 * Saturday-first week; a legacy stored "monday" (the generic default) is
 * treated as the Persian default rather than a deliberate choice.
 */
export function effectiveWeekStart(weekStart: WeekStart): WeekStart {
  if (usesJalaliCalendar() && weekStart === 'monday') return 'saturday';
  return weekStart;
}

function startDayOfWeek(weekStart: WeekStart) {
  if (weekStart === 'sunday') return 0;
  if (weekStart === 'saturday') return 6;
  return 1;
}

export function buildMonthGrid(
  year: number,
  monthIndex: number,
  today = new Date(),
  weekStart: WeekStart = 'monday'
): CalendarDay[] {
  // `year`/`monthIndex` are display-calendar values (Jalali in Persian), so the
  // first cell is the display month's first day, not a Gregorian month.
  const first = displayMonthStart(year, monthIndex);
  const startDow = startDayOfWeek(weekStart);
  const offset = (first.getDay() - startDow + 7) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - offset);
  const result: CalendarDay[] = [];
  const todayIso = toIsoDate(today);

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    result.push({
      isoDate: toIsoDate(date),
      dayOfMonth: displayDayOfMonth(date),
      isCurrentMonth: isSameDisplayMonth(date, year, monthIndex),
      isToday: toIsoDate(date) === todayIso,
      events: []
    });
  }

  return result;
}

/** Weekday labels indexed by day-of-week (0 = Sunday … 6 = Saturday). */
export function weekdayName(dayOfWeek: number, short = true): string {
  if (usesJalaliCalendar()) return jalaliWeekdayName(dayOfWeek, short);
  return new Intl.DateTimeFormat(getLocale(), { weekday: short ? 'short' : 'long' }).format(
    new Date(2026, 0, 4 + dayOfWeek)
  );
}

/** Display-calendar month length and month-of-date helpers re-exported for views. */
export { displayMonthLength, displayMonthOf, displayMonthStart, formatDisplayDate, isSameDisplayMonth };
