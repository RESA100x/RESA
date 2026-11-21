import { Download, Plus, Trash2, X } from '../components/icons';
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { Dialog } from '../components/Dialog';
import { DatePicker } from '../components/DatePicker';
import { Select } from '../components/Select';
import { TimePicker } from '../components/TimePicker';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useContacts } from '../phonebook/useContacts';
import { useProjects } from '../projects/useProjects';
import { useTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { defaultTaskPriority } from '../tasks/task-model';
import { t } from '../i18n';
import {
  ATTENDANCE_STATES,
  MEETING_STATUSES,
  attendanceLabel,
  draftOf,
  emptyMeetingDraft,
  localStamp,
  meetingStatusLabel,
  validateMeetingDraft,
  type AttendanceState,
  type Meeting,
  type MeetingDraft,
  type MeetingItemDraft,
  type MeetingItemKind,
  type MeetingStatus
} from './meeting-model';
import { useMeetings } from './useMeetings';
import './meeting.css';

type MeetingDialogProps = {
  /** null opens the create form. */
  meetingId: string | null;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('common.opFailed');
}

function timeOf(stamp: string): string {
  return stamp.slice(11, 16);
}

function dateOf(stamp: string): string {
  return stamp.slice(0, 10);
}

function withDate(stamp: string, date: string): string {
  return `${date}T${timeOf(stamp) || '09:00'}`;
}

function withTime(stamp: string, time: string): string {
  return `${dateOf(stamp)}T${time}`;
}

/** One hour after a 'YYYY-MM-DDTHH:MM' stamp, clamped inside the same day. */
function hourLater(stamp: string): string {
  const [date, time] = stamp.split('T');
  const [hour, minute] = time.split(':').map(Number);
  if (hour >= 23) return `${date}T23:59`;
  return `${date}T${String(hour + 1).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function MeetingDialog({ meetingId, restoreFocusRef, onClose }: MeetingDialogProps) {
  const titleId = useId();
  const { meetings, saveMeeting, deleteMeeting, exportMeeting, canExport } = useMeetings();
  const { contacts } = useContacts();
  const { projects } = useProjects();
  const workspace = useTaskWorkspace();
  const meeting = meetingId ? meetings.data.find((row) => row.id === meetingId) ?? null : null;
  const [form, setForm] = useState<MeetingDraft>(() => (meeting ? draftOf(meeting) : emptyMeetingDraft()));
  const [initialized, setInitialized] = useState(!meetingId);
  const [busy, setBusy] = useState(false);
  const [errorNote, setErrorNote] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [openItemDate, setOpenItemDate] = useState<string | null>(null);
  const [convertIndex, setConvertIndex] = useState<number | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // The list arrives asynchronously; seed the form once, never on every refresh.
  useEffect(() => {
    if (meetingId && !initialized && meeting) {
      setForm(draftOf(meeting));
      setInitialized(true);
    }
  }, [initialized, meeting, meetingId]);

  const contactOptions = useMemo(
    () => contacts.data.map((contact) => ({ value: contact.id, label: contact.name })),
    [contacts.data]
  );
  const contactName = (id: string | null) =>
    id ? contacts.data.find((contact) => contact.id === id)?.name ?? t('meeting.unknownContact') : '';
  const projectOptions = useMemo(
    () => [
      { value: '', label: t('meeting.noProject') },
      ...projects.data.filter((project) => !project.archivedAt).map((project) => ({ value: project.id, label: project.name }))
    ],
    [projects.data]
  );
  const statusOptions = MEETING_STATUSES.map((status) => ({ value: status, label: meetingStatusLabel(status) }));
  const attendanceOptions = ATTENDANCE_STATES.map((state) => ({ value: state, label: attendanceLabel(state) }));

  function update<K extends keyof MeetingDraft>(key: K, value: MeetingDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateItem(index: number, patch: Partial<MeetingItemDraft>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, position) => (position === index ? { ...item, ...patch } : item))
    }));
  }

  function addItem(kind: MeetingItemKind) {
    setForm((current) => ({
      ...current,
      items: [...current.items, { id: null, kind, title: '', ownerContactId: null, dueDate: null, taskId: null }]
    }));
  }

  function removeItem(index: number) {
    setForm((current) => ({ ...current, items: current.items.filter((_, position) => position !== index) }));
  }

  function addAttendee(contactId: string) {
    if (!contactId) return;
    setForm((current) => current.attendees.some((attendee) => attendee.contactId === contactId)
      ? current
      : {
          ...current,
          attendees: [...current.attendees, { contactId, required: true, attendance: 'unknown', lateMinutes: 0 }]
        });
  }

  function updateAttendee(contactId: string, patch: Partial<MeetingDraft['attendees'][number]>) {
    setForm((current) => ({
      ...current,
      attendees: current.attendees.map((attendee) =>
        attendee.contactId === contactId ? { ...attendee, ...patch } : attendee
      )
    }));
  }

  function removeAttendee(contactId: string) {
    setForm((current) => ({
      ...current,
      attendees: current.attendees.filter((attendee) => attendee.contactId !== contactId)
    }));
  }

  async function runSave(): Promise<boolean> {
    const invalid = validateMeetingDraft(form);
    if (invalid) {
      setErrorNote(invalid.message);
      return false;
    }
    setBusy(true);
    setErrorNote('');
    setStatusNote('');
    try {
      await saveMeeting(meetingId, form);
      setStatusNote(t('meeting.saved'));
      return true;
    } catch (reason) {
      setErrorNote(message(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runExport() {
    if (!meetingId) return;
    const path = await save({
      defaultPath: `${form.title.trim() || 'meeting'}.md`,
      filters: [{ name: t('meeting.exportFilter'), extensions: ['md'] }]
    }).catch(() => null);
    if (!path) return;
    try {
      const summary = await exportMeeting(meetingId, path);
      setStatusNote(t('meeting.exported', { path: summary.path }));
    } catch (reason) {
      setErrorNote(message(reason));
    }
  }

  async function runDelete() {
    if (!meetingId) return;
    setBusy(true);
    try {
      await deleteMeeting(meetingId);
      setConfirmDelete(false);
      onClose();
    } catch (reason) {
      setErrorNote(message(reason));
      setBusy(false);
    }
  }

  const agendaItems = form.items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === 'agenda');
  const followups = form.items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === 'followup');

  function renderItems(kind: MeetingItemKind, rows: { item: MeetingItemDraft; index: number }[]) {
    return (
      <div className="meeting-items">
        {rows.map(({ item, index }) => (
          <div key={`${kind}-${index}`} className="meeting-item">
            <input
              className="good-input"
              value={item.title}
              placeholder={t(kind === 'agenda' ? 'meeting.itemPlaceholder' : 'meeting.followupPlaceholder')}
              aria-label={t('meeting.itemTitle')}
              disabled={busy}
              onChange={(event) => updateItem(index, { title: event.target.value })}
            />
            <Select
              id={`meeting-item-owner-${index}`}
              label={t('meeting.owner')}
              hideLabel
              searchable
              options={[{ value: '', label: t('meeting.noOwner') }, ...contactOptions]}
              value={item.ownerContactId ?? ''}
              disabled={busy}
              onChange={(value) => updateItem(index, { ownerContactId: value || null })}
            />
            <DatePicker
              id={`meeting-item-due-${index}`}
              label={t('meeting.dueDate')}
              hideLabel
              value={item.dueDate ?? ''}
              disabled={busy}
              open={openItemDate === `${kind}-${index}`}
              onOpenChange={(open) => setOpenItemDate(open ? `${kind}-${index}` : null)}
              onChange={(value) => updateItem(index, { dueDate: value || null })}
            />
            {item.taskId ? (
              <span className="meeting-item__task" title={t('meeting.linkedTask')}>
                {t('meeting.linkedTask')}
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || !item.title.trim()}
                onClick={() => setConvertIndex(index)}
              >
                {t('meeting.toTask')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-icon"
              aria-label={t('meeting.removeItem')}
              title={t('common.delete')}
              disabled={busy}
              onClick={() => removeItem(index)}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm meeting-items__add" disabled={busy} onClick={() => addItem(kind)}>
          <Plus aria-hidden="true" />
          {t(kind === 'agenda' ? 'meeting.addItem' : 'meeting.addFollowup')}
        </button>
      </div>
    );
  }

  const loading = Boolean(meetingId) && meetings.status === 'loading' && !initialized;
  const missingMeeting = Boolean(meetingId) && meetings.status === 'ready' && !meeting;

  return (
    <>
      <Dialog
        title={meetingId ? t('meeting.editTitle') : t('meeting.createTitle')}
        ariaLabelledBy={titleId}
        initialFocusRef={titleRef}
        restoreFocusRef={restoreFocusRef}
        onRequestClose={onClose}
        className="meeting-dialog"
        headerActions={
          <>
            {canExport && meetingId ? (
              <button
                type="button"
                className="good-icon-button"
                aria-label={t('meeting.export')}
                title={t('meeting.export')}
                disabled={busy}
                onClick={() => void runExport()}
              >
                <Download aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              className="good-icon-button"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
          </>
        }
        footer={
          <div className="meeting-dialog__footer">
            {meetingId ? (
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
                {t('common.delete')}
              </button>
            ) : <span />}
            <span className="meeting-dialog__notes">
              {statusNote ? <span role="status">{statusNote}</span> : null}
              {errorNote ? <span className="dialog-error" role="alert">{errorNote}</span> : null}
            </span>
            <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || loading || missingMeeting}
              onClick={() => void runSave().then((saved) => { if (saved) onClose(); })}
            >
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        }
      >
        {loading ? <p className="empty-copy">{t('meeting.loading')}</p> : null}
        {missingMeeting ? <p className="empty-copy">{t('meeting.notFound')}</p> : null}
        {!loading && !missingMeeting ? (
          <div className="meeting-form">
            <div className="meeting-form__row">
              <label className="good-field meeting-form__title">
                <span>{t('meeting.title')}</span>
                <input
                  ref={titleRef}
                  className="good-input"
                  value={form.title}
                  disabled={busy}
                  onChange={(event) => update('title', event.target.value)}
                />
              </label>
              <Select
                id="meeting-status"
                label={t('meeting.status')}
                options={statusOptions}
                value={form.status}
                disabled={busy}
                onChange={(value) => update('status', value as MeetingStatus)}
              />
              <Select
                id="meeting-project"
                label={t('meeting.project')}
                options={projectOptions}
                value={form.projectId ?? ''}
                disabled={busy}
                onChange={(value) => update('projectId', value || null)}
              />
            </div>
            <div className="meeting-form__row">
              <DatePicker
                id="meeting-date"
                label={t('meeting.date')}
                value={dateOf(form.startsAt)}
                disabled={busy}
                open={dateOpen}
                onOpenChange={setDateOpen}
                onChange={(value) => setForm((current) => ({
                  ...current,
                  startsAt: withDate(current.startsAt, value),
                  endsAt: withDate(current.endsAt, value)
                }))}
              />
              <TimePicker
                id="meeting-start"
                label={t('meeting.start')}
                value={timeOf(form.startsAt)}
                disabled={busy}
                open={startOpen}
                onOpenChange={setStartOpen}
                onChange={(value) => setForm((current) => ({
                  ...current,
                  startsAt: withTime(current.startsAt, value),
                  endsAt: current.endsAt <= withTime(current.startsAt, value)
                    ? hourLater(withTime(current.startsAt, value))
                    : current.endsAt
                }))}
              />
              <TimePicker
                id="meeting-end"
                label={t('meeting.end')}
                value={timeOf(form.endsAt)}
                disabled={busy}
                open={endOpen}
                onOpenChange={setEndOpen}
                onChange={(value) => update('endsAt', withTime(form.endsAt, value))}
              />
              <label className="good-field meeting-form__location">
                <span>{t('meeting.location')}</span>
                <input
                  className="good-input"
                  value={form.location}
                  placeholder={t('meeting.locationPlaceholder')}
                  disabled={busy}
                  onChange={(event) => update('location', event.target.value)}
                />
              </label>
            </div>

            <label className="good-field">
              <span>{t('meeting.agenda')}</span>
              <textarea
                className="good-input meeting-form__text"
                rows={3}
                value={form.agenda}
                placeholder={t('meeting.agendaPlaceholder')}
                disabled={busy}
                onChange={(event) => update('agenda', event.target.value)}
              />
            </label>

            <section className="meeting-section">
              <h4>{t('meeting.attendees')}</h4>
              <div className="meeting-attendees">
                {form.attendees.length === 0 ? <p className="empty-copy">{t('meeting.noAttendees')}</p> : null}
                {form.attendees.map((attendee) => (
                  <div key={attendee.contactId} className="meeting-attendee">
                    <span className="meeting-attendee__name">{contactName(attendee.contactId)}</span>
                    <label className="meeting-attendee__required">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={attendee.required}
                        disabled={busy}
                        onChange={(event) => updateAttendee(attendee.contactId, { required: event.target.checked })}
                      />
                      {t('meeting.required')}
                    </label>
                    <Select
                      id={`meeting-attendance-${attendee.contactId}`}
                      label={t('meeting.attendance')}
                      hideLabel
                      options={attendanceOptions}
                      value={attendee.attendance}
                      disabled={busy}
                      onChange={(value) => updateAttendee(attendee.contactId, {
                        attendance: value as AttendanceState,
                        lateMinutes: value === 'late' ? attendee.lateMinutes || 5 : 0
                      })}
                    />
                    {attendee.attendance === 'late' ? (
                      <label className="meeting-attendee__late">
                        <input
                          type="number"
                          className="good-input"
                          min={0}
                          max={1440}
                          value={attendee.lateMinutes}
                          disabled={busy}
                          aria-label={t('meeting.lateMinutes')}
                          onChange={(event) => updateAttendee(attendee.contactId, {
                            lateMinutes: Math.max(0, Math.min(1440, Number(event.target.value) || 0))
                          })}
                        />
                        <span>{t('meeting.minutesUnit')}</span>
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={t('meeting.removeAttendee')}
                      title={t('common.delete')}
                      disabled={busy}
                      onClick={() => removeAttendee(attendee.contactId)}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="meeting-attendees__add">
                <Select
                  id="meeting-add-attendee"
                  label={t('meeting.addAttendee')}
                  hideLabel
                  searchable
                  options={[{ value: '', label: t('meeting.addAttendee') }, ...contactOptions]}
                  value=""
                  disabled={busy || contacts.data.length === 0}
                  onChange={addAttendee}
                />
                {contacts.data.length === 0 ? <span className="empty-copy">{t('meeting.noContacts')}</span> : null}
              </div>
            </section>

            <section className="meeting-section">
              <h4>{t('meeting.agendaItems')}</h4>
              {renderItems('agenda', agendaItems)}
            </section>

            <section className="meeting-section">
              <h4>{t('meeting.followups')}</h4>
              {renderItems('followup', followups)}
            </section>

            <label className="good-field">
              <span>{t('meeting.minutes')}</span>
              <textarea
                className="good-input meeting-form__text"
                rows={4}
                value={form.minutes}
                placeholder={t('meeting.minutesPlaceholder')}
                disabled={busy}
                onChange={(event) => update('minutes', event.target.value)}
              />
            </label>
          </div>
        ) : null}
      </Dialog>

      {convertIndex !== null ? (
        <TaskFromItemDialog
          item={form.items[convertIndex]}
          meetingTitle={form.title}
          projectId={form.projectId}
          contacts={contactOptions}
          lanes={workspace.workspace.data.lanes.map((lane) => ({ value: lane.id, label: lane.name }))}
          projects={projectOptions}
          onClose={() => setConvertIndex(null)}
          onCreated={async (taskId, dueDate) => {
            const updated = form.items.map((item, index) =>
              index === convertIndex ? { ...item, taskId, dueDate: dueDate ?? item.dueDate } : item
            );
            const next = { ...form, items: updated };
            setForm(next);
            setConvertIndex(null);
            try {
              await saveMeeting(meetingId, next);
              setStatusNote(t('meeting.taskCreated'));
            } catch (reason) {
              setErrorNote(message(reason));
            }
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={t('meeting.deleteTitle')}
          description={t('meeting.deleteBody', { title: form.title })}
          tone="danger"
          confirmLabel={t('common.delete')}
          busyLabel={t('common.saving')}
          busy={busy}
          onConfirm={() => void runDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </>
  );
}

type TaskFromItemDialogProps = {
  item: MeetingItemDraft;
  meetingTitle: string;
  projectId: string | null;
  contacts: { value: string; label: string }[];
  lanes: { value: string; label: string }[];
  projects: { value: string; label: string }[];
  onClose(): void;
  onCreated(taskId: string, dueDate: string | null, laneId: string | null): Promise<void>;
};

/** Turns an agenda item or follow-up into a real task, with the board lane,
 *  project and person chosen up front so it lands where the follow-up belongs. */
function TaskFromItemDialog({
  item,
  meetingTitle,
  projectId,
  contacts,
  lanes,
  projects,
  onClose,
  onCreated
}: TaskFromItemDialogProps) {
  const workspace = useTaskWorkspace();
  const [title, setTitle] = useState(item.title);
  const [laneId, setLaneId] = useState('');
  const [project, setProject] = useState(projectId ?? '');
  const [assignee, setAssignee] = useState(item.ownerContactId ?? '');
  const [dueDate, setDueDate] = useState(item.dueDate ?? '');
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorNote, setErrorNote] = useState('');
  const headingId = useId();

  async function create() {
    if (!title.trim()) {
      setErrorNote(t('meeting.errorItemTitle'));
      return;
    }
    setBusy(true);
    setErrorNote('');
    try {
      const task = await workspace.createTask({
        title: title.trim(),
        description: t('meeting.taskDescription', { meeting: meetingTitle }),
        priority: defaultTaskPriority,
        dueDate: dueDate || null,
        completed: false,
        laneId: laneId || null,
        tagIds: []
      });
      if (assignee) await workspace.setTaskAssignee(task.id, assignee);
      if (project) await workspace.setTaskProject(task.id, project);
      await onCreated(task.id, dueDate || null, laneId || null);
    } catch (reason) {
      setErrorNote(message(reason));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('meeting.taskDialogTitle')}
      ariaLabelledBy={headingId}
      isTopLayer={false}
      onRequestClose={onClose}
      className="meeting-task-dialog"
      footer={
        <div className="meeting-dialog__footer">
          <span className="meeting-dialog__notes">
            {errorNote ? <span className="dialog-error" role="alert">{errorNote}</span> : null}
          </span>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
            {busy ? t('common.saving') : t('meeting.createTask')}
          </button>
        </div>
      }
    >
      <div className="meeting-form">
        <label className="good-field">
          <span>{t('meeting.taskTitle')}</span>
          <input className="good-input" value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="meeting-form__row">
          <Select
            id="meeting-task-lane"
            label={t('taskModal.lane')}
            options={[{ value: '', label: t('taskModal.noLane') }, ...lanes]}
            value={laneId}
            disabled={busy}
            onChange={setLaneId}
          />
          <Select
            id="meeting-task-project"
            label={t('taskModal.project')}
            options={projects}
            value={project}
            disabled={busy}
            onChange={setProject}
          />
          <Select
            id="meeting-task-assignee"
            label={t('meeting.assignee')}
            searchable
            options={[{ value: '', label: t('meeting.noOwner') }, ...contacts]}
            value={assignee}
            disabled={busy}
            onChange={setAssignee}
          />
          <DatePicker
            id="meeting-task-due"
            label={t('taskModal.dueDate')}
            value={dueDate}
            disabled={busy}
            open={dateOpen}
            onOpenChange={setDateOpen}
            onChange={setDueDate}
          />
        </div>
      </div>
    </Dialog>
  );
}

export type { Meeting };
