import { describe, expect, it } from 'vitest';
import type { Recurrence } from '../calendar/calendar-model';
import { nextTaskDueDate } from './task-recurrence';

function rule(overrides: Partial<Recurrence> = {}): Recurrence {
  return { freq: 'daily', interval: 1, byDay: [], end: { kind: 'never' }, ...overrides };
}

describe('nextTaskDueDate', () => {
  it('steps daily and weekly rules', () => {
    expect(nextTaskDueDate(rule(), '2026-03-01', '2026-03-01', 1)).toBe('2026-03-02');
    expect(nextTaskDueDate(rule({ freq: 'weekly' }), '2026-03-02', '2026-03-02', 1)).toBe('2026-03-09');
  });

  it('picks the next selected weekday and honours the interval', () => {
    const monWedFri = rule({ freq: 'weekly', byDay: ['MO', 'WE', 'FR'] });
    expect(nextTaskDueDate(monWedFri, '2026-03-02', '2026-03-02', 1)).toBe('2026-03-04');
    expect(nextTaskDueDate(monWedFri, '2026-03-02', '2026-03-06', 3)).toBe('2026-03-09');
    const fortnightly = rule({ freq: 'weekly', interval: 2, byDay: ['MO'] });
    expect(nextTaskDueDate(fortnightly, '2026-03-02', '2026-03-02', 1)).toBe('2026-03-16');
  });

  it('clamps month-end and leap days', () => {
    expect(nextTaskDueDate(rule({ freq: 'monthly' }), '2026-01-31', '2026-01-31', 1)).toBe('2026-02-28');
    expect(nextTaskDueDate(rule({ freq: 'yearly' }), '2028-02-29', '2028-02-29', 1)).toBe('2029-02-28');
  });

  it('stops at the end of the series', () => {
    expect(nextTaskDueDate(rule({ end: { kind: 'until', date: '2026-03-02' } }), '2026-03-01', '2026-03-01', 1))
      .toBe('2026-03-02');
    expect(nextTaskDueDate(rule({ end: { kind: 'until', date: '2026-03-02' } }), '2026-03-01', '2026-03-02', 2))
      .toBeNull();
    expect(nextTaskDueDate(rule({ end: { kind: 'count', count: 2 } }), '2026-03-01', '2026-03-02', 2)).toBeNull();
  });
});
