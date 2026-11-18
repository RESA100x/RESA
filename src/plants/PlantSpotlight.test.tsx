import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n';
import { PlantSpotlight, SPOTLIGHT_INTERVAL_MS } from './PlantSpotlight';
import type { Plant } from './plant-model';
import { plantSchedule, type PlantSchedule } from './plant-status';

const DAY = 86_400_000;

function plant(overrides: Partial<Plant> = {}): Plant {
  return {
    id: 'plant-1',
    name: 'Monstera',
    species: 'monstera',
    wateringIntervalDays: 7,
    lastWateredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function thirsty(id: string, name: string): Plant {
  return plant({ id, name, wateringIntervalDays: 5, lastWateredAt: new Date(Date.now() - 20 * DAY).toISOString() });
}

function healthy(id: string, name: string): Plant {
  return plant({ id, name, wateringIntervalDays: 14, lastWateredAt: new Date(Date.now() - 1 * DAY).toISOString() });
}

function schedulesFor(plants: Plant[]): Map<string, PlantSchedule> {
  return new Map(plants.map((item) => [item.id, plantSchedule(item)]));
}

function renderSpotlight(plants: Plant[]) {
  return render(<PlantSpotlight plants={plants} schedules={schedulesFor(plants)} />);
}

beforeEach(() => setLanguage('en'));
afterEach(() => setLanguage('zh'));

describe('PlantSpotlight', () => {
  it('shows the thirstiest plant first with its own status', () => {
    const plants = [thirsty('a', 'Dry one'), healthy('b', 'Happy')];
    const { container } = renderSpotlight(plants);
    // The artwork fades between slides, the caption under it names the plant on
    // show, so the two are read separately.
    expect(container.querySelector('.plants-spotlight__caption')).toHaveTextContent('Dry one');
    expect(container.querySelector('.plants-spotlight__slide[data-active="true"]')).toBeInTheDocument();
    expect(screen.getByText(t('plant.status.wilted'))).toBeInTheDocument();
    expect(container.querySelector('[data-active="true"]')?.getAttribute('data-status')).toBe('wilted');
  });

  it('carries no separate navigation strip, only chrome on the slider', () => {
    const { container } = renderSpotlight([thirsty('a', 'Dry one'), healthy('b', 'Happy')]);
    expect(container.querySelector('.plants-spotlight__controls')).toBeNull();
    const chrome = [...container.querySelectorAll('.plants-spotlight__stage > button')];
    expect(chrome.map((node) => node.className)).toEqual([
      'plants-spotlight__arrow plants-spotlight__arrow--prev',
      'plants-spotlight__arrow plants-spotlight__arrow--next',
      'plants-spotlight__play'
    ]);
  });

  it('advances on its own and shows which slide is running', async () => {
    vi.useFakeTimers();
    try {
      const plants = [thirsty('a', 'Dry one'), healthy('b', 'Happy')];
      renderSpotlight(plants);
      const dots = screen.getAllByRole('tab');
      expect(dots[0]).toHaveAttribute('aria-selected', 'true');
      await act(async () => {
        vi.advanceTimersByTime(SPOTLIGHT_INTERVAL_MS);
      });
      expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
      await act(async () => {
        vi.advanceTimersByTime(SPOTLIGHT_INTERVAL_MS);
      });
      expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds the current slide while the pointer rests on it', async () => {
    vi.useFakeTimers();
    try {
      const plants = [thirsty('a', 'Dry one'), healthy('b', 'Happy')];
      const { container } = renderSpotlight(plants);
      fireEvent.mouseEnter(container.querySelector('.plants-spotlight') as HTMLElement);
      await act(async () => {
        vi.advanceTimersByTime(SPOTLIGHT_INTERVAL_MS * 2);
      });
      expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses and resumes the automatic show from its own button', async () => {
    renderSpotlight([thirsty('a', 'Dry one'), healthy('b', 'Happy')]);
    await userEvent.click(screen.getByRole('button', { name: t('plantsWidget.pauseSlides') }));
    expect(screen.getByRole('button', { name: t('plantsWidget.playSlides') })).toBeInTheDocument();
  });

  it('walks the slides with the dots, the arrows and the keyboard', async () => {
    const plants = [thirsty('a', 'Dry one'), healthy('b', 'Happy'), plant({ id: 'c', name: 'Third' })];
    const { container } = renderSpotlight(plants);
    const dots = screen.getAllByRole('tab');

    await userEvent.click(dots[2]);
    expect(dots[2]).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('button', { name: t('plantsWidget.previousPlant') }));
    expect(dots[1]).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('button', { name: t('plantsWidget.nextPlant') }));
    expect(dots[2]).toHaveAttribute('aria-selected', 'true');

    const stage = container.querySelector('.plants-spotlight') as HTMLElement;
    fireEvent.keyDown(stage, { key: 'Home' });
    expect(dots[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    expect(dots[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(stage, { key: 'End' });
    expect(dots[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('swipes forward and backward in a left-to-right language', () => {
    const plants = [thirsty('a', 'Dry one'), healthy('b', 'Happy'), plant({ id: 'c', name: 'Third' })];
    const { container } = renderSpotlight(plants);
    const stage = container.querySelector('.plants-spotlight') as HTMLElement;
    const dots = screen.getAllByRole('tab');

    fireEvent.pointerDown(stage, { clientX: 220, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 120, pointerId: 1 });
    expect(dots[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.pointerDown(stage, { clientX: 120, pointerId: 2 });
    fireEvent.pointerMove(stage, { clientX: 220, pointerId: 2 });
    fireEvent.pointerUp(stage, { clientX: 220, pointerId: 2 });
    expect(dots[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('ignores a nudge too small to be a swipe', () => {
    const plants = [thirsty('a', 'Dry one'), healthy('b', 'Happy')];
    const { container } = renderSpotlight(plants);
    const stage = container.querySelector('.plants-spotlight') as HTMLElement;
    fireEvent.pointerDown(stage, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 190, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 190, pointerId: 1 });
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('offers watering only where the module is interactive', async () => {
    const plants = [thirsty('a', 'Dry one')];
    const onWater = vi.fn();
    const { rerender } = render(<PlantSpotlight plants={plants} schedules={schedulesFor(plants)} />);
    expect(screen.queryByRole('button', { name: t('plantsWidget.waterNow') })).toBeNull();

    rerender(<PlantSpotlight plants={plants} schedules={schedulesFor(plants)} canWater onWater={onWater} />);
    await userEvent.click(screen.getByRole('button', { name: t('plantsWidget.waterNow') }));
    expect(onWater).toHaveBeenCalledWith(plants[0]);
  });
});
