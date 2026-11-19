import { useId, useMemo, type RefObject } from 'react';
import { X } from '../components/icons';
import { Dialog } from '../components/Dialog';
import { getLocale, formatNumber, t } from '../i18n';
import { formatIsoDisplay, usesJalaliCalendar } from '../lib/calendar-system';
import { effectiveWeekStart } from '../lib/date';
import {
  QUADRANT_ORDER,
  REPORT_RANGES,
  groupByWeek,
  hasActivity,
  peakValue,
  totalFocusSeconds,
  type ReportRange,
  type ReportWeek,
  type TaskReport
} from './report-model';
import type { TaskReportResource } from './useTaskReport';
import './reports.css';

type ReportsDialogProps = {
  resource: TaskReportResource;
  days: ReportRange;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onChangeDays(days: ReportRange): void;
  onRetry(): void;
  onClose(): void;
};

function weekLabel(isoDate: string) {
  if (usesJalaliCalendar()) return formatIsoDisplay(isoDate, 'short');
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric' }).format(
    new Date(year, month - 1, day)
  );
}

function dayLabel(value: number) {
  return value === 1 ? t('reports.dayOne') : t('reports.dayMany', { value: formatNumber(value) });
}

function focusLabel(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('reports.focusMinutes', { value: formatNumber(minutes) });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? t('reports.focusHours', { value: formatNumber(hours) })
    : t('reports.focusHoursMinutes', { hours: formatNumber(hours), minutes: formatNumber(rest) });
}

/**
 * The report itself. Every number comes from the task rows the app already
 * keeps, so the dialog never asks the user to log anything: it answers "how
 * much came in, how much went out, and what is still on my plate".
 */
export function ReportsDialog({
  resource,
  days,
  restoreFocusRef,
  onChangeDays,
  onRetry,
  onClose
}: ReportsDialogProps) {
  const titleId = useId();
  const report: TaskReport | null = resource.data;
  const weekStart = effectiveWeekStart('monday');
  const weeks = useMemo<ReportWeek[]>(
    () =>
      report
        ? groupByWeek(report.days, weekStart === 'saturday' ? 6 : weekStart === 'sunday' ? 0 : 1)
        : [],
    [report, weekStart]
  );
  const peak = useMemo(() => peakValue(weeks), [weeks]);
  const focusSeconds = useMemo(() => (report ? totalFocusSeconds(report.days) : 0), [report]);

  return (
    <Dialog
      title={t('reports.title')}
      ariaLabelledBy={titleId}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="reports-dialog"
      headerActions={
        <button
          type="button"
          className="good-icon-button"
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      }
    >
      <div className="reports-body">
        <div className="reports-ranges" role="group" aria-label={t('reports.rangeLabel')}>
          {REPORT_RANGES.map((range) => (
            <button
              key={range}
              type="button"
              className="reports-range"
              aria-pressed={range === days}
              onClick={() => onChangeDays(range)}
            >
              {t(`reports.range.${range}`)}
            </button>
          ))}
        </div>

        {resource.status === 'error' && !report ? (
          <div className="reports-error" role="alert">
            <span>{resource.message ?? t('reports.readError')}</span>
            <button type="button" className="reports-retry" onClick={onRetry}>
              {t('reports.retry')}
            </button>
          </div>
        ) : null}

        {!report ? (
          resource.status === 'loading' ? <p className="reports-loading">{t('reports.loading')}</p> : null
        ) : (
          <>
            <div className="reports-kpis">
              <div className="reports-kpi">
                <span className="reports-kpi__label">{t('reports.created')}</span>
                <span className="reports-kpi__value">{formatNumber(report.totals.created)}</span>
              </div>
              <div className="reports-kpi reports-kpi--good">
                <span className="reports-kpi__label">{t('reports.completed')}</span>
                <span className="reports-kpi__value">{formatNumber(report.totals.completed)}</span>
              </div>
              <div className="reports-kpi">
                <span className="reports-kpi__label">{t('reports.open')}</span>
                <span className="reports-kpi__value">{formatNumber(report.totals.open)}</span>
              </div>
              <div className={`reports-kpi${report.totals.overdue > 0 ? ' reports-kpi--danger' : ''}`}>
                <span className="reports-kpi__label">{t('reports.overdue')}</span>
                <span className="reports-kpi__value">{formatNumber(report.totals.overdue)}</span>
              </div>
              <div className="reports-kpi">
                <span className="reports-kpi__label">{t('reports.completionRate')}</span>
                <span className="reports-kpi__value">
                  {t('reports.percent', { value: formatNumber(Math.round(report.totals.completionRate * 100)) })}
                </span>
              </div>
              <div className="reports-kpi">
                <span className="reports-kpi__label">{t('reports.averageClose')}</span>
                <span className="reports-kpi__value">
                  {report.totals.averageCloseDays === null
                    ? t('reports.notEnough')
                    : dayLabel(Math.round(report.totals.averageCloseDays))}
                </span>
              </div>
            </div>

            {!hasActivity(report) ? <p className="reports-empty">{t('reports.empty')}</p> : null}

            <section className="reports-section" aria-labelledby={`${titleId}-chart`}>
              <h3 id={`${titleId}-chart`} className="reports-section__title">
                {t('reports.weekChart')}
              </h3>
              <div
                className="reports-chart"
                role="img"
                aria-label={t('reports.weekChartHint', {
                  created: formatNumber(report.totals.created),
                  completed: formatNumber(report.totals.completed)
                })}
              >
                {weeks.map((week) => (
                  <div className="reports-chart__week" key={week.start}>
                    <div className="reports-chart__bars">
                      <span
                        className="reports-bar reports-bar--created"
                        style={{ height: `${Math.max((week.created / peak) * 100, week.created > 0 ? 4 : 0)}%` }}
                        title={t('reports.barCreated', {
                          value: formatNumber(week.created),
                          label: weekLabel(week.start)
                        })}
                      />
                      <span
                        className="reports-bar reports-bar--completed"
                        style={{ height: `${Math.max((week.completed / peak) * 100, week.completed > 0 ? 4 : 0)}%` }}
                        title={t('reports.barCompleted', {
                          value: formatNumber(week.completed),
                          label: weekLabel(week.start)
                        })}
                      />
                    </div>
                    <span className="reports-chart__label">{weekLabel(week.start)}</span>
                  </div>
                ))}
              </div>
              <div className="reports-legend">
                <span className="reports-legend__item reports-legend__item--created">{t('reports.created')}</span>
                <span className="reports-legend__item reports-legend__item--completed">{t('reports.completed')}</span>
                <span className="reports-legend__focus">{t('reports.focusTotal', { value: focusLabel(focusSeconds) })}</span>
              </div>
            </section>

            <div className="reports-columns">
              <section className="reports-section" aria-labelledby={`${titleId}-quadrants`}>
                <h3 id={`${titleId}-quadrants`} className="reports-section__title">
                  {t('reports.byQuadrant')}
                </h3>
                <ul className="reports-rows">
                  {QUADRANT_ORDER.map((priority) => {
                    const row = report.quadrants.find((item) => item.priority === priority);
                    const open = row?.open ?? 0;
                    const completed = row?.completed ?? 0;
                    const total = open + completed;
                    return (
                      <li className="reports-row" key={priority}>
                        <span className="reports-row__name">{t(`quadrant.${priority}`)}</span>
                        <span className="reports-row__track" aria-hidden="true">
                          <span
                            className="reports-row__fill"
                            style={{ width: `${total === 0 ? 0 : (completed / total) * 100}%` }}
                          />
                        </span>
                        <span className="reports-row__count">
                          {t('reports.rowCount', {
                            open: formatNumber(open),
                            completed: formatNumber(completed)
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="reports-section" aria-labelledby={`${titleId}-lanes`}>
                <h3 id={`${titleId}-lanes`} className="reports-section__title">
                  {t('reports.byLane')}
                </h3>
                {report.lanes.length === 0 ? (
                  <p className="reports-empty">{t('reports.noLanes')}</p>
                ) : (
                  <ul className="reports-rows">
                    {report.lanes.map((lane) => (
                      <li className="reports-row" key={lane.id}>
                        <span className="reports-row__name">{lane.name}</span>
                        <span className="reports-row__track" aria-hidden="true">
                          <span
                            className="reports-row__fill"
                            style={{
                              width: `${lane.open + lane.completed === 0 ? 0 : (lane.completed / (lane.open + lane.completed)) * 100}%`
                            }}
                          />
                        </span>
                        <span className="reports-row__count">
                          {t('reports.rowCount', {
                            open: formatNumber(lane.open),
                            completed: formatNumber(lane.completed)
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <p className="reports-footnote">{t('reports.archivedNote', { value: formatNumber(report.totals.archived) })}</p>
          </>
        )}
      </div>
    </Dialog>
  );
}
