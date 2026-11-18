import type { Plant } from './plant-model';
import { clampIntervalDays } from './plant-model';

export const DAY_MS = 86_400_000;

export type PlantWaterStatus = 'healthy' | 'dueSoon' | 'needsWater' | 'wilted';

// A plant's whole visual state comes from this: `wiltProgress` is the single
// number the illustration animates on, and the status is the word shown next to
// it. Both are derived from the real clock, never from a counter.
export type PlantSchedule = {
  status: PlantWaterStatus;
  // 0 = fully turgid, 1 = completely wilted.
  wiltProgress: number;
  daysSinceWatering: number;
  // Negative once the due date has passed.
  daysUntilDue: number;
  overdueDays: number;
  dueAt: Date;
};

// How long before the due date the plant starts to look thirsty. A fifth of the
// cadence keeps a frequently watered plant (a croton on five days) responsive
// without making a fortnightly plant look sad for a whole week.
export function freshnessWindowDays(intervalDays: number): number {
  return Math.min(5, Math.max(1, Math.round(intervalDays / 5)));
}

// After the due date the plant keeps fading for this long before it counts as
// fully wilted. A fifth of the cadence would be too abrupt on short intervals,
// so the window is at least two days and at most a fortnight.
export function wiltingWindowDays(intervalDays: number): number {
  return Math.min(14, Math.max(2, Math.round(intervalDays / 3)));
}

export function plantDueAt(plant: Pick<Plant, 'lastWateredAt' | 'wateringIntervalDays'>): Date {
  const watered = new Date(plant.lastWateredAt).getTime();
  const base = Number.isFinite(watered) ? watered : Date.now();
  return new Date(base + clampIntervalDays(plant.wateringIntervalDays) * DAY_MS);
}

export function plantStatusForDays(daysUntilDue: number, intervalDays: number): PlantWaterStatus {
  const window = freshnessWindowDays(intervalDays);
  const grace = wiltingWindowDays(intervalDays);
  if (daysUntilDue > window) return 'healthy';
  if (daysUntilDue > 0) return 'dueSoon';
  if (daysUntilDue >= -grace) return 'needsWater';
  return 'wilted';
}

// Piecewise, continuous and monotonic: dry plants fade through the freshness
// window, keep fading through the wilting window, then approach (but never
// reach) total collapse, so a forgotten plant cannot look worse than dead.
export function wiltProgressFor(daysUntilDue: number, intervalDays: number): number {
  const window = freshnessWindowDays(intervalDays);
  const grace = wiltingWindowDays(intervalDays);
  if (daysUntilDue >= window) return 0;
  if (daysUntilDue >= 0) return (1 - daysUntilDue / window) * 0.35;
  const overdue = -daysUntilDue;
  if (overdue <= grace) return 0.35 + (overdue / grace) * 0.45;
  return 0.8 + 0.2 * (1 - Math.exp(-(overdue - grace) / grace));
}

export function plantSchedule(
  plant: Pick<Plant, 'lastWateredAt' | 'wateringIntervalDays'>,
  now: Date = new Date()
): PlantSchedule {
  const interval = clampIntervalDays(plant.wateringIntervalDays);
  const watered = new Date(plant.lastWateredAt).getTime();
  const base = Number.isFinite(watered) ? watered : now.getTime();
  const daysSinceWatering = Math.max(0, (now.getTime() - base) / DAY_MS);
  const daysUntilDue = interval - daysSinceWatering;
  return {
    status: plantStatusForDays(daysUntilDue, interval),
    wiltProgress: wiltProgressFor(daysUntilDue, interval),
    daysSinceWatering,
    daysUntilDue,
    overdueDays: Math.max(0, -daysUntilDue),
    dueAt: new Date(base + interval * DAY_MS)
  };
}

// Thirstiest first: the module reads top-down as "what needs me now", and a
// wilted plant outranks one that only just came due.
export function sortPlantsByThirst(plants: Plant[], now: Date = new Date()): Plant[] {
  return [...plants].sort((left, right) => {
    const leftSchedule = plantSchedule(left, now);
    const rightSchedule = plantSchedule(right, now);
    if (leftSchedule.wiltProgress !== rightSchedule.wiltProgress) return rightSchedule.wiltProgress - leftSchedule.wiltProgress;
    return left.name.localeCompare(right.name);
  });
}

export function plantStatusKey(status: PlantWaterStatus): string {
  return `plant.status.${status}`;
}

// What to print under the plant name: "due in 3 days", "due today" or
// "3 days overdue", resolved through i18n by the caller.
export function wateringGap(schedule: PlantSchedule): { key: string; days: number } {
  if (schedule.daysUntilDue <= 0) {
    const overdue = Math.floor(schedule.overdueDays);
    return overdue >= 1 ? { key: 'plantSchedule.overdue', days: overdue } : { key: 'plantSchedule.dueToday', days: 0 };
  }
  const due = Math.ceil(schedule.daysUntilDue);
  return due <= 0 ? { key: 'plantSchedule.dueToday', days: 0 } : { key: 'plantSchedule.inDays', days: due };
}
