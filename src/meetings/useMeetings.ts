import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
import type { Meeting, MeetingDraft, MeetingExportSummary } from './meeting-model';

/** Fired after a meeting is written so every list (widget, calendar) re-reads. */
export const MEETINGS_CHANGED_EVENT = 'resa:meetings-changed';

export type MeetingsResource = {
  status: 'loading' | 'ready' | 'error';
  data: Meeting[];
  message?: string;
};

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('meeting.readError');
}

function missing(command: string) {
  return new Error(t('meeting.unavailable', { command }));
}

export function useMeetings() {
  const repository = useNowlyRepository();
  const [meetings, setMeetings] = useState<MeetingsResource>({ status: 'loading', data: [] });
  const requestIdRef = useRef(0);

  const read = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setMeetings((current) => ({ status: 'loading', data: current.data }));
    try {
      const write = repository.listMeetings;
      if (!write) throw missing('listMeetings');
      const data = await write.call(repository);
      if (requestId === requestIdRef.current) {
        setMeetings({ status: 'ready', data: data.map((meeting) => ({ ...meeting })) });
      }
    } catch (error) {
      if (!silent && requestId === requestIdRef.current) {
        setMeetings((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [repository]);

  const reload = useCallback(() => read(false), [read]);
  const refresh = useCallback(() => read(true), [read]);

  useEffect(() => { void reload(); }, [reload]);

  // The widget and the calendar each hold their own list; a save in one place
  // has to reach the other without a full page reload.
  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener(MEETINGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(MEETINGS_CHANGED_EVENT, handler);
  }, [refresh]);

  const saveMeeting = useCallback(async (id: string | null, draft: MeetingDraft): Promise<Meeting> => {
    const write = repository.saveMeeting;
    if (!write) throw missing('saveMeeting');
    const saved = await write.call(repository, id, draft);
    await reload();
    window.dispatchEvent(new Event(MEETINGS_CHANGED_EVENT));
    return saved;
  }, [reload, repository]);

  const deleteMeeting = useCallback(async (id: string) => {
    const write = repository.deleteMeeting;
    if (!write) throw missing('deleteMeeting');
    await write.call(repository, id);
    await reload();
    window.dispatchEvent(new Event(MEETINGS_CHANGED_EVENT));
  }, [reload, repository]);

  const exportMeeting = useCallback(async (id: string, path: string): Promise<MeetingExportSummary> => {
    const write = repository.exportMeeting;
    if (!write) throw missing('exportMeeting');
    return write.call(repository, id, path);
  }, [repository]);

  return {
    meetings,
    reload,
    refresh,
    saveMeeting,
    deleteMeeting,
    exportMeeting,
    canExport: Boolean(repository.exportMeeting)
  };
}
