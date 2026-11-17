import { describe, expect, it } from 'vitest';
import {
  formatJalali,
  fromJalali,
  isLeapJalaliYear,
  jalaliMonthLength,
  toJalali,
  toPersianDigits
} from './jalali';

const intlPersian = new Intl.DateTimeFormat('en-u-ca-persian', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
});

function intlJalali(date: Date) {
  const parts = Object.fromEntries(
    intlPersian.formatToParts(date).map((part) => [part.type, part.value])
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

describe('Jalali conversion', () => {
  it('matches the platform Persian calendar across a multi-year range', () => {
    const start = new Date(2020, 0, 1);
    for (let offset = 0; offset < 365 * 8; offset += 7) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
      expect(toJalali(date), date.toDateString()).toEqual(intlJalali(date));
    }
  });

  it('round-trips every day of a leap and a common year', () => {
    for (const year of [1403, 1404, 1405]) {
      for (let month = 1; month <= 12; month += 1) {
        const length = jalaliMonthLength(year, month);
        for (let day = 1; day <= length; day += 1) {
          const date = fromJalali(year, month, day);
          expect(toJalali(date)).toEqual({ year, month, day });
        }
      }
    }
  });

  it('knows the leap-year rule', () => {
    expect(isLeapJalaliYear(1403)).toBe(true);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    expect(jalaliMonthLength(1405, 1)).toBe(31);
    expect(jalaliMonthLength(1405, 7)).toBe(30);
  });

  it('formats Persian dates with Persian digits', () => {
    const date = new Date(2026, 10, 17);
    expect(formatJalali(date, 'long')).toBe('۲۶ آبان ۱۴۰۵');
    expect(formatJalali(date, 'full')).toBe('سه‌شنبه ۲۶ آبان ۱۴۰۵');
    expect(formatJalali(date, 'monthYear')).toBe('آبان ۱۴۰۵');
    expect(toPersianDigits('2026')).toBe('۲۰۲۶');
  });
});
