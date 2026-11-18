// The watering state expressed as drawing instructions.
//
// One number — `wiltProgress` — reaches every species, but each species answers
// it in its own way: a monstera sags early and curls late, a sansevieria stands
// stiff and then folds, a croton loses its colour before its shape, a ZZ plant
// folds its leaflets and loses its gloss. The curves below are that difference.
import { bentSpine, clamp01, easeInCubic, easeOutCubic, lerp, ramp } from './species/geometry';

export type PlantAppearance = {
  saturation: number;
  brightness: number;
};

export function plantAppearance(wilt: number, saturationLoss = 0.42, brightnessLoss = 0.14): PlantAppearance {
  const value = clamp01(wilt);
  return { saturation: lerp(1, 1 - saturationLoss, value), brightness: lerp(1, 1 - brightnessLoss, value) };
}

// --- Monstera ---------------------------------------------------------------

const MONSTERA_LEAVES = [
  { angle: -62, petiole: 26, scale: 0.62, offset: 0.02 },
  { angle: -32, petiole: 38, scale: 0.86, offset: 0.1 },
  { angle: 2, petiole: 44, scale: 1, offset: 0.18 },
  { angle: 34, petiole: 37, scale: 0.85, offset: 0.1 },
  { angle: 63, petiole: 25, scale: 0.6, offset: 0.02 }
];

export type MonsteraLeafPose = {
  // Where the petiole meets the soil and where it now holds the blade.
  angle: number;
  petioleLength: number;
  spineBend: number;
  bladeScale: number;
  bladeTilt: number;
  // How far a shed leaf has fallen away from the plant.
  drop: number;
  opacity: number;
};

export type MonsteraPose = PlantAppearance & { leaves: MonsteraLeafPose[] };

export function monsteraPose(wilt: number): MonsteraPose {
  const value = clamp01(wilt);
  const tip = easeInCubic(ramp(value, 0.45, 1));
  const shed = ramp(value, 0.72, 1);
  return {
    ...plantAppearance(value, 0.45, 0.12),
    leaves: MONSTERA_LEAVES.map((leaf, index) => {
      // The outer leaves are the first to feel dry soil; the newest leaf in the
      // middle holds its posture longest.
      const local = easeOutCubic(ramp(value, leaf.offset, leaf.offset + 0.62));
      const direction = leaf.angle >= 0 ? 1 : -1;
      const falling = index === 0 ? shed : 0;
      return {
        angle: leaf.angle + direction * (26 * local + 12 * tip),
        petioleLength: leaf.petiole * (1 - 0.12 * local),
        spineBend: direction * (10 * local),
        bladeScale: leaf.scale * (1 + 0.03 * local),
        bladeTilt: direction * 18 * tip,
        drop: 26 * falling,
        opacity: 1 - 0.85 * falling
      };
    })
  };
}

// --- Sansevieria (snake plant) ---------------------------------------------

const SNAKE_BLADES = [
  { angle: -26, height: 56, width: 9, offset: 0.02 },
  { angle: -17, height: 66, width: 10, offset: 0.14 },
  { angle: -8, height: 74, width: 11, offset: 0.26 },
  { angle: 1, height: 78, width: 11, offset: 0.36 },
  { angle: 9, height: 72, width: 11, offset: 0.26 },
  { angle: 18, height: 64, width: 10, offset: 0.14 },
  { angle: 27, height: 54, width: 9, offset: 0.02 }
];

export type SnakeBladePose = { angle: number; height: number; width: number; bend: number };
export type SnakePlantPose = PlantAppearance & { blades: SnakeBladePose[] };

export function snakePlantPose(wilt: number): SnakePlantPose {
  const value = clamp01(wilt);
  return {
    ...plantAppearance(value, 0.4, 0.16),
    blades: SNAKE_BLADES.map((blade) => {
      const direction = blade.angle >= 0 ? 1 : -1;
      // Stiff first, folded later: a snake plant leans a little, then the tips
      // crease over instead of sagging from the base.
      const lean = easeInCubic(ramp(value, blade.offset, blade.offset + 0.75));
      const fold = easeInCubic(ramp(value, 0.32 + blade.offset * 0.6, 1));
      return {
        angle: Number((blade.angle * (1 + 0.5 * lean)).toFixed(2)),
        height: Number((blade.height * (1 - 0.06 * lean)).toFixed(2)),
        width: Number((blade.width * (1 - 0.12 * lean)).toFixed(2)),
        bend: Number((direction * (14 * lean + 48 * fold)).toFixed(2))
      };
    })
  };
}

// --- Yucca ------------------------------------------------------------------

export const YUCCA_TRUNK = { base: { x: 60, y: 84 }, length: 26, width: 11 };
const YUCCA_ROSETTES = [
  { at: { x: 60, y: 58 }, angles: [-78, -52, -26, 0, 24, 50, 76], length: 30 },
  { at: { x: 46, y: 64 }, angles: [-70, -30, 6, 42, 74], length: 24 },
  { at: { x: 74, y: 66 }, angles: [-74, -42, -6, 30, 70], length: 22 }
];

export type YuccaLeafPose = { base: { x: number; y: number }; angle: number; length: number; bend: number };
export type YuccaPose = PlantAppearance & { trunkLean: number; leaves: YuccaLeafPose[] };

export function yuccaPose(wilt: number): YuccaPose {
  const value = clamp01(wilt);
  const curl = easeInCubic(value);
  return {
    ...plantAppearance(value, 0.5, 0.16),
    // The woody trunk barely moves; the leaves carry the whole story.
    trunkLean: Number((3 * easeOutCubic(value)).toFixed(2)),
    leaves: YUCCA_ROSETTES.flatMap((rosette) =>
      rosette.angles.map((angle) => {
        const outer = Math.abs(angle) / 80;
        const sag = easeOutCubic(ramp(value, 0.04 + outer * 0.1, 1));
        return {
          base: rosette.at,
          angle: Number((angle * (1 + 0.22 * sag)).toFixed(2)),
          length: Number((rosette.length * (1 - 0.05 * sag)).toFixed(2)),
          bend: Number((Math.sign(angle || 1) * (24 * sag + 20 * curl) * (0.5 + outer)).toFixed(2))
        };
      })
    )
  };
}

// --- Croton -----------------------------------------------------------------

export const CROTON_COLORS = ['#C0392B', '#E08A2E', '#F2C14E', '#4E7A3A', '#E08A2E', '#C0392B'];
const CROTON_LEAVES = [
  { angle: -66, length: 30, width: 13, offset: 0.02 },
  { angle: -38, length: 38, width: 15, offset: 0.12 },
  { angle: -8, length: 42, width: 16, offset: 0.22 },
  { angle: 20, length: 40, width: 15, offset: 0.16 },
  { angle: 46, length: 34, width: 14, offset: 0.08 },
  { angle: 70, length: 28, width: 12, offset: 0.02 }
];

export type CrotonLeafPose = {
  angle: number;
  length: number;
  width: number;
  bend: number;
  color: string;
  drop: number;
  opacity: number;
};

export type CrotonPose = PlantAppearance & { leaves: CrotonLeafPose[] };

export function crotonPose(wilt: number): CrotonPose {
  const value = clamp01(wilt);
  return {
    // A croton's identity is its colour, so the colour goes first: by the time it
    // looks structurally sad, it has already gone muddy.
    ...plantAppearance(value, 0.72, 0.18),
    leaves: CROTON_LEAVES.map((leaf, index) => {
      const direction = leaf.angle >= 0 ? 1 : -1;
      const local = easeOutCubic(ramp(value, leaf.offset, leaf.offset + 0.7));
      const falling = index === 0 || index === CROTON_LEAVES.length - 1 ? ramp(value, 0.6, 1) : 0;
      return {
        angle: leaf.angle + direction * 30 * local,
        length: leaf.length * (1 - 0.06 * local),
        width: leaf.width * (1 - 0.14 * local),
        bend: direction * 18 * local,
        color: CROTON_COLORS[index],
        drop: 30 * falling,
        opacity: 1 - 0.9 * falling
      };
    })
  };
}

// --- Zamioculcas (ZZ plant) -------------------------------------------------

const ZZ_STEMS = [
  { angle: -22, length: 62, offset: 0.08 },
  { angle: -8, length: 72, offset: 0.2 },
  { angle: 8, length: 70, offset: 0.2 },
  { angle: 22, length: 60, offset: 0.08 }
];

export type ZzLeafletPose = { at: { x: number; y: number }; angle: number; scale: number };
export type ZzStemPose = { spine: Array<{ x: number; y: number }>; leaflets: ZzLeafletPose[] };
export type ZzPose = PlantAppearance & { gloss: number; stems: ZzStemPose[] };

export function zzPlantPose(wilt: number): ZzPose {
  const value = clamp01(wilt);
  return {
    ...plantAppearance(value, 0.32, 0.12),
    // The waxy sheen is what a ZZ plant shows off; it is the first thing to go.
    gloss: clamp01(1 - 0.9 * easeOutCubic(value)),
    stems: ZZ_STEMS.map((stem) => {
      const direction = stem.angle >= 0 ? 1 : -1;
      const lean = easeOutCubic(ramp(value, stem.offset, stem.offset + 0.7));
      const spine = bentSpine({ x: 60, y: 84 }, stem.angle, stem.length * (1 - 0.04 * lean), direction * 9 * lean, 6);
      const leaflets: ZzLeafletPose[] = [];
      const count = 7;
      for (let index = 0; index < count; index += 1) {
        const t = 0.32 + (index / (count - 1)) * 0.68;
        const point = spine[Math.min(spine.length - 1, Math.round(t * (spine.length - 1)))];
        const side = index % 2 === 0 ? -1 : 1;
        // Upper leaflets hang first, and the fold runs down the stem.
        const local = easeInCubic(ramp(value, stem.offset + (1 - t) * 0.3, 1));
        leaflets.push({
          at: point,
          angle: Number((stem.angle + side * (52 + 46 * local)).toFixed(2)),
          scale: Number((1 - 0.14 * local).toFixed(2))
        });
      }
      return { spine, leaflets };
    })
  };
}
