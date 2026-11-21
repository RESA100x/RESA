import { describe, expect, it } from 'vitest';
import { groupByWeek, hasActivity, peakValue, totalFocusSeconds, type ReportDay, type TaskReport } from './report-model';

function day(date: string, created = 0, completed = 0, focusSeconds = 0): ReportDay {
  return { date, created, completed, focusSeconds };
}

function report(overrides: Partial<TaskReport['totals']> = {}): TaskReport {
  return {
    days: [],
    totals: {
      created: 0,
      completed: 0,
      open: 0,
      overdue: 0,
      archived: 0,
      completionRate: 0,
      averageCloseDays: null,
      medianCloseDays: null,
      ...overrides
    },
    quadrants: [],
    lanes: [],
    projects: [],
    stuck: [],
    meetings: [],
    activity: [],
    previous: { created: 0, completed: 0, archived: 0, averageCloseDays: null },
    generatedAt: 't'
  };
}

describe('report weeks', () => {
  // 2026-11-14 is a Saturday; the Persian week starts there.
  const days = [
    day('2026-11-12', 1, 0, 0),
    day('2026-11-13', 0, 2, 0),
    day('2026-11-14', 3, 1, 600),
    day('2026-11-15', 0, 1, 300),
    day('2026-11-20', 2, 0, 0),
    day('2026-11-21', 1, 4, 0)
  ];

  it('starts a new bucket on the chosen week day and keeps the leading partial week', () => {
    const weeks = groupByWeek(days, 6);
    expect(weeks.map((week) => [week.start, week.end])).toEqual([
      ['2026-11-12', '2026-11-13'],
      ['2026-11-14', '2026-11-20'],
      ['2026-11-21', '2026-11-21']
    ]);
    expect(weeks[1]).toMatchObject({ created: 5, completed: 2, focusSeconds: 900 });
  });

  it('groups by Sunday when that is the week start', () => {
    const weeks = groupByWeek(days, 0);
    expect(weeks.map((week) => week.start)).toEqual(['2026-11-12', '2026-11-15']);
  });

  it('scales the chart from the tallest bar and never divides by zero', () => {
    expect(peakValue(groupByWeek(days, 6))).toBe(5);
    expect(peakValue([])).toBe(1);
  });

  it('sums focus time and detects an empty report', () => {
    expect(totalFocusSeconds(days)).toBe(900);
    expect(hasActivity(report())).toBe(false);
    expect(hasActivity(report({ open: 1 }))).toBe(true);
  });
});
