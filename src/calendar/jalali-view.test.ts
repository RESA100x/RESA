import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { buildMonthGrid, listDateLabel, monthRange, monthTitle, viewTitle } from './calendar-view';

afterEach(() => setLanguage('zh'));

describe('Persian calendar rendering', () => {
  it('builds a Saturday-first Jalali month grid', () => {
    setLanguage('fa');
    const days = buildMonthGrid(1405, 7, new Date(2026, 10, 17), 'saturday');
    expect(days).toHaveLength(42);
    // Aban 1405 starts Friday 2026-10-23, so the grid opens on the Saturday before it.
    expect(days[0].isoDate).toBe('2026-10-17');
    expect(new Date(`${days[0].isoDate}T00:00:00`).getDay()).toBe(6);
    const firstOfMonth = days.find((day) => day.isoDate === '2026-10-23');
    expect(firstOfMonth).toMatchObject({ dayOfMonth: 1, isCurrentMonth: true });
    expect(days[0].isCurrentMonth).toBe(false);
  });

  it('titles and ranges follow Jalali months', () => {
    setLanguage('fa');
    expect(monthTitle(1405, 7)).toBe('آبان ۱۴۰۵');
    expect(monthRange(1405, 7)).toEqual({
      startAt: '2026-10-23T00:00',
      endAtExclusive: '2026-11-22T00:00'
    });
    expect(viewTitle('month', 1405, 7, new Date(2026, 9, 23))).toBe('آبان ۱۴۰۵');
    expect(listDateLabel('2026-11-17')).toBe('۲۶ آبان سه');
  });
});
