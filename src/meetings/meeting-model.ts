// Meeting coordination, kept symmetrical with `src-tauri/src/meetings.rs`.
//
// A meeting is one record plus two child lists: who is coming (a phone-book
// contact, with attendance and lateness once it is over) and the agenda /
// follow-up items. An item that became a task keeps the task id, so the task,
// the meeting and the person all stay one chain.

import { formatIsoDisplay } from '../lib/calendar-system';
import { t } from '../i18n';
import type { HexColor } from '../lib/color';
import { DESIGN_COLORS } from '../lib/color';

export const MEETING_STATUSES = ['planned', 'held', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const ATTENDANCE_STATES = ['unknown', 'present', 'late', 'absent', 'excused'] as const;
export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

export const MEETING_ITEM_KINDS = ['agenda', 'followup'] as const;
export type MeetingItemKind = (typeof MEETING_ITEM_KINDS)[number];

export type MeetingAttendee = {
  contactId: string;
  required: boolean;
  attendance: AttendanceState;
  lateMinutes: number;
};

export type MeetingItem = {
  id: string;
  kind: MeetingItemKind;
  title: string;
  ownerContactId: string | null;
  dueDate: string | null;
  taskId: string | null;
  position: number;
};

export type Meeting = {
  id: string;
  title: string;
  /** دستور کار — free text that goes out with the invitation. */
  agenda: string;
  /** صورت‌جلسه و یادداشت‌های بعد از جلسه. */
  minutes: string;
  location: string;
  /** Local wall clock, 'YYYY-MM-DDTHH:MM'. */
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
  projectId: string | null;
  attendees: MeetingAttendee[];
  items: MeetingItem[];
  createdAt: string;
  updatedAt: string;
};

export type MeetingItemDraft = {
  id: string | null;
  kind: MeetingItemKind;
  title: string;
  ownerContactId: string | null;
  dueDate: string | null;
  taskId: string | null;
};

export type MeetingDraft = {
  title: string;
  agenda: string;
  minutes: string;
  location: string;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
  projectId: string | null;
  attendees: MeetingAttendee[];
  items: MeetingItemDraft[];
};

export type MeetingExportSummary = { path: string; bytes: number };

export const MEETING_TITLE_MAX_LENGTH = 200;
export const MEETING_ITEM_TITLE_MAX_LENGTH = 300;
export const MEETING_LOCATION_MAX_LENGTH = 200;
export const MAX_LATE_MINUTES = 1_440;

const statusKeys: Record<MeetingStatus, string> = {
  planned: 'meeting.status.planned',
  held: 'meeting.status.held',
  cancelled: 'meeting.status.cancelled'
};

const attendanceKeys: Record<AttendanceState, string> = {
  unknown: 'meeting.attendance.unknown',
  present: 'meeting.attendance.present',
  late: 'meeting.attendance.late',
  absent: 'meeting.attendance.absent',
  excused: 'meeting.attendance.excused'
};

export function meetingStatusLabel(status: MeetingStatus): string {
  return t(statusKeys[status]);
}

export function attendanceLabel(state: AttendanceState): string {
  return t(attendanceKeys[state]);
}

/** Calendar chip colour: planned is neutral, a held meeting is calm, a
 *  cancelled one is muted so it never competes with real work. */
export function meetingColor(status: MeetingStatus): HexColor {
  if (status === 'held') return DESIGN_COLORS.success;
  if (status === 'cancelled') return '#9AA4B2';
  return DESIGN_COLORS.info;
}

/** 'YYYY-MM-DDTHH:MM' → a local Date, or null when the value is unusable. */
export function meetingDate(value: string): Date | null {
  const [datePart, timePart = '00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, hour || 0, minute || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isUpcoming(meeting: Meeting, now: Date): boolean {
  const start = meetingDate(meeting.startsAt);
  if (!start) return false;
  const end = meetingDate(meeting.endsAt) ?? start;
  return end.getTime() >= now.getTime();
}

/** Upcoming first (soonest on top), then the past, newest first. */
export function sortMeetings(meetings: Meeting[], now: Date): Meeting[] {
  return [...meetings].sort((left, right) => {
    const leftUpcoming = isUpcoming(left, now);
    const rightUpcoming = isUpcoming(right, now);
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
    return leftUpcoming
      ? left.startsAt.localeCompare(right.startsAt)
      : right.startsAt.localeCompare(left.startsAt);
  });
}

/** "۱۴۰۵/۰۸/۲۸ · ۱۰:۰۰–۱۱:۰۰" in the active display calendar. */
export function meetingWhen(meeting: Meeting, format: 'short' | 'long' = 'short'): string {
  const date = meeting.startsAt.slice(0, 10);
  const start = meeting.startsAt.slice(11, 16);
  const end = meeting.endsAt.slice(11, 16);
  const day = formatIsoDisplay(date, format);
  return `${day} · ${start}–${end}`;
}

export function meetingDay(meeting: Meeting, format: 'short' | 'long' = 'short'): string {
  return formatIsoDisplay(meeting.startsAt.slice(0, 10), format);
}

export function meetingTimeRange(meeting: Meeting): string {
  return `${meeting.startsAt.slice(11, 16)}–${meeting.endsAt.slice(11, 16)}`;
}

export function attendanceCounts(meeting: Meeting) {
  const counts = { present: 0, late: 0, absent: 0, excused: 0, unknown: 0 };
  for (const attendee of meeting.attendees) counts[attendee.attendance] += 1;
  return counts;
}

export function itemsOf(meeting: Meeting, kind: MeetingItemKind): MeetingItem[] {
  return meeting.items.filter((item) => item.kind === kind);
}

/** A draft for a new meeting, starting at the next full hour. */
export function emptyMeetingDraft(now: Date = new Date()): MeetingDraft {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: '',
    agenda: '',
    minutes: '',
    location: '',
    startsAt: localStamp(start),
    endsAt: localStamp(end),
    status: 'planned',
    projectId: null,
    attendees: [],
    items: []
  };
}

export function draftOf(meeting: Meeting): MeetingDraft {
  return {
    title: meeting.title,
    agenda: meeting.agenda,
    minutes: meeting.minutes,
    location: meeting.location,
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    status: meeting.status,
    projectId: meeting.projectId,
    attendees: meeting.attendees.map((attendee) => ({ ...attendee })),
    items: meeting.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      ownerContactId: item.ownerContactId,
      dueDate: item.dueDate,
      taskId: item.taskId
    }))
  };
}

/** 'YYYY-MM-DDTHH:MM' from a local Date. */
export function localStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function validateMeetingDraft(draft: MeetingDraft): { field?: string; message: string } | null {
  if (!draft.title.trim()) return { field: 'title', message: t('meeting.errorTitle') };
  if (draft.title.trim().length > MEETING_TITLE_MAX_LENGTH) return { field: 'title', message: t('meeting.errorTitleLong') };
  if (!meetingDate(draft.startsAt)) return { field: 'startsAt', message: t('meeting.errorStart') };
  if (!meetingDate(draft.endsAt)) return { field: 'endsAt', message: t('meeting.errorEnd') };
  if (draft.endsAt < draft.startsAt) return { field: 'endsAt', message: t('meeting.errorOrder') };
  if (draft.items.some((item) => !item.title.trim())) return { field: 'items', message: t('meeting.errorItemTitle') };
  return null;
}
