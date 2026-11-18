import { describe, expect, it } from 'vitest';
import type { Plant } from './plant-model';
import { defaultIntervalDays } from './plant-model';
import { createPlantForm, isPlantFormDirty, plantToForm, toPlantDraft, validatePlantForm } from './plant-draft';

const NOW = new Date('2026-04-04T08:30:00.000Z');

function plant(overrides: Partial<Plant> = {}): Plant {
  return {
    id: 'plant-1',
    name: 'Corner monstera',
    species: 'snakePlant',
    wateringIntervalDays: 9,
    lastWateredAt: '2026-04-01T07:00:00.000Z',
    createdAt: '2026-04-01T07:00:00.000Z',
    updatedAt: '2026-04-01T07:00:00.000Z',
    ...overrides
  };
}

describe('createPlantForm', () => {
  it('starts a new plant healthy, watered now, with the species cadence', () => {
    const form = createPlantForm('monstera', NOW);
    expect(form.name).toBe('');
    expect(form.species).toBe('monstera');
    expect(form.wateringIntervalDays).toBe(defaultIntervalDays('monstera'));
    expect(form.lastWateredAt).toBe(NOW.toISOString());
  });

  it('prefills the interval of the chosen species', () => {
    expect(createPlantForm('croton', NOW).wateringIntervalDays).toBe(defaultIntervalDays('croton'));
    expect(createPlantForm('zzPlant', NOW).wateringIntervalDays).toBe(defaultIntervalDays('zzPlant'));
  });
});

describe('plantToForm', () => {
  it('copies the stored plant into an editable form', () => {
    const form = plantToForm(plant());
    expect(form).toEqual({
      name: 'Corner monstera',
      species: 'snakePlant',
      wateringIntervalDays: 9,
      lastWateredAt: '2026-04-01T07:00:00.000Z'
    });
  });
});

describe('validatePlantForm', () => {
  it('accepts a complete form', () => {
    expect(validatePlantForm({ ...createPlantForm('yucca', NOW), name: 'Corner yucca' })).toEqual({});
  });

  it('rejects a blank name', () => {
    expect(validatePlantForm({ ...createPlantForm('yucca', NOW), name: '   ' })).toHaveProperty('name');
  });

  it('rejects an unknown species, an out-of-range interval and a bad date', () => {
    const base = createPlantForm('yucca', NOW);
    expect(validatePlantForm({ ...base, species: 'banana' as never })).toHaveProperty('species');
    expect(validatePlantForm({ ...base, wateringIntervalDays: 0 })).toHaveProperty('wateringIntervalDays');
    expect(validatePlantForm({ ...base, wateringIntervalDays: 61 })).toHaveProperty('wateringIntervalDays');
    expect(validatePlantForm({ ...base, lastWateredAt: 'whenever' })).toHaveProperty('lastWateredAt');
  });
});

describe('toPlantDraft', () => {
  it('collapses whitespace, normalizes the species and clamps the interval', () => {
    const draft = toPlantDraft({
      name: '  Window   Side  ',
      species: 'banana' as never,
      wateringIntervalDays: 999,
      lastWateredAt: '2026-04-04T08:30:00.000Z'
    });
    expect(draft.name).toBe('Window Side');
    expect(draft.species).toBe('monstera');
    expect(draft.wateringIntervalDays).toBe(60);
  });
});

describe('isPlantFormDirty', () => {
  it('detects any edit against the initial form', () => {
    const initial = createPlantForm('monstera', NOW);
    expect(isPlantFormDirty(initial, initial)).toBe(false);
    expect(isPlantFormDirty(initial, { ...initial, name: 'x' })).toBe(true);
    expect(isPlantFormDirty(initial, { ...initial, wateringIntervalDays: 8 })).toBe(true);
  });
});
