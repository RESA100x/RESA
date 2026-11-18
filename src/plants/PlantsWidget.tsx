import { Droplets, GalleryCircle, List, Pencil, Plus, X } from '../components/icons';
import { useCallback, useMemo, useState } from 'react';
import { useCurrentTime } from '../app/useCurrentTime';
import { t } from '../i18n';
import { formatDisplayDate } from '../lib/calendar-system';
import { PlantIllustration } from './PlantIllustration';
import { PlantDialog } from './PlantDialog';
import { PlantSpotlight } from './PlantSpotlight';
import { plantSchedule, plantStatusKey, sortPlantsByThirst, wateringGap, type PlantSchedule } from './plant-status';
import { usePlants } from './usePlants';
import type { Plant, PlantDraft, PlantSpecies } from './plant-model';
import './plants.css';

type PlantDialogState = { type: 'create' } | { type: 'edit'; plant: Plant } | null;

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error.message as string)
    : t('common.opFailed');
}

// The watering module. It keeps one promise: the picture of a plant is the truth
// about that plant. Everything drawn comes from `lastWateredAt` plus the
// interval, so nothing here is a counter, a streak or a level.
export function PlantsWidget({ readOnly = false }: { readOnly?: boolean }) {
  const { plants, reload, createPlant, updatePlant, deletePlant, waterPlant } = usePlants();
  const now = useCurrentTime();
  const [dialog, setDialog] = useState<PlantDialogState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [view, setView] = useState<'list' | 'spotlight'>('list');

  const schedules = useMemo(() => {
    const map = new Map<string, PlantSchedule>();
    for (const plant of plants.data) map.set(plant.id, plantSchedule(plant, now));
    return map;
  }, [plants.data, now]);

  const ordered = useMemo(() => sortPlantsByThirst(plants.data, now), [plants.data, now]);
  const thirsty = ordered.filter((plant) => {
    const status = schedules.get(plant.id)?.status;
    return status === 'needsWater' || status === 'wilted';
  }).length;

  const water = useCallback(async (plant: Plant) => {
    setActionError('');
    setBusyId(plant.id);
    try {
      await waterPlant(plant, new Date().toISOString());
    } catch (error) {
      setActionError(message(error));
    } finally {
      setBusyId(null);
    }
  }, [waterPlant]);

  const status = plants.status === 'error' ? 'error' : plants.status === 'loading' && plants.data.length === 0 ? 'loading' : 'ready';
  // On the desktop the module has no pointer and no room for a list: it shows
  // the plants as a slideshow instead, which is also the prettier of the two.
  const spotlight = readOnly || view === 'spotlight';

  const loadingBlock = status === 'loading' ? <p className="plants-widget__empty">{t('plantsWidget.loading')}</p> : null;
  const errorBlock =
    status === 'error' ? (
      <div className="module-message" role="alert">
        <span>{plants.message ?? t('plantsWidget.readError')}</span>
        <div className="module-message__actions">
          <button type="button" className="good-button" onClick={reload}>
            {t('common.retry')}
          </button>
        </div>
      </div>
    ) : null;
  const emptyBlock =
    status === 'ready' && plants.data.length === 0 ? (
      <div className="plants-widget__empty">
        <p>{t('plantsWidget.empty')}</p>
        <button type="button" className="good-button" disabled={readOnly} onClick={() => setDialog({ type: 'create' })}>
          {t('plantsWidget.addFirst')}
        </button>
      </div>
    ) : null;
  const actionErrorBlock = actionError ? (
    <div className="module-message" role="alert">
      <span>{actionError}</span>
      <div className="module-message__actions">
        <button type="button" className="good-icon-button module-message__close" aria-label={t('common.close')} onClick={() => setActionError('')}>
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  ) : null;

  if (spotlight) {
    return (
      <div className="widget-content plants-widget plants-widget--spotlight">
        {plants.data.length > 0 ? (
          <PlantSpotlight
            plants={ordered}
            schedules={schedules}
            canWater={!readOnly}
            onWater={(plant) => void water(plant)}
          />
        ) : null}
        {loadingBlock}
        {errorBlock}
        {emptyBlock}
        {actionErrorBlock}
        {!readOnly ? (
          <button
            type="button"
            className="btn btn-icon plants-widget__view-toggle"
            aria-label={t('plantsWidget.viewList')}
            title={t('plantsWidget.viewList')}
            onClick={() => setView('list')}
          >
            <List aria-hidden="true" />
          </button>
        ) : null}
        {dialog ? (
          <PlantDialog
            mode={dialog}
            onClose={() => setDialog(null)}
            onCreate={(draft: PlantDraft) => createPlant(draft)}
            onUpdate={(plant: Plant, draft: PlantDraft) => updatePlant(plant, draft)}
            onDelete={(plant: Plant) => deletePlant(plant)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="widget-content plants-widget">
      <div className="card-header">
        <div className="heading-group">
          <p>{t('plantsWidget.count', { count: plants.data.length })}</p>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-icon"
            aria-label={t('plantsWidget.viewSpotlight')}
            title={t('plantsWidget.viewSpotlight')}
            disabled={readOnly || plants.data.length === 0}
            onClick={() => setView('spotlight')}
          >
            <GalleryCircle aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-primary"
            aria-label={t('plantsWidget.addPlant')}
            disabled={readOnly}
            onClick={() => setDialog({ type: 'create' })}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      </div>

      {thirsty > 0 ? (
        <p className="plants-widget__alert" role="status">
          {t('plantsWidget.thirsty', { count: thirsty })}
        </p>
      ) : null}

      {actionErrorBlock}

      <div className="panel-body" data-testid="plants-scroll">
        {errorBlock}
        {loadingBlock}
        {emptyBlock}

        {plants.data.length > 0 ? (
          <ul className="plants-list">
            {ordered.map((plant) => {
              const schedule = schedules.get(plant.id);
              if (!schedule) return null;
              const gap = wateringGap(schedule);
              return (
                <li key={plant.id} className={`plants-card plants-card--${schedule.status}`}>
                  <div className="plants-card__visual">
                    <PlantIllustration
                      species={plant.species}
                      wiltProgress={schedule.wiltProgress}
                      name={plant.name}
                      animate={!readOnly}
                      className="plants-card__illustration"
                    />
                  </div>
                  <div className="plants-card__body">
                    <div className="plants-card__heading">
                      <h4 className="plants-card__name">{plant.name}</h4>
                      <span className={`plants-chip plants-chip--${schedule.status}`}>{t(plantStatusKey(schedule.status))}</span>
                    </div>
                    <p className="plants-card__species">{t(`plant.species.${plant.species as PlantSpecies}`)}</p>
                    <p className="plants-card__gap">
                      {t(gap.key, { days: gap.days })}
                      <span className="plants-card__separator" aria-hidden="true">·</span>
                      <span className="plants-card__last">
                        {t('plantsWidget.lastWatered', { date: formatDisplayDate(new Date(plant.lastWateredAt), 'short') })}
                      </span>
                    </p>
                    <div className="plants-card__actions">
                      <button
                        type="button"
                        className="good-button plants-card__water"
                        disabled={readOnly || busyId === plant.id}
                        aria-label={t('plantsWidget.waterPlant', { name: plant.name })}
                        onClick={() => void water(plant)}
                      >
                        <Droplets aria-hidden="true" />
                        {t('plantsWidget.waterNow')}
                      </button>
                      <button
                        type="button"
                        className="good-icon-button"
                        disabled={readOnly}
                        aria-label={t('plantsWidget.editPlant', { name: plant.name })}
                        onClick={() => setDialog({ type: 'edit', plant })}
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {dialog ? (
        <PlantDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onCreate={(draft: PlantDraft) => createPlant(draft)}
          onUpdate={(plant: Plant, draft: PlantDraft) => updatePlant(plant, draft)}
          onDelete={(plant: Plant) => deletePlant(plant)}
        />
      ) : null}
    </div>
  );
}
