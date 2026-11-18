import { ChevronLeft, ChevronRight, Droplets, Pause, Play } from '../components/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDirection, t } from '../i18n';
import { formatDisplayDate } from '../lib/calendar-system';
import { prefersReducedMotion } from '../lib/motion';
import type { Plant, PlantSpecies } from './plant-model';
import { PlantIllustration } from './PlantIllustration';
import { plantStatusKey, wateringGap, type PlantSchedule } from './plant-status';

// One plant at a time, drawn large over its own soft scene: the wallpaper face
// of the module. It walks the list on its own, but it is a real slider — you can
// drag it, tap the dots or use the arrow keys — and it stops while you do.
export const SPOTLIGHT_INTERVAL_MS = 9_000;
const SWIPE_THRESHOLD_PX = 42;

type PlantSpotlightProps = {
  plants: Plant[];
  schedules: Map<string, PlantSchedule>;
  // Watering is offered here too, but only where the module is interactive.
  onWater?(plant: Plant): void;
  canWater?: boolean;
  className?: string;
};

export function PlantSpotlight({ plants, schedules, onWater, canWater = false, className }: PlantSpotlightProps) {
  const [index, setIndex] = useState(0);
  // Two different reasons to stand still: the user asked for it, or the pointer
  // is on the slide. Only the first one is what the play button toggles.
  const [autoPaused, setAutoPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [dragX, setDragX] = useState(0);
  const dragRef = useRef<{ startX: number; pointerId: number } | null>(null);
  const keyHoldRef = useRef<number | null>(null);
  const reducedMotion = prefersReducedMotion();
  const rtl = getDirection() === 'rtl';
  const running = !autoPaused && !held;

  // The list can shrink or re-sort under us (watering moves a plant to the top
  // of the thirst order), so the index is always kept inside the new range.
  useEffect(() => {
    setIndex((current) => (plants.length === 0 ? 0 : Math.min(current, plants.length - 1)));
  }, [plants.length]);

  // A fresh timeout per slide: the progress line restarts with every advance and
  // nothing keeps ticking while the user is holding a slide.
  useEffect(() => {
    if (!running || plants.length <= 1) return;
    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % plants.length);
    }, SPOTLIGHT_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, running, plants.length]);

  const go = useCallback(
    (step: number) => {
      setIndex((current) => {
        if (plants.length === 0) return 0;
        return (current + step + plants.length) % plants.length;
      });
    },
    [plants.length]
  );

  // Only the current slide and its two neighbours stay mounted: a hundred plants
  // must not mean a hundred live drawings.
  const window_slides = useMemo(() => {
    const count = plants.length;
    if (count === 0) return [];
    const offsets = count <= 3 ? plants.map((_, position) => position) : [(index - 1 + count) % count, index, (index + 1) % count];
    return [...new Set(offsets)].map((position) => ({ position, plant: plants[position] }));
  }, [index, plants]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    dragRef.current = { startX: event.clientX, pointerId: event.pointerId };
    setHeld(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom and older engines may not implement pointer capture; the swipe
      // still works because the listeners live on the container.
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setDragX(event.clientX - drag.startX);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    dragRef.current = null;
    setDragX(0);
    setHeld(false);
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    // Content follows the reading direction: in RTL the next plant comes in from
    // the left, so a rightward drag is the one that moves forward.
    const forward = rtl ? dx > 0 : dx < 0;
    go(forward ? 1 : -1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight') go(rtl ? -1 : 1);
    else if (event.key === 'ArrowLeft') go(rtl ? 1 : -1);
    else if (event.key === 'Home') setIndex(0);
    else if (event.key === 'End') setIndex(Math.max(0, plants.length - 1));
    else return;
    event.preventDefault();
    // Keyboard browsing pauses the walk for a beat, then it takes over again.
    // Without the release the show would stay frozen until the pointer moved.
    setHeld(true);
    if (keyHoldRef.current !== null) window.clearTimeout(keyHoldRef.current);
    keyHoldRef.current = window.setTimeout(() => setHeld(false), SPOTLIGHT_INTERVAL_MS);
  }

  useEffect(
    () => () => {
      if (keyHoldRef.current !== null) window.clearTimeout(keyHoldRef.current);
    },
    []
  );

  if (plants.length === 0) return null;

  const current = plants[index];
  const currentSchedule = schedules.get(current.id);
  const currentGap = currentSchedule ? wateringGap(currentSchedule) : null;

  return (
    <div
      className={className ? `plants-spotlight ${className}` : 'plants-spotlight'}
      data-testid="plants-spotlight"
      data-paused={running ? 'false' : 'true'}
      data-reduced={reducedMotion ? 'true' : 'false'}
      style={{ '--spotlight-interval': `${SPOTLIGHT_INTERVAL_MS}ms` } as React.CSSProperties}
      tabIndex={0}
      aria-label={t('plantsWidget.spotlightLabel')}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="plants-spotlight__stage">
        {window_slides.map(({ position, plant }) => {
          const schedule = schedules.get(plant.id);
          if (!schedule) return null;
          const active = position === index;
          return (
            <div className="plants-spotlight__slide" data-active={active ? 'true' : 'false'} data-status={schedule.status} key={plant.id} aria-hidden={!active}>
              <div className="plants-spotlight__scene">
                <PlantIllustration
                  species={plant.species as PlantSpecies}
                  wiltProgress={schedule.wiltProgress}
                  name={plant.name}
                  animate={!reducedMotion}
                  className="plants-spotlight__ghost"
                />
              </div>
              <div className="plants-spotlight__dragger" style={active && dragX ? { transform: `translateX(${dragX * 0.35}px)` } : undefined}>
                <div className="plants-spotlight__figure">
                  <PlantIllustration
                    species={plant.species as PlantSpecies}
                    wiltProgress={schedule.wiltProgress}
                    name={plant.name}
                    animate={!reducedMotion}
                    className="plants-spotlight__plant"
                  />
                </div>
              </div>
            </div>
          );
        })}

        {/* The chrome lives on the slider itself: arrows on the edges, the
            play switch in a corner, and the plant's own card at the foot. No
            separate strip is spent on navigation. */}
        <button
          type="button"
          className="plants-spotlight__arrow plants-spotlight__arrow--prev"
          aria-label={t('plantsWidget.previousPlant')}
          onClick={() => go(-1)}
        >
          {rtl ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="plants-spotlight__arrow plants-spotlight__arrow--next"
          aria-label={t('plantsWidget.nextPlant')}
          onClick={() => go(1)}
        >
          {rtl ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="plants-spotlight__play"
          aria-label={autoPaused ? t('plantsWidget.playSlides') : t('plantsWidget.pauseSlides')}
          onClick={() => setAutoPaused((current) => !current)}
        >
          {autoPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        </button>

        <div className="plants-spotlight__foot">
          <div className="plants-spotlight__dots" role="tablist" aria-label={t('plantsWidget.spotlightLabel')}>
            {plants.map((plant, position) => {
              const schedule = schedules.get(plant.id);
              return (
                <button
                  type="button"
                  key={plant.id}
                  role="tab"
                  className="plants-spotlight__dot"
                  data-status={schedule?.status ?? 'healthy'}
                  aria-selected={position === index}
                  aria-label={t('plantsWidget.showPlant', { name: plant.name })}
                  onClick={() => setIndex(position)}
                />
              );
            })}
          </div>
          <div className="plants-spotlight__caption" key={current.id} data-plant-id={current.id} data-status={currentSchedule?.status}>
            <div className="plants-spotlight__heading">
              <h4 className="plants-spotlight__name">{current.name}</h4>
              {currentSchedule ? (
                <span className={`plants-chip plants-chip--${currentSchedule.status}`}>{t(plantStatusKey(currentSchedule.status))}</span>
              ) : null}
            </div>
            <p className="plants-spotlight__species">{t(`plant.species.${current.species as PlantSpecies}`)}</p>
            {currentSchedule && currentGap ? (
              <p className="plants-spotlight__gap">
                {t(currentGap.key, { days: currentGap.days })}
                <span className="plants-card__separator" aria-hidden="true">·</span>
                <span className="plants-card__last">
                  {t('plantsWidget.lastWatered', { date: formatDisplayDate(new Date(current.lastWateredAt), 'short') })}
                </span>
              </p>
            ) : null}
            {canWater && onWater ? (
              <button type="button" className="good-button plants-spotlight__water" onClick={() => onWater(current)}>
                <Droplets aria-hidden="true" />
                {t('plantsWidget.waterNow')}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <span className="plants-spotlight__progress" key={index} aria-hidden="true" />
      <span className="plants-spotlight__status" aria-live="polite">
        {currentSchedule ? `${current.name} — ${t(plantStatusKey(currentSchedule.status))}` : ''}
      </span>
    </div>
  );
}
