// Shared geometry for the plant illustrations.
//
// Every leaf, blade and stem is a ribbon: a bent spine plus a width profile.
// The spine is what a watering state moves, so a leaf that droops is the same
// leaf with different numbers — not a second drawing swapped in — and the shape
// stays continuous as the plant fades.

export type Pt = { x: number; y: number };

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 3);
}

export function easeInCubic(t: number): number {
  const value = clamp01(t);
  return value * value * value;
}

// 0 before `from`, 1 after `to`: how the leaves of one plant react at slightly
// different times instead of all sagging on the same frame.
export function ramp(value: number, from: number, to: number): number {
  if (to <= from) return value >= to ? 1 : 0;
  return clamp01((value - from) / (to - from));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// Angles are measured from straight up, clockwise positive, so `polar(base, 0,
// length)` sits directly above the base.
export function polar(origin: Pt, angleDeg: number, length: number): Pt {
  const angle = (angleDeg * Math.PI) / 180;
  return { x: origin.x + Math.sin(angle) * length, y: origin.y - Math.cos(angle) * length };
}

// A spine whose direction rotates from `angleDeg` to `angleDeg + bendDeg` along
// its length: a stem that leans, or a blade that folds over at the tip.
export function bentSpine(base: Pt, angleDeg: number, length: number, bendDeg: number, segments = 5): Pt[] {
  const spine: Pt[] = [base];
  const step = length / segments;
  let current = base;
  for (let index = 1; index <= segments; index += 1) {
    const angle = angleDeg + (bendDeg * index) / segments;
    current = polar(current, angle, step);
    spine.push(current);
  }
  return spine;
}

export function offsetPt(point: Pt, delta: Pt): Pt {
  return { x: point.x + delta.x, y: point.y + delta.y };
}

function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function toPath(points: Pt[]): string {
  const parts: string[] = [];
  for (const point of points) parts.push(`${round(point.x)} ${round(point.y)}`);
  return parts.join(' ');
}

// Closed outline through a ring of points, smoothed with quadratics through the
// segment midpoints. Rounding every corner keeps short ribbons from looking
// faceted without needing hand-tuned control points per leaf.
function smoothClosedPath(points: Pt[]): string {
  if (points.length < 3) return '';
  const count = points.length;
  let path = `M ${round(midpoint(points[count - 1], points[0]).x)} ${round(midpoint(points[count - 1], points[0]).y)}`;
  for (let index = 0; index < count; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % count];
    const middle = midpoint(current, next);
    path += ` Q ${round(current.x)} ${round(current.y)} ${round(middle.x)} ${round(middle.y)}`;
  }
  return `${path} Z`;
}

function tangentAt(spine: Pt[], index: number): Pt {
  const previous = spine[Math.max(0, index - 1)];
  const next = spine[Math.min(spine.length - 1, index + 1)];
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

// Ribbon outline: offsets the spine left and right by half the width at each
// point, then joins both sides into one closed shape.
export function ribbonPath(spine: Pt[], widths: number[]): string {
  if (spine.length < 2) return '';
  const left: Pt[] = [];
  const right: Pt[] = [];
  spine.forEach((point, index) => {
    const tangent = tangentAt(spine, index);
    const half = (widths[index] ?? widths[widths.length - 1]) / 2;
    left.push({ x: point.x - tangent.y * half, y: point.y + tangent.x * half });
    right.push({ x: point.x + tangent.y * half, y: point.y - tangent.x * half });
  });
  return smoothClosedPath([...left, ...right.reverse()]);
}

// A leaf drawn as a ribbon: the widest point sits just past the base, which is
// what makes a monstera leaf read as a leaf and not a blade of grass.
export type LeafProfile = 'round' | 'pointed' | 'sword';

const profiles: Record<LeafProfile, number[]> = {
  // From base to tip, multiplied by the leaf's width.
  round: [0.30, 0.92, 1, 0.82, 0.42, 0.08],
  pointed: [0.34, 0.86, 1, 0.8, 0.34, 0.04],
  sword: [0.62, 0.92, 1, 0.78, 0.38, 0.08]
};

export function leafPath(options: {
  base: Pt;
  angleDeg: number;
  length: number;
  width: number;
  bendDeg?: number;
  profile?: LeafProfile;
  segments?: number;
}): string {
  const { base, angleDeg, length, width, bendDeg = 0, profile = 'pointed', segments = 5 } = options;
  const spine = bentSpine(base, angleDeg, length, bendDeg, segments);
  const shape = profiles[profile];
  const widths = shape.map((ratio) => Math.max(0.6, width * ratio));
  return ribbonPath(spine, widths);
}

export function leafTip(options: { base: Pt; angleDeg: number; length: number; bendDeg?: number; segments?: number }): Pt {
  const { base, angleDeg, length, bendDeg = 0, segments = 5 } = options;
  const spine = bentSpine(base, angleDeg, length, bendDeg, segments);
  return spine[spine.length - 1];
}

export function spine(options: { base: Pt; angleDeg: number; length: number; bendDeg?: number; segments?: number }): Pt[] {
  const { base, angleDeg, length, bendDeg = 0, segments = 5 } = options;
  return bentSpine(base, angleDeg, length, bendDeg, segments);
}

export function transformAt(point: Pt, angleDeg: number, scale = 1): string {
  return `translate(${round(point.x)} ${round(point.y)}) rotate(${round(angleDeg)}) scale(${round(scale * 100) / 100})`;
}

export { toPath };
