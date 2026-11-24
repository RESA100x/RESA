import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import type { Plant } from './plant-model';
import { usePlants } from './usePlants';

const listeners = new Map<string, (event: unknown) => void>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: unknown) => void) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  })
}));

function plant(overrides: Partial<Plant> = {}): Plant {
  return {
    id: 'plant-1',
    name: 'Monstera',
    species: 'monstera',
    wateringIntervalDays: 7,
    lastWateredAt: '2026-11-22T06:26:16Z',
    createdAt: '2026-11-22T06:26:16Z',
    updatedAt: '2026-11-22T06:26:16Z',
    ...overrides
  };
}

function Probe() {
  const { plants } = usePlants();
  return <p data-testid="names">{plants.data.map((item) => item.name).join(',')}</p>;
}

describe('usePlants cross-window refresh', () => {
  it('reloads when another window reports a plant change', async () => {
    const rows: Plant[] = [plant()];
    const repository = {
      listPlants: vi.fn(async () => rows.map((row) => ({ ...row })))
    } as unknown as NowlyRepository;

    render(
      <RepositoryProvider repository={repository}>
        <Probe />
      </RepositoryProvider>
    );

    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Monstera'));
    expect(repository.listPlants).toHaveBeenCalledTimes(1);

    rows.push(plant({ id: 'plant-2', name: 'Yucca' }));
    listeners.get('plants-changed')?.({});

    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Monstera,Yucca'));
    expect(repository.listPlants).toHaveBeenCalledTimes(2);
  });
});
