import { describe, expect, it } from 'vitest';
import type { Plant } from './plant-model';
import {
  DAY_MS,
  freshnessWindowDays,
  plantDueAt,
  plantSchedule,
  plantStatusForDays,
  plantStatusKey,
  sortPlantsByThirst,
  wateringGap,
  wiltingWindowDays,
  wiltProgressFor,
  type PlantSchedule
} from './plant-status';

function plant(overrides: Partial<Plant> = {}): Plant {
  return {
    id: 'plant-1',
    name: 'Monstera',
    species: 'monstera',
    wateringIntervalDays: 10,
    lastWateredAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function schedule(overrides: Partial<PlantSchedule> = {}): PlantSchedule {
  return {
    status: 'healthy',
    wiltProgress: 0,
    daysSinceWatering: 0,
    daysUntilDue: 5,
    calendarDaysUntilDue: 5,
    overdueDays: 0,
    dueAt: new Date('2026-01-11T00:00:00.000Z'),
    ...overrides
  };
}

describe('watering windows', () => {
  it('keeps both windows inside their sane bounds for every cadence', () => {
    for (const interval of [1, 2, 5, 7, 10, 14, 30, 60]) {
      const fresh = freshnessWindowDays(interval);
      expect(fresh).toBeGreaterThanOrEqual(1);
      expect(fresh).toBeLessThanOrEqual(5);
      const wilt = wiltingWindowDays(interval);
      expect(wilt).toBeGreaterThanOrEqual(2);
      expect(wilt).toBeLessThanOrEqual(14);
    }
  });

  it('gives a fortnightly plant the longest freshness window', () => {
    expect(freshnessWindowDays(60)).toBe(5);
    expect(wiltingWindowDays(60)).toBe(14);
    expect(freshnessWindowDays(1)).toBe(1);
    expect(wiltingWindowDays(1)).toBe(2);
  });
});

describe('wiltProgressFor', () => {
  it('is flat and zero while the plant is still fresh', () => {
    const interval = 10;
    expect(wiltProgressFor(freshnessWindowDays(interval) + 0.01, interval)).toBe(0);
    expect(wiltProgressFor(freshnessWindowDays(interval), interval)).toBe(0);
    expect(wiltProgressFor(30, interval)).toBe(0);
  });

  it('anchors the curve at its documented stops', () => {
    const interval = 10;
    const grace = wiltingWindowDays(interval);
    expect(wiltProgressFor(0, interval)).toBe(0.35);
    expect(wiltProgressFor(-grace, interval)).toBe(0.8);
  });

  it('rises monotonically and never jumps as the due date recedes', () => {
    const interval = 14;
    let previous = -1;
    let last = 0;
    for (let daysUntilDue = 12; daysUntilDue >= -90; daysUntilDue -= 0.05) {
      const value = wiltProgressFor(daysUntilDue, interval);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      if (previous >= 0) expect(Math.abs(value - previous)).toBeLessThan(0.01);
      previous = value;
      last = value;
    }
  });

  it('approaches but never reaches a fully dead plant', () => {
    const grace = wiltingWindowDays(7);
    const deep = wiltProgressFor(-grace * 3, 7);
    expect(deep).toBeLessThan(1);
    expect(deep).toBeGreaterThan(0.95);
    expect(wiltProgressFor(-grace * 30, 7)).toBeGreaterThanOrEqual(deep);
  });
});

describe('plantStatusForDays', () => {
  it('names the four statuses at their thresholds', () => {
    const interval = 14;
    const window = freshnessWindowDays(interval);
    const grace = wiltingWindowDays(interval);
    expect(plantStatusForDays(window + 0.01, interval)).toBe('healthy');
    expect(plantStatusForDays(window, interval)).toBe('dueSoon');
    expect(plantStatusForDays(0.01, interval)).toBe('dueSoon');
    expect(plantStatusForDays(0, interval)).toBe('needsWater');
    expect(plantStatusForDays(-grace, interval)).toBe('needsWater');
    expect(plantStatusForDays(-grace - 0.01, interval)).toBe('wilted');
  });

  it('maps each status to its translation key', () => {
    expect(['healthy', 'dueSoon', 'needsWater', 'wilted'].map((status) => plantStatusKey(status as PlantSchedule['status']))).toEqual([
      'plant.status.healthy',
      'plant.status.dueSoon',
      'plant.status.needsWater',
      'plant.status.wilted'
    ]);
  });
});

describe('plantSchedule', () => {
  it('reads the state from the stored timestamp and the clock', () => {
    const lastWateredAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(lastWateredAt.getTime() + 12 * DAY_MS);
    const result = plantSchedule(plant({ lastWateredAt: lastWateredAt.toISOString(), wateringIntervalDays: 10 }), now);
    expect(result.daysSinceWatering).toBeCloseTo(12, 5);
    expect(result.daysUntilDue).toBeCloseTo(-2, 5);
    expect(result.overdueDays).toBeCloseTo(2, 5);
    expect(result.status).toBe('needsWater');
    expect(result.dueAt.toISOString()).toBe(new Date(lastWateredAt.getTime() + 10 * DAY_MS).toISOString());
  });

  it('treats a plant watered seconds ago as freshly healthy', () => {
    const now = new Date('2026-05-05T09:00:00.000Z');
    const result = plantSchedule(plant({ lastWateredAt: now.toISOString(), wateringIntervalDays: 7 }), now);
    expect(result.daysSinceWatering).toBe(0);
    expect(result.status).toBe('healthy');
    expect(result.wiltProgress).toBe(0);
  });
});

describe('plantDueAt', () => {
  it('falls back to now for an unusable timestamp', () => {
    const before = Date.now();
    const due = plantDueAt({ lastWateredAt: 'not-a-date', wateringIntervalDays: 4 });
    const after = Date.now();
    expect(due.getTime()).toBeGreaterThanOrEqual(before + 4 * DAY_MS);
    expect(due.getTime()).toBeLessThanOrEqual(after + 4 * DAY_MS);
  });
});

describe('sortPlantsByThirst', () => {
  it('lists the thirstiest plant first and breaks ties by name', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const fresh = plant({ id: 'fresh', name: 'Fresh', wateringIntervalDays: 10, lastWateredAt: now.toISOString() });
    const dry = plant({
      id: 'dry',
      name: 'Dry',
      wateringIntervalDays: 10,
      lastWateredAt: new Date(now.getTime() - 14 * DAY_MS).toISOString()
    });
    const soon = plant({
      id: 'soon',
      name: 'Soon',
      wateringIntervalDays: 10,
      lastWateredAt: new Date(now.getTime() - 9 * DAY_MS).toISOString()
    });
    expect(sortPlantsByThirst([fresh, dry, soon], now).map((item) => item.id)).toEqual(['dry', 'soon', 'fresh']);
  });

  it('does not mutate the caller array', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const items = [plant({ id: 'a' }), plant({ id: 'b' })];
    const snapshot = items.map((item) => item.id);
    sortPlantsByThirst(items, now);
    expect(items.map((item) => item.id)).toEqual(snapshot);
  });
});

describe('wateringGap', () => {
  it('phrases the gap in days, today, or overdue', () => {
    expect(wateringGap(schedule({ calendarDaysUntilDue: 3 }))).toEqual({ key: 'plantSchedule.inDays', days: 3 });
    expect(wateringGap(schedule({ calendarDaysUntilDue: 1 }))).toEqual({ key: 'plantSchedule.inDays', days: 1 });
    expect(wateringGap(schedule({ calendarDaysUntilDue: 0 }))).toEqual({ key: 'plantSchedule.dueToday', days: 0 });
    expect(wateringGap(schedule({ calendarDaysUntilDue: -1 }))).toEqual({ key: 'plantSchedule.overdue', days: 1 });
    expect(wateringGap(schedule({ calendarDaysUntilDue: -2 }))).toEqual({ key: 'plantSchedule.overdue', days: 2 });
  });

  // The reported bug: watered on the 1st with a 6-day cadence, the plant is due
  // on the 7th, so two days later the module owes the user "4 days".
  it('counts calendar days instead of 24-hour spans', () => {
    const watered = new Date(2026, 10, 22, 9, 56);
    const now = new Date(2026, 10, 24, 8, 0);
    const gap = wateringGap(plantSchedule({ lastWateredAt: watered.toISOString(), wateringIntervalDays: 6 }, now));
    expect(gap).toEqual({ key: 'plantSchedule.inDays', days: 4 });
  });

  it('reports the due day as today and the day after as one day overdue', () => {
    const watered = new Date(2026, 10, 22, 9, 56);
    const dueDay = new Date(2026, 10, 28, 1, 0);
    const dayAfter = new Date(2026, 10, 29, 1, 0);
    expect(wateringGap(plantSchedule({ lastWateredAt: watered.toISOString(), wateringIntervalDays: 6 }, dueDay)))
      .toEqual({ key: 'plantSchedule.dueToday', days: 0 });
    expect(wateringGap(plantSchedule({ lastWateredAt: watered.toISOString(), wateringIntervalDays: 6 }, dayAfter)))
      .toEqual({ key: 'plantSchedule.overdue', days: 1 });
  });
});
