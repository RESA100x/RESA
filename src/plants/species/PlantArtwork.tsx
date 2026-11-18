import { useId } from 'react';
import { agingFilter, designerAppearance } from '../plant-pose';
import { mixHex, shadeHex } from './palette';
// Every generated artwork module exports the same shape, so one of them can name
// the type for all of them.
export type PlantArtShape = {
  d: string;
  fill: string;
  pivot: readonly [number, number];
  tilt: number;
  span: number;
  pot: boolean;
  leaf: boolean;
};

// Species whose artwork comes from a designer are drawn here, all of them the
// same way: the outlines are used exactly as drawn and only the shading is added.
//
// Nothing in these drawings bends when the plant gets dry — a hand-drawn leaf
// that is rotated by code stops looking like the artist's leaf. The dryness shows
// in colour only: the whole plant loses saturation and warmth through the filter
// the illustration applies, and each leaf keeps the volume the shading gives it.

export type PlantArtworkData = {
  readonly viewBox: string;
  readonly shapes: readonly PlantArtShape[];
};

export function PlantArtwork({ art, wilt }: { art: PlantArtworkData; wilt: number }) {
  const id = useId();
  const filter = agingFilter(designerAppearance(wilt));
  return (
    <>
      {/* The pot keeps the artist's colour: it is not what a watering state is
          about. It is drawn first, and outside the aging group, because the
          artist draws it behind the plant and because a watering state changes
          the leaves rather than the china. */}
      <g data-plant-part="pot">
        {art.shapes.map((shape, index) =>
          shape.pot ? <path key={index} data-shape-index={index} d={shape.d} fill={shape.fill} /> : null
        )}
      </g>
      <g data-plant-part="wilting" style={{ filter }}>
        <g data-plant-part="foliage">
        <defs>
          {art.shapes.map((shape, index) => {
            // Veins and highlights keep the artist's flat colour; a full leaf gets a
            // run of light from the point it joins the plant to its far edge.
            if (!shape.leaf) return null;
            const tilt = (shape.tilt * Math.PI) / 180;
            const [x, y] = shape.pivot;
            return (
              <linearGradient
                key={index}
                id={`${id}-leaf-${index}`}
                gradientUnits="userSpaceOnUse"
                x1={x}
                y1={y}
                x2={x + Math.sin(tilt) * shape.span}
                y2={y - Math.cos(tilt) * shape.span}
              >
                <stop offset="0" stopColor={shadeHex(shape.fill, 0.22)} />
                <stop offset="0.3" stopColor={mixHex(shape.fill, '#EAF3D8', 0.26)} />
                <stop offset="0.68" stopColor={shape.fill} />
                <stop offset="1" stopColor={shadeHex(shape.fill, -0.32)} />
              </linearGradient>
            );
          })}
        </defs>
        {art.shapes.map((shape, index) =>
          shape.pot ? null : (
            <path
              key={index}
              data-plant-part={shape.leaf ? 'leaf' : 'leaf-detail'}
              data-shape-index={index}
              d={shape.d}
              fill={shape.leaf ? `url(#${id}-leaf-${index})` : shape.fill}
            />
          )
        )}
        </g>
      </g>
    </>
  );
}
