import { X } from '../components/icons';
import { type RefObject, useId, useMemo, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { ColorPicker } from '../components/ColorPicker';
import { kanbanColorPresets } from '../kanban/kanban-model';
import type { HexColor } from '../lib/color';
import { t } from '../i18n';
import {
  DEFAULT_PROJECT_COLOR,
  PROJECT_STATUSES,
  type Project,
  type ProjectDraft,
  type ProjectStatus
} from './project-model';

type ProjectDialogProps = {
  mode: { type: 'create' } | { type: 'edit'; project: Project };
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onCreate(draft: ProjectDraft): Promise<unknown>;
  onUpdate(project: Project, draft: ProjectDraft): Promise<unknown>;
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('common.opFailed');
}

/**
 * A project is a name, an optional note, a colour and a state. It is never
 * deleted, only archived, so the tasks that point at it keep their history.
 */
export function ProjectDialog({ mode, restoreFocusRef, onClose, onCreate, onUpdate }: ProjectDialogProps) {
  const initial = useMemo(
    () =>
      mode.type === 'edit'
        ? {
            name: mode.project.name,
            description: mode.project.description,
            color: mode.project.color,
            status: mode.project.status
          }
        : { name: '', description: '', color: DEFAULT_PROJECT_COLOR, status: 'active' as ProjectStatus },
    [mode]
  );
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [color, setColor] = useState<HexColor>(initial.color);
  const [status, setStatus] = useState<ProjectStatus>(initial.status);
  const [error, setError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  const dirty =
    name !== initial.name ||
    description !== initial.description ||
    color !== initial.color ||
    status !== initial.status;

  async function save() {
    if (!name.trim()) {
      setError(t('projects.errorName'));
      return;
    }
    setError('');
    setDialogError('');
    setBusy(true);
    try {
      const draft: ProjectDraft = { name: name.trim(), description: description.trim(), color, status };
      if (mode.type === 'create') await onCreate(draft);
      else await onUpdate(mode.project, draft);
      onClose();
    } catch (reason) {
      const repositoryError = reason as { code?: string; field?: string; message?: string };
      if (repositoryError.code === 'validation_error' && repositoryError.field === 'name') {
        setError(repositoryError.message ?? t('projects.errorName'));
      } else {
        setDialogError(message(reason));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={mode.type === 'create' ? t('projects.createTitle') : t('projects.editTitle')}
      ariaLabelledBy={titleId}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={busy ? () => undefined : onClose}
      className="project-dialog"
      headerActions={
        <button
          type="button"
          aria-label={t('common.close')}
          className="good-icon-button"
          disabled={busy}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      }
      footer={
        <div className="kanban-dialog__actions">
          {dialogError ? (
            <div role="alert" className="dialog-error">
              {dialogError}
            </div>
          ) : null}
          <button type="button" className="good-button" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="good-button good-button--primary"
            disabled={busy || (mode.type === 'edit' && !dirty)}
            onClick={() => void save()}
          >
            {busy ? t('common.saving') : t('projects.save')}
          </button>
        </div>
      }
    >
      <form className="kanban-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="good-field">
          <label htmlFor="project-name">{t('projects.name')}</label>
          <input
            id="project-name"
            className="good-input"
            autoComplete="off"
            value={name}
            disabled={busy}
            aria-describedby={error ? 'project-name-error' : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {error ? (
            <span id="project-name-error" className="field-error">
              {error}
            </span>
          ) : null}
        </div>

        <div className="good-field">
          <label htmlFor="project-description">{t('projects.description')}</label>
          <textarea
            id="project-description"
            className="good-input"
            rows={3}
            value={description}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <fieldset className="good-field">
          <legend>{t('projects.status')}</legend>
          <div className="project-status-options">
            {PROJECT_STATUSES.map((value) => (
              <label key={value} className={`project-status-option${status === value ? ' project-status-option--active' : ''}`}>
                <input
                  type="radio"
                  name="project-status"
                  value={value}
                  checked={status === value}
                  disabled={busy}
                  onChange={() => setStatus(value)}
                />
                {t(`projectStatus.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <ColorPicker
          legend={t('projects.color')}
          name="project-color"
          value={color}
          presets={kanbanColorPresets()}
          recentColors={[]}
          disabled={busy}
          onChange={setColor}
        />
      </form>
    </Dialog>
  );
}
