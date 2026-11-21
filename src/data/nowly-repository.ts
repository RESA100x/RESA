import type {
  CalendarEvent,
  Category,
  CategoryDraft,
  EditScope,
  EventDraft,
  EventRange,
  EventTarget,
  Recurrence
} from '../calendar/calendar-model';
import type { AxelorModel, CalendarSubscription, ExternalEvent, OAuthAccount, RemoteCalendar, SubscriptionDraft } from '../calendar/subscription-model';
import type {
  KanbanCard,
  KanbanCardDraft,
  KanbanLane,
  KanbanLaneDraft,
  KanbanPriority,
  KanbanPriorityDraft,
  KanbanSnapshot,
  KanbanTag,
  KanbanTagDraft
} from '../kanban/kanban-model';
import type { MatrixTask, TaskDraft } from '../matrix/matrix-model';
import type { Attachment } from '../lib/attachment';
import type { Note, NoteDraft } from '../notes/notes-model';
import type { Plant, PlantDraft } from '../plants/plant-model';
import type { Meeting, MeetingDraft, MeetingExportSummary } from '../meetings/meeting-model';
import type {
  Contact,
  ContactCategory,
  ContactCategoryDraft,
  ContactDraft,
  ContactsExportSummary,
  ContactsImportSummary
} from '../phonebook/contact-model';
import type {
  Task as WorkspaceTask,
  TaskDraft as WorkspaceTaskDraft,
  TaskEvent,
  TaskLane,
  TaskLaneDraft,
  TaskStatus,
  TaskTag,
  TaskTagDraft,
  TaskViewPreferences,
  TaskWorkspaceSnapshot
} from '../tasks/task-model';
import type { Project, ProjectDraft } from '../projects/project-model';
import type { HexColor } from '../lib/color';
import type { IconStyle } from '../components/icon-style';
import type { BarMenuItem } from '../app/bar-menu';
import type { SoundSettings } from '../settings/sound-settings';
import type { StickerAsset, StickerBoard } from '../stickers/sticker-model';
import type { WorldClock, TimeSettings, Alarm, AlarmDraft } from '../time/time-model';
import type { SearchHit } from '../lib/search';
import type { ReportExportSummary, TaskReport } from '../reports/report-model';
import type { BackupSummary } from '../lib/backup';
export type { WorldClock, TimeSettings, Alarm, AlarmDraft };

export type AppSettings = {
  wallpaperEnabled: boolean;
  launchAtLogin: boolean;
  targetMonitorId: string | null;
  density: 'compact' | 'balanced' | 'comfortable';
  weekStart: 'monday' | 'sunday' | 'saturday';
  dateFormat: 'localized' | 'iso';
  showWeekends: boolean;
  // Icon drawing style shared by every icon in the app.
  iconStyle: IconStyle;
  // Hide the topbar while running as the desktop wallpaper. Defaults on, so the
  // wallpaper reads as a clean dashboard; the topbar returns the moment the app
  // is brought back to the foreground.
  hideTopbarInWallpaper: boolean;
  hideModuleBackgroundInWallpaper?: boolean;
  notificationMode?: 'persistent' | 'notification';
  soundSettings?: SoundSettings;
  quickPanelEnabled?: boolean;
  quickPanelShortcut?: string;
  screenshotShortcut?: string;
  screenshotHistoryShortcut?: string;
  // Quick-create shortcuts are unset by default; an empty string means not set.
  quickCreateEventShortcut?: string;
  quickCreateTaskShortcut?: string;
  quickCreateNoteShortcut?: string;
  // Hidden features retain their position in the ordered menu.
  barMenu?: BarMenuItem[];
  recentColors?: HexColor[];
};

export type ModuleLayoutEntry = { id: string; x: number; y: number; w: number; h: number };

export type FocusSession = {
  id: string;
  plannedSeconds: number;
  focusedSeconds: number;
  status: 'completed' | 'interrupted';
  startedAt: string;
  endedAt: string;
  createdAt: string;
};

export type FocusRange = { startAt: string; endAtExclusive: string };
export type FocusPeriodBoundary = FocusRange & { period: string };
export type FocusStatisticsPoint = {
  period: string;
  focusedSeconds: number;
  completedCount: number;
  interruptedCount: number;
};
export type FocusStatistics = {
  totalFocusedSeconds: number;
  completedCount: number;
  interruptedCount: number;
  completionRate: number;
  points: FocusStatisticsPoint[];
};

export type MonitorInfo = { id:string; name:string; isPrimary:boolean; positionX:number; positionY:number; width:number; height:number; scaleFactor:number };

// The result of a software update check against the public GitHub releases.
// `latestVersion`, `releaseNotes`, and `publishedAt` are absent when GitHub
// could not be reached; the dialog then just shows the current version.
export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseNotes: string | null;
  releaseUrl: string;
  publishedAt: string | null;
};

export type RepositoryError = {
  code: 'validation_error' | 'not_found' | 'conflict' | 'database_error' | 'system_error';
  message: string;
  field?: string;
};

export type NowlyRepository = {
  getStickerBoard?(): Promise<StickerBoard>;
  saveStickerBoard?(board: StickerBoard): Promise<StickerBoard>;
  uploadStickerImage?(fileName: string, bytes: Uint8Array): Promise<StickerAsset>;
  readStickerImage?(id: string): Promise<Uint8Array>;
  discardStickerImages?(ids: string[]): Promise<void>;
  // 浇水提醒模块：植物本体 + 「上次浇水时间」。状态由时间实时推导，不存历史流水。
  listPlants?(): Promise<Plant[]>;
  createPlant?(draft: PlantDraft): Promise<Plant>;
  updatePlant?(id: string, draft: PlantDraft): Promise<Plant>;
  deletePlant?(id: string): Promise<void>;
  waterPlant?(id: string, wateredAt: string): Promise<Plant>;
  // 会议协调：会议 + 参会人（通讯录联系人）+ 议程 / 跟进事项。
  listMeetings?(): Promise<Meeting[]>;
  saveMeeting?(id: string | null, draft: MeetingDraft): Promise<Meeting>;
  deleteMeeting?(id: string): Promise<void>;
  exportMeeting?(id: string, path: string): Promise<MeetingExportSummary>;
  // 电话簿模块：姓名 + 电话 + 分组 + 备注。搜索在界面层完成（联系人数量有上限，
  // 过滤是同步的），这里只负责存取。
  listContacts?(): Promise<Contact[]>;
  createContact?(draft: ContactDraft): Promise<Contact>;
  updateContact?(id: string, draft: ContactDraft): Promise<Contact>;
  deleteContact?(id: string): Promise<void>;
  // The whole directory as one Excel-friendly CSV; the same file imports back.
  exportContacts?(path: string): Promise<ContactsExportSummary>;
  importContacts?(path: string, commit: boolean): Promise<ContactsImportSummary>;
  // 电话簿分组：名称 + 颜色。颜色属于分组本身，联系人只存 categoryId。
  listContactCategories?(): Promise<ContactCategory[]>;
  createContactCategory?(draft: ContactCategoryDraft): Promise<ContactCategory>;
  updateContactCategory?(id: string, draft: ContactCategoryDraft): Promise<ContactCategory>;
  deleteContactCategory?(id: string): Promise<void>;
  getTimeSettings(): Promise<TimeSettings>;
  saveTimeSettings(settings: TimeSettings): Promise<TimeSettings>;
  listAlarms(): Promise<Alarm[]>;
  createAlarm(draft: AlarmDraft): Promise<Alarm>;
  updateAlarm(id: string, draft: AlarmDraft): Promise<Alarm>;
  deleteAlarm(id: string): Promise<void>;
  listEventsInRange(range: EventRange): Promise<CalendarEvent[]>;
  createEvent(draft: EventDraft): Promise<CalendarEvent>;
  updateEvent(target: EventTarget, draft: EventDraft, scope: EditScope): Promise<void>;
  deleteEvent(target: EventTarget, scope: EditScope): Promise<void>;
  // 日历分类（用户自定义，名称 + 颜色）。事件与订阅共用同一份分类。
  listCategories(): Promise<Category[]>;
  createCategory(draft: CategoryDraft): Promise<Category>;
  updateCategory(id: string, draft: CategoryDraft): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
  listCalendarSubscriptions: () => Promise<CalendarSubscription[]>;
  createCalendarSubscription: (draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  updateCalendarSubscription: (id: string, draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  deleteCalendarSubscription: (id: string) => Promise<void>;
  refreshCalendarSubscription: (id: string) => Promise<void>;
  // OAuth 日历（Google / Outlook·Teams）。
  startOAuthLogin: (provider: 'google' | 'microsoft') => Promise<OAuthAccount>;
  listOAuthAccounts: () => Promise<OAuthAccount[]>;
  disconnectOAuthAccount: (id: string) => Promise<void>;
  listRemoteCalendars: (accountId: string) => Promise<RemoteCalendar[]>;
  subscribeRemoteCalendar: (
    accountId: string,
    remoteCalendarId: string,
    name: string,
    color: string,
    refreshIntervalMinutes: number
  ) => Promise<CalendarSubscription>;
  // Axelor 自建实例（REST + API key）。模型清单用于让用户挑选要同步的模型。
  listAxelorModels: (baseUrl: string, apiKey: string) => Promise<AxelorModel[]>;
  createAxelorSubscription: (
    baseUrl: string,
    apiKey: string,
    model: string,
    name: string,
    color: string,
    refreshIntervalMinutes: number,
    categoryId: string | null
  ) => Promise<CalendarSubscription>;
  updateSubscriptionDisplay: (
    id: string,
    name: string,
    color: string,
    refreshIntervalMinutes: number,
    categoryId: string | null
  ) => Promise<CalendarSubscription>;
  listExternalEventsInRange: (range: EventRange) => Promise<ExternalEvent[]>;
  createRemoteEvent?(subscriptionId: string, draft: EventDraft): Promise<void>;
  updateRemoteEvent?(
    subscriptionId: string,
    remoteEventId: string,
    draft: EventDraft,
    descriptionChanged: boolean
  ): Promise<void>;
  deleteRemoteEvent?(subscriptionId: string, remoteEventId: string): Promise<void>;
  listTasks(): Promise<MatrixTask[]>;
  createTask(draft: TaskDraft): Promise<MatrixTask>;
  updateTask(id: string, draft: TaskDraft): Promise<MatrixTask>;
  deleteTask(id: string): Promise<void>;
  setTaskCompleted(id: string, completed: boolean): Promise<MatrixTask>;
  // Unified task workspace. Optional during the frontend migration so focused
  // feature-test repositories that still exercise the legacy adapters remain
  // lightweight; the desktop repository implements the complete contract.
  getTaskWorkspaceSnapshot?(): Promise<TaskWorkspaceSnapshot>;
  createWorkspaceTask?(draft: WorkspaceTaskDraft): Promise<WorkspaceTask>;
  updateWorkspaceTask?(id: string, draft: WorkspaceTaskDraft): Promise<WorkspaceTask>;
  deleteWorkspaceTask?(id: string): Promise<void>;
  setWorkspaceTaskCompleted?(id: string, completed: boolean): Promise<WorkspaceTask>;
  // Sets or clears the recurrence rule of a task (habits / repeating tasks).
  setTaskRecurrence?(id: string, recurrence: Recurrence | null): Promise<WorkspaceTask>;
  // Lifecycle state and project membership. Kept as their own commands so the
  // board can change them without opening the full task form.
  setTaskStatus?(id: string, status: TaskStatus): Promise<WorkspaceTask>;
  setTaskProject?(id: string, projectId: string | null): Promise<WorkspaceTask>;
  setTaskAssignee?(id: string, contactId: string | null): Promise<WorkspaceTask>;
  // The action history of one task, oldest first.
  listTaskEvents?(taskId: string): Promise<TaskEvent[]>;
  // Everything that left the board: done, suspended, cancelled and deleted.
  listTaskArchive?(): Promise<WorkspaceTask[]>;
  // The one-line note explaining why a task left the board.
  setTaskArchiveReason?(id: string, reason: string | null): Promise<WorkspaceTask>;
  // Permanently drops archived rows and returns how many were removed.
  purgeTasks?(ids: string[]): Promise<number>;
  // Writes the archive to `path`; `ids` narrows it to the rows on screen.
  exportTaskArchive?(path: string, ids?: string[]): Promise<{ path: string; tasks: number }>;
  listProjects?(): Promise<Project[]>;
  createProject?(draft: ProjectDraft): Promise<Project>;
  updateProject?(id: string, draft: ProjectDraft): Promise<Project>;
  archiveProject?(id: string): Promise<void>;
  // Aggregated task statistics for the reports module (created / completed /
  // open over the last `days` days, plus the current backlog snapshot).
  getTaskReport?(days: number): Promise<TaskReport>;
  // Writes the report to `path`; the extension picks CSV or Markdown.
  exportTaskReport?(path: string, days: number): Promise<ReportExportSummary>;
  // Global search for the command palette: events, tasks and notes.
  searchAll?(query: string, limit?: number): Promise<SearchHit[]>;
  // One-click backup and transfer; both write/read a single `.resa` file.
  exportBackup?(path: string): Promise<BackupSummary>;
  importBackup?(path: string): Promise<BackupSummary>;
  /** Path of the folder holding the automatic daily snapshots. */
  backupsFolder?(): Promise<string>;
  /** Opens that folder in the system file manager and returns its path. */
  openBackupsFolder?(): Promise<string>;
  moveTaskToLane?(id: string, laneId: string, targetIndex: number): Promise<WorkspaceTask>;
  moveTaskToPriority?(id: string, priority: WorkspaceTask['priority']): Promise<WorkspaceTask>;
  moveTaskToDate?(id: string, dueDate: string | null): Promise<WorkspaceTask>;
  createTaskLane?(draft: TaskLaneDraft): Promise<TaskLane>;
  updateTaskLane?(id: string, draft: TaskLaneDraft): Promise<TaskLane>;
  // The lane's tasks stay in the matrix with no lane.
  deleteTaskLane?(id: string): Promise<TaskWorkspaceSnapshot>;
  reorderTaskLanes?(orderedIds: string[]): Promise<TaskLane[]>;
  setDefaultTaskLane?(id: string): Promise<TaskWorkspaceSnapshot>;
  createTaskTag?(draft: TaskTagDraft): Promise<TaskTag>;
  updateTaskTag?(id: string, draft: TaskTagDraft): Promise<TaskTag>;
  archiveTaskTag?(id: string, archived: boolean): Promise<TaskTag>;
  deleteTaskTag?(id: string): Promise<void>;
  setTaskViewPreferences?(preferences: TaskViewPreferences): Promise<TaskWorkspaceSnapshot>;
  listNotes(): Promise<Note[]>;
  createNote(draft: NoteDraft): Promise<Note>;
  updateNote(id: string, draft: NoteDraft): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  // Rich text attachments. Optional so lightweight test doubles need not
  // implement them; the editor degrades to text-only when they are absent.
  //
  // Files are written to `<app-data>/attachments/` and referenced from stored
  // Markdown as `attachment:<id>`. There is no delete method on purpose:
  // removing an image from the text is just a text edit, and the backend
  // reclaims unreferenced files at startup, so cancelling a dialog can never
  // orphan a file that the content still points at.
  saveAttachment?(fileName: string, bytes: Uint8Array): Promise<Attachment>;
  readAttachment?(id: string): Promise<Uint8Array>;
  listAttachments?(ids: string[]): Promise<Attachment[]>;
  /**
   * Hand one attachment to the OS to open in its default application.
   *
   * The desktop backend opens the stored file in place, so an edit saved from
   * that application stays with the note. Rejects for a file type the OS would
   * execute rather than open.
   */
  openAttachment?(id: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  // Check GitHub for a newer release. Optional so lightweight test doubles and
  // the browser dev shim need not implement it.
  checkForUpdate?(): Promise<UpdateInfo>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  listMonitors(): Promise<MonitorInfo[]>;
  listModuleLayout(): Promise<ModuleLayoutEntry[]>;
  saveModuleLayout(layout: ModuleLayoutEntry[]): Promise<ModuleLayoutEntry[]>;
  createFocusSession(session: FocusSession): Promise<FocusSession>;
  listFocusSessions(range: FocusRange): Promise<FocusSession[]>;
  getFocusStatistics(boundaries: FocusPeriodBoundary[]): Promise<FocusStatistics>;
  getKanbanSnapshot(): Promise<KanbanSnapshot>;
  createKanbanLane(draft: KanbanLaneDraft): Promise<KanbanLane>;
  updateKanbanLane(id: string, draft: KanbanLaneDraft): Promise<KanbanLane>;
  deleteKanbanLane(id: string): Promise<void>;
  reorderKanbanLanes(orderedIds: string[]): Promise<KanbanLane[]>;
  createKanbanCard(draft: KanbanCardDraft): Promise<KanbanCard>;
  updateKanbanCard(id: string, draft: KanbanCardDraft): Promise<KanbanCard>;
  deleteKanbanCard(id: string): Promise<void>;
  moveKanbanCard(id: string, targetLaneId: string, targetIndex: number): Promise<void>;
  createKanbanPriority(draft: KanbanPriorityDraft): Promise<KanbanPriority>;
  updateKanbanPriority(id: string, draft: KanbanPriorityDraft): Promise<KanbanPriority>;
  deleteKanbanPriority(id: string): Promise<void>;
  reorderKanbanPriorities(orderedIds: string[]): Promise<KanbanPriority[]>;
  createKanbanTag(draft: KanbanTagDraft): Promise<KanbanTag>;
  updateKanbanTag(id: string, draft: KanbanTagDraft): Promise<KanbanTag>;
  deleteKanbanTag(id: string): Promise<void>;
};
