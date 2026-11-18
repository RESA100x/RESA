import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PLANT_SPECIES } from './plant-model';
import { PlantIllustration } from './PlantIllustration';

function pathData(container: HTMLElement): string[] {
  return [...container.querySelectorAll('path')].map((node) => node.getAttribute('d') ?? '');
}

describe('PlantIllustration', () => {
  it.each(PLANT_SPECIES)('draws %s with real, finite geometry', (species) => {
    const { container } = render(<PlantIllustration species={species} wiltProgress={0.5} animate={false} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('data-plant-species')).toBe(species);
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')?.length).toBeGreaterThan(0);
    const paths = pathData(container);
    expect(paths.length).toBeGreaterThan(0);
    for (const value of paths) {
      expect(value).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it('exposes the wilt level it is currently showing', () => {
    const { container } = render(<PlantIllustration species="monstera" wiltProgress={0.42} animate={false} />);
    expect(container.querySelector('svg')?.getAttribute('data-wilt')).toBe('0.420');
  });

  it('clamps a non-finite wilt value instead of drawing NaN', () => {
    const { container } = render(<PlantIllustration species="yucca" wiltProgress={Number.NaN} animate={false} />);
    expect(container.querySelector('svg')?.getAttribute('data-wilt')).toBe('0.000');
    for (const value of pathData(container)) expect(value).not.toMatch(/NaN|undefined/);
  });

  it('feeds the species name into the accessible label', () => {
    const { container } = render(<PlantIllustration species="croton" wiltProgress={0.2} name="Kitchen" animate={false} />);
    const label = container.querySelector('svg')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('Kitchen');
    expect(label).toContain('·');
  });

  it('fades the foliage through one saturation filter', () => {
    const { container } = render(<PlantIllustration species="croton" wiltProgress={1} animate={false} />);
    const foliage = container.querySelector<HTMLElement>('[data-plant-part="wilting"]');
    expect(foliage?.style.filter).toMatch(/^saturate\(0\.\d+\) brightness\(0\.\d+\)$/);
  });

  it('gives every species its own drawing', () => {
    const drawings = PLANT_SPECIES.map((species) => {
      const { container } = render(<PlantIllustration species={species} wiltProgress={0.4} animate={false} />);
      return container.querySelector('svg')?.innerHTML ?? '';
    });
    expect(new Set(drawings).size).toBe(PLANT_SPECIES.length);
  });

  it('redraws the same plant as it wilts', () => {
    const fresh = render(<PlantIllustration species="monstera" wiltProgress={0} animate={false} />).container.querySelector('svg')?.innerHTML;
    const dry = render(<PlantIllustration species="monstera" wiltProgress={0.95} animate={false} />).container.querySelector('svg')?.innerHTML;
    expect(fresh).not.toBe(dry);
  });
});
