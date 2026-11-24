import { CalendarRange, Plus, X } from '../components/icons';
import { useMemo, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { formatNumber, t } from '../i18n';
import { useCurrentTime } from '../app/useCurrentTime';
import { MeetingDialog } from './MeetingDialog';
import {
  attendanceCounts,
  isUpcoming,
  meetingDay,
  meetingStatusLabel,
  meetingTimeRange,
  sortMeetings
} from './meeting-model';
import { useMeetings } from './useMeetings';
import './meeting.css';

/**
 * The meetings block follows the phone book and the archive: one cell, one
 * glyph, a badge with the number of meetings still ahead. The list lives in the
 * modal, because a single grid cell cannot hold a schedule.
 */
export function MeetingsWidget({ readOnly = false, mobile = false }: { readOnly?: boolean; mobile?: boolean }) {
  const { meetings, reload } = useMeetings();
  const now = useCurrentTime();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const tileRef = useRef<HTMLButtonElement>(null);

  const rows = useMemo(() => sortMeetings(meetings.data, now), [meetings.data, now]);
  const upcoming = rows.filter((meeting) => isUpcoming(meeting, now));
  const past = rows.filter((meeting) => !isUpcoming(meeting, now));
  const ready = meetings.status === 'ready';
  const failed = meetings.status === 'error';

  function renderRow(meeting: (typeof rows)[number]) {
    const counts = attendanceCounts(meeting);
    const going = counts.present + counts.late;
    return (
      <button
        key={meeting.id}
        type="button"
        className="meeting-row"
        data-status={meeting.status}
        onClick={() => setEditing({ id: meeting.id })}
      >
        <span className="meeting-row__when">
          <span className="meeting-row__day">{meetingDay(meeting)}</span>
          <span className="meeting-row__time">{meetingTimeRange(meeting)}</span>
        </span>
        <span className="meeting-row__main">
          <span className="meeting-row__title">{meeting.title}</span>
          <span className="meeting-row__meta">
            {meeting.location ? <span>{meeting.location}</span> : null}
            <span>{t('meeting.attendeeCount', { count: formatNumber(meeting.attendees.length) })}</span>
            {meeting.status === 'held' && meeting.attendees.length > 0
              ? <span>{t('meeting.presentCount', { count: formatNumber(going) })}</span>
              : null}
          </span>
        </span>
        <span className="meeting-row__status">{meetingStatusLabel(meeting.status)}</span>
      </button>
    );
  }

  const listDialog = (
    <Dialog
      title={t('meeting.listTitle')}
      ariaLabelledBy="meetings-list-title"
      inline={mobile}
      restoreFocusRef={tileRef}
      onRequestClose={() => setOpen(false)}
      className="meetings-dialog"
      headerActions={
        <>
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('meeting.newMeeting')}
            title={t('meeting.newMeeting')}
            onClick={() => setEditing({ id: null })}
          >
            <Plus aria-hidden="true" />
          </button>
          {mobile ? null : (
            <button
              type="button"
              className="good-icon-button"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={() => setOpen(false)}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </>
      }
      footer={
        <div className="meeting-dialog__footer">
          <span className="meeting-dialog__notes">
            {failed ? meetings.message ?? t('meeting.readError') : null}
          </span>
          {mobile ? null : (
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.close')}</button>
          )}
        </div>
      }
    >
      <div className="meetings-list">
        {meetings.status === 'loading' && rows.length === 0 ? <p className="empty-copy">{t('meeting.loading')}</p> : null}
        {ready && rows.length === 0 ? <p className="empty-copy">{t('meeting.noMeetings')}</p> : null}
        {upcoming.length > 0 ? (
          <section className="meeting-group">
            <h4>{t('meeting.upcoming')}</h4>
            {upcoming.map(renderRow)}
          </section>
        ) : null}
        {past.length > 0 ? (
          <section className="meeting-group">
            <h4>{t('meeting.past')}</h4>
            {past.map(renderRow)}
          </section>
        ) : null}
      </div>
    </Dialog>
  );

  if (mobile) {
    return (
      <div className="widget-content meetings-widget">
        {listDialog}
        {editing ? (
          <MeetingDialog
            meetingId={editing.id}
            restoreFocusRef={tileRef}
            onClose={() => {
              setEditing(null);
              void reload();
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="widget-content meetings-widget">
      <button
        ref={tileRef}
        type="button"
        className="meetings-tile"
        data-testid="meetings-tile"
        disabled={readOnly}
        aria-label={t('meeting.tileOpen', { count: formatNumber(upcoming.length) })}
        title={failed ? meetings.message ?? t('meeting.readError') : t('meeting.tileDetail', { count: formatNumber(upcoming.length) })}
        onClick={() => {
          setOpen(true);
          void reload();
        }}
      >
        <span className="meetings-tile__plate" aria-hidden="true">
          <CalendarRange />
        </span>
        <span className="meetings-tile__badge" aria-hidden="true">
          {failed ? '!' : ready ? formatNumber(upcoming.length) : '…'}
        </span>
      </button>

      {open ? listDialog : null}

      {editing ? (
        <MeetingDialog
          meetingId={editing.id}
          restoreFocusRef={tileRef}
          onClose={() => {
            setEditing(null);
            if (open) void reload();
          }}
        />
      ) : null}
    </div>
  );
}
