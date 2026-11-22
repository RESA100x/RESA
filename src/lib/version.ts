// Semantic-version helpers for the update banner. The release tags look like
// `v0.2.23`; anything after `-` or `+` is ignored, and missing parts read as 0.

export type ParsedVersion = { major: number; minor: number; patch: number };

export function parseVersion(raw: string): ParsedVersion {
  const trimmed = raw.trim().replace(/^[vV]/, '');
  const core = trimmed.split(/[-+]/)[0] ?? '';
  const parts = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0 };
}

// How many patch releases separate `current` from `latest`. Only a simple
// same-major.minor gap has a meaningful count; a jump across minor or major
// versions returns null so the UI can say "several versions behind" instead of
// inventing a number.
export function versionsBehind(current: string, latest: string): number | null {
  const from = parseVersion(current);
  const to = parseVersion(latest);
  if (from.major !== to.major || from.minor !== to.minor) return null;
  const gap = to.patch - from.patch;
  return gap > 0 ? gap : null;
}
