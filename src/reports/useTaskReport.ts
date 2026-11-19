import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
import type { TaskReport } from './report-model';

export type TaskReportResource = {
  status: 'loading' | 'ready' | 'error';
  data: TaskReport | null;
  message?: string;
};

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('reports.readError');
}

export function useTaskReport(days: number) {
  const repository = useNowlyRepository();
  const [report, setReport] = useState<TaskReportResource>({ status: 'loading', data: null });
  const requestIdRef = useRef(0);

  const load = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setReport((current) => ({ status: 'loading', data: current.data }));
    try {
      const read = repository.getTaskReport;
      if (!read) throw new Error(t('reports.unavailable'));
      const data = await read.call(repository, days);
      if (requestId === requestIdRef.current) setReport({ status: 'ready', data });
    } catch (error) {
      // A silent refresh keeps the numbers already on screen.
      if (!silent && requestId === requestIdRef.current) {
        setReport((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [days, repository]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => load(false), [load]);
  return { report, reload };
}
