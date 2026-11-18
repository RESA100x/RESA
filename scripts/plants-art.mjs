// Turns a designer's plant artwork into the TypeScript module the plants module
// shades. Run once per species, from the repository root:
//
//   node scripts/plants-art.mjs monstera ./monstera.svg
//   node scripts/plants-art.mjs yucca ./yucca.svg
//
// The output is written to src/plants/species/<species>-art.ts and committed; the
// SVG itself stays out of the repository. The artwork is kept exactly as drawn —
// what is added is the little metadata the module needs to shade and age a plant:
// which shapes are leaves, where each leaf joins the plant, and how long it is.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { chromium } from 'playwright';

const [species, source] = process.argv.slice(2);
if (!species || !source) throw new Error('usage: node scripts/plants-art.mjs <species> <path-to-svg>');
const target = `src/plants/species/${species}-art.ts`;

const svg = readFileSync(source, 'utf8');
const sourceName = basename(source).replace(/\.svg$/i, '');
// A rule with a real fill wins; `fill:none` (a CorelDRAW construction guide)
// ends up as null and is dropped later instead of being drawn black.
const styles = Object.fromEntries(
  [...svg.matchAll(/\.(fil\d+)\s*\{([^}]+)\}/g)].map((match) => [
    match[1],
    (match[2].match(/fill:\s*(#[0-9A-Fa-f]{6})/) ?? [])[1] ?? null
  ])
);
const paths = [...svg.matchAll(/<path([^>]*)>/g)].map((match, index) => ({
  index,
  cls: (match[1].match(/class="([^"]+)"/) ?? [])[1] ?? '',
  d: (match[1].match(/d="([^"]+)"/) ?? [])[1] ?? ''
}));

const page = await chromium
  .launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
  .then((browser) => browser.newPage());
await page.setContent('<svg id="host" xmlns="http://www.w3.org/2000/svg"></svg>');

const boxes = await page.evaluate((items) => {
  const host = document.getElementById('host');
  return items.map((item) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    node.setAttribute('d', item.d);
    host.appendChild(node);
    const box = node.getBBox();
    return [box.x, box.y, box.width, box.height].map((value) => Math.round(value));
  });
}, paths);

const shapes = paths.map((path, index) => ({ ...path, fill: styles[path.cls], box: boxes[index] }));
const union = shapes.reduce(
  (acc, shape) => {
    const [x, y, w, h] = shape.box;
    return [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x + w), Math.max(acc[3], y + h)];
  },
  [Infinity, Infinity, -Infinity, -Infinity]
);
const canvasArea = (union[2] - union[0]) * (union[3] - union[1]);

// A background plate covers most of the canvas; a plant never does.
const isBackground = (shape) => (shape.box[2] * shape.box[3]) / canvasArea > 0.6;
const isGreen = (hex) => {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return green > red + 8 && green > blue + 8;
};
// Grey-green plates and highlights are part of the artist's shading, not leaves;
// a real leaf colour is saturated.
const isSaturated = (hex) => {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const high = Math.max(...channels);
  return high > 0 && (high - Math.min(...channels)) / high >= 0.2;
};
// Leaves are the big green shapes; the small ones are the artist's own veins and
// highlights and stay flat, exactly as drawn.
const isLeaf = (shape) =>
  isGreen(shape.fill) && isSaturated(shape.fill) && (shape.box[2] * shape.box[3]) / canvasArea >= 0.015;

// The pot, the saucer and the plate are not the plant. They keep the artist's
// colour at every watering state, the same way the shared pot of the geometric
// species sits outside the aging group. Every CorelDRAW export we have uses this
// same terracotta pair for the pot and this pale green for the plate; anything
// else in the file - including a woody trunk - ages with the leaves.
const HARDWARE_FILLS = new Set(['#954F2F', '#C06B46', '#CADAD1']);
const isPot = (shape) => HARDWARE_FILLS.has(shape.fill.toUpperCase());

// CorelDRAW also exports construction guides with `fill:none`. They draw
// nothing, so they are dropped rather than emitted as black shapes.
const isInvisible = (shape) => typeof shape.fill !== 'string';

const kept = shapes.filter((shape) => !isBackground(shape) && !isInvisible(shape));
const dropped = shapes.filter((shape) => isBackground(shape) || isInvisible(shape));
const content = kept.reduce(
  (acc, shape) => {
    const [x, y, w, h] = shape.box;
    return [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x + w), Math.max(acc[3], y + h)];
  },
  [Infinity, Infinity, -Infinity, -Infinity]
);

// Everything grows out of one place: the middle of the pot, at the bottom of the
// drawing. A leaf's own attachment is the point of its outline nearest to it.
const root = { x: Math.round((content[0] + content[2]) / 2), y: Math.round(content[3]) };
const pivots = await page.evaluate(
  ({ items, origin }) =>
    items.map((item) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      node.setAttribute('d', item.d);
      document.getElementById('host').appendChild(node);
      const total = node.getTotalLength();
      let best = { x: 0, y: 0, distance: Infinity };
      for (let step = 0; step <= 500; step += 1) {
        const point = node.getPointAtLength((step / 500) * total);
        const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
        if (distance < best.distance) best = { x: point.x, y: point.y, distance };
      }
      return { x: Math.round(best.x), y: Math.round(best.y) };
    }),
  { items: kept, origin: root }
);

const margin = Math.round(Math.max(content[2] - content[0], content[3] - content[1]) * 0.035);
const viewBox = [
  content[0] - margin,
  content[1] - margin,
  content[2] - content[0] + margin * 2,
  content[3] - content[1] + margin * 2
].map(Math.round);

const round = (values) => values.map((value) => Math.round(value)).join(' ');
const quote = (d) => d.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\s+/g, ' ').trim();

const emitted = kept.map((shape, index) => {
  const [x, y, w, h] = shape.box;
  const centre = { x: x + w / 2, y: y + h / 2 };
  const pivot = pivots[index];
  const tilt = (Math.atan2(centre.x - pivot.x, pivot.y - centre.y) * 180) / Math.PI;
  return {
    d: shape.d,
    fill: shape.fill,
    pivot: [pivot.x, pivot.y],
    tilt: Number(tilt.toFixed(1)),
    span: Math.round(Math.hypot(w, h)),
    pot: isPot(shape),
    leaf: isLeaf(shape)
  };
});

// snake-plant -> SNAKE_PLANT, monstera -> MONSTERA (the module adds _ART).
const name = species.split(/[^a-zA-Z0-9]+/).filter(Boolean).join('_').toUpperCase();
const lines = [];
lines.push(`// Generated from the designer's ${sourceName}.svg (CorelDRAW export).`);
lines.push('//');
lines.push("// The drawing arrives as flat outlines: one path per shape, in the artist's own");
lines.push('// layer order, and is kept exactly as drawn. What is recorded here is which');
lines.push('// shapes are leaves, where each leaf joins the plant and how long it is, so the');
lines.push('// module can shade a leaf from its base to its tip and age it as it dries.');
lines.push('');
lines.push(`export const ${name}_ART = {`);
lines.push("  // The drawing's own bounds: the block frames the plant, not the empty canvas.");
lines.push(`  viewBox: '${round(viewBox)}',`);
lines.push("  // Document order is the artist's layering and is kept as drawn. Each shape:");
lines.push('  //   pivot - the point nearest the pot, where its shading starts');
lines.push('  //   tilt  - direction it grows away from the plant, in degrees');
lines.push('  //   span  - how long it is, base to far edge');
lines.push('  //   leaf  - a full leaf takes its own shading; a vein or a highlight stays');
lines.push('  //           exactly as the artist drew it.');
lines.push('  //   pot   - the pot, saucer or plate: keeps its colour as the plant dries.');
lines.push('  shapes: [');
for (const shape of emitted) {
  lines.push('    {');
  lines.push(`      d: '${quote(shape.d)}',`);
  lines.push(`      fill: '${shape.fill}',`);
  lines.push(`      pivot: [${shape.pivot[0]}, ${shape.pivot[1]}],`);
  lines.push(`      tilt: ${shape.tilt},`);
  lines.push(`      span: ${shape.span},`);
  lines.push(`      pot: ${shape.pot},`);
  lines.push(`      leaf: ${shape.leaf}`);
  lines.push('    },');
}
lines.push('  ]');
lines.push('} as const;');

writeFileSync(target, lines.join('\n'), 'utf8');
console.log(`${species}: canvas ${Math.round(union[2] - union[0])}x${Math.round(union[3] - union[1])}`);
console.log(
  `  kept ${kept.length}/${shapes.length} shapes (dropped ${dropped.filter(isBackground).length} background, ${dropped.filter(isInvisible).length} invisible)`
);
console.log(`  leaves ${emitted.filter((shape) => shape.leaf).length}, details ${emitted.filter((shape) => !shape.leaf).length}`);
console.log(`  pot/plate ${emitted.filter((shape) => shape.pot).length}`);
console.log(`  root ${root.x},${root.y} | viewBox ${round(viewBox)} | bytes ${readFileSync(target, 'utf8').length}`);
console.log(`  leaf fills ${[...new Set(emitted.filter((shape) => shape.leaf).map((shape) => shape.fill))].join(' ')}`);

await page.context().browser().close();
