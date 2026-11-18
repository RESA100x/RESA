import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { t } from '../i18n';
import { PlantsWidget } from './PlantsWidget';
import type { Plant, PlantDraft } from './plant-model';

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

function repository(seed: Plant[]) {
  const store = new Map(seed.map((item) => [item.id, item]));
  return {
    listPlants: vi.fn(async () => [...store.values()]),
    createPlant: vi.fn(async (draft: PlantDraft) => {
      const created = plant({ id: `plant-${store.size + 1}`, ...draft });
      store.set(created.id, created);
      return created;
    }),
    updatePlant: vi.fn(async (id: string, draft: PlantDraft) => {
      const updated = { ...(store.get(id) as Plant), ...draft };
      store.set(id, updated);
      return updated;
    }),
    deletePlant: vi.fn(async (id: string) => {
      store.delete(id);
    }),
    waterPlant: vi.fn(async (id: string) => {
      const updated = { ...(store.get(id) as Plant), lastWateredAt: new Date().toISOString() };
      store.set(id, updated);
      return updated;
    })
  } as unknown as NowlyRepository;
}

function renderWidget(repo: NowlyRepository, readOnly = false) {
  return render(
    <RepositoryProvider repository={repo}>
      <PlantsWidget readOnly={readOnly} />
    </RepositoryProvider>
  );
}

describe('PlantsWidget', () => {
  it('invites the user to add a plant when the list is empty', async () => {
    renderWidget(repository([]));
    expect(await screen.findByRole('button', { name: t('plantsWidget.addFirst') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('plantsWidget.addPlant') })).toBeInTheDocument();
  });

  it('counts only the plants that actually need water', async () => {
    renderWidget(repository([thirsty('a', 'Dry one'), thirsty('b', 'Dry two'), healthy('c', 'Happy')]));
    const alert = await screen.findByRole('status');
    expect(alert).toHaveTextContent(t('plantsWidget.thirsty', { count: 2 }));
  });

  it('orders the cards thirstiest first', async () => {
    renderWidget(repository([healthy('c', 'Happy'), thirsty('a', 'Dry one'), thirsty('b', 'Dry two')]));
    await screen.findByText('Dry one');
    const names = [...document.querySelectorAll('.plants-card__name')].map((node) => node.textContent);
    expect(names[names.length - 1]).toBe('Happy');
    expect(names.slice(0, 2).sort()).toEqual(['Dry one', 'Dry two']);
  });

  it('waters a plant and returns it to healthy', async () => {
    const repo = repository([thirsty('a', 'Dry one')]);
    renderWidget(repo);
    const button = await screen.findByRole('button', { name: t('plantsWidget.waterPlant', { name: 'Dry one' }) });
    await userEvent.click(button);
    await waitFor(() => expect(repo.waterPlant).toHaveBeenCalledTimes(1));
    expect(repo.waterPlant).toHaveBeenCalledWith('a', expect.any(String));
    const card = (await screen.findByText('Dry one')).closest('.plants-card') as HTMLElement;
    await waitFor(() => expect(within(card).getByText(t('plant.status.healthy'))).toBeInTheDocument());
  });

  it('recomputes the status even when the backend reuses its rows', async () => {
    // A caching backend may answer `listPlants` with the very array it holds and
    // update a row in place; the module must still stop calling the plant wilted.
    const rows = [thirsty('a', 'Dry one')];
    const repo = {
      listPlants: vi.fn(async () => rows),
      waterPlant: vi.fn(async (id: string) => {
        const target = rows.find((plant) => plant.id === id) as Plant;
        target.lastWateredAt = new Date().toISOString();
        return target;
      })
    } as unknown as NowlyRepository;
    renderWidget(repo);
    await userEvent.click(await screen.findByRole('button', { name: t('plantsWidget.waterPlant', { name: 'Dry one' }) }));
    const card = (await screen.findByText('Dry one')).closest('.plants-card') as HTMLElement;
    await waitFor(() => expect(within(card).getByText(t('plant.status.healthy'))).toBeInTheDocument());
  });

  it('surfaces a missing backend command with a retry action', async () => {
    renderWidget({} as NowlyRepository);
    expect(await screen.findByText(t('plantsWidget.unavailable', { command: 'listPlants' }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('common.retry') })).toBeInTheDocument();
  });

  it('shows the slideshow with no editable controls when the module is read-only', async () => {
    renderWidget(repository([thirsty('a', 'Dry one'), healthy('b', 'Happy')]), true);
    expect(await screen.findByTestId('plants-spotlight')).toBeInTheDocument();
    expect(screen.getByText('Dry one')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('plantsWidget.addPlant') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('plantsWidget.viewList') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('plantsWidget.waterPlant', { name: 'Dry one' }) })).toBeNull();
  });

  it('switches between the list and the slideshow from the module header', async () => {
    renderWidget(repository([thirsty('a', 'Dry one')]));
    await userEvent.click(await screen.findByRole('button', { name: t('plantsWidget.viewSpotlight') }));
    expect(await screen.findByTestId('plants-spotlight')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t('plantsWidget.viewList') }));
    expect(await screen.findByTestId('plants-scroll')).toBeInTheDocument();
  });
});
