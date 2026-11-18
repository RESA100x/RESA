import { leafPath, ribbonPath, bentSpine, type Pt } from './geometry';
import { YUCCA_TRUNK, type YuccaPose } from '../plant-pose';

export function Yucca({ pose }: { pose: YuccaPose }) {
  const trunk = bentSpine(YUCCA_TRUNK.base, pose.trunkLean, YUCCA_TRUNK.length, 0, 4);
  const trunkWidths = [11, 10, 9.4, 9, 8.6];
  return (
    <g data-plant-part="foliage">
      <path d={ribbonPath(trunk, trunkWidths)} fill="#8A6A4A" />
      {pose.leaves.map((leaf, index) => (
        <path
          key={index}
          data-plant-part="leaf"
          d={leafPath({ base: leaf.base, angleDeg: leaf.angle, length: leaf.length, width: 5, bendDeg: leaf.bend, profile: 'pointed', segments: 5 })}
          fill="#6E8F5A"
        />
      ))}
    </g>
  );
}
