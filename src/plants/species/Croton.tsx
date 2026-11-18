import { leafPath, ribbonPath, bentSpine, transformAt, type Pt } from './geometry';
import type { CrotonPose } from '../plant-pose';

const BASE: Pt = { x: 60, y: 84 };
const SPECKLES: Array<[number, number]> = [
  [-3.4, -16],
  [3.6, -22],
  [-1.2, -28]
];

export function Croton({ pose }: { pose: CrotonPose }) {
  const stem = bentSpine(BASE, 0, 24, 0, 3);
  return (
    <g data-plant-part="foliage">
      <path d={ribbonPath(stem, [9, 8, 7.4, 7])} fill="#5B4632" />
      {pose.leaves.map((leaf, index) => (
        <g key={index} data-plant-part="leaf" data-leaf-index={index} transform={transformAt(BASE, leaf.angle)}>
          <g transform={`translate(0 ${leaf.drop})`} opacity={leaf.opacity}>
            {/* Built pointing up and turned by the group, so the speckles stay
                on the leaf whatever the pose does. */}
            <path d={leafPath({ base: { x: 0, y: 0 }, angleDeg: 0, length: leaf.length, width: leaf.width, bendDeg: leaf.bend, profile: 'pointed' })} fill={leaf.color} />
            {SPECKLES.map(([x, y]) => (
              <circle key={`${x}:${y}`} cx={x} cy={y} r="1.5" fill="#F7E7A6" opacity="0.45" />
            ))}
          </g>
        </g>
      ))}
    </g>
  );
}
