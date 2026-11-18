import type { PlantSpecies } from '../plant-model';
import { CROTON_ART } from './croton-art';
import { MONSTERA_ART } from './monstera-art';
import { SNAKE_PLANT_ART } from './snake-plant-art';
import { YUCCA_ART } from './yucca-art';
import { ZZ_PLANT_ART } from './zz-plant-art';
import type { PlantArtworkData } from './PlantArtwork';

// One row per species. Every plant in the module is now a designer's drawing, so
// there is no per-species component to wire up: adding a species means running
// scripts/plants-art.mjs, adding one import and one line here.
export const PLANT_ARTWORK: Record<PlantSpecies, PlantArtworkData> = {
  monstera: MONSTERA_ART,
  yucca: YUCCA_ART,
  snakePlant: SNAKE_PLANT_ART,
  croton: CROTON_ART,
  zzPlant: ZZ_PLANT_ART
};
