import { BarChart3 } from '../components/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { formatNumber, t } from '../i18n';
import { useCurrentTime } from '../app/useCurrentTime';
import { useOptionalTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { ReportsDialog } from './ReportsDialog';
import { useTaskReport } from './useTaskReport';
import type { ReportRange } from './report-model';
import './reports.css';

/**
 * A one-cell launcher, the same shape as the phone book: the block is the icon
 * and the badge is the number of open tasks, and the report itself lives in a
 * modal where a chart has room to breathe.
 */
export function ReportsWidget({ readOnly = false }: { readOnly?: boolean }) {
  const [days, setDays] = useState<ReportRange>(30);
  const { report, reload, refresh } = useTaskReport(days);
  const repository = useNowlyRepository();
  const [open, setOpen] = useState(false);
  const tileRef = useRef<HTMLButtonElement>(null);
  // The report is a snapshot of the board, so it has to follow the board: every
  // task write (a new due date, a completion, an archive) changes this
  // signature and the numbers re-read themselves without a manual refresh.
  const taskWorkspace = useOptionalTaskWorkspace();
  const boardTasks = taskWorkspace?.workspace.data.tasks;
  const boardSignature = useMemo(
    () => boardTasks
      ? boardTasks.map((task) => `${task.id}:${task.status}:${task.completed ? 1 : 0}:${task.dueDate ?? ''}:${task.updatedAt}`).join('|')
      : '',
    [boardTasks]
  );
  const lastSignature = useRef(boardSignature);
  useEffect(() => {
    if (lastSignature.current === boardSignature) return;
    lastSignature.current = boardSignature;
    void refresh();
  }, [boardSignature, refresh]);

  // "Overdue" and "open" are counted against today, so the report also has to
  // roll over at midnight instead of waiting for the next click.
  const now = useCurrentTime();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const lastDay = useRef(today);
  useEffect(() => {
    if (lastDay.current === today) return;
    lastDay.current = today;
    void refresh();
  }, [today, refresh]);

  const totals = report.data?.totals;
  const ready = report.status === 'ready' && totals !== undefined;
  const failed = report.status === 'error' && !report.data;
  const openCount = totals?.open ?? 0;
  const completedCount = totals?.completed ?? 0;
  const detail = failed
    ? (report.message ?? t('reports.readError'))
    : t('reports.tileDetail', {
        open: formatNumber(openCount),
        completed: formatNumber(completedCount)
      });

  return (
    <div className="widget-content reports-widget">
      <button
        ref={tileRef}
        type="button"
        className={`reports-tile${totals && totals.overdue > 0 ? ' reports-tile--attention' : ''}`}
        data-testid="reports-tile"
        disabled={readOnly}
        aria-label={
          readOnly
            ? t('reports.tileReadOnly', { open: formatNumber(openCount) })
            : t('reports.openTile', { open: formatNumber(openCount) })
        }
        title={detail}
        onClick={() => {
          setOpen(true);
          // Opening is also the moment to pick up focus sessions, which the
          // board signature does not see.
          void refresh();
        }}
      >
        <span className="reports-tile__plate" aria-hidden="true">
          <BarChart3 />
        </span>
        <span className="reports-tile__badge" aria-hidden="true">
          {failed ? '!' : ready ? formatNumber(openCount) : '…'}
        </span>
      </button>

      {open ? (
        <ReportsDialog
          resource={report}
          days={days}
          restoreFocusRef={tileRef}
          onChangeDays={setDays}
          onRetry={reload}
          onExport={
            repository.exportTaskReport
              ? (path) => repository.exportTaskReport!.call(repository, path, days)
              : undefined
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
