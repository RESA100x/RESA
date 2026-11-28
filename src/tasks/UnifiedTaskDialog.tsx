import { X } from '../components/icons';
import { type RefObject, useEffect, useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { RichEditor } from '../components/rich-text/RichEditor';
import { Select } from '../components/Select';
import type { RepositoryError } from '../data/nowly-repository';
import { t } from '../i18n';
import { KanbanMultiSelect } from '../kanban/KanbanMultiSelect';
import {
  presetToRecurrence,
  recurrenceToPreset,
  validateRecurrence,
  WEEKDAYS,
  weekdayOf,
  type RecurrencePreset
} from '../lib/recurrence';
import type { Recurrence, RecurrenceFreq, Weekday } from '../calendar/calendar-model';
import { quadrantLabel } from '../matrix/matrix-model';
import { useProjects } from '../projects/useProjects';
import { useContacts } from '../phonebook/useContacts';
import { useTeamMembers } from '../sync/useTeamMembers';
import { priorityColors } from './task-projections';
import { useTaskWorkspace } from './TaskWorkspaceContext';
import { TaskStepsField, type TaskStepItem } from './TaskStepsField';
import {
  defaultTaskPriority,
  taskPriorityOrder,
  type Task,
  type TaskDraft,
  type TaskPriority
} from './task-model';

type Mode =
  | { type: 'create'; dueDate: string | null; laneId?: string | null; priority?: TaskPriority }
  | { type: 'edit'; task: Task };

type Props = {
  mode: Mode;
  // The matrix does not use lanes, so it hides the lane field; new tasks then
  // stay off the kanban board and edits keep the task's lane.
  showLane?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onSaved?(task: Task): void | Promise<void>;
  onDirtyChange?(dirty: boolean): void;
};

type Form = {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string;
  laneId: string | null;
  projectId: string | null;
  assigneeContactId: string | null;
  assigneeUserId: string | null;
  tagIds: string[];
  steps: TaskStepItem[];
  stepInput: string;
  recurrence: Recurrence | null;
};

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const presetOptions = () => (['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom'] as const)
  .map((preset) => ({ value: preset, label: t(`recurrence.preset.${preset}`) }));
const freqOptions = () => (['daily', 'weekly', 'monthly', 'yearly'] as const)
  .map((freq) => ({ value: freq, label: t(`recurrence.freq.${freq}`) }));

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('common.opFailed');
}

export function UnifiedTaskDialog({ mode, showLane = true, restoreFocusRef, onClose, onSaved, onDirtyChange }: Props) {
  const workspace = useTaskWorkspace();
  const { projects } = useProjects();
  const { contacts } = useContacts();
  const team = useTeamMembers();
  const snapshot = workspace.workspace.data;
  const initial = useMemo<Form>(() => {
    if (mode.type === 'edit') {
      return {
        title: mode.task.title,
        description: mode.task.description,
        priority: mode.task.priority,
        dueDate: mode.task.dueDate ?? '',
        laneId: mode.task.laneId,
        projectId: mode.task.projectId ?? null,
        assigneeContactId: mode.task.assigneeContactId ?? null,
        assigneeUserId: mode.task.assigneeUserId ?? null,
        tagIds: mode.task.tagIds,
        steps: (mode.task.steps ?? []).map((step) => ({
          key: step.id, id: step.id, title: step.title, completed: step.completed
        })),
        stepInput: '',
        recurrence: mode.task.recurrence ?? null
      };
    }
    return {
      title: '',
      description: '',
      priority: mode.priority ?? defaultTaskPriority,
      dueDate: mode.dueDate ?? '',
      laneId: mode.laneId !== undefined ? mode.laneId : showLane ? snapshot.defaultLaneId : null,
      projectId: null,
      assigneeContactId: null,
      assigneeUserId: null,
      tagIds: [],
      steps: [],
      stepInput: '',
      recurrence: null
    };
  }, [mode, showLane, snapshot.defaultLaneId]);
  // Any task can join (or leave) the board from here; an empty lane means it
  // stays a matrix-only task.
  const laneVisible = showLane && snapshot.lanes.length > 0;
  const [form, setForm] = useState(initial);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [recurrenceDateOpen, setRecurrenceDateOpen] = useState(false);
  const [preset, setPreset] = useState<RecurrencePreset>(() =>
    recurrenceToPreset(initial.recurrence, `${initial.dueDate || todayIso()}T00:00`)
  );
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
  const titleId = useId();

  const dirty = JSON.stringify(initial) !== JSON.stringify(form);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const activeTags = snapshot.tags.filter((tag) => !tag.archivedAt || form.tagIds.includes(tag.id));
  const laneOptions = [
    { value: '', label: t('taskModal.noLane') },
    ...snapshot.lanes.map((lane) => ({ value: lane.id, label: lane.name }))
  ];
  const projectOptions = [
    { value: '', label: t('taskModal.noProject') },
    ...projects.data
      .filter((project) => !project.archivedAt)
      .map((project) => ({ value: project.id, label: project.name }))
  ];
  const assigneeOptions = [
    { value: '', label: t('taskModal.noAssignee') },
    ...contacts.data.map((contact) => ({ value: contact.id, label: contact.name }))
  ];
  // Only a shared workspace has a second person to hand work to; a solo
  // account keeps the phone-book assignee alone.
  const delegateOptions = [
    { value: '', label: t('sync.noDelegate') },
    ...team.members
      .filter((member) => member.userId !== team.userId)
      .map((member) => ({
        value: member.userId,
        label: member.displayName ?? member.userId.slice(0, 8)
      }))
  ];
  const canDelegate = team.signedIn && delegateOptions.length > 1;

  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (fieldError?.field === key) setFieldError(null);
  };
  const toggle = (values: string[], id: string, checked: boolean) =>
    checked ? [...values, id] : values.filter((value) => value !== id);

  const recurrenceAnchor = () => `${form.dueDate || todayIso()}T00:00`;
  const changePreset = (next: RecurrencePreset) => {
    setPreset(next);
    update('recurrence', presetToRecurrence(next, recurrenceAnchor()));
  };
  const patchRecurrence = (patch: Partial<Recurrence>) => {
    if (!form.recurrence) return;
    update('recurrence', { ...form.recurrence, ...patch });
  };
  const toggleWeekday = (day: Weekday) => {
    if (!form.recurrence) return;
    const chosen = new Set(form.recurrence.byDay);
    if (!chosen.delete(day)) chosen.add(day);
    patchRecurrence({ byDay: WEEKDAYS.filter((value) => chosen.has(value)) });
  };
  const changeEnd = (kind: Recurrence['end']['kind']) => {
    if (!form.recurrence) return;
    const anchor = form.dueDate || todayIso();
    const end: Recurrence['end'] = kind === 'until'
      ? { kind, date: anchor }
      : kind === 'count'
        ? { kind, count: 10 }
        : { kind: 'never' };
    patchRecurrence({ end });
  };
  // A weekly rule seeded from the due date follows it when the date changes.
  const changeDueDate = (value: string) => {
    update('dueDate', value);
    if (value && form.recurrence?.freq === 'weekly' && form.recurrence.byDay.length === 1) {
      patchRecurrence({ byDay: [weekdayOf(value)] });
    }
  };

  function requestClose() {
    if (busy) return;
    if (dirty) setConfirm('discard');
    else onClose();
  }

  function draft(): TaskDraft {
    return {
      title: form.title.trim(),
      description: form.description,
      priority: form.priority,
      dueDate: form.dueDate || null,
      // Completion is toggled from the matrix checkbox; the dialog keeps it as is.
      completed: mode.type === 'edit' ? mode.task.completed : false,
      laneId: form.laneId,
      tagIds: form.tagIds,
      steps: [
        ...form.steps.map(({ id, title, completed }) => ({ id, title: title.trim(), completed })),
        // Text typed but not yet added is kept as the last step rather than lost.
        ...(form.stepInput.trim() ? [{ id: null, title: form.stepInput.trim(), completed: false }] : [])
      ]
    };
  }

  async function save() {
    if (!form.title.trim()) {
      setFieldError({ field: 'title', message: t('taskDraft.errorTitle') });
      return;
    }
    const recurrenceError = validateRecurrence(form.recurrence, recurrenceAnchor());
    if (recurrenceError) {
      setFieldError({ field: 'recurrence', message: recurrenceError });
      return;
    }
    setBusy(true);
    setDialogError('');
    setFieldError(null);
    try {
      let saved = mode.type === 'create'
        ? await workspace.createTask(draft())
        : await workspace.updateTask(mode.task.id, draft());
      // Recurrence lives on its own command so the other task writers
      // (assistant, quick toggles) never wipe an existing rule.
      if (JSON.stringify(saved.recurrence ?? null) !== JSON.stringify(form.recurrence)) {
        saved = await workspace.setTaskRecurrence(saved.id, form.recurrence);
      }
      // The project is its own command, so attaching one never fights the
      // other task writers (assistant, quick add, board drag).
      if ((saved.projectId ?? null) !== form.projectId) {
        saved = await workspace.setTaskProject(saved.id, form.projectId);
      }
      // Same reasoning for the assignee: one command, so a person can be
      // attached from the meeting, the board or this dialog without a write
      // race with the other task writers.
      if ((saved.assigneeContactId ?? null) !== form.assigneeContactId) {
        saved = await workspace.setTaskAssignee(saved.id, form.assigneeContactId);
      }
      // Delegation to a teammate account is its own command too, so the
      // delegator and the assignee stay recorded together.
      if ((saved.assigneeUserId ?? null) !== form.assigneeUserId) {
        saved = await workspace.setTaskDelegate(
          saved.id,
          form.assigneeUserId,
          form.assigneeUserId ? team.userId : null
        );
      }
      await onSaved?.(saved);
      onClose();
    } catch (error) {
      const repositoryError = error as RepositoryError;
      if (repositoryError.code === 'validation_error' && repositoryError.field) {
        setFieldError({ field: repositoryError.field, message: repositoryError.message });
      } else {
        setDialogError(message(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (mode.type !== 'edit') return;
    setBusy(true);
    setDialogError('');
    try {
      await workspace.deleteTask(mode.task.id);
      onClose();
    } catch (error) {
      setDialogError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Dialog
      title={mode.type === 'create' ? t('taskModal.createTitle') : t('taskModal.editTitle')}
      ariaLabelledBy={titleId}
      isTopLayer={!confirm && !dateOpen && !recurrenceDateOpen}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={requestClose}
      className="task-dialog"
      headerActions={
        <button type="button" aria-label={t('common.close')} className="good-icon-button" disabled={busy} onClick={requestClose}>
          <X aria-hidden="true" />
        </button>
      }
      footer={<div className="task-dialog__actions">
        {dialogError && !confirm ? <div role="alert" className="dialog-error">{dialogError}</div> : null}
        {mode.type === 'edit' ? (
          <button type="button" className="good-button good-button--danger-ghost" disabled={busy} onClick={() => setConfirm('delete')}>
            {t('taskModal.deleteTask')}
          </button>
        ) : null}
        <button type="button" className="good-button" disabled={busy} onClick={requestClose}>{t('common.cancel')}</button>
        <button type="button" className="good-button good-button--primary" disabled={busy} onClick={() => void save()}>
          {busy ? t('common.saving') : t('taskModal.saveTask')}
        </button>
      </div>}
    >
      <form className="task-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="good-field">
          <label htmlFor="unified-task-title">{t('taskModal.title')}</label>
          <input id="unified-task-title" className="good-input" autoComplete="off" value={form.title} disabled={busy}
            onChange={(event) => update('title', event.target.value)}
            onKeyDown={(event) => {
              // A second text box (the step input) turns off the browser's
              // implicit Enter submission, so the title keeps Enter-to-save here.
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void save();
            }} />
          {fieldError?.field === 'title' ? <span className="field-error">{fieldError.message}</span> : null}
        </div>
        <fieldset className="quadrant-picker" disabled={busy}>
          <legend className="quadrant-picker__legend">{t('taskModal.quadrant')}</legend>
          <div className="quadrant-picker__grid">
            {taskPriorityOrder.map((priority) => (
              <label key={priority} className="quadrant-picker__option">
                <input type="radio" className="quadrant-picker__input" name="unified-task-quadrant" value={priority}
                  checked={form.priority === priority} onChange={() => update('priority', priority)} />
                <span className="quadrant-picker__dot" style={{ background: priorityColors[priority] }} aria-hidden="true" />
                {quadrantLabel(priority)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="task-form__row">
          {laneVisible ? (
            <Select id="unified-task-lane" label={t('taskModal.lane')} options={laneOptions} value={form.laneId ?? ''}
              disabled={busy} onChange={(value) => update('laneId', value || null)} />
          ) : null}
          <Select id="unified-task-project" label={t('taskModal.project')} options={projectOptions}
            value={form.projectId ?? ''} disabled={busy}
            onChange={(value) => update('projectId', value || null)} />
          <Select id="unified-task-assignee" label={t('taskModal.assignee')} options={assigneeOptions}
            searchable value={form.assigneeContactId ?? ''} disabled={busy}
            onChange={(value) => update('assigneeContactId', value || null)} />
          {canDelegate ? (
            <Select id="unified-task-delegate" label={t('sync.delegate')} options={delegateOptions}
              value={form.assigneeUserId ?? ''} disabled={busy}
              onChange={(value) => update('assigneeUserId', value || null)} />
          ) : null}
          <DatePicker id="unified-task-due-date" label={t('taskModal.dueDate')} value={form.dueDate}
            disabled={busy} open={dateOpen} onOpenChange={setDateOpen} onChange={changeDueDate} />
        </div>
        <fieldset className="task-form__recurrence" disabled={busy}>
          <legend>{t('taskModal.recurrence')}</legend>
          <div className="recurrence-field">
            <Select id="unified-task-recurrence" label={t('taskModal.recurrence')} hideLabel
              options={presetOptions()} value={preset} onChange={(value) => changePreset(value as RecurrencePreset)} />
            {preset === 'custom' && form.recurrence ? (
              <div className="recurrence-custom">
                <div className="form-row">
                  <Select id="unified-task-recurrence-freq" label={t('recurrence.freqLabel')}
                    options={freqOptions()} value={form.recurrence.freq}
                    onChange={(value) => patchRecurrence({ freq: value as RecurrenceFreq })} />
                  <div className="good-field">
                    <label htmlFor="unified-task-recurrence-interval">{t('recurrence.interval')}</label>
                    <input id="unified-task-recurrence-interval" className="good-input" type="number" min={1}
                      value={form.recurrence.interval}
                      onChange={(event) => patchRecurrence({ interval: Number(event.target.value) })} />
                  </div>
                </div>
                {form.recurrence.freq === 'weekly' ? (
                  <fieldset className="recurrence-weekdays">
                    <legend>{t('recurrence.byDay')}</legend>
                    {WEEKDAYS.map((day, index) => (
                      <label key={day} className="form-check form-check-custom form-check-solid">
                        <input className="form-check-input" type="checkbox"
                          checked={form.recurrence?.byDay.includes(day) ?? false}
                          onChange={() => toggleWeekday(day)} />
                        <span className="form-check-label">{t('recurrence.weekdays').split(',')[index]}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                <fieldset className="recurrence-end">
                  <legend>{t('recurrence.endLabel')}</legend>
                  {(['never', 'until', 'count'] as const).map((kind) => (
                    <label key={kind} className="form-check form-check-custom form-check-solid">
                      <input className="form-check-input" type="radio" name="unified-task-recurrence-end"
                        value={kind} checked={form.recurrence?.end.kind === kind}
                        onChange={() => changeEnd(kind)} />
                      <span className="form-check-label">{t(`recurrence.end.${kind}`)}</span>
                    </label>
                  ))}
                </fieldset>
                {form.recurrence.end.kind === 'until' ? (
                  <DatePicker id="unified-task-recurrence-until" label={t('recurrence.until')}
                    value={form.recurrence.end.date} open={recurrenceDateOpen}
                    onOpenChange={setRecurrenceDateOpen}
                    onChange={(date) => patchRecurrence({ end: { kind: 'until', date } })} />
                ) : null}
                {form.recurrence.end.kind === 'count' ? (
                  <div className="good-field">
                    <label htmlFor="unified-task-recurrence-count">{t('recurrence.count')}</label>
                    <input id="unified-task-recurrence-count" className="good-input" type="number" min={1}
                      value={form.recurrence.end.count}
                      onChange={(event) => patchRecurrence({ end: { kind: 'count', count: Number(event.target.value) } })} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {fieldError?.field === 'recurrence' ? <span className="field-error">{fieldError.message}</span> : null}
            {form.recurrence ? <p className="task-form__hint">{t('taskModal.recurrenceHint')}</p> : null}
          </div>
        </fieldset>
        <div className="good-field">
          <label id="unified-task-description-label">{t('kanbanTask.description')}</label>
          <RichEditor id="unified-task-description" labelledBy="unified-task-description-label"
            value={form.description} disabled={busy} placeholder={t('richEditor.placeholder')}
            onChange={(markdown) => update('description', markdown)} />
        </div>
        <TaskStepsField steps={form.steps} input={form.stepInput} disabled={busy}
          error={fieldError?.field === 'steps' ? fieldError.message : undefined}
          onStepsChange={(steps) => update('steps', steps)}
          onInputChange={(value) => update('stepInput', value)} />
        <KanbanMultiSelect legend={t('kanbanTask.tags')}
          options={activeTags.map((tag) => ({ id: tag.id, label: tag.name }))} selected={form.tagIds} disabled={busy}
          emptyHint={t('kanbanTask.tagsEmpty')}
          onToggle={(id, checked) => update('tagIds', toggle(form.tagIds, id, checked))} />
      </form>
    </Dialog>
    {confirm === 'discard' ? (
      <ConfirmDialog title={t('common.discardTitle')} description={t('common.discardDesc')}
        confirmLabel={t('common.discard')} busyLabel={t('common.discarding')}
        onCancel={() => setConfirm(null)} onConfirm={onClose} />
    ) : null}
    {confirm === 'delete' && mode.type === 'edit' ? (
      <ConfirmDialog title={t('taskModal.deleteTitle', { title: mode.task.title })}
        description={t('common.deleteUnrecoverable')}
        tone="danger" confirmLabel={t('common.permanentDelete')} busyLabel={t('common.deleting')}
        busy={busy} errorMessage={dialogError} onCancel={() => setConfirm(null)} onConfirm={() => void remove()} />
    ) : null}
  </>;
}
