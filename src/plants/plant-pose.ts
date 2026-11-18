// The watering state expressed as drawing instructions.
//
// Every plant in the module is drawn by an artist now, so only one instruction
// is left: how much colour the drawing has lost. One number — `wiltProgress` —
// reaches the illustration, and it comes back out as a single CSS filter.
// Nothing in the drawing moves.
import { clamp01 } from './species/palette';

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

export type PlantAppearance = {
  saturation: number;
  brightness: number;
  // Degrees of hue rotation as the plant dries: green drifts towards yellow
  // before it goes grey, which is what a thirsty leaf actually does.
  hue: number;
};

export function plantAppearance(wilt: number, saturationLoss = 0.42, brightnessLoss = 0.14, hueDrift = 12): PlantAppearance {
  const value = clamp01(wilt);
  return {
    saturation: lerp(1, 1 - saturationLoss, value),
    brightness: lerp(1, 1 - brightnessLoss, value),
    hue: -hueDrift * value
  };
}

// A drawing a designer made keeps its shape when the plant gets dry: a leaf that
// was drawn by hand stops being that leaf the moment code rotates or bends it.
// Every drawn species therefore shares one aging curve, and it only touches
// colour - the green drains towards yellow, then goes dull.
export function designerAppearance(wilt: number): PlantAppearance {
  return plantAppearance(wilt, 0.55, 0.18, 14);
}

// One string for every drawn plant, so a thirsty plant looks equally thirsty
// whichever artwork it came from.
export function agingFilter({ saturation, brightness, hue }: PlantAppearance): string {
  return `saturate(${saturation.toFixed(3)}) brightness(${brightness.toFixed(3)}) hue-rotate(${hue.toFixed(1)}deg)`;
}
