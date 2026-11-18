import { X } from '../components/icons';
import { useEffect, useId, useMemo, useState, type RefObject } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { t } from '../i18n';
import { toIsoDate } from '../lib/date';
import {
  createPlantForm,
  plantToForm,
  toPlantDraft,
  validatePlantForm,
  type PlantFormDraft
} from './plant-draft';
import {
  defaultIntervalDays,
  PLANT_INTERVAL_MAX_DAYS,
  PLANT_INTERVAL_MIN_DAYS,
  speciesOptions,
  type Plant,
  type PlantDraft,
  type PlantSpecies
} from './plant-model';

type PlantDialogProps = {
  mode: { type: 'create' } | { type: 'edit'; plant: Plant };
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onCreate(draft: PlantDraft): Promise<unknown>;
  onUpdate(plant: Plant, draft: PlantDraft): Promise<unknown>;
  onDelete(plant: Plant): Promise<unknown>;
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error.message as string)
    : t('common.opFailed');
}

// The date picker edits the day only: watering happens at a time of day, and
// rewriting the whole timestamp from a calendar click would lose it.
function dateOf(isoTimestamp: string, fallback: Date) {
  const parsed = new Date(isoTimestamp);
  return toIsoDate(Number.isFinite(parsed.getTime()) ? parsed : fallback);
}

function withDate(isoTimestamp: string, isoDate: string, now: Date) {
  const source = new Date(isoTimestamp);
  const time = Number.isFinite(source.getTime()) ? source : now;
  const pad = (value: number) => String(value).padStart(2, '0');
  const local = `${isoDate}T${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
  const parsed = new Date(local);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : time.toISOString();
}

export function PlantDialog({ mode, restoreFocusRef, onClose, onCreate, onUpdate, onDelete }: PlantDialogProps) {
  const now = useMemo(() => new Date(), []);
  const initial = useMemo<PlantFormDraft>(
    () => (mode.type === 'edit' ? plantToForm(mode.plant) : createPlantForm('monstera', now)),
    [mode, now]
  );
  const [form, setForm] = useState<PlantFormDraft>(initial);
  const [fieldError, setFieldError] = useState<Partial<Record<keyof PlantFormDraft, string>>>({});
  const [dialogError, setDialogError] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  useEffect(() => { setForm(initial); }, [initial]);

  function update(patch: Partial<PlantFormDraft>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function chooseSpecies(species: PlantSpecies) {
    // Moving to another species carries its usual cadence along, unless the user
    // already dialled in their own — then their number stays.
    const previousDefault = defaultIntervalDays(form.species);
    const patch: Partial<PlantFormDraft> = { species };
    if (form.wateringIntervalDays === previousDefault) patch.wateringIntervalDays = defaultIntervalDays(species);
    update(patch);
  }

  function requestClose() {
    if (busy) return;
    onClose();
  }

  async function save() {
    const errors = validatePlantForm(form);
    setFieldError(errors);
    if (Object.keys(errors).length > 0) return;
    setDialogError('');
    setBusy(true);
    try {
      const draft = toPlantDraft(form);
      if (mode.type === 'create') await onCreate(draft);
      else await onUpdate(mode.plant, draft);
      onClose();
    } catch (reason) {
      setDialogError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (mode.type !== 'edit') return;
    setDialogError('');
    setBusy(true);
    try {
      await onDelete(mode.plant);
      setConfirmDelete(false);
      onClose();
    } catch (reason) {
      setConfirmDelete(false);
      setDialogError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={mode.type === 'create' ? t('plantDialog.createTitle') : t('plantDialog.editTitle')}
      ariaLabelledBy={titleId}
      restoreFocusRef={restoreFocusRef}
      isTopLayer={!confirmDelete && !dateOpen}
      onRequestClose={requestClose}
      className="plant-dialog"
      headerActions={
        <button type="button" aria-label={t('common.close')} className="good-icon-button" disabled={busy} onClick={requestClose}>
          <X aria-hidden="true" />
        </button>
      }
      footer={
        <div className="plant-dialog__actions">
          {dialogError ? (
            <div role="alert" className="dialog-error">
              {dialogError}
            </div>
          ) : null}
          {mode.type === 'edit' ? (
            <button type="button" className="good-button good-button--danger-ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
              {t('plantDialog.deletePlant')}
            </button>
          ) : null}
          <button type="button" className="good-button" disabled={busy} onClick={requestClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="good-button good-button--primary" disabled={busy} onClick={() => void save()}>
            {busy ? t('common.saving') : t('plantDialog.savePlant')}
          </button>
        </div>
      }
    >
      <form className="plant-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="good-field">
          <label htmlFor="plant-name">{t('plantDialog.name')}</label>
          <input
            id="plant-name"
            className="good-input"
            autoComplete="off"
            placeholder={t('plantDialog.namePlaceholder')}
            value={form.name}
            disabled={busy}
            aria-describedby={fieldError.name ? 'plant-name-error' : undefined}
            onChange={(event) => update({ name: event.target.value })}
          />
          {fieldError.name ? (
            <span id="plant-name-error" className="field-error">
              {fieldError.name}
            </span>
          ) : null}
        </div>

        <Select
          id="plant-species"
          label={t('plantDialog.species')}
          options={speciesOptions().map((option) => ({
            value: option.value,
            label: `${option.label} · ${t('plantsWidget.recommendedDays', { days: option.days })}`
          }))}
          value={form.species}
          disabled={busy}
          onChange={(value) => chooseSpecies(value as PlantSpecies)}
        />

        <div className="good-field">
          <label htmlFor="plant-interval">{t('plantDialog.interval')}</label>
          <input
            id="plant-interval"
            className="good-input"
            type="number"
            inputMode="numeric"
            min={PLANT_INTERVAL_MIN_DAYS}
            max={PLANT_INTERVAL_MAX_DAYS}
            value={form.wateringIntervalDays}
            disabled={busy}
            aria-describedby={fieldError.wateringIntervalDays ? 'plant-interval-error' : 'plant-interval-hint'}
            onChange={(event) => update({ wateringIntervalDays: Number(event.target.value) })}
          />
          {fieldError.wateringIntervalDays ? (
            <span id="plant-interval-error" className="field-error">
              {fieldError.wateringIntervalDays}
            </span>
          ) : (
            <span id="plant-interval-hint" className="plant-form__hint">
              {t('plantDialog.intervalHint', { min: PLANT_INTERVAL_MIN_DAYS, max: PLANT_INTERVAL_MAX_DAYS })}
            </span>
          )}
        </div>

        <div className="good-field">
          <DatePicker
            id="plant-last-watered"
            label={t('plantDialog.lastWatered')}
            value={dateOf(form.lastWateredAt, now)}
            disabled={busy}
            open={dateOpen}
            onOpenChange={setDateOpen}
            onChange={(isoDate) => update({ lastWateredAt: withDate(form.lastWateredAt, isoDate, now) })}
          />
        </div>
      </form>

      {confirmDelete && mode.type === 'edit' ? (
        <ConfirmDialog
          title={t('plantDialog.deleteTitle', { name: mode.plant.name })}
          description={t('common.deleteUnrecoverable')}
          tone="danger"
          confirmLabel={t('common.delete')}
          busyLabel={t('common.deleting')}
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      ) : null}
    </Dialog>
  );
}
