// Browser fallback for the Tauri IPC layer.
//
// The real desktop app talks to the Rust backend through
// `window.__TAURI_INTERNALS__.invoke`. When the plain Vite page is opened in an
// ordinary browser (no Tauri runtime) that object is `undefined`, so the very
// first `invoke(...)` call throws
// `Cannot read properties of undefined (reading 'invoke')` and the whole app
// fails to boot.
//
// To keep local browser development usable we install a self-contained
// in-memory backend that speaks the same command protocol as the Rust side and
// persists to `localStorage`. This mirrors what the Playwright specs inject,
// but is complete enough to run the full UI. Data lives only in the browser's
// `localStorage`, never the real SQLite database, so this is a development
// convenience, not a substitute for the desktop app.
//
// The shim is only installed when no real (or test-injected) Tauri IPC is
// present, so it never interferes with the desktop build or e2e runs.

// The upload allowlist is shared with the editor rather than copied again, so a
// file the desktop build would refuse is refused here too. ("Self-contained"
// above means it needs no Tauri runtime, not that it avoids imports.)
import { isAllowedAttachmentName } from '../lib/attachment';
import { getBrowserStickerBoard, saveBrowserStickerBoard, uploadBrowserStickerImage, readBrowserStickerImage, discardBrowserStickerImages } from './browser-sticker-store';
import type { StickerBoard } from '../stickers/sticker-model';
import { validateNoteForm, toNoteDraft } from '../lib/note-draft';
import type { NoteDraft } from '../notes/notes-model';
import { toPlantDraft, validatePlantForm } from '../plants/plant-draft';
import type { PlantDraft } from '../plants/plant-model';
import { coerceContactDraft, toContactDraft, validateContactForm } from '../phonebook/contact-draft';
import { withContactDefaults, type Contact, type ContactCategory, type ContactCategoryDraft, type ContactDraft } from '../phonebook/contact-model';
import { normalizeHexColor } from '../lib/color';
import { contentToPlainText, isContentEmpty } from '../components/rich-text/content';
import { normalizeBarMenu } from '../app/bar-menu';
import { isQuickCreateKind } from '../quick-create/request';
import { alarmToDraft, defaultTimeSettings, type Alarm, type AlarmDraft, type AlarmNotice, type TimeSettings } from '../time/time-model';
import { formatDate, nextTaskDueDate } from '../lib/task-recurrence';
import type { Recurrence } from '../calendar/calendar-model';

type Dict = Record<string, unknown>;

const STORAGE_KEY = 'nowly:browser-backend';

type Store = {
  alarmFormatVersion: number;
  timeSettings: TimeSettings;
  alarms: Alarm[];
  // Explicit E2E fixtures only: the Rust backend owns real alarm scheduling.
  alarmNotices: AlarmNotice[];
  events: Dict[];
  categories: Dict[];
  subscriptions: Dict[];
  oauthAccounts: Dict[];
  externalEvents: Dict[];
  tasks: Dict[];
  notes: Dict[];
  plants: Dict[];
  contacts: Dict[];
  contactCategories: Dict[];
  projects: Dict[];
  taskEvents: Dict[];
  meetings: Dict[];
  settings: Dict;
  moduleLayout: Dict[];
  focusSessions: Dict[];
  kanban: {
    lanes: Dict[];
    cards: Dict[];
    priorities: Dict[];
    tags: Dict[];
  };
};

const defaultSettings: Dict = {
  wallpaperEnabled: true,
  launchAtLogin: true,
  targetMonitorId: null,
  density: 'compact',
  weekStart: 'monday',
  dateFormat: 'localized',
  showWeekends: true,
  iconStyle: 'duotone',
  hideTopbarInWallpaper: true, hideModuleBackgroundInWallpaper: false,
  notificationMode: 'notification',
  quickPanelEnabled: true,
  quickPanelShortcut: 'Ctrl+Space',
  screenshotShortcut: 'Ctrl+Alt+A',
  screenshotHistoryShortcut: 'Ctrl+Alt+H',
  quickCreateEventShortcut: '',
  quickCreateTaskShortcut: '',
  quickCreateNoteShortcut: '',
  barMenu: normalizeBarMenu(undefined),
  recentColors: []
};

function emptyStore(): Store {
  return {
    alarmFormatVersion: 1,
    timeSettings: defaultTimeSettings(),
    alarms: [],
    alarmNotices: [],
    events: [],
    categories: [],
    subscriptions: [],
    oauthAccounts: [],
    externalEvents: [],
    tasks: [],
    notes: [],
    plants: [],
    contacts: [],
    contactCategories: [],
    projects: [],
    taskEvents: [],
    meetings: [],
    settings: { ...defaultSettings },
    moduleLayout: [],
    focusSessions: [],
    kanban: { lanes: [], cards: [], priorities: [], tags: [] }
  };
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<Store>;
    const base = emptyStore();
    const settings = { ...base.settings, ...(parsed.settings ?? {}), barMenu: normalizeBarMenu(parsed.settings?.barMenu) };
    Reflect.deleteProperty(settings, 'barButtons');
    if (parsed.alarmFormatVersion !== 1) {
      parsed.alarms = [];
      parsed.alarmNotices = [];
      parsed.alarmFormatVersion = 1;
      Reflect.deleteProperty(parsed, 'alarmSchedulerState');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed, settings }));
    }
    return {
      ...base,
      ...parsed,
      settings,
      notes: (parsed.notes ?? []).map(note => {
        const migrated = { ...note };
        Reflect.deleteProperty(migrated, 'title');
        return migrated;
      }),
      plants: parsed.plants ?? [],
      contacts: parsed.contacts ?? [],
      contactCategories: parsed.contactCategories ?? [],
      projects: parsed.projects ?? [],
      taskEvents: parsed.taskEvents ?? [],
      kanban: { ...base.kanban, ...(parsed.kanban ?? {}) }
    };
  } catch {
    return emptyStore();
  }
}

function id(prefix: string) {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

const browserTaskPriorities = [
  'important_urgent',
  'important_not_urgent',
  'not_important_urgent',
  'not_important_not_urgent'
];

// Mirrors the native rules: owned ids keep their step, anything else gets a new
// id, titles are trimmed, and a missing list keeps the current steps.
function shimSteps(value: unknown, current: unknown): Dict[] {
  const existing = Array.isArray(current) ? (current as Dict[]) : [];
  if (!Array.isArray(value)) return existing;
  const owned = new Set(existing.map((step) => step.id));
  const used = new Set<unknown>();
  return value.map((raw) => {
    const step = raw as Dict;
    const title = typeof step.title === 'string' ? step.title.trim() : '';
    if (!title) throw { code: 'validation_error', field: 'steps', message: '请输入步骤内容。' };
    const stepId = typeof step.id === 'string' && owned.has(step.id) && !used.has(step.id) ? step.id : id('s');
    used.add(stepId);
    return { id: stepId, title, completed: step.completed === true };
  });
}

// Mirrors the native contact rules: the name is required, the birthday must be a
// real ISO date, and a group id has to exist. Native rejects dirty data rather
// than storing a dangling reference, and so does this.
function assertContactDraft(store: Store, draft: ContactDraft) {
  const errors = validateContactForm(coerceContactDraft(draft));
  const field = Object.keys(errors)[0];
  if (field) throw { code: 'validation_error', field, message: errors[field as keyof typeof errors] };
  const categoryId = draft.categoryId;
  if (categoryId && !store.contactCategories.some((item) => item.id === categoryId)) {
    throw { code: 'validation_error', field: 'categoryId', message: '分组不存在。' };
  }
}

// The shim keeps rows in localStorage, where a contact saved by an earlier
// build is missing every field added since. Reading them back through
// `withContactDefaults` means the UI never sees a half-shaped row.
function storedContact(store: Store, idValue: string, createdAt: string, updatedAt: string, draft: ContactDraft): Contact {
  const normalized = toContactDraft(coerceContactDraft(draft));
  return { ...withContactDefaults({ id: idValue }), ...normalized, id: idValue, createdAt, updatedAt };
}

// Lanes are user-created only, like the native store: nothing is seeded.
function ensureTaskWorkspace(store: Store) {
  store.tasks = store.tasks.map((task) => {
    if ('laneId' in task && 'boardPosition' in task) {
      const { views: _views, collaboratorIds: _collaborators, ...rest } = task;
      return {
        ...rest,
        priority: browserTaskPriorities.includes(task.priority as string) ? task.priority : 'not_important_not_urgent',
        steps: Array.isArray(task.steps) ? task.steps : [],
        completedAt: task.completed === true ? (typeof task.completedAt === 'string' ? task.completedAt : task.updatedAt ?? nowIso()) : null
      };
    }
    const priority = typeof task.quadrant === 'string' && browserTaskPriorities.includes(task.quadrant)
      ? task.quadrant
      : 'not_important_not_urgent';
    const dueDate = typeof task.dueAt === 'string' ? task.dueAt : null;
    const completed = task.completed === true;
    return {
      id: task.id ?? id('t'),
      title: task.title ?? '',
      description: task.note ?? '',
      priority,
      dueDate,
      completed,
      completedAt: completed ? task.updatedAt ?? nowIso() : null,
      laneId: null,
      boardPosition: 0,
      tagIds: [],
      steps: [],
      createdAt: task.createdAt ?? nowIso(),
      updatedAt: task.updatedAt ?? nowIso()
    };
  });
}

// Whether an event/external record starts inside the half-open range the UI
// asks for. Recurrence is not expanded in the browser fallback; recurring
// events surface only on their original start, which is an accepted dev-only
// limitation.
function inRange(startAt: unknown, range: { startAt: string; endAtExclusive: string }) {
  return typeof startAt === 'string' && startAt >= range.startAt && startAt < range.endAtExclusive;
}

function timeValidation(field: string, message: string): never {
  throw { code: 'validation_error', field, message };
}

function validateTimeSettings(settings: TimeSettings) {
  if (!Array.isArray(settings?.clocks) || !settings.clocks.length) timeValidation('clocks', 'At least one clock is required.');
  if (!['clocks', 'focus'].includes(settings.displayContent)) timeValidation('displayContent', 'Invalid module display.');
  const appearance = settings.appearance;
  if (!appearance || !['digital', 'analog', 'mixed'].includes(appearance.mode)) timeValidation('mode', 'Invalid clock mode.');
  if (!['h12', 'h23'].includes(appearance.hourCycle)) timeValidation('hourCycle', 'Invalid hour cycle.');
  if (!['horizontal', 'stacked'].includes(appearance.layout)) timeValidation('layout', 'Invalid digital layout.');
  if (!['auto', 'manual'].includes(appearance.fontMode)) timeValidation('fontMode', 'Invalid font mode.');
  if (!Number.isInteger(appearance.fontSize) || appearance.fontSize < 32 || appearance.fontSize > 160) timeValidation('fontSize', 'Font size must be between 32 and 160.');
  const minutes = settings.focusPreferences?.defaultMinutes;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) timeValidation('defaultMinutes', 'Focus duration must be between 1 and 720 minutes.');
  for (const key of ['showSeconds', 'showLabel', 'showDate', 'showDifference'] as const) {
    if (typeof appearance[key] !== 'boolean') timeValidation(key, 'Clock visibility must be boolean.');
  }
  const ids = new Set<string>();
  for (const clock of settings.clocks) {
    if (!clock || typeof clock.id !== 'string' || !clock.id.trim() || ids.has(clock.id)) timeValidation('clocks', 'Clock IDs must be nonempty and unique.');
    ids.add(clock.id);
    if (typeof clock.timeZone !== 'string' || !clock.timeZone) timeValidation('timeZone', 'A valid time zone is required.');
    if (clock.timeZone !== 'local') {
      try { new Intl.DateTimeFormat('en', { timeZone: clock.timeZone }).format(0); }
      catch { timeValidation('timeZone', 'Unsupported time zone.'); }
    }
    if (typeof clock.label !== 'string') timeValidation('label', 'Clock label must be text.');
  }
}

function validateAlarmDraft(draft: AlarmDraft) {
  if (!draft || typeof draft.title !== 'string' || !draft.title.trim()) timeValidation('title', 'Alarm title is required.');
  if (!Number.isInteger(draft.hour) || draft.hour < 0 || draft.hour > 23) timeValidation('hour', 'Hour must be between 0 and 23.');
  if (!Number.isInteger(draft.minute) || draft.minute < 0 || draft.minute > 59) timeValidation('minute', 'Minute must be between 0 and 59.');
  if (typeof draft.enabled !== 'boolean') timeValidation('enabled', 'Enabled must be boolean.');
  if (draft.repeat?.kind === 'weekly') {
    const days = draft.repeat.weekdays;
    if (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(days).size !== days.length) {
      timeValidation('weekdays', 'Select unique ISO weekdays between 1 and 7.');
    }
  } else if (draft.repeat?.kind === 'once') {
    if (Object.keys(draft.repeat).some(key => key !== 'kind')) timeValidation('repeat', 'Once alarms have no date or other fields.');
  } else timeValidation('repeat', 'Invalid alarm repeat rule.');
}

export function installBrowserTauriBackend() {
  const store = loadStore();
  ensureTaskWorkspace(store);
  const listeners = new Map<number, { event: string; callback: number }>();
  let listenerId = 0;
  const emit = (event: string, payload: unknown) => {
    for (const [id, listener] of listeners) {
      if (listener.event !== event) continue;
      const callback = Reflect.get(window, `_${listener.callback}`);
      if (typeof callback === 'function') callback({ event, id, payload });
    }
  };
  let focus = { status: 'idle', sessionId: null as string | null, plannedSeconds: 0, remainingSeconds: 0, focusedSeconds: 0, startedAt: null as string | null, stageSequence: 0, stageChangedAt: null as string | null };
  let remainingMs = 0;
  let runStarted = 0;
  let focusInterval: number | undefined;
  let pendingFocus: Dict | null = null;
  let focusSession: Dict | null = null;
  const sampleFocus = () => {
    const remaining = focus.status === 'running' ? Math.max(0, remainingMs - (performance.now() - runStarted)) : remainingMs;
    return { ...focus, remainingSeconds: Math.ceil(remaining / 1000), focusedSeconds: Math.floor((focus.plannedSeconds * 1000 - remaining) / 1000) };
  };
  const publishFocus = () => {
    focus = sampleFocus();
    emit('focus-timer-updated', focus);
  };
  const markFocusStage = () => {
    focus.stageSequence += 1;
    focus.stageChangedAt = nowIso();
    publishFocus();
    emit('status-island-invalidated', null);
  };
  const startFocusTimer = (snapshot: Dict, seconds: number) => {
    if (focusInterval !== undefined) window.clearInterval(focusInterval);
    focusSession = snapshot;
    pendingFocus = null;
    remainingMs = seconds * 1000;
    runStarted = performance.now();
    focus = { ...focus, status: 'running', sessionId: String(snapshot.id), plannedSeconds: Number(snapshot.plannedSeconds), startedAt: String(snapshot.startedAt) };
    markFocusStage();
    focusInterval = window.setInterval(() => {
      if (focus.status !== 'running') return;
      const current = sampleFocus();
      if (current.remainingSeconds === 0) {
        remainingMs = 0;
        focus.status = 'completed';
        pendingFocus = focusSession;
        markFocusStage();
        window.clearInterval(focusInterval);
        emit('focus-session-completed', pendingFocus);
      } else if (current.remainingSeconds !== focus.remainingSeconds || current.focusedSeconds !== focus.focusedSeconds) publishFocus();
    }, 250);
  };
  const pauseFocusTimer = () => {
    if (focus.status !== 'running') return;
    remainingMs = Math.max(0, remainingMs - (performance.now() - runStarted));
    focus.status = 'paused';
    markFocusStage();
  };
  const resumeFocusTimer = () => {
    if (focus.status !== 'paused') return;
    runStarted = performance.now();
    focus.status = 'running';
    markFocusStage();
  };
  let panelSource: 'island' | 'menu' | 'nowly' | 'history' | null = null;
  let panelGeneration = 0;
  let panelClosing = false;
  let notificationVisible = false;
  const barPresence = new Set<string>();
  let barGeneration = 0;
  let barStrip = false;
  const barPresentation = () => {
    const strip = store.settings.notificationMode === 'notification'
      && !notificationVisible && barPresence.size === 0 && panelSource === null && !panelClosing;
    if (strip !== barStrip) {
      barStrip = strip;
      barGeneration += 1;
    }
    const presentation = { generation: barGeneration, strip };
    emit('status-island-presentation', presentation);
    return presentation;
  };
  const closePanel = () => {
    panelSource = null;
    panelClosing = true;
    const generation = ++panelGeneration;
    emit('status-island-details-close', { generation });
    setTimeout(() => {
      if (panelGeneration !== generation) return;
      panelClosing = false;
      emit('status-island-details-closed', { generation });
      barPresentation();
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
  };
  const openPanel = (source: Exclude<typeof panelSource, null>) => {
    panelSource = source;
    panelClosing = false;
    barPresentation();
    emit('status-island-details-open', { generation: ++panelGeneration, source, identity: null });
  };

  // Attachment bytes and metadata, kept in memory only (see save_attachment).
  const attachmentBytes = new Map<string, Uint8Array>();
  const attachmentRecords = new Map<string, Dict>();

  const taskWorkspaceSnapshot = () => ({
    tasks: store.tasks.filter((task) => !task.archivedAt),
    lanes: store.kanban.lanes,
    tags: store.kanban.tags.map((tag) => ({ archivedAt: null, ...tag })),
    // Like the native store: the saved lane while it exists, else the first lane.
    defaultLaneId: store.kanban.lanes.some((lane) => lane.id === store.settings.defaultTaskLaneId)
      ? store.settings.defaultTaskLaneId as string
      : [...store.kanban.lanes].sort((a, b) => Number(a.position) - Number(b.position))[0]?.id as string ?? null,
    viewPreferences: (store.settings.taskViewPreferences as Dict) ?? {}
  });

  // Mirrors `reports::build` closely enough for the browser preview: local-day
  // buckets, the same totals, and the same "open is a snapshot, not a window"
  // rule. Kept here so the plain Vite page and the Playwright suite can open the
  // report without the Rust side.
  const buildBrowserTaskReport = (requestedDays: number) => {
    const days = Math.max(1, Math.min(Math.trunc(requestedDays) || 30, 366));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setDate(from.getDate() - (days - 1));
    const localDay = (value: unknown) => {
      if (typeof value !== 'string' || !value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      return formatDate(parsed);
    };
    const inRange = (iso: string | null) => iso !== null && iso >= formatDate(from) && iso <= formatDate(today);

    const buckets = new Map<string, { date: string; created: number; completed: number; focusSeconds: number }>();
    for (let index = 0; index < days; index += 1) {
      const date = new Date(from);
      date.setDate(from.getDate() + index);
      const iso = formatDate(date);
      buckets.set(iso, { date: iso, created: 0, completed: 0, focusSeconds: 0 });
    }

    let created = 0;
    let completed = 0;
    let open = 0;
    let overdue = 0;
    let archived = 0;
    const closeDays: number[] = [];
    const quadrants = new Map<string, { priority: string; open: number; completed: number }>();
    const lanes = new Map<string, { id: string; name: string; open: number; completed: number }>();
    const projects = new Map<
      string,
      { id: string; name: string; open: number; completed: number; overdue: number; closeDays: number[] }
    >();
    const stuck: {
      id: string;
      title: string;
      status: string;
      priority: string;
      projectName: string | null;
      dueDate: string | null;
      ageDays: number;
      overdueDays: number | null;
    }[] = [];
    const todayIso = formatDate(today);
    const dayGap = (later: string, earlier: string) =>
      Math.round(
        (new Date(`${later}T00:00:00`).getTime() - new Date(`${earlier}T00:00:00`).getTime()) / 86_400_000
      );

    for (const task of store.tasks) {
      const createdOn = localDay(task.createdAt);
      const completedOn = localDay(task.completedAt);
      const archivedOn = localDay(task.archivedAt);
      const isArchived = Boolean(task.archivedAt);
      if (inRange(createdOn)) {
        created += 1;
        const bucket = buckets.get(createdOn as string);
        if (bucket) bucket.created += 1;
      }
      if (inRange(completedOn)) {
        completed += 1;
        const bucket = buckets.get(completedOn as string);
        if (bucket) bucket.completed += 1;
        if (createdOn) {
          const span = Math.round(
            (new Date(`${completedOn}T00:00:00`).getTime() - new Date(`${createdOn}T00:00:00`).getTime()) / 86_400_000
          );
          if (span >= 0) closeDays.push(span);
        }
      }
      if (inRange(archivedOn)) archived += 1;

      const isOpen = task.completed !== true && !isArchived;
      const overdueDays =
        isOpen && typeof task.dueDate === 'string' && task.dueDate < todayIso
          ? dayGap(todayIso, task.dueDate)
          : null;
      if (isOpen) {
        open += 1;
        if (overdueDays !== null) overdue += 1;
        const ageDays = createdOn ? dayGap(todayIso, createdOn) : 0;
        if ((overdueDays !== null && overdueDays >= 3) || ageDays >= 21) {
          stuck.push({
            id: String(task.id),
            title: String(task.title ?? ''),
            status: String(task.status ?? 'open'),
            priority: String(task.priority ?? 'not_important_not_urgent'),
            projectName: null,
            dueDate: typeof task.dueDate === 'string' ? task.dueDate : null,
            ageDays,
            overdueDays
          });
        }
      }
      const createdInRange = inRange(createdOn);
      const completedInRange = inRange(completedOn);
      if (!createdInRange && !completedInRange && !isOpen) continue;

      const priority = String(task.priority ?? 'not_important_not_urgent');
      const quadrant = quadrants.get(priority) ?? { priority, open: 0, completed: 0 };
      if (isOpen) quadrant.open += 1;
      if (completedInRange) quadrant.completed += 1;
      quadrants.set(priority, quadrant);

      const laneId = typeof task.laneId === 'string' ? task.laneId : null;
      if (laneId) {
        const lane = lanes.get(laneId) ?? {
          id: laneId,
          name: String(store.kanban.lanes.find((item) => item.id === laneId)?.name ?? laneId),
          open: 0,
          completed: 0
        };
        if (isOpen) lane.open += 1;
        if (completedInRange) lane.completed += 1;
        lanes.set(laneId, lane);
      }

      const projectId = typeof task.projectId === 'string' ? task.projectId : null;
      if (projectId) {
        const projectName = String(store.projects.find((item) => item.id === projectId)?.name ?? projectId);
        const project = projects.get(projectId) ?? {
          id: projectId,
          name: projectName,
          open: 0,
          completed: 0,
          overdue: 0,
          closeDays: []
        };
        if (isOpen) {
          project.open += 1;
          if (overdueDays !== null) project.overdue += 1;
        }
        if (completedInRange) {
          project.completed += 1;
          if (createdOn && completedOn) project.closeDays.push(dayGap(completedOn, createdOn));
        }
        projects.set(projectId, project);
      }
    }

    const focusSessions = (store.focusSessions as Dict[] | undefined) ?? [];
    for (const session of focusSessions) {
      const day = localDay(session.endedAt);
      const bucket = day ? buckets.get(day) : undefined;
      if (bucket) bucket.focusSeconds += Number(session.focusedSeconds ?? 0);
    }

    for (const task of stuck) {
      const stored = store.tasks.find((row) => row.id === task.id);
      const projectId = typeof stored?.projectId === 'string' ? stored.projectId : null;
      if (projectId) {
        task.projectName = String(store.projects.find((item) => item.id === projectId)?.name ?? projectId);
      }
    }
    stuck.sort(
      (left, right) => (right.overdueDays ?? -1) - (left.overdueDays ?? -1) || right.ageDays - left.ageDays
    );
    stuck.splice(50);

    const meetings = store.meetings
      .filter((meeting) => inRange(localDay(meeting.startsAt)))
      .sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt)))
      .map((meeting) => {
        const attendees = Array.isArray(meeting.attendees) ? (meeting.attendees as Dict[]) : [];
        const count = (state: string) => attendees.filter((row) => row.attendance === state).length;
        const items = Array.isArray(meeting.items) ? (meeting.items as Dict[]) : [];
        const tasks = items.filter((item) => typeof item.taskId === 'string');
        return {
          id: String(meeting.id),
          title: String(meeting.title ?? ''),
          startsAt: String(meeting.startsAt ?? ''),
          status: String(meeting.status ?? 'planned'),
          attendees: attendees.length,
          present: count('present'),
          late: count('late'),
          absent: count('absent'),
          excused: count('excused'),
          unknown: count('unknown'),
          lateMinutes: attendees
            .filter((row) => row.attendance === 'late')
            .reduce((sum, row) => sum + Number(row.lateMinutes ?? 0), 0),
          agendaItems: items.length,
          agendaTasks: tasks.length,
          agendaDone: tasks.filter(
            (item) => store.tasks.find((row) => row.id === item.taskId)?.completed === true
          ).length
        };
      });

    const activity = store.taskEvents
      .filter((event) => inRange(localDay(event.at)))
      .sort((left, right) => String(right.at).localeCompare(String(left.at)))
      .slice(0, 100)
      .map((event) => ({
        id: String(event.id),
        at: String(event.at),
        taskId: String(event.taskId ?? ''),
        taskTitle: String(store.tasks.find((row) => row.id === event.taskId)?.title ?? ''),
        kind: String(event.kind ?? ''),
        detail: typeof event.detail === 'string' ? event.detail : null
      }));

    const previousFrom = new Date(from);
    previousFrom.setDate(previousFrom.getDate() - days);
    const previousTo = new Date(from);
    previousTo.setDate(previousTo.getDate() - 1);
    const previousFromIso = formatDate(previousFrom);
    const previousToIso = formatDate(previousTo);
    const previousInRange = (iso: string | null) =>
      iso !== null && iso >= previousFromIso && iso <= previousToIso;
    let previousCreated = 0;
    let previousCompleted = 0;
    let previousArchived = 0;
    const previousCloseDays: number[] = [];
    for (const task of store.tasks) {
      const createdOn = localDay(task.createdAt);
      const completedOn = localDay(task.completedAt);
      if (previousInRange(createdOn)) previousCreated += 1;
      if (previousInRange(completedOn) && createdOn) {
        previousCompleted += 1;
        previousCloseDays.push(dayGap(completedOn as string, createdOn));
      }
      if (previousInRange(localDay(task.archivedAt))) previousArchived += 1;
    }

    const sorted = [...closeDays].sort((left, right) => left - right);
    const median = sorted.length === 0
      ? null
      : sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[(sorted.length - 1) / 2];

    return {
      days: [...buckets.values()].sort((left, right) => left.date.localeCompare(right.date)),
      totals: {
        created,
        completed,
        open,
        overdue,
        archived,
        completionRate: completed + open === 0 ? 0 : completed / (completed + open),
        averageCloseDays: closeDays.length === 0 ? null : closeDays.reduce((sum, value) => sum + value, 0) / closeDays.length,
        medianCloseDays: median
      },
      quadrants: [...quadrants.values()].sort((left, right) => left.priority.localeCompare(right.priority)),
      lanes: [...lanes.values()].sort((left, right) => right.open + right.completed - (left.open + left.completed)),
      projects: [...projects.values()]
        .map((project) => ({
          id: project.id,
          name: project.name,
          open: project.open,
          completed: project.completed,
          overdue: project.overdue,
          completionRate:
            project.open + project.completed === 0
              ? 0
              : project.completed / (project.open + project.completed),
          averageCloseDays:
            project.closeDays.length === 0
              ? null
              : project.closeDays.reduce((sum, value) => sum + value, 0) / project.closeDays.length
        }))
        .sort((left, right) => right.open + right.completed - (left.open + left.completed)),
      stuck,
      meetings,
      activity,
      previous: {
        created: previousCreated,
        completed: previousCompleted,
        archived: previousArchived,
        averageCloseDays:
          previousCloseDays.length === 0
            ? null
            : previousCloseDays.reduce((sum, value) => sum + value, 0) / previousCloseDays.length
      },
      generatedAt: nowIso()
    };
  };

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* storage disabled; keep running from in-memory state */
    }
  };

  // Mirrors the Rust backend: completing a recurring task writes the next
  // occurrence (same lane, tags and steps, steps reset to open).
  const spawnBrowserOccurrence = (task: Dict) => {
    const rule = task.recurrence as Recurrence | null | undefined;
    if (!rule) return;
    const anchor = (task.dueDate as string | null) ?? formatDate(new Date());
    const root = (task.recurrenceParentId as string | null) ?? (task.id as string);
    const occurrences = store.tasks.filter((item) => item.id === root || item.recurrenceParentId === root).length;
    const next = nextTaskDueDate(rule, anchor, anchor || formatDate(new Date()), occurrences);
    if (!next) return;
    if (store.tasks.some((item) =>
      (item.id === root || item.recurrenceParentId === root) && item.dueDate === next && item.completed !== true
    )) return;
    const laneId = (task.laneId as string | null) ?? null;
    store.tasks.push({
      ...task,
      id: id('t'),
      dueDate: next,
      completed: false,
      completedAt: null,
      linkedEventId: null,
      recurrenceParentId: root,
      boardPosition: laneId === null ? 0 : store.tasks.filter((item) => item.laneId === laneId).length,
      steps: Array.isArray(task.steps)
        ? (task.steps as Dict[]).map((step) => ({ ...step, id: id('step'), completed: false }))
        : [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    persist();
  };

  persist();

  const handlers: Record<string, (args: Dict) => unknown> = {
    get_sticker_board: () => getBrowserStickerBoard(),
    save_sticker_board: a => saveBrowserStickerBoard(a.board as StickerBoard),
    upload_sticker_image: a => uploadBrowserStickerImage(String(a.fileName), new Uint8Array(a.bytes as number[])),
    read_sticker_image: a => readBrowserStickerImage(String(a.id)).then(bytes => Array.from(bytes)),
    discard_sticker_images: a => discardBrowserStickerImages(a.ids as string[]),
    get_time_settings: () => store.timeSettings,
    save_time_settings: (a) => {
      const settings = a.settings as TimeSettings;
      validateTimeSettings(settings);
      store.timeSettings = settings;
      persist();
      return settings;
    },
    list_alarms: () => [...store.alarms].sort((a, b) => a.hour - b.hour || a.minute - b.minute || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    create_alarm: (a) => {
      const draft = a.draft as AlarmDraft;
      validateAlarmDraft(draft);
      const stamp = nowIso();
      const alarm: Alarm = { ...draft, id: id('alarm'), createdAt: stamp, updatedAt: stamp, effectiveFromUtc: stamp };
      store.alarms.push(alarm);
      persist();
      emit('status-island-invalidated', null);
      return alarm;
    },
    update_alarm: (a) => {
      const index = store.alarms.findIndex(alarm => alarm.id === a.id);
      if (index === -1) throw { code: 'not_found', message: 'Alarm not found.' };
      const previous = store.alarms[index];
      const draft = { ...alarmToDraft(previous), ...a.draft as Partial<AlarmDraft> };
      validateAlarmDraft(draft);
      const stamp = nowIso();
      const repeatChanged = previous.repeat.kind !== draft.repeat.kind
        || (previous.repeat.kind === 'weekly' && draft.repeat.kind === 'weekly'
          && [...previous.repeat.weekdays].sort().join(',') !== [...draft.repeat.weekdays].sort().join(','));
      const resetAnchor = previous.hour !== draft.hour || previous.minute !== draft.minute
        || repeatChanged || (!previous.enabled && draft.enabled);
      const alarm: Alarm = { ...draft, id: previous.id, createdAt: previous.createdAt, updatedAt: stamp,
        effectiveFromUtc: resetAnchor ? stamp : previous.effectiveFromUtc };
      store.alarms[index] = alarm;
      if ((a.draft as Partial<AlarmDraft>).enabled === false) store.alarmNotices = store.alarmNotices.filter(notice => notice.alarmId !== alarm.id);
      persist();
      emit('status-island-invalidated', null);
      return alarm;
    },
    delete_alarm: (a) => {
      const index = store.alarms.findIndex(alarm => alarm.id === a.id);
      if (index === -1) throw { code: 'not_found', message: 'Alarm not found.' };
      store.alarms.splice(index, 1);
      store.alarmNotices = store.alarmNotices.filter(notice => notice.alarmId !== a.id);
      persist();
      emit('status-island-invalidated', null);
    },
    acknowledge_alarm_notice: (a) => {
      store.alarmNotices = store.alarmNotices.filter(notice => notice.id !== a.id);
      persist();
      emit('status-island-invalidated', null);
    },
    // Fixtures can be dismissed, but are never rescheduled in the browser.
    snooze_alarm_notice: (a) => {
      const notice = store.alarmNotices.find(notice => notice.id === a.id);
      if (notice?.kind === 'missedSummary') timeValidation('id', 'Missed summaries cannot be snoozed.');
      store.alarmNotices = store.alarmNotices.filter(notice => notice.id !== a.id);
      persist();
      emit('status-island-invalidated', null);
    },
    // Calendar events
    list_events_in_range: (a) =>
      store.events.filter((e) => inRange(e.startAt, a.range as never)),
    create_event: (a) => {
      const draft = a.draft as Dict;
      const event = { id: id('e'), createdAt: nowIso(), updatedAt: nowIso(), ...draft };
      store.events.push(event);
      persist();
      return event;
    },
    update_event: (a) => {
      const target = a.target as { id: string };
      const draft = a.draft as Dict;
      store.events = store.events.map((e) =>
        e.id === target.id ? { ...e, ...draft, updatedAt: nowIso() } : e
      );
      persist();
    },
    delete_event: (a) => {
      const target = a.target as { id: string };
      store.events = store.events.filter((e) => e.id !== target.id);
      persist();
    },

    // Calendar categories (user-defined name + color; shared by events & subs)
    list_categories: () =>
      [...store.categories].sort(
        (a, b) => (a.position as number) - (b.position as number)
      ),
    create_category: (a) => {
      const draft = a.draft as Dict;
      const position = store.categories.reduce(
        (max, c) => Math.max(max, (c.position as number) + 1),
        0
      );
      const category = {
        id: id('cat'),
        position,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...draft
      };
      store.categories.push(category);
      persist();
      return category;
    },
    update_category: (a) => {
      const draft = a.draft as Dict;
      let updated: Dict | undefined;
      store.categories = store.categories.map((c) =>
        c.id === a.id ? (updated = { ...c, ...draft, updatedAt: nowIso() }) : c
      );
      // Category and color are one concept: refresh the color snapshot on every
      // event/subscription referencing this category.
      const color = draft.color as string;
      store.events = store.events.map((e) => (e.category === a.id ? { ...e, color } : e));
      store.subscriptions = store.subscriptions.map((s) =>
        s.categoryId === a.id ? { ...s, color } : s
      );
      persist();
      return updated;
    },
    delete_category: (a) => {
      store.categories = store.categories.filter((c) => c.id !== a.id);
      // Referencing rows fall back to "no category, no color".
      store.events = store.events.map((e) =>
        e.category === a.id ? { ...e, category: '', color: '' } : e
      );
      store.subscriptions = store.subscriptions.map((s) =>
        s.categoryId === a.id ? { ...s, categoryId: null, color: '' } : s
      );
      persist();
    },

    // Calendar subscriptions
    list_calendar_subscriptions: () => store.subscriptions,
    create_calendar_subscription: (a) => {
      const sub = {
        id: id('sub'),
        provider: 'ics',
        accountId: null,
        remoteCalendarId: null,
        lastSyncedAt: null,
        lastAttemptedAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...(a.draft as Dict)
      };
      store.subscriptions.push(sub);
      persist();
      return sub;
    },
    update_calendar_subscription: (a) => {
      let updated: Dict | undefined;
      store.subscriptions = store.subscriptions.map((s) =>
        s.id === a.id ? (updated = { ...s, ...(a.draft as Dict), updatedAt: nowIso() }) : s
      );
      persist();
      return updated;
    },
    delete_calendar_subscription: (a) => {
      store.subscriptions = store.subscriptions.filter((s) => s.id !== a.id);
      store.externalEvents = store.externalEvents.filter((e) => e.subscriptionId !== a.id);
      persist();
    },
    refresh_calendar_subscription: () => undefined,
    // OAuth 日历（浏览器 mock：无真实授权，仅维持 UI 可用）。
    start_oauth_login: (a) => {
      const provider = a.provider as string;
      const account = {
        id: id('acct'),
        provider,
        accountLabel: `${provider}@example.com`,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      store.oauthAccounts.push(account);
      persist();
      return account;
    },
    list_oauth_accounts: () => store.oauthAccounts,
    disconnect_oauth_account: (a) => {
      store.oauthAccounts = store.oauthAccounts.filter((acct) => acct.id !== a.id);
      const removed = store.subscriptions.filter((s) => s.accountId === a.id).map((s) => s.id);
      store.subscriptions = store.subscriptions.filter((s) => s.accountId !== a.id);
      store.externalEvents = store.externalEvents.filter((e) => !removed.includes(e.subscriptionId as string));
      persist();
    },
    list_remote_calendars: () => [
      { id: 'primary', name: '主日历', color: '#4FC9DA' },
      { id: 'work', name: '工作', color: '#F2A65A' }
    ],
    subscribe_remote_calendar: (a) => {
      const sub = {
        id: id('sub'),
        name: a.name as string,
        url: '',
        color: a.color as string,
        categoryId: null,
        refreshIntervalMinutes: a.refreshIntervalMinutes as number,
        provider: (store.oauthAccounts.find((acct) => acct.id === a.accountId)?.provider as string) ?? 'google',
        accountId: a.accountId as string,
        remoteCalendarId: a.remoteCalendarId as string,
        lastSyncedAt: null,
        lastAttemptedAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      store.subscriptions.push(sub);
      persist();
      return sub;
    },
    // Axelor（浏览器 mock：返回几个常见模型，订阅不真正拉数据）。
    list_axelor_models: () => [
      { name: 'com.axelor.apps.project.db.ProjectTask', title: 'Project Task' },
      { name: 'com.axelor.apps.crm.db.Event', title: 'Event' }
    ],
    create_axelor_subscription: (a) => {
      const sub = {
        id: id('sub'),
        name: a.name as string,
        url: '',
        color: a.color as string,
        categoryId: (a.categoryId as string | null) ?? null,
        refreshIntervalMinutes: a.refreshIntervalMinutes as number,
        provider: 'axelor',
        accountId: null,
        remoteCalendarId: null,
        axelorServerId: id('axelor'),
        axelorModel: a.model as string,
        lastSyncedAt: null,
        lastAttemptedAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      store.subscriptions.push(sub);
      persist();
      return sub;
    },
    update_subscription_display: (a) => {
      let updated: Dict | undefined;
      store.subscriptions = store.subscriptions.map((s) =>
        s.id === a.id
          ? (updated = {
              ...s,
              name: a.name as string,
              color: a.color as string,
              categoryId: (a.categoryId as string | null) ?? null,
              refreshIntervalMinutes: a.refreshIntervalMinutes as number,
              updatedAt: nowIso()
            })
          : s
      );
      persist();
      return updated;
    },
    list_external_events_in_range: (a) =>
      store.externalEvents.filter((e) => inRange(e.startAt, a.range as never)),
    create_remote_event: (a) => {
      const subscription = store.subscriptions.find((source) => source.id === a.subscriptionId);
      const draft = a.draft as Dict;
      const event = {
        id: id('external'),
        subscriptionId: a.subscriptionId,
        remoteEventId: id('remote'),
        provider: subscription?.provider ?? 'google',
        writable: true,
        startTz: null,
        endTz: null,
        location: null,
        description: draft.note ?? null,
        reminders: [],
        color: subscription?.color ?? '#4FC9DA',
        ...draft
      };
      store.externalEvents.push(event);
      persist();
    },
    update_remote_event: (a) => {
      const draft = a.draft as Dict;
      store.externalEvents = store.externalEvents.map((event) =>
        event.subscriptionId === a.subscriptionId && event.remoteEventId === a.remoteEventId
          ? {
              ...event,
              ...draft,
              description: a.descriptionChanged ? draft.note ?? null : event.description
            }
          : event
      );
      persist();
    },
    delete_remote_event: (a) => {
      store.externalEvents = store.externalEvents.filter((event) =>
        event.subscriptionId !== a.subscriptionId || event.remoteEventId !== a.remoteEventId
      );
      persist();
    },

    // Unified tasks. Legacy command names remain accepted because both the old
    // focused tests and the new desktop IPC use create/update/delete_task.
    get_task_workspace_snapshot: taskWorkspaceSnapshot,
    list_tasks: () => store.tasks.filter((task) => !task.archivedAt),
    create_task: (a) => {
      const { steps, ...draft } = a.draft as Dict;
      const normalizedSteps = shimSteps(steps, []);
      // Like the backend, a task without a lane stays off the kanban board.
      const laneId = (draft.laneId as string | null | undefined) ?? null;
      const task: Dict = {
        id: id('t'),
        description: '',
        dueDate: null,
        completed: false,
        status: draft.completed === true ? 'done' : 'open',
        projectId: (draft.projectId as string | null | undefined) ?? null,
        tagIds: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...draft,
        completedAt: draft.completed === true ? nowIso() : null,
        laneId,
        boardPosition: laneId === null ? 0 : store.tasks.filter((item) => item.laneId === laneId).length,
        priority: (draft.priority as string | null) ?? 'not_important_not_urgent',
        steps: normalizedSteps
      };
      store.tasks.push(task);
      persist();
      return task;
    },
    update_task: (a) => {
      const current = store.tasks.find((task) => task.id === a.id);
      const steps = shimSteps((a.draft as Dict).steps, current?.steps);
      let updated: Dict | undefined;
      store.tasks = store.tasks.map((task) => {
        if (task.id !== a.id) return task;
        const draft = a.draft as Dict;
        const completedAt = draft.completed !== true ? null : task.completed === true ? task.completedAt ?? nowIso() : nowIso();
        updated = { ...task, ...draft, priority: (draft.priority as string | null) ?? 'not_important_not_urgent', steps, completedAt, updatedAt: nowIso() };
        return updated;
      });
      persist();
      return updated;
    },
    delete_task: (a) => {
      // Archive, like the native store: the row stays for the report.
      store.tasks = store.tasks.map((task) =>
        task.id === a.id ? { ...task, archivedAt: nowIso(), updatedAt: nowIso() } : task
      );
      persist();
    },
    get_task_report: (a) => buildBrowserTaskReport(Number(a.days ?? 30)),
    export_task_report: () => {
      throw { code: 'system_error', message: 'Report export is only available in the desktop app.' };
    },
    set_task_status: (a) => {
      const status = String(a.status ?? 'open');
      if (!['open', 'in_progress', 'done', 'suspended', 'cancelled', 'delayed'].includes(status)) {
        throw { code: 'validation_error', field: 'status', message: '任务状态无效。' };
      }
      const current = store.tasks.find((task) => task.id === a.id);
      if (!current) throw { code: 'not_found', message: '未找到该任务。' };
      const done = status === 'done';
      const updated: Dict = {
        ...current,
        status,
        completed: done,
        completedAt: done ? current.completedAt ?? nowIso() : null,
        // A status write always brings the row back onto the board, matching
        // the native command that clears archived_at.
        archivedAt: null,
        boardPosition: !done && current.laneId ? -1 : current.boardPosition,
        updatedAt: nowIso()
      };
      store.tasks = store.tasks.map((task) => task.id === a.id ? updated : task);
      store.taskEvents.push({ id: id('ev'), taskId: a.id, kind: 'status', detail: status, at: nowIso() });
      persist();
      return updated;
    },
    set_task_project: (a) => {
      const projectId = (a.projectId as string | null | undefined) ?? null;
      if (projectId && !store.projects.some((project) => project.id === projectId && !project.archivedAt)) {
        throw { code: 'validation_error', field: 'projectId', message: '项目不存在。' };
      }
      const current = store.tasks.find((task) => task.id === a.id);
      if (!current) throw { code: 'not_found', message: '未找到该任务。' };
      const updated = { ...current, projectId, updatedAt: nowIso() };
      store.tasks = store.tasks.map((task) => task.id === a.id ? updated : task);
      store.taskEvents.push({ id: id('ev'), taskId: a.id, kind: 'project', detail: projectId, at: nowIso() });
      persist();
      return updated;
    },
    list_task_events: (a) =>
      store.taskEvents.filter((event) => event.taskId === a.taskId).sort((left, right) => String(left.at).localeCompare(String(right.at))),
    list_task_archive: () =>
      store.tasks
        .filter((task) => task.archivedAt || ['done', 'suspended', 'cancelled'].includes(String(task.status ?? (task.completed ? 'done' : 'open'))))
        .sort((left, right) => String(right.completedAt ?? right.updatedAt).localeCompare(String(left.completedAt ?? left.updatedAt))),
    set_task_archive_reason: (a) => {
      const current = store.tasks.find((task) => task.id === a.id);
      if (!current) throw { code: 'not_found', message: '未找到该任务。' };
      const raw = typeof a.reason === 'string' ? a.reason.trim() : '';
      const next = raw ? raw : null;
      const updated = { ...current, archiveReason: next, updatedAt: nowIso() };
      store.tasks = store.tasks.map((task) => task.id === a.id ? updated : task);
      store.taskEvents.push({ id: id('ev'), taskId: a.id as string, kind: 'reason', detail: next, at: nowIso() });
      persist();
      return updated;
    },
    purge_tasks: (a) => {
      const ids = Array.isArray(a.ids) ? (a.ids as unknown[]).map(String) : [];
      let removed = 0;
      store.tasks = store.tasks.filter((task) => {
        if (!ids.includes(String(task.id))) return true;
        const status = String(task.status ?? (task.completed ? 'done' : 'open'));
        const purgable = Boolean(task.archivedAt) || ['done', 'suspended', 'cancelled'].includes(status);
        if (!purgable) return true;
        removed += 1;
        return false;
      });
      if (removed > 0) {
        store.taskEvents = store.taskEvents.filter((event) => !ids.includes(String(event.taskId)));
      }
      persist();
      return removed;
    },
    export_task_archive: (a) => {
      const ids = Array.isArray(a.ids) ? (a.ids as unknown[]).map(String) : null;
      const rows = store.tasks.filter((task) =>
        task.archivedAt || ['done', 'suspended', 'cancelled'].includes(String(task.status ?? (task.completed ? 'done' : 'open')))
      );
      const wanted = ids ? rows.filter((task) => ids.includes(String(task.id))) : rows;
      return { path: String(a.path ?? ''), tasks: wanted.length };
    },
    list_projects: () =>
      store.projects.map((project) => ({
        ...project,
        taskCount: store.tasks.filter((task) => task.projectId === project.id).length
      })),
    create_project: (a) => {
      const draft = a.draft as Dict;
      const name = String(draft.name ?? '').replace(/\s+/g, ' ').trim();
      if (!name) throw { code: 'validation_error', field: 'name', message: '请输入项目名称。' };
      if (store.projects.some((project) => !project.archivedAt && String(project.name).toLowerCase() === name.toLowerCase())) {
        throw { code: 'validation_error', field: 'name', message: '同名项目已存在。' };
      }
      const project = {
        id: id('project'),
        description: String(draft.description ?? ''),
        color: String(draft.color ?? '#4FC9DA'),
        status: String(draft.status ?? 'active'),
        name,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        archivedAt: null,
        taskCount: 0
      };
      store.projects.push(project);
      persist();
      return project;
    },
    update_project: (a) => {
      const draft = a.draft as Dict;
      const name = String(draft.name ?? '').replace(/\s+/g, ' ').trim();
      if (!name) throw { code: 'validation_error', field: 'name', message: '请输入项目名称。' };
      const current = store.projects.find((project) => project.id === a.id);
      if (!current) throw { code: 'not_found', message: '未找到该项目。' };
      const updated = {
        ...current,
        name,
        description: String(draft.description ?? current.description ?? ''),
        color: String(draft.color ?? current.color ?? '#4FC9DA'),
        status: String(draft.status ?? current.status ?? 'active'),
        updatedAt: nowIso()
      };
      store.projects = store.projects.map((project) => project.id === a.id ? updated : project);
      persist();
      return updated;
    },
    archive_project: (a) => {
      store.projects = store.projects.map((project) =>
        project.id === a.id ? { ...project, archivedAt: project.archivedAt ?? nowIso(), updatedAt: nowIso() } : project
      );
      persist();
    },
    set_task_completed: (a) => {
      const current = store.tasks.find((task) => task.id === a.id);
      if (!current || current.completed === a.completed) return current;
      // The task keeps its lane; reopening puts it back at the top of that lane.
      const updated: Dict = a.completed
        ? { ...current, completed: true, status: 'done', completedAt: nowIso(), updatedAt: nowIso() }
        : { ...current, completed: false, status: current.status === 'done' ? 'open' : current.status ?? 'open', completedAt: null, boardPosition: current.laneId ? -1 : current.boardPosition, updatedAt: nowIso() };
      store.tasks = store.tasks.map((task) => task.id === a.id ? updated : task);
      if (a.completed) spawnBrowserOccurrence(updated);
      if (!a.completed && updated.laneId) {
        const lane = store.tasks.filter((task) => task.laneId === updated.laneId)
          .sort((left, right) => Number(left.boardPosition) - Number(right.boardPosition));
        const positions = new Map(lane.map((task, index) => [task.id, index]));
        store.tasks = store.tasks.map((task) => positions.has(task.id) ? { ...task, boardPosition: positions.get(task.id) } : task);
      }
      persist();
      return store.tasks.find((task) => task.id === a.id);
    },
    set_task_recurrence: (a) => {
      const current = store.tasks.find((task) => task.id === a.id);
      if (!current) return undefined;
      const rule = (a.recurrence as Recurrence | null) ?? null;
      const updated: Dict = {
        ...current,
        recurrence: rule,
        recurrenceParentId: null,
        dueDate: rule ? current.dueDate ?? formatDate(new Date()) : current.dueDate,
        updatedAt: nowIso()
      };
      store.tasks = store.tasks.map((task) => task.id === a.id ? updated : task);
      persist();
      return updated;
    },
    search_all: (a) => {
      const query = String(a.query ?? '').trim().toLowerCase();
      if (!query) return [];
      const limit = Math.max(1, Math.min(Number(a.limit ?? 8), 20));
      const matches = (text: unknown) => typeof text === 'string' && text.toLowerCase().includes(query);
      const snippet = (text: string) => text.trim().slice(0, 120);
      const events = store.events
        .filter((event) => matches(event.title) || matches(event.note))
        .slice(0, limit)
        .map((event) => ({
          kind: 'event', id: event.id, title: event.title,
          snippet: snippet(String(event.note ?? '')), date: event.startAt ?? null
        }));
      const tasks = store.tasks
        .filter((task) => matches(task.title) || matches(task.description))
        .slice(0, limit)
        .map((task) => ({
          kind: 'task', id: task.id, title: task.title,
          snippet: snippet(String(task.description ?? '')), date: (task.dueDate as string | null) ?? null
        }));
      const notes = store.notes
        .filter((note) => matches(contentToPlainText(String(note.content ?? ''))))
        .slice(0, limit)
        .map((note) => {
          const text = contentToPlainText(String(note.content ?? ''));
          return {
            kind: 'note', id: note.id,
            title: text.split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 60) ?? '',
            snippet: snippet(text), date: (note.updatedAt as string | null) ?? null
          };
        });
      return [...events, ...tasks, ...notes];
    },
    // Backups write real files through the native dialog plugin, which the
    // browser preview does not have.
    export_backup: () => {
      throw { code: 'system_error', message: 'Backups are only available in the desktop app.', field: null };
    },
    import_backup: () => {
      throw { code: 'system_error', message: 'Backups are only available in the desktop app.', field: null };
    },
    move_task_to_lane: (a) => {
      const moving = store.tasks.find((task) => task.id === a.id);
      if (!moving) return undefined;
      const laneId = a.laneId as string;
      // The index counts open cards only; completed cards stay after them. Moving
      // a task into a lane reopens it.
      const inLane = store.tasks.filter((task) => task.id !== a.id && task.laneId === laneId)
        .sort((left, right) => Number(left.boardPosition) - Number(right.boardPosition));
      const open = inLane.filter((task) => task.completed !== true);
      open.splice(Math.max(0, Math.min(Number(a.targetIndex), open.length)), 0, moving);
      const target = [...open, ...inLane.filter((task) => task.completed === true)];
      const positions = new Map(target.map((task, index) => [task.id, index]));
      let updated: Dict | undefined;
      store.tasks = store.tasks.map((task) => {
        if (task.id === a.id) {
          updated = { ...task, laneId, completed: false, completedAt: null, boardPosition: positions.get(task.id) ?? 0, updatedAt: nowIso() };
          return updated;
        }
        return positions.has(task.id) ? { ...task, boardPosition: positions.get(task.id) } : task;
      });
      persist();
      return updated;
    },
    move_task_to_priority: (a) => {
      let updated: Dict | undefined;
      store.tasks = store.tasks.map((task) => {
        if (task.id !== a.id) return task;
        updated = { ...task, priority: a.priority ?? 'not_important_not_urgent', updatedAt: nowIso() };
        return updated;
      });
      persist();
      return updated;
    },
    move_task_to_date: (a) => {
      let updated: Dict | undefined;
      store.tasks = store.tasks.map((task) => {
        if (task.id !== a.id) return task;
        updated = { ...task, dueDate: a.dueDate, updatedAt: nowIso() };
        return updated;
      });
      persist();
      return updated;
    },
    create_task_lane: (a) => {
      const lane = {
        id: id('lane'),
        position: store.kanban.lanes.length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...(a.draft as Dict)
      };
      store.kanban.lanes.push(lane);
      persist();
      return lane;
    },
    update_task_lane: (a) => {
      let updated: Dict | undefined;
      store.kanban.lanes = store.kanban.lanes.map((lane) =>
        lane.id === a.id ? (updated = { ...lane, ...(a.draft as Dict), updatedAt: nowIso() }) : lane
      );
      persist();
      return updated;
    },
    delete_task_lane: (a) => {
      // The lane's tasks leave the board and stay in the matrix; any lane,
      // including the last one, can be deleted.
      const removedId = a.id as string;
      store.tasks = store.tasks.map((task) => task.laneId === removedId
        ? { ...task, laneId: null, boardPosition: 0, updatedAt: nowIso() }
        : task);
      store.kanban.lanes = store.kanban.lanes.filter((lane) => lane.id !== removedId);
      if (store.settings.defaultTaskLaneId === removedId) delete store.settings.defaultTaskLaneId;
      persist();
      return taskWorkspaceSnapshot();
    },
    reorder_task_lanes: (a) => {
      const order = a.orderedIds as string[];
      store.kanban.lanes = store.kanban.lanes.map((lane) => ({
        ...lane,
        position: order.indexOf(lane.id as string),
        updatedAt: nowIso()
      }));
      persist();
      return store.kanban.lanes;
    },
    set_default_task_lane: (a) => {
      store.settings.defaultTaskLaneId = a.id;
      persist();
      return taskWorkspaceSnapshot();
    },
    create_task_tag: (a) => {
      const tag = { id: id('tag'), archivedAt: null, createdAt: nowIso(), updatedAt: nowIso(), ...(a.draft as Dict) };
      store.kanban.tags.push(tag);
      persist();
      return tag;
    },
    update_task_tag: (a) => {
      let updated: Dict | undefined;
      store.kanban.tags = store.kanban.tags.map((tag) =>
        tag.id === a.id ? (updated = { ...tag, ...(a.draft as Dict), updatedAt: nowIso() }) : tag
      );
      persist();
      return updated;
    },
    archive_task_tag: (a) => {
      let updated: Dict | undefined;
      store.kanban.tags = store.kanban.tags.map((tag) =>
        tag.id === a.id ? (updated = { ...tag, archivedAt: a.archived ? nowIso() : null, updatedAt: nowIso() }) : tag
      );
      persist();
      return updated;
    },
    delete_task_tag: (a) => {
      store.kanban.tags = store.kanban.tags.filter((tag) => tag.id !== a.id);
      store.tasks = store.tasks.map((task) => ({
        ...task,
        tagIds: Array.isArray(task.tagIds) ? (task.tagIds as string[]).filter((tagId) => tagId !== a.id) : []
      }));
      persist();
    },
    set_task_view_preferences: (a) => {
      store.settings.taskViewPreferences = a.preferences;
      persist();
      return taskWorkspaceSnapshot();
    },

    // Notes
    list_notes: () => store.notes,
    create_note: (a) => {
      const draft = a.draft as NoteDraft;
      const errors = validateNoteForm(draft);
      const field = Object.keys(errors)[0] as keyof NoteDraft | undefined;
      if (field) throw { code: 'validation_error', field, message: errors[field] };
      const note = { id: id('n'), createdAt: nowIso(), updatedAt: nowIso(), styleVariant: Math.floor(Math.random() * 9), ...toNoteDraft(draft) };
      store.notes.push(note);
      persist();
      return note;
    },
    update_note: (a) => {
      const old = store.notes.find(note => note.id === a.id);
      if (!old) throw { code: 'not_found', message: '未找到该便签。' };
      const draft = a.draft as NoteDraft;
      const errors = validateNoteForm(draft, isContentEmpty(String(old.content ?? '')) && draft.content === old.content);
      const field = Object.keys(errors)[0] as keyof NoteDraft | undefined;
      if (field) throw { code: 'validation_error', field, message: errors[field] };
      let updated: Dict | undefined;
      store.notes = store.notes.map((n) =>
        n.id === a.id ? (updated = { ...n, ...toNoteDraft(draft), updatedAt: nowIso() }) : n
      );
      persist();
      return updated;
    },
    delete_note: (a) => {
      store.notes = store.notes.filter((n) => n.id !== a.id);
      persist();
    },

    // Plants
    list_plants: () => store.plants,
    create_plant: (a) => {
      const draft = toPlantDraft(a.draft as PlantDraft);
      const errors = validatePlantForm(a.draft as PlantDraft);
      const field = Object.keys(errors)[0];
      if (field) throw { code: 'validation_error', field, message: errors[field as keyof typeof errors] };
      const plant = { id: id('plant'), createdAt: nowIso(), updatedAt: nowIso(), ...draft };
      store.plants.push(plant);
      persist();
      return plant;
    },
    update_plant: (a) => {
      const existing = store.plants.find((plant) => plant.id === a.id);
      if (!existing) throw { code: 'validation_error', field: 'id', message: '未找到该植物。' };
      const errors = validatePlantForm(a.draft as PlantDraft);
      const field = Object.keys(errors)[0];
      if (field) throw { code: 'validation_error', field, message: errors[field as keyof typeof errors] };
      let updated: Dict | undefined;
      store.plants = store.plants.map((plant) =>
        plant.id === a.id ? (updated = { ...plant, ...toPlantDraft(a.draft as PlantDraft), updatedAt: nowIso() }) : plant
      );
      persist();
      return updated;
    },
    delete_plant: (a) => {
      store.plants = store.plants.filter((plant) => plant.id !== a.id);
      persist();
    },
    water_plant: (a) => {
      const existing = store.plants.find((plant) => plant.id === a.id);
      if (!existing) throw { code: 'validation_error', field: 'id', message: '未找到该植物。' };
      let updated: Dict | undefined;
      store.plants = store.plants.map((plant) =>
        plant.id === a.id ? (updated = { ...plant, lastWateredAt: a.wateredAt, updatedAt: nowIso() }) : plant
      );
      persist();
      return updated;
    },

    // Meetings: one row plus attendees and agenda/follow-up items.
    list_meetings: () => store.meetings,
    save_meeting: (a) => {
      const draft = a.draft as Dict;
      const title = String(draft.title ?? '').trim();
      if (!title) throw { code: 'validation_error', field: 'title', message: '会议标题不能为空。' };
      const startsAt = String(draft.startsAt ?? '');
      const endsAt = String(draft.endsAt ?? '');
      if (!startsAt || !endsAt) throw { code: 'validation_error', field: 'startsAt', message: '会议时间无效。' };
      if (endsAt < startsAt) throw { code: 'validation_error', field: 'endsAt', message: '结束时间早于开始时间。' };
      const attendees = ((draft.attendees as Dict[]) ?? []).map((attendee) => ({
        contactId: String(attendee.contactId ?? ''),
        required: attendee.required !== false,
        attendance: String(attendee.attendance ?? 'unknown'),
        lateMinutes: Number(attendee.lateMinutes ?? 0)
      }));
      const items = ((draft.items as Dict[]) ?? []).map((item, index) => ({
        id: String(item.id ?? id('mi')),
        kind: String(item.kind ?? 'agenda'),
        title: String(item.title ?? '').trim(),
        ownerContactId: (item.ownerContactId as string | null) ?? null,
        dueDate: (item.dueDate as string | null) ?? null,
        taskId: (item.taskId as string | null) ?? null,
        position: index
      }));
      const existing = a.id ? store.meetings.find((meeting) => meeting.id === a.id) : undefined;
      const saved: Dict = {
        ...(existing ?? { id: id('meeting'), createdAt: nowIso() }),
        title,
        agenda: String(draft.agenda ?? ''),
        minutes: String(draft.minutes ?? ''),
        location: String(draft.location ?? ''),
        startsAt,
        endsAt,
        status: String(draft.status ?? 'planned'),
        projectId: (draft.projectId as string | null) ?? null,
        attendees,
        items,
        updatedAt: nowIso()
      };
      store.meetings = existing
        ? store.meetings.map((meeting) => meeting.id === saved.id ? saved : meeting)
        : [...store.meetings, saved];
      persist();
      return saved;
    },
    delete_meeting: (a) => {
      store.meetings = store.meetings.filter((meeting) => meeting.id !== a.id);
      persist();
    },
    export_meeting: (a) => {
      const meeting = store.meetings.find((row) => row.id === a.id);
      if (!meeting) throw { code: 'not_found', message: '会议不存在。' };
      return { path: String(a.path ?? ''), bytes: JSON.stringify(meeting).length };
    },
    set_task_assignee: (a) => {
      const contactId = (a.contactId as string | null) ?? null;
      let updated: Dict | undefined;
      store.tasks = store.tasks.map((task) =>
        task.id === a.id ? (updated = { ...task, assigneeContactId: contactId, updatedAt: nowIso() }) : task
      );
      if (!updated) throw { code: 'not_found', message: '未找到该任务。' };
      persist();
      return updated;
    },

    // Phone book
    list_contacts: () =>
      store.contacts.map((row) => withContactDefaults(row as unknown as Partial<Contact> & { id: string })),
    list_contact_categories: () => store.contactCategories,
    create_contact_category: (a) => {
      const draft = a.draft as ContactCategoryDraft;
      const name = String(draft.name ?? '').replace(/\s+/g, ' ').trim();
      if (!name) throw { code: 'validation_error', field: 'name', message: '分组名称不能为空。' };
      const color = normalizeHexColor(draft.color);
      if (!color) throw { code: 'validation_error', field: 'color', message: '请选择有效颜色。' };
      const position = store.contactCategories.reduce((max, item) => Math.max(max, Number(item.position ?? 0)), -1) + 1;
      const category = { id: id('contactCategory'), createdAt: nowIso(), updatedAt: nowIso(), name, color, position };
      store.contactCategories.push(category);
      persist();
      return category;
    },
    update_contact_category: (a) => {
      const existing = store.contactCategories.find((item) => item.id === a.id);
      if (!existing) throw { code: 'validation_error', field: 'id', message: '分组不存在。' };
      const draft = a.draft as ContactCategoryDraft;
      const name = String(draft.name ?? '').replace(/\s+/g, ' ').trim();
      if (!name) throw { code: 'validation_error', field: 'name', message: '分组名称不能为空。' };
      const color = normalizeHexColor(draft.color);
      if (!color) throw { code: 'validation_error', field: 'color', message: '请选择有效颜色。' };
      let updated: Dict | undefined;
      store.contactCategories = store.contactCategories.map((item) =>
        item.id === a.id ? (updated = { ...item, name, color, updatedAt: nowIso() }) : item
      );
      persist();
      return updated;
    },
    // Deleting a group keeps every contact and only clears their link, the same
    // promise the Rust side makes.
    delete_contact_category: (a) => {
      store.contactCategories = store.contactCategories.filter((item) => item.id !== a.id);
      store.contacts = store.contacts.map((contact) =>
        contact.categoryId === a.id ? { ...contact, categoryId: null } : contact
      );
      persist();
    },
    create_contact: (a) => {
      assertContactDraft(store, a.draft as ContactDraft);
      const contact = storedContact(store, id('contact'), nowIso(), nowIso(), a.draft as ContactDraft);
      store.contacts.push(contact);
      persist();
      return contact;
    },
    update_contact: (a) => {
      const existing = store.contacts.find((contact) => contact.id === a.id);
      if (!existing) throw { code: 'validation_error', field: 'id', message: '未找到该联系人。' };
      assertContactDraft(store, a.draft as ContactDraft);
      let updated: Dict | undefined;
      store.contacts = store.contacts.map((contact) =>
        contact.id === a.id
          ? (updated = storedContact(
              store,
              a.id as string,
              String(contact.createdAt ?? nowIso()),
              nowIso(),
              a.draft as ContactDraft
            ))
          : contact
      );
      persist();
      return updated;
    },
    delete_contact: (a) => {
      store.contacts = store.contacts.filter((contact) => contact.id !== a.id);
      persist();
    },
    // File transfer needs a real filesystem and a native save dialog, so the
    // browser fallback answers with the same shape the desktop returns but
    // refuses to pretend a file was written.
    export_contacts: () => {
      throw { code: 'system_error', message: 'File transfer is only available in the desktop app.' };
    },
    import_contacts: () => {
      throw { code: 'system_error', message: 'File transfer is only available in the desktop app.' };
    },
    export_contacts_vcard: () => {
      throw { code: 'system_error', message: 'File transfer is only available in the desktop app.' };
    },
    import_contacts_vcard: () => {
      throw { code: 'system_error', message: 'File transfer is only available in the desktop app.' };
    },

    // Rich text attachments. Bytes stay in memory rather than in localStorage:
    // binary does not survive a JSON round trip cleanly and a 1MB quota would
    // fill instantly. Attachments therefore vanish on reload, which is an
    // accepted dev-only limitation in the same spirit as the recurrence one.
    save_attachment: (a) => {
      const bytes = Uint8Array.from((a.bytes as number[]) ?? []);
      if (!bytes.length) throw { code: 'validation_error', field: 'file', message: '文件内容为空。' };
      if (bytes.length > 1024 * 1024) {
        throw { code: 'validation_error', field: 'file', message: '文件超过 1 MB 上限，请压缩后重试。' };
      }
      const fileName = String(a.fileName ?? 'file');
      // Same allowlist the desktop backend enforces, so a file that would be
      // refused there is refused here rather than appearing to work in dev.
      if (!isAllowedAttachmentName(fileName)) {
        throw {
          code: 'validation_error',
          field: 'file',
          message: '不支持该文件类型，只能上传办公文档与图片。'
        };
      }
      const match = /\.([A-Za-z0-9]{1,16})$/.exec(fileName);
      const extension = match ? match[1].toLowerCase() : null;
      const stem = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const attachmentId = extension ? `${stem}.${extension}` : stem;
      const mime = extension && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extension)
        ? `image/${extension === 'jpg' ? 'jpeg' : extension}`
        : 'application/octet-stream';
      const record = {
        id: attachmentId,
        fileName: fileName.split(/[\\/]/).pop() || 'file',
        relPath: `attachments/${attachmentId}`,
        byteSize: bytes.length,
        mime,
        createdAt: nowIso()
      };
      attachmentBytes.set(attachmentId, bytes);
      attachmentRecords.set(attachmentId, record);
      return record;
    },
    read_attachment: (a) => {
      const bytes = attachmentBytes.get(String(a.id));
      if (!bytes) throw { code: 'not_found', message: '未找到该附件。' };
      return Array.from(bytes);
    },
    list_attachments: (a) =>
      ((a.ids as string[]) ?? []).map((id) => attachmentRecords.get(id)).filter(Boolean),
    // No OS handler in a browser. A download under the real file name is the
    // closest equivalent, and here it is also the only way to get that name: the
    // stored file is named by its id.
    open_attachment: (a) => {
      const id = String(a.id);
      const bytes = attachmentBytes.get(id);
      const record = attachmentRecords.get(id);
      if (!bytes || !record) throw { code: 'not_found', message: '未找到该附件。' };
      if (typeof document === 'undefined') return;
      // Copy into a fresh array so the blob part is backed by a plain
      // ArrayBuffer, as the resolver does when it builds thumbnail URLs.
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: String(record.mime) }));
      const link = document.createElement('a');
      link.href = url;
      link.download = String(record.fileName);
      link.click();
      // The download has started; the URL only needs to outlive the click.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    collect_attachment_garbage: () => 0,

    // Software update check. The browser dev shim has no Cargo version and
    // should not hit the GitHub API on every page load, so it reports the
    // injected build version with no update available.
    check_for_update: () => ({
      currentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
      latestVersion: null,
      updateAvailable: false,
      releaseNotes: null,
      releaseUrl: typeof __RESA_REPO__ === 'string' && __RESA_REPO__ ? `https://github.com/${__RESA_REPO__.trim()}/releases` : '',
      publishedAt: null
    }),

    // Settings & environment
    get_app_settings: () => store.settings,
    update_app_settings: (a) => {
      store.settings = { ...store.settings, ...(a.settings as Dict) };
      store.settings.barMenu = normalizeBarMenu(store.settings.barMenu);
      Reflect.deleteProperty(store.settings, 'barButtons');
      persist();
      barPresentation();
      return store.settings;
    },
    get_status_island_snapshot: () => ({
      sampledAt: nowIso(),
      events: store.events,
      externalEvents: store.externalEvents,
      tasks: store.tasks,
      focus: sampleFocus(),
      reminders: [],
      alarmNotices: store.alarmNotices,
      expiredAlarmNotices: [],
      notificationMode: store.settings.notificationMode ?? 'notification',
      barMenu: normalizeBarMenu(store.settings.barMenu)
    }),
    list_monitors: () => [
      {
        id: 'browser',
        name: 'Browser',
        isPrimary: true,
        positionX: 0,
        positionY: 0,
        width: typeof window !== 'undefined' ? window.screen.width : 1920,
        height: typeof window !== 'undefined' ? window.screen.height : 1080,
        scaleFactor: 1
      }
    ],

    // Module layout & per-module state
    list_module_layout: () => store.moduleLayout,
    save_module_layout: (a) => {
      store.moduleLayout = (a.layout as Dict[]) ?? [];
      persist();
      return store.moduleLayout;
    },

    // Focus timer
    create_focus_session: (a) => {
      const session = a.session as Dict;
      store.focusSessions.push(session);
      persist();
      return session;
    },
    list_focus_sessions: (a) => {
      const range = a.range as { startAt: string; endAtExclusive: string };
      return store.focusSessions.filter(
        (s) =>
          typeof s.startedAt === 'string' &&
          s.startedAt >= range.startAt &&
          s.startedAt < range.endAtExclusive
      );
    },
    get_focus_statistics: (a) => {
      const boundaries = (a.boundaries as Array<{ period: string; startAt: string; endAtExclusive: string }>) ?? [];
      let totalFocusedSeconds = 0;
      let completedCount = 0;
      let interruptedCount = 0;
      const points = boundaries.map((b) => {
        const inWindow = store.focusSessions.filter(
          (s) =>
            typeof s.startedAt === 'string' &&
            s.startedAt >= b.startAt &&
            s.startedAt < b.endAtExclusive
        );
        const focused = inWindow.reduce((sum, s) => sum + Number(s.focusedSeconds ?? 0), 0);
        const completed = inWindow.filter((s) => s.status === 'completed').length;
        const interrupted = inWindow.filter((s) => s.status === 'interrupted').length;
        totalFocusedSeconds += focused;
        completedCount += completed;
        interruptedCount += interrupted;
        return { period: b.period, focusedSeconds: focused, completedCount: completed, interruptedCount: interrupted };
      });
      const total = completedCount + interruptedCount;
      return {
        totalFocusedSeconds,
        completedCount,
        interruptedCount,
        completionRate: total === 0 ? 0 : completedCount / total,
        points
      };
    },
    get_focus_timer_snapshot: sampleFocus,
    get_pending_focus_completion: () => pendingFocus,
    acknowledge_focus_completion: (a) => { if (pendingFocus?.id === a.id) pendingFocus = null; },
    start_focus_timer: (a) => startFocusTimer(a.snapshot as Dict, Number(a.remainingSeconds)),
    pause_focus_timer: pauseFocusTimer,
    resume_focus_timer: resumeFocusTimer,
    cancel_focus_timer: () => {
      window.clearInterval(focusInterval);
      remainingMs = 0;
      pendingFocus = null;
      focusSession = null;
      focus = { status: 'idle', sessionId: null, plannedSeconds: 0, remainingSeconds: 0, focusedSeconds: 0, startedAt: null, stageSequence: 0, stageChangedAt: null };
      publishFocus();
      emit('status-island-invalidated', null);
    },
    start_status_island_focus: (a) => {
      const seconds = Number(a.minutes) * 60;
      startFocusTimer({ id: id('focus'), plannedSeconds: seconds, startedAt: nowIso() }, seconds);
    },
    pause_status_island_focus: pauseFocusTimer,
    resume_status_island_focus: resumeFocusTimer,

    // Kanban
    get_kanban_snapshot: () => store.kanban,
    create_kanban_lane: (a) => {
      const lane = {
        id: id('lane'),
        position: store.kanban.lanes.length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...(a.draft as Dict)
      };
      store.kanban.lanes.push(lane);
      persist();
      return lane;
    },
    update_kanban_lane: (a) => {
      let updated: Dict | undefined;
      store.kanban.lanes = store.kanban.lanes.map((l) =>
        l.id === a.id ? (updated = { ...l, ...(a.draft as Dict), updatedAt: nowIso() }) : l
      );
      persist();
      return updated;
    },
    delete_kanban_lane: (a) => {
      store.kanban.lanes = store.kanban.lanes.filter((l) => l.id !== a.id);
      store.kanban.cards = store.kanban.cards.filter((c) => c.laneId !== a.id);
      persist();
    },
    reorder_kanban_lanes: (a) => {
      const order = a.orderedIds as string[];
      store.kanban.lanes = store.kanban.lanes.map((l) => ({
        ...l,
        position: order.indexOf(l.id as string)
      }));
      persist();
      return store.kanban.lanes;
    },
    create_kanban_card: (a) => {
      const draft = a.draft as Dict;
      const laneId = draft.laneId as string;
      const position = store.kanban.cards.filter((c) => c.laneId === laneId).length;
      const card = { id: id('card'), position, createdAt: nowIso(), updatedAt: nowIso(), ...draft };
      store.kanban.cards.push(card);
      persist();
      return card;
    },
    update_kanban_card: (a) => {
      let updated: Dict | undefined;
      store.kanban.cards = store.kanban.cards.map((c) =>
        c.id === a.id ? (updated = { ...c, ...(a.draft as Dict), updatedAt: nowIso() }) : c
      );
      persist();
      return updated;
    },
    delete_kanban_card: (a) => {
      store.kanban.cards = store.kanban.cards.filter((c) => c.id !== a.id);
      persist();
    },
    move_kanban_card: (a) => {
      const cardId = a.id as string;
      const targetLaneId = a.targetLaneId as string;
      const targetIndex = a.targetIndex as number;
      const card = store.kanban.cards.find((c) => c.id === cardId);
      if (!card) return;
      const rest = store.kanban.cards
        .filter((c) => c.laneId === targetLaneId && c.id !== cardId)
        .sort((x, y) => Number(x.position) - Number(y.position));
      rest.splice(targetIndex, 0, { ...card, laneId: targetLaneId });
      const repositioned = new Map(rest.map((c, index) => [c.id, index]));
      store.kanban.cards = store.kanban.cards.map((c) => {
        if (c.id === cardId) return { ...c, laneId: targetLaneId, position: repositioned.get(cardId) ?? 0, updatedAt: nowIso() };
        if (repositioned.has(c.id as string)) return { ...c, position: repositioned.get(c.id as string)! };
        return c;
      });
      persist();
    },
    create_kanban_priority: (a) => {
      const priority = {
        id: id('prio'),
        position: store.kanban.priorities.length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...(a.draft as Dict)
      };
      store.kanban.priorities.push(priority);
      persist();
      return priority;
    },
    update_kanban_priority: (a) => {
      let updated: Dict | undefined;
      store.kanban.priorities = store.kanban.priorities.map((p) =>
        p.id === a.id ? (updated = { ...p, ...(a.draft as Dict), updatedAt: nowIso() }) : p
      );
      persist();
      return updated;
    },
    delete_kanban_priority: (a) => {
      store.kanban.priorities = store.kanban.priorities.filter((p) => p.id !== a.id);
      store.kanban.cards = store.kanban.cards.map((c) =>
        c.priorityId === a.id ? { ...c, priorityId: null } : c
      );
      persist();
    },
    reorder_kanban_priorities: (a) => {
      const order = a.orderedIds as string[];
      store.kanban.priorities = store.kanban.priorities.map((p) => ({
        ...p,
        position: order.indexOf(p.id as string)
      }));
      persist();
      return store.kanban.priorities;
    },
    create_kanban_tag: (a) => {
      const tag = { id: id('tag'), createdAt: nowIso(), updatedAt: nowIso(), ...(a.draft as Dict) };
      store.kanban.tags.push(tag);
      persist();
      return tag;
    },
    update_kanban_tag: (a) => {
      let updated: Dict | undefined;
      store.kanban.tags = store.kanban.tags.map((tg) =>
        tg.id === a.id ? (updated = { ...tg, ...(a.draft as Dict), updatedAt: nowIso() }) : tg
      );
      persist();
      return updated;
    },
    delete_kanban_tag: (a) => {
      store.kanban.tags = store.kanban.tags.filter((tg) => tg.id !== a.id);
      store.kanban.cards = store.kanban.cards.map((c) => ({
        ...c,
        tagIds: Array.isArray(c.tagIds) ? (c.tagIds as string[]).filter((t) => t !== a.id) : c.tagIds
      }));
      persist();
    },

    list_screenshot_history: () => ({ items: [], nextCursor: null }),
    screenshot_shortcut_status: () => {
      const binding = (shortcut: unknown) => ({
        shortcut: typeof shortcut === 'string' ? shortcut : '',
        registered: false,
        error: 'Global shortcuts are available only in the desktop application.'
      });
      return {
        screenshot: binding(store.settings.screenshotShortcut),
        history: binding(store.settings.screenshotHistoryShortcut),
        createEvent: binding(store.settings.quickCreateEventShortcut),
        createTask: binding(store.settings.quickCreateTaskShortcut),
        createNote: binding(store.settings.quickCreateNoteShortcut)
      };
    },
    screenshot_shortcut_recording: () => undefined,
    copy_screenshot_history: () => { throw new Error('Image clipboard requires the desktop application.'); },
    delete_screenshot_history: () => { throw new Error('Screenshot files require the desktop application.'); },
    open_screenshot_folder: () => { throw new Error('Screenshot folder requires the desktop application.'); },
    open_screenshot_history: () => openPanel('history'),
    toggle_bar_menu: () => panelSource === 'menu' ? closePanel() : openPanel('menu'),
    toggle_status_island_details: () => panelSource === 'island' ? closePanel() : openPanel('island'),
    toggle_nowly_panel: () => panelSource === 'nowly' ? closePanel() : openPanel('nowly'),
    close_status_island_details: closePanel,
    // The browser has no native quick-create window, so the dialog opens as its own page.
    open_quick_create: (a) => {
      if (!isQuickCreateKind(a.kind)) throw { code: 'validation_error', message: `Invalid quick-create kind: ${String(a.kind)}` };
      if (panelSource === 'menu') closePanel();
      window.open(`/?surface=quick-create&kind=${a.kind}`, 'nowly-quick-create', 'popup,width=760,height=720');
    },
    get_quick_create_request: () => {
      const kind = new URLSearchParams(window.location.search).get('kind');
      return { id: 1, kind: isQuickCreateKind(kind) ? kind : 'event', maxHeight: window.innerHeight };
    },
    quick_create_layout: () => undefined,
    close_quick_create: () => {
      if (window.opener) window.close();
    },
    get_status_island_presentation: barPresentation,
    finish_status_island_presentation: () => undefined,
    finish_status_island_details: (a) => {
      if (Number(a.generation) !== panelGeneration || !panelClosing) return;
      panelClosing = false;
      emit('status-island-details-closed', { generation: panelGeneration });
      barPresentation();
    },
    set_status_island_primary: () => undefined,
    set_status_island_visibility: (a) => {
      notificationVisible = a.visible === true;
      return barPresentation();
    },
    set_status_island_presence: (a) => {
      const surface = String(a.surface);
      if (!['island', 'details', 'keyboard', 'action'].includes(surface)) {
        throw { code: 'system_error', message: `Invalid Bar presence surface: ${surface}` };
      }
      if (a.present === true) barPresence.add(surface);
      else barPresence.delete(surface);
      return barPresentation();
    },

    // Window mode & shell — no desktop window to switch in the browser.
    enter_wallpaper_mode: () => 'ok',
    enter_foreground_mode: () => 'ok',

    // Open external links in a new browser tab; the desktop app defers to the OS.
    open_external: (a) => {
      const target = a.target as string;
      if (typeof window !== 'undefined' && /^(https?:|mailto:)/i.test(target)) {
        window.open(target, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const invoke = async (command: string, args: Dict = {}) => {
    if (command === 'plugin:event|listen') {
      const id = ++listenerId;
      listeners.set(id, { event: String(args.event), callback: Number(args.handler) });
      return id;
    }
    if (command === 'plugin:event|unlisten') {
      listeners.delete(Number(args.eventId));
      return;
    }
    if (command === 'plugin:event|emit' || command === 'plugin:event|emit_to') {
      emit(String(args.event), args.payload);
      return;
    }
    const handler = handlers[command];
    if (!handler) {
      throw { code: 'system_error', message: `Unsupported command in browser fallback: ${command}` };
    }
    return handler(args);
  };

  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {
      invoke,
      transformCallback: (callback: (payload: unknown) => void) => {
        const callbackId = Math.floor(Math.random() * 2 ** 32);
        Reflect.set(window, `_${callbackId}`, callback);
        return callbackId;
      }
    }
  });
  Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
    configurable: true,
    value: { unregisterListener: (_event: string, id: number) => { listeners.delete(id); } }
  });
}
