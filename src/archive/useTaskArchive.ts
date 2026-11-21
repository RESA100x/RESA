import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
import type { Contact } from '../phonebook/contact-model';
import type { Project } from '../projects/project-model';
import type { Task, TaskEvent, TaskStatus } from '../tasks/task-model';

export type TaskArchiveResource = {
  status: 'loading' | 'ready' | 'error';
  data: Task[];
  message?: string;
};

export type ProjectsResource = {
  status: 'loading' | 'ready' | 'error';
  data: Project[];
  message?: string;
};

// The phone book is read only to show assignee names; when the repository has
// no contact list (or it fails) the archive still works with ids alone.
export type ContactsResource = {
  status: 'idle' | 'ready' | 'error';
  data: Contact[];
};

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('archive.readError');
}

/**
 * The archive reads three lists at once: what left the board, the projects
 * those rows point at, and the contacts they are assigned to. All three are
 * needed to show names instead of ids; a failure in the first two surfaces on
 * the archive resource, a failure in the third is silently tolerated.
 */
export function useTaskArchive() {
  const repository = useNowlyRepository();
  const [archive, setArchive] = useState<TaskArchiveResource>({ status: 'loading', data: [] });
  const [projects, setProjects] = useState<ProjectsResource>({ status: 'loading', data: [] });
  const [contacts, setContacts] = useState<ContactsResource>({ status: 'idle', data: [] });
  const requestIdRef = useRef(0);

  const load = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) {
      setArchive((current) => ({ status: 'loading', data: current.data }));
      setProjects((current) => ({ status: 'loading', data: current.data }));
    }
    try {
      const readArchive = repository.listTaskArchive;
      const readProjects = repository.listProjects;
      if (!readArchive || !readProjects) throw new Error(t('archive.unavailable'));
      const [tasks, projectRows] = await Promise.all([
        readArchive.call(repository),
        readProjects.call(repository)
      ]);
      if (requestId !== requestIdRef.current) return;
      setArchive({ status: 'ready', data: tasks });
      setProjects({ status: 'ready', data: projectRows });
    } catch (error) {
      if (!silent && requestId === requestIdRef.current) {
        setArchive((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
        setProjects((current) => ({ status: 'error', data: current.data }));
      }
      return;
    }
    // Contacts are optional: a repository without them just shows ids, and a
    // failure here must not turn the whole archive into an error state.
    const readContacts = repository.listContacts;
    if (!readContacts) {
      setContacts({ status: 'idle', data: [] });
      return;
    }
    try {
      const rows = await readContacts.call(repository);
      if (requestId === requestIdRef.current) setContacts({ status: 'ready', data: rows });
    } catch {
      if (requestId === requestIdRef.current) setContacts({ status: 'error', data: [] });
    }
  }, [repository]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => load(false), [load]);
  // For background re-reads: keeps the current rows on screen instead of
  // flashing the loading state.
  const refresh = useCallback(() => load(true), [load]);

  // Restoring a task to the board, annotating one, and permanently dropping
  // rows are the only writes the archive makes.
  const restore = useCallback(async (id: string, status: TaskStatus) => {
    const write = repository.setTaskStatus;
    if (!write) throw new Error(t('archive.unavailable'));
    await write.call(repository, id, status);
    await load(true);
  }, [load, repository]);

  // A bulk restore writes every row before a single re-read, so selecting
  // twenty tasks does not trigger twenty list reloads.
  const restoreMany = useCallback(async (ids: string[], status: TaskStatus) => {
    const write = repository.setTaskStatus;
    if (!write) throw new Error(t('archive.unavailable'));
    for (const id of ids) await write.call(repository, id, status);
    if (ids.length > 0) await load(true);
  }, [load, repository]);

  const setReason = useCallback(async (id: string, reason: string | null) => {
    const write = repository.setTaskArchiveReason;
    if (!write) throw new Error(t('archive.unavailable'));
    const updated = await write.call(repository, id, reason);
    await load(true);
    return updated;
  }, [load, repository]);

  const purge = useCallback(async (ids: string[]) => {
    const write = repository.purgeTasks;
    if (!write) throw new Error(t('archive.unavailable'));
    const removed = await write.call(repository, ids);
    await load(true);
    return removed;
  }, [load, repository]);

  const exportArchive = useCallback(async (path: string, ids?: string[]) => {
    const write = repository.exportTaskArchive;
    if (!write) throw new Error(t('archive.unavailable'));
    return write.call(repository, path, ids);
  }, [repository]);

  return {
    archive,
    projects,
    contacts,
    reload,
    refresh,
    restore,
    restoreMany,
    setReason,
    purge,
    exportArchive,
    canExport: Boolean(repository.exportTaskArchive),
    canAnnotate: Boolean(repository.setTaskArchiveReason),
    canPurge: Boolean(repository.purgeTasks)
  };
}

export function useTaskEvents(taskId: string | null) {
  const repository = useNowlyRepository();
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!taskId) {
      setEvents([]);
      setStatus('idle');
      return;
    }
    const requestId = ++requestIdRef.current;
    const read = repository.listTaskEvents;
    if (!read) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    read
      .call(repository, taskId)
      .then((rows) => {
        if (requestId !== requestIdRef.current) return;
        setEvents(rows);
        setStatus('ready');
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setStatus('error');
      });
  }, [repository, taskId]);

  return { events, status };
}
