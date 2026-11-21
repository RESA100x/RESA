import { describe, expect, it } from 'vitest';
import {
  attendanceCounts,
  emptyMeetingDraft,
  isUpcoming,
  itemsOf,
  meetingTimeRange,
  sortMeetings,
  validateMeetingDraft,
  type Meeting
} from './meeting-model';

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    title: 'جلسه',
    agenda: '',
    minutes: '',
    location: '',
    startsAt: '2026-11-20T10:00',
    endsAt: '2026-11-20T11:00',
    status: 'planned',
    projectId: null,
    attendees: [],
    items: [],
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides
  };
}

const now = new Date(2026, 10, 19, 12, 0);

describe('sortMeetings', () => {
  it('puts upcoming meetings first, soonest on top', () => {
    const rows = sortMeetings([
      meeting({ id: 'past', startsAt: '2026-11-10T10:00', endsAt: '2026-11-10T11:00' }),
      meeting({ id: 'later', startsAt: '2026-11-22T10:00', endsAt: '2026-11-22T11:00' }),
      meeting({ id: 'sooner', startsAt: '2026-11-20T10:00', endsAt: '2026-11-20T11:00' })
    ], now);
    expect(rows.map((row) => row.id)).toEqual(['sooner', 'later', 'past']);
  });

  it('orders past meetings newest first', () => {
    const rows = sortMeetings([
      meeting({ id: 'old', startsAt: '2026-10-01T10:00', endsAt: '2026-10-01T11:00' }),
      meeting({ id: 'recent', startsAt: '2026-11-18T10:00', endsAt: '2026-11-18T11:00' })
    ], now);
    expect(rows.map((row) => row.id)).toEqual(['recent', 'old']);
  });
});

describe('isUpcoming', () => {
  it('keeps a meeting that is still running', () => {
    expect(isUpcoming(meeting({ startsAt: '2026-11-19T11:30', endsAt: '2026-11-19T12:30' }), now)).toBe(true);
    expect(isUpcoming(meeting({ startsAt: '2026-11-19T08:00', endsAt: '2026-11-19T09:00' }), now)).toBe(false);
  });
});

describe('validateMeetingDraft', () => {
  it('requires a title and a sane time range', () => {
    const draft = emptyMeetingDraft(now);
    expect(validateMeetingDraft({ ...draft, title: '  ' })?.field).toBe('title');
    expect(validateMeetingDraft({ ...draft, title: 'جلسه', endsAt: '2020-01-01T09:00' })?.field).toBe('endsAt');
    expect(validateMeetingDraft({ ...draft, title: 'جلسه' })).toBeNull();
  });

  it('rejects an empty agenda item title', () => {
    const draft = emptyMeetingDraft(now);
    const invalid = {
      ...draft,
      title: 'جلسه',
      items: [{ id: null, kind: 'agenda' as const, title: ' ', ownerContactId: null, dueDate: null, taskId: null }]
    };
    expect(validateMeetingDraft(invalid)?.field).toBe('items');
  });
});

describe('attendanceCounts', () => {
  it('counts each attendance state', () => {
    const counts = attendanceCounts(meeting({
      attendees: [
        { contactId: 'a', required: true, attendance: 'present', lateMinutes: 0 },
        { contactId: 'b', required: true, attendance: 'late', lateMinutes: 10 },
        { contactId: 'c', required: false, attendance: 'absent', lateMinutes: 0 },
        { contactId: 'd', required: false, attendance: 'unknown', lateMinutes: 0 }
      ]
    }));
    expect(counts).toEqual({ present: 1, late: 1, absent: 1, excused: 0, unknown: 1 });
  });
});

describe('itemsOf', () => {
  it('splits agenda from follow-ups', () => {
    const row = meeting({
      items: [
        { id: '1', kind: 'agenda', title: 'a', ownerContactId: null, dueDate: null, taskId: null, position: 0 },
        { id: '2', kind: 'followup', title: 'b', ownerContactId: null, dueDate: null, taskId: null, position: 1 }
      ]
    });
    expect(itemsOf(row, 'agenda').map((item) => item.id)).toEqual(['1']);
    expect(itemsOf(row, 'followup').map((item) => item.id)).toEqual(['2']);
  });
});

describe('meetingTimeRange', () => {
  it('prints the wall-clock range', () => {
    expect(meetingTimeRange(meeting())).toBe('10:00–11:00');
  });
});
