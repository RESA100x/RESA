import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import type { NowlyRepository } from './nowly-repository';
import { localizeRepositoryError } from '../i18n/localize-error';
import { withContactDefaults, type Contact } from '../phonebook/contact-model';

async function invoke<T>(...args: Parameters<typeof tauriInvoke>): Promise<T> {
  try {
    return await tauriInvoke<T>(...args);
  } catch (error) {
    throw localizeRepositoryError(error);
  }
}

function invalidating<T>(operation: Promise<T>): Promise<T> {
  return operation.then(result => {
    void emit('status-island-invalidated').catch(() => undefined);
    return result;
  });
}

// A contact row that predates the current schema (or arrives from a hand-edited
// backup) can be missing fields the directory reads, and one short row would
// otherwise take the whole module down. Fill the gaps at the boundary, so the
// module only ever sees a whole contact.
function contactRow(row: Contact): Contact {
  return withContactDefaults(row);
}

export const tauriNowlyRepository: NowlyRepository = {
  getTimeSettings: () => invoke('get_time_settings'),
  saveTimeSettings: (settings) => invoke('save_time_settings', { settings }),
  listAlarms: () => invoke('list_alarms'),
  createAlarm: (draft) => invalidating(invoke('create_alarm', { draft })),
  updateAlarm: (id, draft) => invalidating(invoke('update_alarm', { id, draft })),
  deleteAlarm: (id) => invalidating(invoke('delete_alarm', { id })),
  listEventsInRange: (range) => invoke('list_events_in_range', { range }),
  createEvent: (draft) => invalidating(invoke('create_event', { draft })),
  updateEvent: (target, draft, scope) => invalidating(invoke('update_event', { target, draft, scope })),
  deleteEvent: (target, scope) => invalidating(invoke('delete_event', { target, scope })),
  listCategories: () => invoke('list_categories'),
  createCategory: (draft) => invalidating(invoke('create_category', { draft })),
  updateCategory: (id, draft) => invalidating(invoke('update_category', { id, draft })),
  deleteCategory: (id) => invalidating(invoke('delete_category', { id })),
  listCalendarSubscriptions: () => invoke('list_calendar_subscriptions'),
  createCalendarSubscription: (draft) => invalidating(invoke('create_calendar_subscription', { draft })),
  updateCalendarSubscription: (id, draft) => invalidating(invoke('update_calendar_subscription', { id, draft })),
  deleteCalendarSubscription: (id) => invalidating(invoke('delete_calendar_subscription', { id })),
  refreshCalendarSubscription: (id) => invalidating(invoke('refresh_calendar_subscription', { id })),
  startOAuthLogin: (provider) => invoke('start_oauth_login', { provider }),
  listOAuthAccounts: () => invoke('list_oauth_accounts'),
  disconnectOAuthAccount: (id) => invoke('disconnect_oauth_account', { id }),
  listRemoteCalendars: (accountId) => invoke('list_remote_calendars', { accountId }),
  subscribeRemoteCalendar: (accountId, remoteCalendarId, name, color, refreshIntervalMinutes) =>
    invoke('subscribe_remote_calendar', {
      accountId,
      remoteCalendarId,
      name,
      color,
      refreshIntervalMinutes
    }),
  updateSubscriptionDisplay: (id, name, color, refreshIntervalMinutes, categoryId) =>
    invoke('update_subscription_display', { id, name, color, refreshIntervalMinutes, categoryId }),
  listAxelorModels: (baseUrl, apiKey) => invoke('list_axelor_models', { baseUrl, apiKey }),
  createAxelorSubscription: (baseUrl, apiKey, model, name, color, refreshIntervalMinutes, categoryId) =>
    invalidating(
      invoke('create_axelor_subscription', {
        baseUrl,
        apiKey,
        model,
        name,
        color,
        refreshIntervalMinutes,
        categoryId
      })
    ),
  listExternalEventsInRange: (range) => invoke('list_external_events_in_range', { range }),
  createRemoteEvent: (subscriptionId, draft) => invalidating(invoke('create_remote_event', { subscriptionId, draft })),
  updateRemoteEvent: (subscriptionId, remoteEventId, draft, descriptionChanged) =>
    invalidating(invoke('update_remote_event', { subscriptionId, remoteEventId, draft, descriptionChanged })),
  deleteRemoteEvent: (subscriptionId, remoteEventId) =>
    invalidating(invoke('delete_remote_event', { subscriptionId, remoteEventId })),
  listTasks: () => invoke('list_tasks'),
  createTask: (draft) => invalidating(invoke('create_task', { draft })),
  updateTask: (id, draft) => invalidating(invoke('update_task', { id, draft })),
  deleteTask: (id) => invalidating(invoke('delete_task', { id })),
  setTaskCompleted: (id, completed) => invalidating(invoke('set_task_completed', { id, completed })),
  getTaskWorkspaceSnapshot: () => invoke('get_task_workspace_snapshot'),
  createWorkspaceTask: (draft) => invalidating(invoke('create_task', { draft })),
  updateWorkspaceTask: (id, draft) => invalidating(invoke('update_task', { id, draft })),
  deleteWorkspaceTask: (id) => invalidating(invoke('delete_task', { id })),
  setWorkspaceTaskCompleted: (id, completed) => invalidating(invoke('set_task_completed', { id, completed })),
  setTaskRecurrence: (id, recurrence) => invalidating(invoke('set_task_recurrence', { id, recurrence })),
  setTaskStatus: (id, status) => invalidating(invoke('set_task_status', { id, status })),
  setTaskProject: (id, projectId) => invalidating(invoke('set_task_project', { id, projectId })),
  setTaskAssignee: (id, contactId) => invalidating(invoke('set_task_assignee', { id, contactId })),
  listTaskEvents: (taskId) => invoke('list_task_events', { taskId }),
  listTaskArchive: () => invoke('list_task_archive'),
  setTaskArchiveReason: (id, reason) => invalidating(invoke('set_task_archive_reason', { id, reason })),
  purgeTasks: (ids) => invalidating(invoke('purge_tasks', { ids })),
  exportTaskArchive: (path, ids) => invoke('export_task_archive', { path, ids: ids ?? null }),
  listProjects: () => invoke('list_projects'),
  createProject: (draft) => invalidating(invoke('create_project', { draft })),
  updateProject: (id, draft) => invalidating(invoke('update_project', { id, draft })),
  archiveProject: (id) => invalidating(invoke('archive_project', { id })),
  restoreProject: (id) => invalidating(invoke('restore_project', { id })),
  getTaskReport: (days) => invoke('get_task_report', { days }),
  exportTaskReport: (path, days) => invoke('export_task_report', { path, days }),
  listPlants: () => invoke('list_plants'),
  createPlant: (draft) => invalidating(invoke('create_plant', { draft })),
  updatePlant: (id, draft) => invalidating(invoke('update_plant', { id, draft })),
  deletePlant: (id) => invalidating(invoke('delete_plant', { id })),
  waterPlant: (id, wateredAt) => invalidating(invoke('water_plant', { id, wateredAt })),
  listBooks: () => invoke('list_books'),
  createBook: (draft) => invalidating(invoke('create_book', { draft })),
  updateBook: (id, draft) => invalidating(invoke('update_book', { id, draft })),
  deleteBook: (id) => invalidating(invoke('delete_book', { id })),
  readBookCover: (id) => invoke('read_book_cover', { id }),
  listMeetings: () => invoke('list_meetings'),
  saveMeeting: (id, draft) => invalidating(invoke('save_meeting', { id, draft })),
  deleteMeeting: (id) => invalidating(invoke('delete_meeting', { id })),
  exportMeeting: (id, path) => invoke('export_meeting', { id, path }),
  listContacts: () => invoke<Contact[]>('list_contacts').then((rows) => rows.map(contactRow)),
  createContact: (draft) => invalidating(invoke<Contact>('create_contact', { draft }).then(contactRow)),
  updateContact: (id, draft) => invalidating(invoke<Contact>('update_contact', { id, draft }).then(contactRow)),
  deleteContact: (id) => invalidating(invoke('delete_contact', { id })),
  exportContacts: (path) => invoke('export_contacts', { path }),
  importContacts: (path, commit) => invalidating(invoke('import_contacts', { path, commit })),
  exportContactsVcard: (path) => invoke('export_contacts_vcard', { path }),
  importContactsVcard: (path, commit) => invalidating(invoke('import_contacts_vcard', { path, commit })),
  listContactCategories: () => invoke('list_contact_categories'),
  createContactCategory: (draft) => invalidating(invoke('create_contact_category', { draft })),
  updateContactCategory: (id, draft) => invalidating(invoke('update_contact_category', { id, draft })),
  deleteContactCategory: (id) => invalidating(invoke('delete_contact_category', { id })),
  searchAll: (query, limit) => invoke('search_all', { query, limit }),
  exportBackup: (path) => invoke('export_backup', { path }),
  importBackup: (path) => invoke('import_backup', { path }),
  quickExportBackup: () => invoke('quick_export_backup'),
  readBackupManifest: (path) => invoke('read_backup_manifest', { path }),
  backupsFolder: () => invoke('backups_folder'),
  openBackupsFolder: () => invoke('open_backups_folder'),
  moveTaskToLane: (id, laneId, targetIndex) => invalidating(invoke('move_task_to_lane', { id, laneId, targetIndex })),
  moveTaskToPriority: (id, priority) => invalidating(invoke('move_task_to_priority', { id, priority })),
  moveTaskToDate: (id, dueDate) => invalidating(invoke('move_task_to_date', { id, dueDate })),
  createTaskLane: (draft) => invoke('create_task_lane', { draft }),
  updateTaskLane: (id, draft) => invoke('update_task_lane', { id, draft }),
  deleteTaskLane: (id) => invoke('delete_task_lane', { id }),
  reorderTaskLanes: (orderedIds) => invoke('reorder_task_lanes', { orderedIds }),
  setDefaultTaskLane: (id) => invoke('set_default_task_lane', { id }),
  createTaskTag: (draft) => invoke('create_task_tag', { draft }),
  updateTaskTag: (id, draft) => invoke('update_task_tag', { id, draft }),
  archiveTaskTag: (id, archived) => invoke('archive_task_tag', { id, archived }),
  deleteTaskTag: (id) => invoke('delete_task_tag', { id }),
  setTaskViewPreferences: (preferences) => invoke('set_task_view_preferences', { preferences }),
  listNotes: () => invoke('list_notes'),
  getStickerBoard: () => invoke('get_sticker_board'),
  saveStickerBoard: (board) => invoke('save_sticker_board', { board }),
  uploadStickerImage: (fileName, bytes) => invoke('upload_sticker_image', { fileName, bytes: Array.from(bytes) }),
  readStickerImage: (id) => invoke<number[]>('read_sticker_image', { id }).then(bytes => new Uint8Array(bytes)),
  discardStickerImages: (ids) => invoke('discard_sticker_images', { ids }),
  createNote: (draft) => invoke('create_note', { draft }),
  updateNote: (id, draft) => invoke('update_note', { id, draft }),
  deleteNote: (id) => invoke('delete_note', { id }),
  // `bytes` must be a plain number array: a Uint8Array nested inside an invoke
  // payload is JSON-serialised as `{"0":1,...}`, which serde cannot read back
  // into a `Vec<u8>`. The reply is likewise a number array.
  saveAttachment: (fileName, bytes) =>
    invoke('save_attachment', { fileName, bytes: Array.from(bytes) }),
  readAttachment: (id) =>
    invoke<number[]>('read_attachment', { id }).then((bytes) => new Uint8Array(bytes)),
  listAttachments: (ids) => invoke('list_attachments', { ids }),
  openAttachment: (id) => invoke('open_attachment', { id }),
  getSettings: () => invoke('get_app_settings'),
  checkForUpdate: () => invoke('check_for_update'),
  installUpdate: () => invoke('install_update'),
  updateSettings: (settings) => invoke('update_app_settings', { settings }),
  listMonitors: () => invoke('list_monitors'),
  listMonitorWallpaperAreas: () => invoke('list_monitor_wallpaper_areas'),
  // Without a monitor the original command payload is sent unchanged, so the
  // single-layout path stays byte-for-byte the same as before.
  listModuleLayout: (monitor) =>
    monitor ? invoke('list_module_layout', { monitor }) : invoke('list_module_layout'),
  saveModuleLayout: (layout, monitor) =>
    monitor
      ? invoke('save_module_layout', { layout, monitor })
      : invoke('save_module_layout', { layout }),
  createFocusSession: (session) => invoke('create_focus_session', { session }),
  listFocusSessions: (range) => invoke('list_focus_sessions', { range }),
  getFocusStatistics: (boundaries) => invoke('get_focus_statistics', { boundaries }),
  getKanbanSnapshot: () => invoke('get_kanban_snapshot'),
  createKanbanLane: (draft) => invoke('create_kanban_lane', { draft }),
  updateKanbanLane: (id, draft) => invoke('update_kanban_lane', { id, draft }),
  deleteKanbanLane: (id) => invoke('delete_kanban_lane', { id }),
  reorderKanbanLanes: (orderedIds) => invoke('reorder_kanban_lanes', { orderedIds }),
  createKanbanCard: (draft) => invoke('create_kanban_card', { draft }),
  updateKanbanCard: (id, draft) => invoke('update_kanban_card', { id, draft }),
  deleteKanbanCard: (id) => invoke('delete_kanban_card', { id }),
  moveKanbanCard: (id, targetLaneId, targetIndex) =>
    invoke('move_kanban_card', { id, targetLaneId, targetIndex }),
  createKanbanPriority: (draft) => invoke('create_kanban_priority', { draft }),
  updateKanbanPriority: (id, draft) => invoke('update_kanban_priority', { id, draft }),
  deleteKanbanPriority: (id) => invoke('delete_kanban_priority', { id }),
  reorderKanbanPriorities: (orderedIds) => invoke('reorder_kanban_priorities', { orderedIds }),
  createKanbanTag: (draft) => invoke('create_kanban_tag', { draft }),
  updateKanbanTag: (id, draft) => invoke('update_kanban_tag', { id, draft }),
  deleteKanbanTag: (id) => invoke('delete_kanban_tag', { id })
};
