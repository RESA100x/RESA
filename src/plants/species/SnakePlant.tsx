import { leafPath, type Pt } from './geometry';
import type { SnakePlantPose } from '../plant-pose';

const BASE: Pt = { x: 60, y: 84 };

export function SnakePlant({ pose }: { pose: SnakePlantPose }) {
  // Outermost blades first so the plant reads as a rosette instead of a fan.
  const blades = [...pose.blades].sort((left, right) => Math.abs(right.angle) - Math.abs(left.angle));
  return (
    <g data-plant-part="foliage">
      {blades.map((blade, index) => (
        <g key={index} data-plant-part="blade">
          {/* The pale margin is a wider blade underneath the dark centre, which
              is how a sansevieria is banded without a second drawing. */}
          <path
            d={leafPath({ base: BASE, angleDeg: blade.angle, length: blade.height, width: blade.width, bendDeg: blade.bend, profile: 'sword', segments: 6 })}
            fill="#B9CFA0"
          />
          <path
            d={leafPath({ base: BASE, angleDeg: blade.angle, length: blade.height * 0.95, width: blade.width * 0.52, bendDeg: blade.bend, profile: 'sword', segments: 6 })}
            fill="#3F6B4B"
          />
        </g>
      ))}
    </g>
  );
}
