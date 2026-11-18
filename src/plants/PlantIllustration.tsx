import type { ReactNode } from 'react';
import { t } from '../i18n';
import { normalizePlantSpecies, type PlantSpecies } from './plant-model';
import { crotonPose, monsteraPose, snakePlantPose, yuccaPose, zzPlantPose } from './plant-pose';
import { clamp01 } from './species/geometry';
import { useWiltProgress } from './useWiltProgress';
import { Croton } from './species/Croton';
import { Monstera } from './species/Monstera';
import { PlantPot } from './species/pot';
import { SnakePlant } from './species/SnakePlant';
import { Yucca } from './species/Yucca';
import { ZzPlant } from './species/ZzPlant';

export type PlantIllustrationProps = {
  species: PlantSpecies | string;
  // 0 = freshly watered, 1 = long overdue. The illustration walks to the new
  // value instead of cutting to it.
  wiltProgress: number;
  name?: string;
  animate?: boolean;
  className?: string;
};

type Frame = { saturation: number; brightness: number; node: ReactNode };

// One entry per species: the pose functions carry all the arithmetic, the
// components only draw. Adding a plant means adding one row here and one file
// beside the others — nothing in the module has to learn about it.
const illustrations: Record<PlantSpecies, (wilt: number) => Frame> = {
  monstera: (wilt) => {
    const pose = monsteraPose(wilt);
    return { saturation: pose.saturation, brightness: pose.brightness, node: <Monstera pose={pose} /> };
  },
  snakePlant: (wilt) => {
    const pose = snakePlantPose(wilt);
    return { saturation: pose.saturation, brightness: pose.brightness, node: <SnakePlant pose={pose} /> };
  },
  yucca: (wilt) => {
    const pose = yuccaPose(wilt);
    return { saturation: pose.saturation, brightness: pose.brightness, node: <Yucca pose={pose} /> };
  },
  croton: (wilt) => {
    const pose = crotonPose(wilt);
    return { saturation: pose.saturation, brightness: pose.brightness, node: <Croton pose={pose} /> };
  },
  zzPlant: (wilt) => {
    const pose = zzPlantPose(wilt);
    return { saturation: pose.saturation, brightness: pose.brightness, node: <ZzPlant pose={pose} /> };
  }
};

export function PlantIllustration({ species, wiltProgress, name, animate = true, className }: PlantIllustrationProps) {
  const plant = normalizePlantSpecies(species);
  const wilt = useWiltProgress(clamp01(wiltProgress), animate);
  const speciesLabel = t(`plant.species.${plant}`);
  const label = name?.trim() ? `${name.trim()} · ${speciesLabel}` : speciesLabel;
  const { saturation, brightness, node } = illustrations[plant](wilt);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 120 120"
      preserveAspectRatio="xMidYMid meet"
      className={className ? `plant-illustration ${className}` : 'plant-illustration'}
      data-plant-species={plant}
      data-wilt={wilt.toFixed(3)}
    >
      {/* Saturating and brightening the whole plant at once keeps every leaf on
          the same footing as it fades. */}
      <g data-plant-part="wilting" style={{ filter: `saturate(${saturation.toFixed(3)}) brightness(${brightness.toFixed(3)})` }}>
        {node}
      </g>
      <PlantPot />
    </svg>
  );
}
