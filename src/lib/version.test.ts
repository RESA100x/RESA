import { describe, expect, it } from 'vitest';
import { parseVersion, versionsBehind } from './version';

describe('parseVersion', () => {
  it('reads plain and v-prefixed tags', () => {
    expect(parseVersion('0.2.23')).toEqual({ major: 0, minor: 2, patch: 23 });
    expect(parseVersion('v0.2.23')).toEqual({ major: 0, minor: 2, patch: 23 });
    expect(parseVersion('1.2')).toEqual({ major: 1, minor: 2, patch: 0 });
  });

  it('ignores pre-release and build metadata', () => {
    expect(parseVersion('1.2.3-beta.1')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('1.2.3+build.9')).toEqual({ major: 1, minor: 2, patch: 3 });
  });
});

describe('versionsBehind', () => {
  it('counts patch releases within the same minor', () => {
    expect(versionsBehind('0.2.0', 'v0.2.23')).toBe(23);
    expect(versionsBehind('0.2.21', '0.2.22')).toBe(1);
  });

  it('refuses to invent a count across minor or major jumps', () => {
    expect(versionsBehind('0.1.9', '0.2.1')).toBeNull();
    expect(versionsBehind('1.4.0', '2.0.0')).toBeNull();
  });

  it('returns null when nothing is newer', () => {
    expect(versionsBehind('0.2.23', '0.2.23')).toBeNull();
    expect(versionsBehind('0.2.24', '0.2.23')).toBeNull();
  });
});
