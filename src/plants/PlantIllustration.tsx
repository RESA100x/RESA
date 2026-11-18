import { t } from '../i18n';
import { normalizePlantSpecies, type PlantSpecies } from './plant-model';
import { clamp01 } from './species/palette';
import { PlantArtwork } from './species/PlantArtwork';
import { PLANT_ARTWORK } from './species/artwork';
import { useWiltProgress } from './useWiltProgress';

export type PlantIllustrationProps = {
  species: PlantSpecies | string;
  // 0 = freshly watered, 1 = long overdue. The illustration walks to the new
  // value instead of cutting to it.
  wiltProgress: number;
  name?: string;
  animate?: boolean;
  className?: string;
};

// Each plant is framed by its own drawing instead of a shared square: a
// sansevieria is tall and narrow, a monstera is wide and low, and a croton is a
// compact bush. The generated modules carry the drawn bounds of the artwork plus
// a small margin, so nothing is ever clipped and every plant fills as much of
// the block as its own shape allows.
export function PlantIllustration({ species, wiltProgress, name, animate = true, className }: PlantIllustrationProps) {
  const plant = normalizePlantSpecies(species);
  const wilt = useWiltProgress(clamp01(wiltProgress), animate);
  const speciesLabel = t(`plant.species.${plant}`);
  const label = name?.trim() ? `${name.trim()} · ${speciesLabel}` : speciesLabel;
  const art = PLANT_ARTWORK[plant];

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={art.viewBox}
      preserveAspectRatio="xMidYMid meet"
      className={className ? `plant-illustration ${className}` : 'plant-illustration'}
      data-plant-species={plant}
      data-wilt={wilt.toFixed(3)}
    >
      <PlantArtwork art={art} wilt={wilt} />
    </svg>
  );
}
