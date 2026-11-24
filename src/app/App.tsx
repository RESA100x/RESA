import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { currentMonitor as currentWindowMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  buildDefinitions,
  type WidgetId
} from '../widgets/widget-registry';
import { CalendarWidget } from '../calendar/CalendarWidget';
import { useEvents } from '../calendar/useEvents';
import { useCategories } from '../calendar/useCategories';
import { registerModalRequest, type ModalState } from '../lib/modal-store';
import { externalToCalendarEvent, type CalendarSubscription } from '../calendar/subscription-model';
import { isEventWritable, type CalendarEvent, type EventTarget } from '../calendar/calendar-model';
import { enterForegroundMode, enterWallpaperMode } from '../lib/window-mode';
import { MatrixWidget } from '../matrix/MatrixWidget';
import { KanbanWidget } from '../kanban/KanbanWidget';
import { TaskWorkspaceProvider, useTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { TaskDragProvider } from '../tasks/TaskDragContext';
import { IconStyleProvider } from '../components/icons';
import { useWorkspaceTasks } from '../tasks/useWorkspaceTasks';
import { BOARD_STATUSES, taskStatus } from '../tasks/task-model';
import { priorityColors } from '../tasks/task-projections';
import { ModalRoot } from '../modals/ModalRoot';
import { NotesWidget } from '../notes/NotesWidget';
import { useNotes } from '../notes/useNotes';
import { useNotesView } from '../notes/useNotesView';
import { DesktopShell } from './layout/DesktopShell';
import { MobileShell } from './layout/MobileShell';
import { isMobileShell } from './layout/platform';
import { useSettings } from '../settings/useSettings';
import { useRecentColors } from '../settings/useRecentColors';
import { useUpdateCheck } from '../settings/useUpdateCheck';
import { useNowlyRepository } from '../data/RepositoryContext';
import { useCurrentTime } from './useCurrentTime';
import { t, useTranslation, getLocale } from '../i18n';
import { TimeModule } from '../time/TimeModule';
import { StickersWidget } from '../stickers/StickersWidget';
import { PlantsWidget } from '../plants/PlantsWidget';
import { PhonebookWidget } from '../phonebook/PhonebookWidget';
import { LibraryWidget } from '../library/LibraryWidget';
import { useContacts } from '../phonebook/useContacts';
import { bookCalendarChips } from '../library/calendar-chips';
import { useBooks } from '../library/useBooks';
import { ReportsWidget } from '../reports/ReportsWidget';
import { ArchiveWidget } from '../archive/ArchiveWidget';
import { ProjectsWidget } from '../projects/ProjectsWidget';
import { MeetingsWidget } from '../meetings/MeetingsWidget';
import { useMeetings } from '../meetings/useMeetings';
import { meetingColor } from '../meetings/meeting-model';
import { TimeSettingsDialog } from '../time/TimeSettingsDialog';
import { useFocusTimer } from '../focus/FocusTimerContext';
import { FocusStatisticsDialog } from '../focus/FocusStatisticsDialog';
import { FocusWallpaperOverlay } from '../focus/FocusWallpaperOverlay';
import { OnboardingGuide, type GuideStep } from './onboarding/OnboardingGuide';
import { useOnboarding } from './onboarding/useOnboarding';
import { CommandPalette, type PaletteAction } from '../command-palette/CommandPalette';
import type { SearchHit } from '../lib/search';
import type { NativeStatusIslandSnapshot } from '../quick-panel/useStatusIslandSnapshot';
import { RECORDS_CHANGED_EVENT, recordsChangedKind, type RecordsChangedKind } from '../quick-create/events';
import { effectiveWeekStart } from '../lib/date';
import { anniversaryOccurrence, formatDisplayDate } from '../lib/calendar-system';

type WindowMode = 'wallpaper' | 'foreground';

function localeTag() {
  return getLocale();
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Mirrors `monitors::monitor_id` in Rust so the layout key written here matches
// the id the backend reports for the same screen.
function monitorIdOf(monitor: { name: string | null; position: { x: number; y: number } }) {
  return monitor.name && monitor.name.length > 0
    ? monitor.name
    : `display:${monitor.position.x}:${monitor.position.y}`;
}

// The monitor the foreground window currently sits on. Only tracked while the
// opt-in multi-monitor layout is enabled; otherwise the global layout is used.
function useCurrentMonitorId(enabled: boolean) {
  const [state, setState] = useState<{ resolved: boolean; id: string | null }>({
    resolved: false,
    id: null
  });
  useEffect(() => {
    if (!enabled) {
      setState({ resolved: true, id: null });
      return;
    }
    let active = true;
    let unlisten: (() => void) | null = null;
    const read = () => {
      try {
        void currentWindowMonitor()
          .then((monitor) => {
            if (!active) return;
            setState({ resolved: true, id: monitor ? monitorIdOf(monitor) : null });
          })
          .catch(() => {
            if (active) setState({ resolved: true, id: null });
          });
      } catch {
        // Outside the desktop shell (browser dev) there is no window to ask.
        if (active) setState({ resolved: true, id: null });
      }
    };
    read();
    try {
      void getCurrentWindow()
        .onMoved(() => read())
        .then((stop) => {
          if (active) unlisten = stop;
          else stop();
        })
        .catch(() => undefined);
    } catch {
      // Same as above: no native window in a plain browser.
    }
    return () => {
      active = false;
      unlisten?.();
    };
  }, [enabled]);
  return state;
}

function AppContent() {
  useTranslation();
  const repository = useNowlyRepository();
  const settingsFeature = useSettings();
  const multiMonitorWallpaper = settingsFeature.settings.data.multiMonitorWallpaper ?? false;
  const currentMonitor = useCurrentMonitorId(multiMonitorWallpaper);
  const layoutMonitorKey = !multiMonitorWallpaper
    ? undefined
    : currentMonitor.resolved
      ? currentMonitor.id ?? undefined
      : null;
  const layoutTargetLabel =
    multiMonitorWallpaper && currentMonitor.id
      ? settingsFeature.monitors.data.find((monitor) => monitor.id === currentMonitor.id)?.name ??
        currentMonitor.id
      : undefined;
  const weekStart = effectiveWeekStart(settingsFeature.settings.data.weekStart);
  const eventsFeature = useEvents({ weekStart });
  const categoriesFeature = useCategories();
  const tasksFeature = useWorkspaceTasks();
  const { refresh: refreshWorkspace, workspace: taskWorkspace } = useTaskWorkspace();
  const notesFeature = useNotes();
  const meetingsFeature = useMeetings();
  const phonebook = useContacts();
  const library = useBooks();
  const notesView = useNotesView();
  const refreshEvents = useCallback(() => eventsFeature.retryEvents(), [eventsFeature]);
  const events = eventsFeature.events.data;
  const tasks = tasksFeature.tasks.data;
  // Due dates are shown on the calendar as read-only all-day chips. They are
  // merged here, not stored as events, so completing or moving a task never
  // leaves a stale calendar row behind.
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const dueTasks = taskWorkspace.data.tasks.filter(
      (task) => task.dueDate && BOARD_STATUSES.includes(taskStatus(task))
    );
    // Birthdays and (work) anniversaries repeat every year, so they are stamped
    // onto the year the calendar is showing rather than the year they were
    // recorded in. They stay read-only chips like due dates.
    const yearlyDates = phonebook.contacts.data.flatMap((contact) => {
      const chips: Array<{ key: string; title: string; color: string; date: string }> = [];
      const birthday = contact.birthday ? anniversaryOccurrence(contact.birthday, eventsFeature.year) : null;
      if (birthday) chips.push({ key: 'birthday', title: t('phonebook.birthdayEvent', { name: contact.name }), color: '#E7A3B8', date: birthday });
      const anniversary = contact.profile.anniversaryDate
        ? anniversaryOccurrence(contact.profile.anniversaryDate, eventsFeature.year)
        : null;
      if (anniversary) chips.push({ key: 'anniversary', title: t('phonebook.anniversaryEvent', { name: contact.name }), color: '#C9B6E4', date: anniversary });
      return chips.map((chip) => ({ ...chip, contactId: contact.id }));
    });
    return [
      ...events,
      ...meetingsFeature.meetings.data.map((meeting) => ({
        id: `meeting:${meeting.id}`,
        meetingId: meeting.id,
        title: meeting.title,
        startAt: meeting.startsAt,
        endAt: meeting.endsAt,
        allDay: false,
        category: '',
        color: meetingColor(meeting.status),
        note: '',
        reminders: [],
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
        recurrence: null,
        startTz: null,
        endTz: null,
        rrule: null,
        seriesId: null,
        seriesStartAt: null,
        occurrenceStartAt: null,
        isOverridden: false,
        subscriptionId: null
      })),
      ...dueTasks.map((task) => ({
        id: `task:${task.id}`,
        taskId: task.id,
        title: task.title,
        startAt: `${task.dueDate}T00:00`,
        endAt: `${task.dueDate}T23:59`,
        allDay: true,
        category: '',
        color: priorityColors[task.priority],
        note: '',
        reminders: [],
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        recurrence: null,
        startTz: null,
        endTz: null,
        rrule: null,
        seriesId: null,
        seriesStartAt: null,
        occurrenceStartAt: null,
        isOverridden: false,
        subscriptionId: null
      })),
      ...yearlyDates.map((chip) => ({
        id: `contact-${chip.key}:${chip.contactId}`,
        contactId: chip.contactId,
        title: chip.title,
        startAt: `${chip.date}T00:00`,
        endAt: `${chip.date}T23:59`,
        allDay: true,
        category: '',
        color: chip.color,
        note: '',
        reminders: [],
        createdAt: '',
        updatedAt: '',
        recurrence: null,
        startTz: null,
        endTz: null,
        rrule: null,
        seriesId: null,
        seriesStartAt: null,
        occurrenceStartAt: null,
        isOverridden: false,
        subscriptionId: null
      })),
      ...bookCalendarChips(library.books.data).map((chip) => ({
        id: chip.id,
        bookId: chip.bookId,
        title: chip.title,
        startAt: `${chip.date}T00:00`,
        endAt: `${chip.date}T23:59`,
        allDay: true,
        category: '',
        color: chip.color,
        note: '',
        reminders: [],
        createdAt: '',
        updatedAt: '',
        recurrence: null,
        startTz: null,
        endTz: null,
        rrule: null,
        seriesId: null,
        seriesStartAt: null,
        occurrenceStartAt: null,
        isOverridden: false,
        subscriptionId: null
      }))
    ];
  }, [events, meetingsFeature.meetings.data, taskWorkspace.data.tasks, phonebook.contacts.data, library.books.data, eventsFeature.year, localeTag()]);
  const notes = notesFeature.notes.data;
  const [modal, setModal] = useState<ModalState>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [subscriptions, setSubscriptions] = useState<CalendarSubscription[]>([]);
  const loadSubscriptions = useCallback(() => {
    void repository.listCalendarSubscriptions().then(setSubscriptions).catch(() => setSubscriptions([]));
  }, [repository]);
  // After a subscription is created, edited, deleted, or manually refreshed the
  // external_events table may have changed, so reload both the source list and
  // the calendar events; otherwise removed/updated events linger until the next
  // range change or the ~1-minute background poll.
  const onSubscriptionsChanged = useCallback(() => {
    loadSubscriptions();
    void refreshEvents();
  }, [loadSubscriptions, refreshEvents]);
  // Refresh every configured subscription in turn, then reload the source list
  // and calendar events so freshly synced items appear at once. Individual
  // failures are ignored so one broken source can't block the rest.
  const syncAllSubscriptions = useCallback(async () => {
    await Promise.all(
      subscriptions.map((subscription) =>
        repository.refreshCalendarSubscription(subscription.id).catch(() => undefined)
      )
    );
    onSubscriptionsChanged();
  }, [subscriptions, repository, onSubscriptionsChanged]);
  const [focusStatisticsOpen, setFocusStatisticsOpen] = useState(false);
  const [timeDialog, setTimeDialog] = useState<{ createAlarm: boolean; trigger: HTMLElement | null } | null>(null);
  const [windowMode, setWindowMode] = useState<WindowMode>('foreground');
  const [isSwitchingWindowMode, setIsSwitchingWindowMode] = useState(false);
  const isSwitchingWindowModeRef = useRef(false);
  const focusTimer = useFocusTimer();
  const focusStatus = focusTimer.state.status;

  const onboarding = useOnboarding();
  const update = useUpdateCheck();

  const now = useCurrentTime();
  const todayIso = localIsoDate(now);
  const { recentColors, rememberColor: rememberCustomColor } = useRecentColors();

  // Interface density is a global visual preference: it drives the spacing
  // scale for the whole app, modals included. We reflect it as a data attribute
  // on the document root so CSS can tighten (compact) or widen (comfortable)
  // paddings and gaps without threading the value through every view. The
  // balanced default needs no overrides.
  const density = settingsFeature.settings.data.density;
  useEffect(() => {
    document.documentElement.dataset.density = density;
    return () => {
      delete document.documentElement.dataset.density;
    };
  }, [density]);

  // When a focus session finishes, briefly show the "done" state and then
  // clear it back to idle. Completion only surfaces a system notification; it
  // must never pull Nowly from wallpaper to the foreground. Resetting is what
  // clears the overlay: the fullscreen countdown only renders while the
  // session is running/paused/completed, so returning to idle removes it and
  // leaves the wallpaper clean without any window-mode switch.
  useEffect(() => {
    if (focusStatus !== 'completed') return;
    const id = window.setTimeout(() => {
      focusTimer.reset();
    }, 2500);
    return () => window.clearTimeout(id);
  }, [focusStatus, windowMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // The full set of placeable modules. Every module Nowly offers is built in.
  const definitions = buildDefinitions();
  // A phone has no wallpaper mode, no multi-monitor layout and no drag grid, so
  // it renders the same modules through a tabbed shell instead. Launcher
  // modules open their list as a full page there rather than as a modal.
  const mobileShell = isMobileShell();

  const todayEventCount = calendarEvents.filter((event) => event.startAt.startsWith(todayIso)).length;
  const importantTaskCount = tasks.filter(
    (task) => !task.completed && task.quadrant.startsWith('important')
  ).length;
  const summary = t('app.summary', { events: todayEventCount, tasks: importantTaskCount, notes: notes.length });
  const modules: Partial<Record<WidgetId, ReactNode>> = {};
  modules.stickers = <StickersWidget readOnly={windowMode === 'wallpaper' || isSwitchingWindowMode} />;
  modules.plants = <PlantsWidget readOnly={windowMode === 'wallpaper' || isSwitchingWindowMode} />;
  modules.phonebook = <PhonebookWidget readOnly={windowMode === 'wallpaper' || isSwitchingWindowMode} mobile={mobileShell} />;
  modules.library = <LibraryWidget readOnly={windowMode === 'wallpaper' || isSwitchingWindowMode} mobile={mobileShell} />;
    modules.reports = <ReportsWidget readOnly={windowMode === 'wallpaper' || isSwitchingWindowMode} mobile={mobileShell} />;
    modules.archive = <ArchiveWidget readOnly={windowMode === 'wallpaper' || isSwitchingWindowMode} mobile={mobileShell} />;
    modules.projects = <ProjectsWidget readOnly={windowMode === 'wallpaper' || isSwitchingWindowMode} mobile={mobileShell} />;
    modules.meetings = <MeetingsWidget readOnly={windowMode === 'wallpaper' || isSwitchingWindowMode} mobile={mobileShell} />;
  {
    modules.calendar = (
      <CalendarWidget
        year={eventsFeature.year}
        monthIndex={eventsFeature.monthIndex}
        todayIso={todayIso}
        events={calendarEvents}
        categories={categoriesFeature.categories}
        status={eventsFeature.events.status}
        errorMessage={eventsFeature.events.status === 'error' ? eventsFeature.events.message : undefined}
        view={eventsFeature.view}
        anchorIso={eventsFeature.anchorIso}
        onRetry={() => void eventsFeature.retryEvents()}
        onCreateEvent={() => openModalInForeground({ type: 'event-create', dateIso: todayIso, trigger: null })}
        onSetView={eventsFeature.setView}
        onPreviousMonth={eventsFeature.goToPrevious}
        onNextMonth={eventsFeature.goToNext}
        onToday={eventsFeature.goToToday}
        onCreateEventForDate={(dateIso) => openModalInForeground({ type: 'event-create', dateIso, trigger: null })}
        onOpenDate={(isoDate) => openModalInForeground({ type: 'date', isoDate, trigger: null })}
        onOpenEvent={(event) => {
          if (event.bookId) {
            openModalInForeground({ type: 'book-card', bookId: event.bookId, trigger: null });
            return;
          }
          if (event.contactId) {
            openModalInForeground({ type: 'contact-card', contactId: event.contactId, trigger: null });
            return;
          }
          if (event.meetingId) {
            openModalInForeground({ type: 'meeting-edit', meetingId: event.meetingId, trigger: null });
            return;
          }
          if (event.taskId) {
            const task = taskWorkspace.data.tasks.find((item) => item.id === event.taskId);
            if (task) openModalInForeground({ type: 'workspace-task-edit', task, trigger: null });
            return;
          }
          if (event.subscriptionId && !isEventWritable(event)) {
            openModalInForeground({ type: 'external-detail', event, trigger: null });
            return;
          }
          openModalInForeground({ type: 'event-edit', event, trigger: null });
        }}
        onMoveEvent={(event, isoDate) => void eventsFeature.moveEvent(event, isoDate)}
        onMoveEventToHour={(event, isoDate, startHour) => void eventsFeature.moveEventToHour(event, isoDate, startHour)}
        onResizeEvent={(event, endIsoDate) => void eventsFeature.resizeEvent(event, endIsoDate)}
        onResizeEventToHour={(event, endHour) => void eventsFeature.resizeEventToHour(event, endHour)}
        calendarSettings={{
          weekStart,
          dateFormat: settingsFeature.settings.data.dateFormat,
          showWeekends: settingsFeature.settings.data.showWeekends
        }}
        onOpenSettings={() => openModalInForeground({ type: 'calendar-settings', trigger: null })}
        hasSubscriptions={subscriptions.length > 0}
        onSyncSubscriptions={syncAllSubscriptions}
      />
    );
  }
  {
    modules.matrix = (
      <MatrixWidget
        tasks={tasks}
        status={tasksFeature.tasks.status}
        errorMessage={tasksFeature.tasks.status === 'error' ? tasksFeature.tasks.message : undefined}
        completionError={tasksFeature.failedCompletion?.message ?? null}
        dragError={tasksFeature.dragError}
        pendingTaskIds={tasksFeature.pendingTaskIds}
        onRetry={() => void tasksFeature.retryTasks()}
        onCreateTask={(trigger) => openModalInForeground({ type:'task-create', dueDate:null, trigger })}
        onQuickAdd={tasksFeature.quickAdd}
        onOpenSettings={() => openModalInForeground({ type:'task-settings', trigger:null })}
        onOpenTask={(task, trigger) => openModalInForeground({ type:'task-edit', task, trigger })}
        onToggleTask={(task, completed) => void tasksFeature.setTaskCompleted(task, completed)}
        onArchiveTask={(task) => void tasksFeature.archiveTask(task)}
        onMoveTask={(task, quadrant) => void tasksFeature.moveTask(task, quadrant)}
        onRetryCompletion={() => void tasksFeature.retryFailedCompletion()}
        onDismissCompletionError={tasksFeature.dismissTaskError}
        onDismissDragError={tasksFeature.dismissDragError}
      />
    );
  }
  {
    modules.notes = (
      <NotesWidget
        notes={notes}
        status={notesFeature.notes.status}
        errorMessage={notesFeature.notes.status === 'error' ? notesFeature.notes.message : undefined}
        view={notesView.view}
        onSetView={notesView.setView}
        onRetry={() => void notesFeature.retryNotes()}
        onCreateNote={() => openModalInForeground({type:'note-create',trigger:null})}
        onOpenNote={(note,trigger) => openModalInForeground({type:'note-edit',note,trigger})}
        onViewAll={(trigger) => openModalInForeground({type:'notes-manager',trigger})}
      />
    );
  }
  modules.kanban = (
    <KanbanWidget
      todayIso={todayIso}
      recentColors={recentColors}
      onRememberCustomColor={rememberCustomColor}
    />
  );
  modules.time = <TimeModule mode={windowMode} onCreateAlarm={() => openTimeDialog(true)} onOpenSettings={() => openTimeDialog()} onOpenStatistics={() => setFocusStatisticsOpen(true)} onEnterWallpaper={() => void runWindowModeSwitch(switchToWallpaper)} />;


  useEffect(() => {
    const removers: Array<() => void> = [];
    // A login launch can start the window already parked as the wallpaper, so
    // ask once instead of assuming foreground. Without this the spanning
    // multi-monitor layout would not render until the user switched modes.
    void invoke<string>('get_window_mode')
      .then((mode) => {
        if (mode === 'wallpaper') setWindowMode('wallpaper');
      })
      .catch(() => undefined);
    // The desktop double-click hook can restore the window natively without the
    // webview seeing the click, so re-read the mode whenever we gain focus. This
    // is what brings the topbar back on the first double-click.
    try {
      void getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => {
          if (!focused) return;
          void invoke<string>('get_window_mode')
            .then((mode) => {
              if (mode === 'foreground' || mode === 'wallpaper') setWindowMode(mode);
            })
            .catch(() => undefined);
        })
        .then((remove) => removers.push(remove));
    } catch {
      // No native window in a plain browser.
    }
    void listen<WindowMode>('window-mode-changed', (event) => setWindowMode(event.payload)).then(remove => removers.push(remove));
    void listen('open-settings', () => setModal({type:'settings',trigger:null})).then(remove => removers.push(remove));
    void listen('request-overlay-cleanup', () => setModal(null)).then(remove => removers.push(remove));
    void listen('calendar-subscriptions-updated', () => { loadSubscriptions(); void refreshEvents(); }).then(remove => removers.push(remove));
    void listen<{ target: EventTarget; startAt: string }>('status-island-open-event', event => {
      void invoke<NativeStatusIslandSnapshot>('get_status_island_snapshot').then(snapshot => {
        const candidates = [...snapshot.events, ...snapshot.externalEvents.map(externalToCalendarEvent)];
        const selected = candidates.find(item => item.id === event.payload.target.id
          && (event.payload.target.occurrenceStartAt !== null
            ? item.occurrenceStartAt === event.payload.target.occurrenceStartAt
            : item.startAt === event.payload.startAt));
        if (!selected) return;
        openModalInForeground(selected.subscriptionId && !isEventWritable(selected)
          ? { type: 'external-detail', event: selected, trigger: null }
          : { type: 'event-edit', event: selected, trigger: null });
      }).catch(() => undefined);
    }).then(remove => removers.push(remove));
    void listen<string>('status-island-open-task', event => {
      void invoke<NativeStatusIslandSnapshot>('get_status_island_snapshot').then(snapshot => {
        const task = snapshot.tasks.find(item => item.id === event.payload);
        if (task) openModalInForeground({ type: 'workspace-task-edit', task, trigger: null });
      }).catch(() => undefined);
    }).then(remove => removers.push(remove));
    return () => removers.forEach(remove => remove());
  }, [loadSubscriptions, refreshEvents]);

  // The quick-create window writes through the same backend; reload whatever it
  // changed, quietly, so the modules on screen do not flash a loading state.
  const reloadChanged = useRef<(kind: RecordsChangedKind) => void>(() => undefined);
  reloadChanged.current = (kind) => {
    if (kind === 'event') void eventsFeature.refreshEvents();
    if (kind === 'category') {
      categoriesFeature.reloadCategories();
      void eventsFeature.refreshEvents();
    }
    if (kind === 'task') void refreshWorkspace();
    if (kind === 'note') void notesFeature.refreshNotes();
  };
  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | null = null;
    void listen(RECORDS_CHANGED_EVENT, (event) => {
      const kind = recordsChangedKind(event.payload);
      if (kind) reloadChanged.current(kind);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else remove = unlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      remove?.();
    };
  }, []);

  useEffect(() => { loadSubscriptions(); }, [loadSubscriptions]);

  async function runWindowModeSwitch(switchMode: () => Promise<void>) {
    if (isSwitchingWindowModeRef.current) return;

    isSwitchingWindowModeRef.current = true;
    setIsSwitchingWindowMode(true);
    try {
      await switchMode();
    } finally {
      isSwitchingWindowModeRef.current = false;
      setIsSwitchingWindowMode(false);
    }
  }

  async function switchToForeground() {
    await enterForegroundMode();
    setWindowMode('foreground');
  }

  async function switchToWallpaper() {
    await enterWallpaperMode();
    setWindowMode('wallpaper');
  }

  function openModalInForeground(nextModal: ModalState) {
    runWindowModeSwitch(async () => {
      if (windowMode === 'wallpaper') {
        await switchToForeground().catch(() => undefined);
      }
      setModal(nextModal);
    }).catch(() => undefined);
  }

  // Blocks that live outside the shell — the phone-book block, for one — reach
  // the modal state through this, so a contact card there can still open a task
  // or a meeting it links to.
  useEffect(() => registerModalRequest(openModalInForeground), [windowMode]);

  // Ctrl+K (or Cmd+K) opens the command palette from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const searchAll = useCallback(
    (query: string) => repository.searchAll ? repository.searchAll(query) : Promise.resolve([]),
    [repository]
  );

  const paletteActions = useMemo<PaletteAction[]>(() => [
    { id: 'new-event', label: t('commandPalette.newEvent'), icon: 'event',
      run: () => openModalInForeground({ type: 'event-create', dateIso: todayIso, trigger: null }) },
    { id: 'new-task', label: t('commandPalette.newTask'), icon: 'task',
      run: () => openModalInForeground({ type: 'task-create', dueDate: todayIso, trigger: null }) },
    { id: 'new-note', label: t('commandPalette.newNote'), icon: 'note',
      run: () => openModalInForeground({ type: 'note-create', trigger: null }) },
    { id: 'open-notes', label: t('commandPalette.openNotes'), icon: 'notes',
      run: () => openModalInForeground({ type: 'notes-manager', trigger: null }) },
    { id: 'open-settings', label: t('commandPalette.openSettings'), icon: 'settings',
      run: () => openModalInForeground({ type: 'settings', trigger: null }) }
    // `openModalInForeground` reads the current window mode, so the list is
    // rebuilt whenever the day or the mode changes.
  ], [todayIso, windowMode]);

  const openSearchHit = useCallback((hit: SearchHit) => {
    if (hit.kind === 'contact') {
      openModalInForeground({ type: 'contact-card', contactId: hit.id, trigger: null });
      return;
    }
    if (hit.kind === 'task') {
      const task = taskWorkspace.data.tasks.find((item) => item.id === hit.id);
      if (task) openModalInForeground({ type: 'workspace-task-edit', task, trigger: null });
      return;
    }
    if (hit.kind === 'note') {
      const note = notes.find((item) => item.id === hit.id);
      if (note) openModalInForeground({ type: 'note-edit', note, trigger: null });
      return;
    }
    const event = events.find((item) => item.id === hit.id);
    if (event) {
      openModalInForeground(event.subscriptionId && !isEventWritable(event)
        ? { type: 'external-detail', event, trigger: null }
        : { type: 'event-edit', event, trigger: null });
    } else if (hit.date) {
      openModalInForeground({ type: 'date', isoDate: hit.date.slice(0, 10), trigger: null });
    }
  }, [events, notes, taskWorkspace.data.tasks, windowMode]);

  function openTimeDialog(createAlarm = false) {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void runWindowModeSwitch(async () => {
      if (windowMode === 'wallpaper') await switchToForeground().catch(() => undefined);
      setTimeDialog({ createAlarm, trigger });
    });
  }


  const onboardingSteps: GuideStep[] = [
    { title: t('onboarding.welcome.title'), body: t('onboarding.welcome.body') },
    { target: 'workspace', title: t('onboarding.workspace.title'), body: t('onboarding.workspace.body') },
    { target: 'edit-layout', title: t('onboarding.editLayout.title'), body: t('onboarding.editLayout.body') },
    { target: 'settings', title: t('onboarding.settings.title'), body: t('onboarding.settings.body') },
    { target: 'wallpaper', title: t('onboarding.wallpaper.title'), body: t('onboarding.wallpaper.body') },
    { title: t('onboarding.done.title'), body: t('onboarding.done.body') }
  ];

  const clockText = new Intl.DateTimeFormat(localeTag(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);
  const dateText = formatDisplayDate(now, 'full');
  return (
    <IconStyleProvider style={settingsFeature.settings.data.iconStyle}>
      {mobileShell ? (
        <MobileShell
          modules={modules}
          time={clockText}
          dateText={dateText}
          onOpenSettings={() => setModal({ type: 'settings', trigger: null })}
          onOpenSearch={() => setPaletteOpen(true)}
          onQuickAction={(action) => {
            if (action === 'new-event') {
              openModalInForeground({ type: 'event-create', dateIso: todayIso, trigger: null });
            } else if (action === 'new-task') {
              openModalInForeground({ type: 'task-create', dueDate: todayIso, trigger: null });
            } else {
              openModalInForeground({ type: 'note-create', trigger: null });
            }
          }}
        />
      ) : (
      <DesktopShell
        mode={windowMode}
        time={clockText}
        dateText={dateText}
        summary={summary}
        modules={modules}
        definitions={definitions}
        isModeSwitching={isSwitchingWindowMode}
        onSetWallpaper={() => void runWindowModeSwitch(switchToWallpaper)}
        onWallpaperDoubleClick={() => void runWindowModeSwitch(switchToForeground)}
        onOpenSettings={() => setModal({type:'settings',trigger:null})}
        onOpenSearch={() => setPaletteOpen(true)}
        hideTopbarInWallpaper={settingsFeature.settings.data.hideTopbarInWallpaper}
        hideModuleBackgroundInWallpaper={settingsFeature.settings.data.hideModuleBackgroundInWallpaper}
        multiMonitorWallpaper={multiMonitorWallpaper}
        monitors={settingsFeature.monitors.data}
        monitorKey={layoutMonitorKey}
        layoutTargetLabel={layoutTargetLabel}
        overlay={windowMode === 'wallpaper' ? <FocusWallpaperOverlay /> : null}
        update={update}
      />
      )}
      {timeDialog ? <TimeSettingsDialog createAlarm={timeDialog.createAlarm} trigger={timeDialog.trigger} onClose={() => setTimeDialog(null)} /> : null}
      {focusStatisticsOpen ? <FocusStatisticsDialog onClose={() => setFocusStatisticsOpen(false)} /> : null}
      <CommandPalette
        open={paletteOpen}
        actions={paletteActions}
        search={searchAll}
        onOpenHit={openSearchHit}
        onClose={() => setPaletteOpen(false)}
      />
      <OnboardingGuide
        open={!mobileShell && onboarding.shouldShow && windowMode === 'foreground'}
        steps={onboardingSteps}
        onClose={onboarding.dismiss}
      />
      <ModalRoot
        modal={modal}
        events={calendarEvents}
        onClose={() => setModal(null)}
        onChangeModal={setModal}
        createEvent={eventsFeature.createEvent}
        updateEvent={eventsFeature.updateEvent}
        deleteEvent={eventsFeature.deleteEvent}
        onSaved={() => undefined}
        onDeleted={() => undefined}
        notes={notes}
        createNote={notesFeature.createNote}
        updateNote={notesFeature.updateNote}
        deleteNote={notesFeature.deleteNote}
        settings={settingsFeature.settings.data}
        monitors={settingsFeature.monitors.data}
        saveSettings={settingsFeature.saveSettings}
        subscriptions={subscriptions}
        onSubscriptionsChanged={onSubscriptionsChanged}
        createSubscription={repository.createCalendarSubscription}
        updateSubscription={repository.updateCalendarSubscription}
        deleteSubscription={repository.deleteCalendarSubscription}
        refreshSubscription={repository.refreshCalendarSubscription}
        categories={categoriesFeature.categories}
        createCategory={categoriesFeature.createCategory}
        updateCategory={categoriesFeature.updateCategory}
        deleteCategory={categoriesFeature.deleteCategory}
        recentColors={recentColors}
        onRememberCustomColor={rememberCustomColor}
      />
    </IconStyleProvider>
  );
}

export function App() {
  return (
    <TaskWorkspaceProvider>
      <TaskDragProvider>
        <AppContent />
      </TaskDragProvider>
    </TaskWorkspaceProvider>
  );
}
