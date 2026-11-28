import { CalendarDays, ChevronLeft, ChevronRight, type AppIcon } from '../components/icons';
import { type CSSProperties, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildMonthGrid, effectiveWeekStart, formatChineseDate, toIsoDate } from '../lib/date';
import { t, formatNumber, isRtl } from '../i18n';
import {
  addDisplayMonths,
  displayMonthLength,
  displayMonthDayOf,
  displayMonthName,
  displayMonthOf,
  displayMonthStart,
  usesJalaliCalendar
} from '../lib/calendar-system';
import { formatJalali, toLatinDigits } from '../lib/jalali';

function weekdayHeadingsList() {
  return t('datePicker.weekdays').split(',');
}

export type DatePickerProps = {
  id: string;
  label: string;
  hideLabel?: boolean;
  value: string;
  errorId?: string;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  today?: Date;
};

/** How many years one page of the year grid holds. */
const YEARS_PER_PAGE = 12;

function parseIsoDate(value: string, fallback: Date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function displayDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return t('datePicker.placeholder');
  if (usesJalaliCalendar()) {
    return formatJalali(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])), 'long');
  }
  return t('datePicker.value', { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
}

function monthHeading(year: number, monthIndex: number) {
  if (usesJalaliCalendar()) return `${displayMonthName(monthIndex)} ${formatNumber(year, { useGrouping: false })}`;
  return t('datePicker.header', { year, month: monthIndex + 1 });
}

/**
 * Two chevrons drawn as icons, not as the « » characters: those are
 * bidi-mirrored, so in a right-to-left page the browser flips them and a
 * "previous year" arrow ends up pointing the wrong way. Icons follow the same
 * direction as the month chevrons next to them.
 */
function DoubleChevron({ icon: Icon }: { icon: AppIcon }) {
  return (
    <span className="date-picker__double" aria-hidden="true">
      <Icon />
      <Icon />
    </span>
  );
}

/** First year of the page that holds `year`. */
function pageStart(year: number) {
  return year - (((year % YEARS_PER_PAGE) + YEARS_PER_PAGE) % YEARS_PER_PAGE);
}

/**
 * The phone shell turns the calendar into a bottom sheet through
 * `html.is-mobile-shell .date-picker__popup`. Inline positioning would beat
 * that rule, so the measuring code stays out of the way there.
 */
function usesSheetLayout() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('is-mobile-shell');
}

/**
 * A date field with a calendar.
 *
 * The calendar is a *range* picker as much as a month picker: a production date
 * is often twenty or thirty years back, and paging there month by month is
 * unusable. So the header carries a year step on each side, the title opens a
 * year grid (twelve years a page) and then a month grid, and the year grid has
 * a box to type the year directly. Shift+PageUp/PageDown does the same from the
 * keyboard.
 */
export function DatePicker({
  id,
  label,
  hideLabel = false,
  value,
  errorId,
  disabled = false,
  open,
  onOpenChange,
  onChange,
  today = new Date()
}: DatePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const yearInputRef = useRef<HTMLInputElement>(null);
  const initialDate = parseIsoDate(value, today);
  const [visibleMonth, setVisibleMonth] = useState(() => displayMonthOf(initialDate));
  const [cursorDate, setCursorDate] = useState(initialDate);
  const [panel, setPanel] = useState<'days' | 'months' | 'years'>('days');
  const [yearPage, setYearPage] = useState(() => pageStart(displayMonthOf(initialDate).year));
  const [yearDraft, setYearDraft] = useState('');
  // The calendar is positioned against the viewport instead of the field: the
  // event form lives in a scrolling modal body, and an absolutely positioned
  // panel was clipped by that scroll container (and pushed off the right edge
  // in right-to-left layouts, where `left: 0` points the wrong way).
  const [popupStyle, setPopupStyle] = useState<CSSProperties>(() => (usesSheetLayout() ? {} : { visibility: 'hidden' }));
  const cursorDateRef = useRef(initialDate);
  const shouldRestoreFocusRef = useRef(false);
  // Keyboard moves re-render the grid, which replaces the focused button. The
  // focus is handed back in a layout effect so the next key press (Enter, Space)
  // always lands on the day the cursor actually moved to.
  const pendingFocusRef = useRef(false);

  const days = buildMonthGrid(visibleMonth.year, visibleMonth.monthIndex, today, effectiveWeekStart('monday'));
  // Month navigation is a logical back/forward control, so the chevrons flip
  // along with the mirrored layout in right-to-left languages.
  const PreviousIcon = isRtl() ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl() ? ChevronLeft : ChevronRight;
  const dialogId = `${id}-dialog`;

  useEffect(() => {
    if (!open) return;
    const selected = parseIsoDate(value, today);
    cursorDateRef.current = selected;
    setCursorDate(selected);
    setVisibleMonth(displayMonthOf(selected));
    setPanel('days');
    setYearPage(pageStart(displayMonthOf(selected).year));
    setYearDraft('');
    requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>(`[data-date="${toIsoDate(selected)}"]`)?.focus();
    });

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close(true);
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open && shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (usesSheetLayout()) {
      setPopupStyle({});
      return;
    }
    const GAP = 8;
    // Roughly the height of the day panel; only used to decide whether to flip
    // the calendar above the field.
    const PANEL_HEIGHT = 380;
    function measure() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - GAP * 2);
      const left = Math.min(Math.max(GAP, rect.left), Math.max(GAP, window.innerWidth - width - GAP));
      const spaceBelow = window.innerHeight - rect.bottom - GAP * 2;
      const spaceAbove = rect.top - GAP * 2;
      const above = spaceBelow < PANEL_HEIGHT && spaceAbove > spaceBelow;
      const maxHeight = Math.max(200, Math.min(above ? spaceAbove : spaceBelow, window.innerHeight - GAP * 2));
      setPopupStyle({
        position: 'fixed',
        left: `${left}px`,
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
        overflowY: 'auto',
        ...(above
          ? { bottom: `${window.innerHeight - rect.top + GAP}px`, top: 'auto' }
          : { top: `${rect.bottom + GAP}px`, bottom: 'auto' })
      });
    }
    measure();
    function handleScroll(event: Event) {
      // Scrolling inside the calendar itself must not re-anchor it.
      if (popupRef.current?.contains(event.target as Node)) return;
      measure();
    }
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, panel]);

  useLayoutEffect(() => {
    if (!open || panel !== 'days' || !pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-date="${toIsoDate(cursorDateRef.current)}"]`)
      ?.focus();
  });

  function close(restoreFocus: boolean) {
    shouldRestoreFocusRef.current = restoreFocus;
    onOpenChange(false);
  }

  function choose(date: Date) {
    onChange(toIsoDate(date));
    close(true);
  }

  function moveCursor(nextDate: Date) {
    cursorDateRef.current = nextDate;
    setCursorDate(nextDate);
    setVisibleMonth(displayMonthOf(nextDate));
    pendingFocusRef.current = true;
  }

  function changeVisibleMonth(offset: number) {
    setVisibleMonth(addDisplayMonths(visibleMonth.year, visibleMonth.monthIndex, offset));
  }

  /** Move the calendar a whole year, keeping the day where the month allows. */
  function changeVisibleYear(offset: number) {
    const targetYear = visibleMonth.year + offset;
    const length = displayMonthLength(targetYear, visibleMonth.monthIndex);
    if (length <= 0) return;
    setVisibleMonth({ year: targetYear, monthIndex: visibleMonth.monthIndex });
    setYearPage(pageStart(targetYear));
    // The cursor's day is read in the *display* calendar: in Jalali mode the
    // Gregorian day-of-month is a different number.
    const day = Math.min(displayMonthDayOf(toIsoDate(cursorDateRef.current)).day, length);
    const start = displayMonthStart(targetYear, visibleMonth.monthIndex);
    const next = new Date(start.getFullYear(), start.getMonth(), day);
    cursorDateRef.current = next;
    setCursorDate(next);
  }

  function openYears() {
    setYearPage(pageStart(visibleMonth.year));
    setYearDraft('');
    setPanel('years');
    requestAnimationFrame(() => yearInputRef.current?.focus());
  }

  function pickYear(year: number) {
    const length = displayMonthLength(year, visibleMonth.monthIndex);
    if (length <= 0) return;
    setVisibleMonth({ year, monthIndex: visibleMonth.monthIndex });
    setPanel('months');
  }

  function pickMonth(monthIndex: number) {
    setVisibleMonth({ year: visibleMonth.year, monthIndex });
    setPanel('days');
    pendingFocusRef.current = true;
  }

  function submitYearDraft() {
    const digits = toLatinDigits(yearDraft).trim();
    const year = Number(digits);
    if (!digits || !Number.isInteger(year) || year < 1 || year > 9999) return;
    setYearPage(pageStart(year));
    pickYear(year);
  }

  function handleDateKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const cursor = cursorDateRef.current;
    let nextDate: Date | null = null;
    if (event.key === 'ArrowLeft') nextDate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    if (event.key === 'ArrowRight') nextDate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    if (event.key === 'ArrowUp') nextDate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
    if (event.key === 'ArrowDown') nextDate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const month = displayMonthOf(cursor);
      const step = event.key === 'PageUp' ? -1 : 1;
      const target = event.shiftKey
        ? { year: month.year + step, monthIndex: month.monthIndex }
        : addDisplayMonths(month.year, month.monthIndex, step);
      const start = displayMonthStart(target.year, target.monthIndex);
      const day = Math.min(
        displayMonthDayOf(toIsoDate(cursor)).day,
        displayMonthLength(target.year, target.monthIndex)
      );
      nextDate = new Date(start.getFullYear(), start.getMonth(), day);
    }
    if (nextDate) {
      event.preventDefault();
      moveCursor(nextDate);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(cursor);
    }
  }

  const yearPageYears = Array.from({ length: YEARS_PER_PAGE }, (_, index) => yearPage + index);
  const monthNames = Array.from({ length: 12 }, (_, index) => displayMonthName(index));

  return (
    <div ref={rootRef} className="date-picker">
      <label className={hideLabel ? 'date-picker__label visually-hidden' : 'date-picker__label'} id={`${id}-label`} htmlFor={id}>{label}</label>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="date-picker__trigger"
        aria-labelledby={`${id}-label`}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-expanded={open}
        aria-describedby={errorId}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        <span>{displayDate(value)}</span>
        <CalendarDays aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={popupRef}
          id={dialogId}
          role="dialog"
          aria-label={t('datePicker.select', { label })}
          className="date-picker__popup"
          style={popupStyle}
        >
          {panel === 'days' ? (
            <>
              <div className="date-picker__header date-picker__header--days">
                <button type="button" aria-label={t('datePicker.prevYear')} title={t('datePicker.prevYear')} onClick={() => changeVisibleYear(-1)}>
                  <DoubleChevron icon={PreviousIcon} />
                </button>
                <button type="button" aria-label={t('datePicker.prevMonth')} onClick={() => changeVisibleMonth(-1)}><PreviousIcon aria-hidden="true" /></button>
                <button
                  type="button"
                  className="date-picker__title"
                  aria-label={t('datePicker.chooseMonth')}
                  title={t('datePicker.chooseMonth')}
                  onClick={openYears}
                >
                  {monthHeading(visibleMonth.year, visibleMonth.monthIndex)}
                </button>
                <button type="button" aria-label={t('datePicker.nextMonth')} onClick={() => changeVisibleMonth(1)}><NextIcon aria-hidden="true" /></button>
                <button type="button" aria-label={t('datePicker.nextYear')} title={t('datePicker.nextYear')} onClick={() => changeVisibleYear(1)}>
                  <DoubleChevron icon={NextIcon} />
                </button>
              </div>
              <div role="grid" aria-label={monthHeading(visibleMonth.year, visibleMonth.monthIndex)} className="date-picker__calendar">
                <div role="row" className="date-picker__weekdays">
                  {weekdayHeadingsList().map((heading) => <span role="columnheader" key={heading}>{heading}</span>)}
                </div>
                <div role="rowgroup" className="date-picker__days">
                  {days.map((day) => {
                    const date = parseIsoDate(day.isoDate, today);
                    const selected = day.isoDate === value;
                    const current = day.isoDate === toIsoDate(today);
                    return (
                      <button
                        key={day.isoDate}
                        type="button"
                        role="gridcell"
                        data-date={day.isoDate}
                        tabIndex={day.isoDate === toIsoDate(cursorDate) ? 0 : -1}
                        aria-label={formatChineseDate(date)}
                        aria-selected={selected}
                        aria-current={current ? 'date' : undefined}
                        className={`date-picker__day${day.isCurrentMonth ? '' : ' date-picker__day--outside'}${selected ? ' date-picker__day--selected' : ''}${current ? ' date-picker__day--today' : ''}`}
                        onClick={() => choose(date)}
                        onKeyDown={(event) => handleDateKeyDown(event, date)}
                      >
                        {formatNumber(day.dayOfMonth)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}

          {panel === 'years' ? (
            <div className="date-picker__panel">
              <div className="date-picker__header date-picker__header--years">
                <button type="button" aria-label={t('datePicker.prevYears')} onClick={() => setYearPage(yearPage - YEARS_PER_PAGE)}>
                  <DoubleChevron icon={PreviousIcon} />
                </button>
                <strong>{t('datePicker.yearRange', {
                  from: formatNumber(yearPage, { useGrouping: false }),
                  to: formatNumber(yearPage + YEARS_PER_PAGE - 1, { useGrouping: false })
                })}</strong>
                <button type="button" aria-label={t('datePicker.nextYears')} onClick={() => setYearPage(yearPage + YEARS_PER_PAGE)}>
                  <DoubleChevron icon={NextIcon} />
                </button>
              </div>
              <div className="date-picker__year-input">
                <label htmlFor={`${id}-year`}>{t('datePicker.yearInput')}</label>
                <input
                  ref={yearInputRef}
                  id={`${id}-year`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={yearDraft}
                  onChange={(event) => setYearDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submitYearDraft();
                    }
                  }}
                />
                <button type="button" onClick={submitYearDraft}>{t('datePicker.go')}</button>
              </div>
              <div className="date-picker__years" role="group" aria-label={t('datePicker.chooseYear')}>
                {yearPageYears.map((year) => (
                  <button
                    key={year}
                    type="button"
                    aria-pressed={year === visibleMonth.year}
                    className={`date-picker__year${year === visibleMonth.year ? ' is-current' : ''}`}
                    onClick={() => pickYear(year)}
                  >
                    {formatNumber(year, { useGrouping: false })}
                  </button>
                ))}
              </div>
              <div className="date-picker__footer">
                <button type="button" onClick={() => setPanel('days')}>{t('datePicker.backToCalendar')}</button>
                <button type="button" onClick={() => choose(today)}>{t('datePicker.today')}</button>
              </div>
            </div>
          ) : null}

          {panel === 'months' ? (
            <div className="date-picker__panel">
              <div className="date-picker__header date-picker__header--years">
                <button type="button" aria-label={t('datePicker.prevYear')} onClick={() => pickYear(visibleMonth.year - 1)}>
                  <DoubleChevron icon={PreviousIcon} />
                </button>
                <strong>{formatNumber(visibleMonth.year, { useGrouping: false })}</strong>
                <button type="button" aria-label={t('datePicker.nextYear')} onClick={() => pickYear(visibleMonth.year + 1)}>
                  <DoubleChevron icon={NextIcon} />
                </button>
              </div>
              <div className="date-picker__months" role="group" aria-label={t('datePicker.chooseMonth')}>
                {monthNames.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={index === visibleMonth.monthIndex}
                    className={`date-picker__month${index === visibleMonth.monthIndex ? ' is-current' : ''}`}
                    onClick={() => pickMonth(index)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <div className="date-picker__footer">
                <button type="button" onClick={() => setPanel('years')}>{t('datePicker.chooseYear')}</button>
                <button type="button" onClick={() => setPanel('days')}>{t('datePicker.backToCalendar')}</button>
              </div>
            </div>
          ) : null}

          {panel === 'days' ? (
            <div className="date-picker__footer">
              <button type="button" aria-label={t('datePicker.clear')} onClick={() => { onChange(''); close(true); }}>{t('datePicker.clearShort')}</button>
              <button type="button" onClick={() => choose(today)}>{t('datePicker.today')}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
