// Jalali (Solar Hijri) calendar math and Persian formatting.
//
// The app stores every date as an ISO Gregorian string; this module only
// converts for display and month-grid navigation. The conversion is the
// well-known Khayyam/Birashk algorithm (as implemented by jalaali-js), which is
// exact for the supported year range and needs no Intl calendar data.

export type JalaliDate = { year: number; month: number; day: number };

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
  2192, 2262, 2324, 2394, 2456, 3178
];

const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

// Indexed by getDay(): 0 = Sunday … 6 = Saturday.
const PERSIAN_WEEKDAYS = [
  'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'
];
const PERSIAN_WEEKDAYS_SHORT = ['یک', 'دو', 'سه', 'چهار', 'پنج', 'جمعه', 'شنبه'];

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

function div(a: number, b: number) {
  return Math.trunc(a / b);
}

function mod(a: number, b: number) {
  return a - Math.trunc(a / b) * b;
}

function jalCal(jy: number, withoutLeap: boolean) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm = 0;
  let jump = 0;
  let leap = 0;
  let n: number;

  if (jy < jp || jy >= BREAKS[bl - 1]) throw new RangeError(`Invalid Jalali year ${jy}`);

  for (let i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;

  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (!withoutLeap) {
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
  }

  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): JalaliDate {
  const gregorian = d2g(jdn);
  let jy = gregorian.gy - 621;
  const r = jalCal(jy, false);
  const jdn1f = g2d(gregorian.gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      return { year: jy, month: 1 + div(k, 31), day: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { year: jy, month: 7 + div(k, 30), day: mod(k, 30) + 1 };
}

export function isLeapJalaliYear(year: number): boolean {
  return jalCal(year, false).leap === 0;
}

export function jalaliMonthLength(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  return isLeapJalaliYear(year) ? 30 : 29;
}

/** Convert a local Date (its year/month/day) to a Jalali date. */
export function toJalali(date: Date): JalaliDate {
  return d2j(g2d(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

/** Build a local Date at midnight for a Jalali date. */
export function fromJalali(year: number, month: number, day: number): Date {
  const gregorian = d2g(j2d(year, month, day));
  return new Date(gregorian.gy, gregorian.gm - 1, gregorian.gd);
}

export function jalaliMonthName(month: number): string {
  return PERSIAN_MONTHS[month - 1] ?? '';
}

export function jalaliWeekdayName(dayOfWeek: number, short = false): string {
  return (short ? PERSIAN_WEEKDAYS_SHORT : PERSIAN_WEEKDAYS)[dayOfWeek] ?? '';
}

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

export function toLatinDigits(value: string): string {
  // Persian (۰-۹) and Arabic-Indic (٠-٩) digits both arrive from keyboards and
  // pasted text; the year box and every numeric field accept either.
  return value
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

export type JalaliFormat = 'full' | 'long' | 'medium' | 'short' | 'monthYear' | 'numeric';

/**
 * Format a Gregorian Date in the Jalali calendar. Numbers use Persian digits
 * unless `latinDigits` is set (machine-readable contexts).
 */
export function formatJalali(
  date: Date,
  format: JalaliFormat = 'long',
  { latinDigits = false }: { latinDigits?: boolean } = {}
): string {
  const { year, month, day } = toJalali(date);
  const num = (value: number) => (latinDigits ? String(value) : toPersianDigits(value));
  const monthName = jalaliMonthName(month);
  switch (format) {
    case 'full':
      return `${jalaliWeekdayName(date.getDay())} ${num(day)} ${monthName} ${num(year)}`;
    case 'long':
      return `${num(day)} ${monthName} ${num(year)}`;
    case 'medium':
      return `${num(day)} ${monthName} ${num(year)}`;
    case 'short':
      return `${num(day)} ${monthName}`;
    case 'monthYear':
      return `${monthName} ${num(year)}`;
    case 'numeric':
      return `${num(year)}/${num(month).padStart(2, latinDigits ? '0' : '۰')}/${num(day).padStart(2, latinDigits ? '0' : '۰')}`;
  }
}
