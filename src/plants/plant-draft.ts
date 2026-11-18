import { t } from '../i18n';
import {
  clampIntervalDays,
  defaultIntervalDays,
  normalizePlantName,
  normalizePlantSpecies,
  PLANT_INTERVAL_MAX_DAYS,
  PLANT_INTERVAL_MIN_DAYS,
  type Plant,
  type PlantDraft,
  type PlantSpecies
} from './plant-model';

export type PlantFormDraft = PlantDraft;
export type PlantFieldErrors = Partial<Record<keyof PlantDraft, string>>;

// A new plant counts as watered today: every plant starts fresh, so the module
// never opens on a row that says "unknown".
export function createPlantForm(species: PlantSpecies = 'monstera', now: Date = new Date()): PlantFormDraft {
  return {
    name: '',
    species,
    wateringIntervalDays: defaultIntervalDays(species),
    lastWateredAt: now.toISOString()
  };
}

export function plantToForm(plant: Plant): PlantFormDraft {
  return {
    name: plant.name,
    species: plant.species,
    wateringIntervalDays: plant.wateringIntervalDays,
    lastWateredAt: plant.lastWateredAt
  };
}

export function validatePlantForm(form: PlantFormDraft): PlantFieldErrors {
  const errors: PlantFieldErrors = {};
  if (!normalizePlantName(form.name)) errors.name = t('plantDialog.errorName');
  const species = form.species;
  if (normalizePlantSpecies(species) !== species) errors.species = t('plantDialog.errorSpecies');
  const interval = Number(form.wateringIntervalDays);
  if (!Number.isFinite(interval) || interval < PLANT_INTERVAL_MIN_DAYS || interval > PLANT_INTERVAL_MAX_DAYS) {
    errors.wateringIntervalDays = t('plantDialog.errorInterval');
  }
  if (!Number.isFinite(new Date(form.lastWateredAt).getTime())) errors.lastWateredAt = t('plantDialog.errorLastWatered');
  return errors;
}

export function toPlantDraft(form: PlantFormDraft): PlantDraft {
  return {
    name: normalizePlantName(form.name),
    species: normalizePlantSpecies(form.species),
    wateringIntervalDays: clampIntervalDays(form.wateringIntervalDays),
    lastWateredAt: form.lastWateredAt
  };
}

export function isPlantFormDirty(initial: PlantFormDraft, current: PlantFormDraft): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}
