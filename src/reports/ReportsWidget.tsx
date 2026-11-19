import { BarChart3 } from '../components/icons';
import { useRef, useState } from 'react';
import { formatNumber, t } from '../i18n';
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
  const { report, reload } = useTaskReport(days);
  const [open, setOpen] = useState(false);
  const tileRef = useRef<HTMLButtonElement>(null);

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
        onClick={() => setOpen(true)}
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
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
