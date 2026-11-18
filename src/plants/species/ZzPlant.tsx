import { ribbonPath, transformAt } from './geometry';
import type { ZzPose } from '../plant-pose';

export function ZzPlant({ pose }: { pose: ZzPose }) {
  return (
    <g data-plant-part="foliage">
      {pose.stems.map((stem, index) => (
        <g key={index} data-plant-part="stem" data-stem-index={index}>
          <path d={ribbonPath(stem.spine, stem.spine.map(() => 4.6))} fill="#4A7A55" />
          {stem.leaflets.map((leaflet, leafletIndex) => (
            <g key={leafletIndex} data-plant-part="leaflet" transform={transformAt(leaflet.at, leaflet.angle, leaflet.scale)}>
              <ellipse cx="0" cy="-9.6" rx="5.6" ry="9.6" fill="#2F5D3A" />
              {/* The waxy highlight: the first thing a thirsty ZZ plant loses. */}
              <ellipse cx="-1.8" cy="-12.4" rx="1.5" ry="3.4" fill="#9CCFAB" opacity={pose.gloss} />
            </g>
          ))}
        </g>
      ))}
    </g>
  );
}
