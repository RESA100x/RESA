import { t } from '../i18n';

// Species are stored by stable id, never by their label, so a plant keeps its
// illustration and its animation when the interface language changes.
export const PLANT_SPECIES = ['monstera', 'snakePlant', 'yucca', 'croton', 'zzPlant'] as const;
export type PlantSpecies = (typeof PLANT_SPECIES)[number];

export function isPlantSpecies(value: unknown): value is PlantSpecies {
  return typeof value === 'string' && (PLANT_SPECIES as readonly string[]).includes(value);
}

export function normalizePlantSpecies(value: unknown): PlantSpecies {
  return isPlantSpecies(value) ? value : 'monstera';
}

export const PLANT_INTERVAL_MIN_DAYS = 1;
export const PLANT_INTERVAL_MAX_DAYS = 60;
export const PLANT_NAME_MAX_LENGTH = 60;

// How often each species wants water when it is healthy. Only used to prefill
// the interval field — the stored interval is always what the plant is judged
// by, so a user who knows their windowsill better than the book can override it.
const speciesDefaultInterval: Record<PlantSpecies, number> = {
  monstera: 7,
  snakePlant: 14,
  yucca: 10,
  croton: 5,
  zzPlant: 14
};

export function defaultIntervalDays(species: PlantSpecies): number {
  return speciesDefaultInterval[species];
}

export function speciesOptions(): Array<{ value: PlantSpecies; label: string; days: number }> {
  return PLANT_SPECIES.map((value) => ({ value, label: t(`plant.species.${value}`), days: speciesDefaultInterval[value] }));
}

export function clampIntervalDays(value: unknown): number {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days)) return speciesDefaultInterval.monstera;
  return Math.min(PLANT_INTERVAL_MAX_DAYS, Math.max(PLANT_INTERVAL_MIN_DAYS, days));
}

// Collapse the whitespace a paste can bring along: the name is shown on one
// line in the module.
export function normalizePlantName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, PLANT_NAME_MAX_LENGTH);
}

export type Plant = {
  id: string;
  name: string;
  species: PlantSpecies;
  wateringIntervalDays: number;
  // ISO timestamp of the last watering. Set when the plant is created, so every
  // plant starts healthy instead of unknown.
  lastWateredAt: string;
  createdAt: string;
  updatedAt: string;
};

export type PlantDraft = {
  name: string;
  species: PlantSpecies;
  wateringIntervalDays: number;
  lastWateredAt: string;
};
