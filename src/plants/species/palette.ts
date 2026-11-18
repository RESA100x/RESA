// Colour arithmetic for the plant drawings.
//
// The illustrations are hand-drawn SVG with gradients, which means every shade
// has to come from somewhere. Keeping the maths here — instead of forty hex
// literals per species — is what lets one base green produce the pale, sunlit
// side of a leaf, its shaded edge and the deep tone where leaves overlap.

// One clamp, shared by every mix below and by the watering maths next door.
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

type Rgb = { r: number; g: number; b: number };

function parse(hex: string): Rgb {
  const value = hex.trim().replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const numeric = Number.parseInt(full, 16);
  if (!Number.isFinite(numeric)) return { r: 0, g: 0, b: 0 };
  return { r: (numeric >> 16) & 255, g: (numeric >> 8) & 255, b: numeric & 255 };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (channel: number) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function mixHex(from: string, to: string, t: number): string {
  const amount = clamp01(t);
  const a = parse(from);
  const b = parse(to);
  return toHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount
  });
}

// `amount > 0` lightens towards white, `< 0` deepens towards black: the two
// moves that make a flat shape read as a lit, rounded leaf.
export function shadeHex(hex: string, amount: number): string {
  return amount >= 0 ? mixHex(hex, '#ffffff', amount) : mixHex(hex, '#101a12', -amount);
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha).toFixed(3)})`;
}
