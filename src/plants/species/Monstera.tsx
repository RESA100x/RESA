import { useId } from 'react';
import { leafPath, ribbonPath, spine, transformAt, type Pt } from './geometry';
import type { MonsteraPose } from '../plant-pose';

const BASE: Pt = { x: 60, y: 84 };

// One leaf shape, reused by every leaf: the silhouette is fixed and the pose
// only moves and turns it, which is what lets a single mask (with the splits
// cut into it) serve the whole plant.
const BLADE = leafPath({ base: { x: 0, y: 0 }, angleDeg: 0, length: 52, width: 46, profile: 'round', segments: 6 });
const SPLITS = [
  'M 26 -9 L 9 -13 L 26 -17 Z',
  'M 26 -22 L 10 -26 L 26 -30 Z',
  'M -26 -9 L -9 -13 L -26 -17 Z',
  'M -26 -22 L -10 -26 L -26 -30 Z'
];

export function Monstera({ pose }: { pose: MonsteraPose }) {
  const maskId = useId();
  return (
    <g data-plant-part="foliage">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-30" y="-56" width="60" height="60">
          <path d={BLADE} fill="#fff" />
          {SPLITS.map((split) => (
            <path key={split} d={split} fill="#000" />
          ))}
          <ellipse cx="9" cy="-31" rx="2.6" ry="4.2" fill="#000" />
          <ellipse cx="-9" cy="-31" rx="2.6" ry="4.2" fill="#000" />
        </mask>
      </defs>
      {pose.leaves.map((leaf, index) => {
        const petiole = spine({ base: BASE, angleDeg: leaf.angle, length: leaf.petioleLength, bendDeg: leaf.spineBend, segments: 4 });
        const tip = petiole[petiole.length - 1];
        const widths = petiole.map((_, step) => 4.6 - step * 0.6);
        return (
          <g key={index} data-plant-part="leaf" data-leaf-index={index}>
            <path d={ribbonPath(petiole, widths)} fill="#3B6B4A" />
            <g transform={`translate(0 ${leaf.drop})`} opacity={leaf.opacity}>
              <g transform={transformAt(tip, leaf.angle + leaf.bladeTilt, leaf.bladeScale)}>
                <path d={BLADE} fill="#3E7D4F" mask={`url(#${maskId})`} />
                <path d="M 0 0 L 0 -46" stroke="#2C5C39" strokeWidth="1.6" strokeLinecap="round" opacity="0.75" />
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
}
