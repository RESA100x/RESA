import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
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

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('archive.readError');
}

/**
 * The archive reads two lists at once: what left the board, and the projects
 * those rows point at. Both are needed to show a project name instead of an id,
 * so a failure in either surfaces on the same resource.
 */
export function useTaskArchive() {
  const repository = useNowlyRepository();
  const [archive, setArchive] = useState<TaskArchiveResource>({ status: 'loading', data: [] });
  const [projects, setProjects] = useState<ProjectsResource>({ status: 'loading', data: [] });
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
    }
  }, [repository]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => load(false), [load]);
  // For background re-reads: keeps the current rows on screen instead of
  // flashing the loading state.
  const refresh = useCallback(() => load(true), [load]);

  // Restoring a task to the board is the only write the archive makes: the
  // history rows themselves are never edited or deleted.
  const restore = useCallback(async (id: string, status: TaskStatus) => {
    const write = repository.setTaskStatus;
    if (!write) throw new Error(t('archive.unavailable'));
    await write.call(repository, id, status);
    await load(true);
  }, [load, repository]);

  const exportArchive = useCallback(async (path: string) => {
    const write = repository.exportTaskArchive;
    if (!write) throw new Error(t('archive.unavailable'));
    return write.call(repository, path);
  }, [repository]);

  return {
    archive,
    projects,
    reload,
    refresh,
    restore,
    exportArchive,
    canExport: Boolean(repository.exportTaskArchive)
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
