import { useId, useMemo, useState, type RefObject } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { Download, X } from '../components/icons';
import { Dialog } from '../components/Dialog';
import { getLocale, formatNumber, t } from '../i18n';
import { formatIsoDisplay, usesJalaliCalendar } from '../lib/calendar-system';
import { effectiveWeekStart } from '../lib/date';
import {
  QUADRANT_ORDER,
  REPORT_RANGES,
  focusPerCompleted,
  groupByMonth,
  groupByWeek,
  hasActivity,
  peakValue,
  totalFocusSeconds,
  type ReportActivity,
  type ReportMeeting,
  type ReportMonth,
  type ReportRange,
  type ReportStuckTask,
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
  onExport?(path: string): Promise<{ path: string; format: string }>;
  onClose(): void;
};

type ReportTab = 'summary' | 'trend' | 'projects' | 'stuck' | 'meetings' | 'activity';

const TABS: ReportTab[] = ['summary', 'trend', 'projects', 'stuck', 'meetings', 'activity'];

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

function dateLabel(isoDate: string | null) {
  if (!isoDate) return t('reports.noDue');
  return formatIsoDisplay(isoDate.slice(0, 10), 'short');
}

function momentLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(parsed);
}

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('reports.exportFailed');
}

function reportFileName(days: number) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `resa-report-${days}d-${stamp}.csv`;
}

const exportFilters = [
  { name: 'CSV', extensions: ['csv'] },
  { name: 'Markdown', extensions: ['md'] }
];

function Delta({ label, current, previous }: { label: string; current: number; previous: number }) {
  const diff = current - previous;
  const tone = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
  const value = diff === 0 ? t('reports.deltaSame') : `${diff > 0 ? '+' : '−'}${formatNumber(Math.abs(diff))}`;
  return (
    <span className={`reports-delta reports-delta--${tone}`} title={t('reports.deltaHint', { label, value: formatNumber(previous) })}>
      <span className="reports-delta__label">{label}</span>
      <span className="reports-delta__value">{value}</span>
    </span>
  );
}

function WeeklyChart({ weeks, peak, focusSeconds }: { weeks: ReportWeek[]; peak: number; focusSeconds: number }) {
  return (
    <>
      <div
        className="reports-chart"
        role="img"
        aria-label={t('reports.weekChartHint', {
          created: formatNumber(weeks.reduce((sum, week) => sum + week.created, 0)),
          completed: formatNumber(weeks.reduce((sum, week) => sum + week.completed, 0))
        })}
      >
        {weeks.map((week) => (
          <div className="reports-chart__week" key={week.start}>
            <div className="reports-chart__bars">
              <span
                className="reports-bar reports-bar--created"
                style={{ height: `${Math.max((week.created / peak) * 100, week.created > 0 ? 4 : 0)}%` }}
                title={t('reports.barCreated', { value: formatNumber(week.created), label: weekLabel(week.start) })}
              />
              <span
                className="reports-bar reports-bar--completed"
                style={{ height: `${Math.max((week.completed / peak) * 100, week.completed > 0 ? 4 : 0)}%` }}
                title={t('reports.barCompleted', { value: formatNumber(week.completed), label: weekLabel(week.start) })}
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
    </>
  );
}

function MonthlyChart({ months }: { months: ReportMonth[] }) {
  const peak = Math.max(1, ...months.map((month) => Math.max(month.created, month.completed)));
  return (
    <div className="reports-chart reports-chart--months">
      {months.map((month) => (
        <div className="reports-chart__week" key={month.key}>
          <div className="reports-chart__bars">
            <span
              className="reports-bar reports-bar--created"
              style={{ height: `${Math.max((month.created / peak) * 100, month.created > 0 ? 4 : 0)}%` }}
              title={t('reports.barCreated', { value: formatNumber(month.created), label: month.label })}
            />
            <span
              className="reports-bar reports-bar--completed"
              style={{ height: `${Math.max((month.completed / peak) * 100, month.completed > 0 ? 4 : 0)}%` }}
              title={t('reports.barCompleted', { value: formatNumber(month.completed), label: month.label })}
            />
          </div>
          <span className="reports-chart__label">{month.label}</span>
        </div>
      ))}
    </div>
  );
}

function StuckRow({ task }: { task: ReportStuckTask }) {
  return (
    <li className="reports-stuck">
      <span className="reports-stuck__title">{task.title}</span>
      <span className="reports-stuck__meta">
        {task.projectName ? <span className="reports-chip">{task.projectName}</span> : null}
        <span className={`reports-chip${task.overdueDays !== null ? ' reports-chip--danger' : ''}`}>
          {task.overdueDays !== null
            ? t('reports.stuckOverdue', { value: formatNumber(task.overdueDays) })
            : t('reports.stuckAge', { value: formatNumber(task.ageDays) })}
        </span>
        <span className="reports-chip reports-chip--muted">{dateLabel(task.dueDate)}</span>
      </span>
    </li>
  );
}

function MeetingRow({ meeting }: { meeting: ReportMeeting }) {
  return (
    <li className="reports-meeting">
      <div className="reports-meeting__head">
        <span className="reports-meeting__title">{meeting.title}</span>
        <span className="reports-meeting__when">{momentLabel(meeting.startsAt)}</span>
      </div>
      <div className="reports-meeting__meta">
        <span className="reports-chip">
          {t('reports.meetingAttendance', {
            present: formatNumber(meeting.present),
            late: formatNumber(meeting.late),
            absent: formatNumber(meeting.absent)
          })}
        </span>
        {meeting.lateMinutes > 0 ? (
          <span className="reports-chip reports-chip--danger">
            {t('reports.meetingLateMinutes', { value: formatNumber(meeting.lateMinutes) })}
          </span>
        ) : null}
        <span className="reports-chip reports-chip--muted">
          {t('reports.meetingAgenda', {
            items: formatNumber(meeting.agendaItems),
            tasks: formatNumber(meeting.agendaTasks),
            done: formatNumber(meeting.agendaDone)
          })}
        </span>
      </div>
    </li>
  );
}

function ActivityRow({ event }: { event: ReportActivity }) {
  return (
    <li className="reports-activity">
      <span className={`reports-activity__kind reports-activity__kind--${event.kind}`}>
        {t(`reports.activityKind.${event.kind}`)}
      </span>
      <span className="reports-activity__title">{event.taskTitle || event.taskId}</span>
      <span className="reports-activity__when">{momentLabel(event.at)}</span>
    </li>
  );
}

/**
 * The report itself. Every number comes from the task rows the app already
 * keeps, so the dialog never asks the user to log anything: it answers "how
 * much came in, how much went out, what is still on my plate, and what has
 * quietly rotted".
 */
export function ReportsDialog({
  resource,
  days,
  restoreFocusRef,
  onChangeDays,
  onRetry,
  onExport,
  onClose
}: ReportsDialogProps) {
  const titleId = useId();
  const [tab, setTab] = useState<ReportTab>('summary');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportError, setExportError] = useState('');
  const report: TaskReport | null = resource.data;
  const weekStart = effectiveWeekStart('monday');
  const weeks = useMemo<ReportWeek[]>(
    () =>
      report
        ? groupByWeek(report.days, weekStart === 'saturday' ? 6 : weekStart === 'sunday' ? 0 : 1)
        : [],
    [report, weekStart]
  );
  const months = useMemo<ReportMonth[]>(() => (report ? groupByMonth(report.days) : []), [report]);
  const peak = useMemo(() => peakValue(weeks), [weeks]);
  const focusSeconds = useMemo(() => (report ? totalFocusSeconds(report.days) : 0), [report]);
  const focusPerTask = useMemo(() => (report ? focusPerCompleted(report.days) : null), [report]);

  async function runExport() {
    if (!onExport) return;
    setExportError('');
    setExportStatus('');
    const path = await save({ defaultPath: reportFileName(days), filters: exportFilters }).catch(() => null);
    if (!path) return;
    setExportBusy(true);
    try {
      const summary = await onExport(path);
      setExportStatus(t('reports.exported', { path: summary.path }));
    } catch (reason) {
      setExportError(message(reason));
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <Dialog
      title={t('reports.title')}
      ariaLabelledBy={titleId}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="reports-dialog"
      headerActions={
        <>
          {onExport ? (
            <button
              type="button"
              className="good-icon-button"
              aria-label={t('reports.export')}
              title={t('reports.export')}
              disabled={exportBusy || !report}
              onClick={() => void runExport()}
            >
              <Download aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </>
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

        {exportStatus ? <p className="reports-note">{exportStatus}</p> : null}
        {exportError ? (
          <p className="reports-error" role="alert">
            {exportError}
          </p>
        ) : null}

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
            <div className="reports-tabs" role="tablist" aria-label={t('reports.tabsLabel')}>
              {TABS.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  className="reports-tab"
                  aria-selected={tab === item}
                  onClick={() => setTab(item)}
                >
                  {t(`reports.tab.${item}`)}
                  {item === 'stuck' && report.stuck.length > 0 ? (
                    <span className="reports-tab__badge">{formatNumber(report.stuck.length)}</span>
                  ) : null}
                </button>
              ))}
            </div>

            {tab === 'summary' ? (
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

                <div className="reports-compare">
                  <span className="reports-compare__title">{t('reports.vsPrevious')}</span>
                  <Delta label={t('reports.created')} current={report.totals.created} previous={report.previous.created} />
                  <Delta
                    label={t('reports.completed')}
                    current={report.totals.completed}
                    previous={report.previous.completed}
                  />
                  <Delta
                    label={t('reports.archived')}
                    current={report.totals.archived}
                    previous={report.previous.archived}
                  />
                </div>

                {!hasActivity(report) ? <p className="reports-empty">{t('reports.empty')}</p> : null}

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

                <p className="reports-footnote">
                  {t('reports.archivedNote', { value: formatNumber(report.totals.archived) })}
                </p>
              </>
            ) : null}

            {tab === 'trend' ? (
              <>
                <section className="reports-section" aria-labelledby={`${titleId}-chart`}>
                  <h3 id={`${titleId}-chart`} className="reports-section__title">
                    {t('reports.weekChart')}
                  </h3>
                  <WeeklyChart weeks={weeks} peak={peak} focusSeconds={focusSeconds} />
                </section>
                <section className="reports-section" aria-labelledby={`${titleId}-months`}>
                  <h3 id={`${titleId}-months`} className="reports-section__title">
                    {t('reports.monthChart')}
                  </h3>
                  <MonthlyChart months={months} />
                </section>
                <p className="reports-footnote">
                  {focusPerTask === null
                    ? t('reports.focusPerTaskNone')
                    : t('reports.focusPerTask', { value: focusLabel(focusPerTask) })}
                </p>
              </>
            ) : null}

            {tab === 'projects' ? (
              <section className="reports-section" aria-labelledby={`${titleId}-projects`}>
                <h3 id={`${titleId}-projects`} className="reports-section__title">
                  {t('reports.byProject')}
                </h3>
                {report.projects.length === 0 ? (
                  <p className="reports-empty">{t('reports.noProjects')}</p>
                ) : (
                  <ul className="reports-rows">
                    {report.projects.map((project) => (
                      <li className="reports-row" key={project.id}>
                        <span className="reports-row__name">{project.name}</span>
                        <span className="reports-row__track" aria-hidden="true">
                          <span
                            className="reports-row__fill"
                            style={{ width: `${project.completionRate * 100}%` }}
                          />
                        </span>
                        <span className="reports-row__count">
                          {t('reports.projectRow', {
                            open: formatNumber(project.open),
                            completed: formatNumber(project.completed),
                            overdue: formatNumber(project.overdue)
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {tab === 'stuck' ? (
              <section className="reports-section" aria-labelledby={`${titleId}-stuck`}>
                <h3 id={`${titleId}-stuck`} className="reports-section__title">
                  {t('reports.stuckTitle')}
                </h3>
                <p className="reports-hint">{t('reports.stuckHint')}</p>
                {report.stuck.length === 0 ? (
                  <p className="reports-empty">{t('reports.stuckEmpty')}</p>
                ) : (
                  <ul className="reports-stuck-list">
                    {report.stuck.map((task) => (
                      <StuckRow key={task.id} task={task} />
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {tab === 'meetings' ? (
              <section className="reports-section" aria-labelledby={`${titleId}-meetings`}>
                <h3 id={`${titleId}-meetings`} className="reports-section__title">
                  {t('reports.meetingsTitle')}
                </h3>
                {report.meetings.length === 0 ? (
                  <p className="reports-empty">{t('reports.meetingsEmpty')}</p>
                ) : (
                  <ul className="reports-meeting-list">
                    {report.meetings.map((meeting) => (
                      <MeetingRow key={meeting.id} meeting={meeting} />
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {tab === 'activity' ? (
              <section className="reports-section" aria-labelledby={`${titleId}-activity`}>
                <h3 id={`${titleId}-activity`} className="reports-section__title">
                  {t('reports.activityTitle')}
                </h3>
                {report.activity.length === 0 ? (
                  <p className="reports-empty">{t('reports.activityEmpty')}</p>
                ) : (
                  <ul className="reports-activity-list">
                    {report.activity.map((event) => (
                      <ActivityRow key={event.id} event={event} />
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
