import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
import type { Project, ProjectDraft } from './project-model';

export type ProjectsResource = {
  status: 'loading' | 'ready' | 'error';
  data: Project[];
  message?: string;
};

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('projects.readError');
}

function missing(command: string) {
  return new Error(t('projects.unavailable', { command }));
}

export function useProjects() {
  const repository = useNowlyRepository();
  const [projects, setProjects] = useState<ProjectsResource>({ status: 'loading', data: [] });
  const requestIdRef = useRef(0);

  const load = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setProjects((current) => ({ status: 'loading', data: current.data }));
    try {
      const read = repository.listProjects;
      if (!read) throw missing('listProjects');
      const rows = await read.call(repository);
      if (requestId === requestIdRef.current) setProjects({ status: 'ready', data: rows });
    } catch (error) {
      if (!silent && requestId === requestIdRef.current) {
        setProjects((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [repository]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const createProject = useCallback(async (draft: ProjectDraft) => {
    const write = repository.createProject;
    if (!write) throw missing('createProject');
    const project = await write.call(repository, draft);
    await load(true);
    return project;
  }, [load, repository]);

  const updateProject = useCallback(async (id: string, draft: ProjectDraft) => {
    const write = repository.updateProject;
    if (!write) throw missing('updateProject');
    const project = await write.call(repository, id, draft);
    await load(true);
    return project;
  }, [load, repository]);

  const archiveProject = useCallback(async (id: string) => {
    const write = repository.archiveProject;
    if (!write) throw missing('archiveProject');
    await write.call(repository, id);
    await load(true);
  }, [load, repository]);

  return {
    projects,
    reload: () => load(false),
    createProject,
    updateProject,
    archiveProject
  };
}
