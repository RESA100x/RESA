import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
import type { Plant, PlantDraft } from './plant-model';

type PlantsResource = {
  status: 'loading' | 'ready' | 'error';
  data: Plant[];
  message?: string;
};

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('plantsWidget.readError');
}

function missing(command: string) {
  return new Error(t('plantsWidget.unavailable', { command }));
}

export function usePlants() {
  const repository = useNowlyRepository();
  const [plants, setPlants] = useState<PlantsResource>({ status: 'loading', data: [] });
  const requestIdRef = useRef(0);

  const readPlants = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setPlants((current) => ({ status: 'loading', data: current.data }));
    try {
      const write = repository.listPlants;
      if (!write) throw missing('listPlants');
      const data = await write.call(repository);
      // Copy the rows: a backend that answers with the same array instance (a
      // cache, a shim) would otherwise hand the module the rows it already
      // holds, and the memoized schedules would keep reporting the old thirst.
      if (requestId === requestIdRef.current) setPlants({ status: 'ready', data: data.map((plant) => ({ ...plant })) });
    } catch (error) {
      // A silent refresh keeps what is on screen; only an explicit read reports
      // the failure, exactly like the notes module.
      if (!silent && requestId === requestIdRef.current) {
        setPlants((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [repository]);
  const loadPlants = useCallback(() => readPlants(false), [readPlants]);

  useEffect(() => { void loadPlants(); }, [loadPlants]);

  const createPlant = useCallback(async (draft: PlantDraft) => {
    const write = repository.createPlant;
    if (!write) throw missing('createPlant');
    const created = await write.call(repository, draft);
    await loadPlants();
    return created;
  }, [loadPlants, repository]);

  const updatePlant = useCallback(async (plant: Plant, draft: PlantDraft) => {
    const write = repository.updatePlant;
    if (!write) throw missing('updatePlant');
    const updated = await write.call(repository, plant.id, draft);
    await loadPlants();
    return updated;
  }, [loadPlants, repository]);

  const deletePlant = useCallback(async (plant: Plant) => {
    const write = repository.deletePlant;
    if (!write) throw missing('deletePlant');
    await write.call(repository, plant.id);
    await loadPlants();
  }, [loadPlants, repository]);

  const waterPlant = useCallback(async (plant: Plant, wateredAt: string) => {
    const write = repository.waterPlant;
    if (!write) throw missing('waterPlant');
    const updated = await write.call(repository, plant.id, wateredAt);
    await loadPlants();
    return updated;
  }, [loadPlants, repository]);

  return { plants, reload: loadPlants, createPlant, updatePlant, deletePlant, waterPlant };
}
