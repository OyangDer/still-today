// Local-calendar helpers. A "day key" is the local YYYY-MM-DD of a moment; all-day values are
// stored as day keys so they never drift across time zones.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
}

export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Monday-first weekday index, 0..6. */
export function weekdayMon(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** The 42 days shown by a Monday-first month grid. */
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -weekdayMon(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Parses ISO strings, including .NET's seven-digit fractions. */
export function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.replace(/(\.\d{3})\d+/, '$1');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function uid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
