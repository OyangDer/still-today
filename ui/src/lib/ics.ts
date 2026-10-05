import type { FeedEvent } from './model';
import { dayKey } from './time';

// An RFC 5545 reader sized for timetable and LMS feeds: VEVENT with RRULE/EXDATE/RECURRENCE-ID,
// DATE and DATE-TIME values in UTC, floating, IANA or Windows zones, and VTIMEZONE as a fallback.

type Wall = { y: number; m: number; d: number; h: number; mi: number; s: number };
type IcsTime =
  | { kind: 'date'; wall: Wall }
  | { kind: 'utc'; ms: number }
  | { kind: 'local'; wall: Wall; tzid: string | null };

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Component {
  type: string;
  props: Prop[];
  children: Component[];
}

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: IcsTime | null;
  byDay: { n: number; wd: number }[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
}

interface VEvent {
  uid: string;
  summary: string;
  location: string;
  url: string;
  status: string;
  start: IcsTime;
  end: IcsTime | null;
  durationMs: number | null;
  rule: Rule | null;
  exdates: IcsTime[];
  recurrenceId: IcsTime | null;
}

export interface ParsedFeed {
  name: string | null;
  events: FeedEvent[];
  /** Canvas assignment copies that were left out because the Canvas API owns them. */
  skippedAssignments: number;
}

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const WINDOWS_ZONES: Record<string, string> = {
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'W. Australia Standard Time': 'Australia/Perth',
  'Tasmania Standard Time': 'Australia/Hobart',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Singapore Standard Time': 'Asia/Singapore',
  'India Standard Time': 'Asia/Kolkata',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  UTC: 'UTC',
};

// ---- lexing ---------------------------------------------------------------------------------

function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, '').split(/\r\n|\n|\r/);
}

function parseLine(line: string): Prop | null {
  // The value starts at the first ':' outside a quoted parameter.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const part of head.slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: head[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

function parseComponents(text: string): Component {
  const root: Component = { type: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const line of unfold(text)) {
    if (!line) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      const child: Component = { type: prop.value.toUpperCase(), props: [], children: [] };
      stack[stack.length - 1].children.push(child);
      stack.push(child);
    } else if (prop.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1].props.push(prop);
    }
  }
  return root;
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c)).trim();
}

const first = (c: Component, name: string) => c.props.find((p) => p.name === name);

// ---- values ---------------------------------------------------------------------------------

function parseTime(prop: Prop | undefined, value = prop?.value): IcsTime | null {
  if (!prop || !value) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const wall: Wall = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  if (!m[4] || prop.params.VALUE === 'DATE') return { kind: 'date', wall };
  if (m[7]) return { kind: 'utc', ms: Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.mi, wall.s) };
  return { kind: 'local', wall, tzid: prop.params.TZID ?? null };
}

function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function parseRule(value: string | undefined, dtstart: Prop | undefined): Rule | null {
  if (!value) return null;
  const parts: Record<string, string> = {};
  for (const part of value.split(';')) {
    const [k, v] = part.split('=');
    if (k && v) parts[k.toUpperCase()] = v;
  }
  const freq = parts.FREQ as Rule['freq'];
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const list = (v: string | undefined) => (v ? v.split(',').map(Number).filter((n) => !Number.isNaN(n)) : []);
  return {
    freq,
    interval: Math.max(1, +(parts.INTERVAL ?? 1) || 1),
    count: parts.COUNT ? +parts.COUNT : null,
    until: parts.UNTIL && dtstart ? parseTime({ ...dtstart, params: { ...dtstart.params, VALUE: parts.UNTIL.includes('T') ? 'DATE-TIME' : 'DATE' } }, parts.UNTIL) : null,
    byDay: (parts.BYDAY ?? '')
      .split(',')
      .filter(Boolean)
      .map((token) => {
        const m = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token.trim());
        return m ? { n: m[1] ? +m[1] : 0, wd: WEEKDAYS.indexOf(m[2]) } : null;
      })
      .filter((x): x is { n: number; wd: number } => x !== null),
    byMonthDay: list(parts.BYMONTHDAY),
    byMonth: list(parts.BYMONTH),
    bySetPos: list(parts.BYSETPOS),
  };
}

// ---- time zones -----------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    try {
      formatters.set(
        tz,
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hourCycle: 'h23',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        }),
      );
    } catch {
      formatters.set(tz, null);
    }
  }
  return formatters.get(tz)!;
}

function offsetAt(utcMs: number, f: Intl.DateTimeFormat): number {
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = +part.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

interface Observance {
  start: Wall;
  offsetTo: number;
  offsetFrom: number;
  rule: Rule | null;
}

function parseOffset(value: string | undefined): number {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value?.trim() ?? '');
  if (!m) return 0;
  const ms = (+m[2] * 3600 + +m[3] * 60 + +(m[4] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function readZones(root: Component): Map<string, Observance[]> {
  const zones = new Map<string, Observance[]>();
  for (const z of root.children.flatMap((c) => c.children).filter((c) => c.type === 'VTIMEZONE')) {
    const id = first(z, 'TZID')?.value;
    if (!id) continue;
    const observances: Observance[] = [];
    for (const o of z.children) {
      const start = parseTime(first(o, 'DTSTART'));
      if (!start || start.kind === 'utc') continue;
      observances.push({
        start: start.wall,
        offsetTo: parseOffset(first(o, 'TZOFFSETTO')?.value),
        offsetFrom: parseOffset(first(o, 'TZOFFSETFROM')?.value),
        rule: parseRule(first(o, 'RRULE')?.value, first(o, 'DTSTART')),
      });
    }
    zones.set(id, observances);
  }
  return zones;
}

function wallMs(w: Wall): number {
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
}

function toWall(ms: number): Wall {
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

/** The UTC offset a VTIMEZONE gives a wall-clock time: the latest observance onset before it wins. */
function vtimezoneOffset(observances: Observance[], wall: Wall): number {
  const target = wallMs(wall);
  let best: { at: number; offset: number } | null = null;
  for (const o of observances) {
    const onsets = o.rule ? yearlyOnsets(o, wall.y) : [wallMs(o.start)];
    for (const at of onsets) if (at <= target && (!best || at > best.at)) best = { at, offset: o.offsetTo };
  }
  if (best) return best.offset;
  return observances[0]?.offsetFrom ?? 0;
}

function yearlyOnsets(o: Observance, year: number): number[] {
  const out: number[] = [];
  for (const y of [year - 1, year]) {
    if (y < o.start.y) continue;
    const months = o.rule!.byMonth.length ? o.rule!.byMonth : [o.start.m];
    for (const m of months) {
      for (const d of daysInMonthFor(o.rule!, y, m, o.start.d)) out.push(Date.UTC(y, m - 1, d, o.start.h, o.start.mi, o.start.s));
    }
  }
  return out;
}

function zoned(wall: Wall, tzid: string | null, zones: Map<string, Observance[]>): number {
  if (!tzid) return new Date(wall.y, wall.m - 1, wall.d, wall.h, wall.mi, wall.s).getTime();
  const iana = formatter(tzid) ? tzid : WINDOWS_ZONES[tzid];
  const f = iana ? formatter(iana) : null;
  const naive = wallMs(wall);
  if (f) {
    const guess = naive - offsetAt(naive, f);
    return naive - offsetAt(guess, f);
  }
  const observances = zones.get(tzid);
  if (observances?.length) return naive - vtimezoneOffset(observances, wall);
  return new Date(wall.y, wall.m - 1, wall.d, wall.h, wall.mi, wall.s).getTime();
}

function instant(t: IcsTime, zones: Map<string, Observance[]>): number {
  if (t.kind === 'utc') return t.ms;
  if (t.kind === 'date') return new Date(t.wall.y, t.wall.m - 1, t.wall.d).getTime();
  return zoned(t.wall, t.tzid, zones);
}

// ---- recurrence -----------------------------------------------------------------------------

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function weekdayOf(y: number, m: number, d: number): number {
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Days of one month that a MONTHLY/YEARLY rule selects, before BYSETPOS. */
function daysInMonthFor(rule: Rule, y: number, m: number, defaultDay: number): number[] {
  const count = daysIn(y, m);
  let days: number[];
  if (rule.byDay.length) {
    days = [];
    for (const { n, wd } of rule.byDay) {
      const matches: number[] = [];
      for (let d = 1; d <= count; d++) if (weekdayOf(y, m, d) === wd) matches.push(d);
      if (n === 0) days.push(...matches);
      else {
        const pick = n > 0 ? matches[n - 1] : matches[matches.length + n];
        if (pick) days.push(pick);
      }
    }
    if (rule.byMonthDay.length) {
      const allowed = new Set(rule.byMonthDay.map((d) => (d < 0 ? count + d + 1 : d)));
      days = days.filter((d) => allowed.has(d));
    }
  } else if (rule.byMonthDay.length) {
    days = rule.byMonthDay.map((d) => (d < 0 ? count + d + 1 : d)).filter((d) => d >= 1 && d <= count);
  } else {
    days = defaultDay <= count ? [defaultDay] : [];
  }
  days = [...new Set(days)].sort((a, b) => a - b);
  if (rule.bySetPos.length) {
    days = rule.bySetPos.map((p) => (p > 0 ? days[p - 1] : days[days.length + p])).filter((d): d is number => d !== undefined);
  }
  return days;
}

/** Occurrence start walls, in order, up to `limitMs` of naive wall time. */
function* expandWalls(start: Wall, rule: Rule, limitMs: number): Generator<Wall> {
  const at = (y: number, m: number, d: number): Wall => ({ y, m, d, h: start.h, mi: start.mi, s: start.s });
  const startMs = wallMs(start);
  let guard = 0;
  if (rule.freq === 'DAILY') {
    for (let i = 0; guard++ < 20000; i += rule.interval) {
      const w = toWall(startMs + i * 86400000);
      if (wallMs(w) > limitMs) return;
      if (rule.byMonth.length && !rule.byMonth.includes(w.m)) continue;
      if (rule.byDay.length && !rule.byDay.some((b) => b.wd === weekdayOf(w.y, w.m, w.d))) continue;
      yield w;
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length ? [...new Set(rule.byDay.map((b) => b.wd))].sort() : [weekdayOf(start.y, start.m, start.d)];
    const weekStart = startMs - weekdayOf(start.y, start.m, start.d) * 86400000;
    for (let week = 0; guard++ < 5000; week += rule.interval) {
      for (const wd of days) {
        const w = toWall(weekStart + (week * 7 + wd) * 86400000);
        if (wallMs(w) > limitMs) return;
        if (wallMs(w) < startMs) continue;
        if (rule.byMonth.length && !rule.byMonth.includes(w.m)) continue;
        yield w;
      }
    }
  } else {
    const monthly = rule.freq === 'MONTHLY';
    for (let i = 0; guard++ < 5000; i += rule.interval) {
      const periodMonths = monthly
        ? [{ y: start.y + Math.floor((start.m - 1 + i) / 12), m: ((start.m - 1 + i) % 12) + 1 }]
        : (rule.byMonth.length ? rule.byMonth : [start.m]).map((m) => ({ y: start.y + i, m }));
      if (wallMs(at(periodMonths[0].y, periodMonths[0].m, 1)) > limitMs) return;
      for (const { y, m } of periodMonths) {
        if (monthly && rule.byMonth.length && !rule.byMonth.includes(m)) continue;
        for (const d of daysInMonthFor(rule, y, m, start.d)) {
          const w = at(y, m, d);
          if (wallMs(w) < startMs) continue;
          if (wallMs(w) > limitMs) return;
          yield w;
        }
      }
    }
  }
}

// ---- assembly -------------------------------------------------------------------------------

function readEvent(c: Component): VEvent | null {
  const uid = first(c, 'UID')?.value.trim();
  const start = parseTime(first(c, 'DTSTART'));
  if (!uid || !start) return null;
  const dtend = first(c, 'DTEND');
  return {
    uid,
    summary: unescapeText(first(c, 'SUMMARY')?.value ?? ''),
    location: unescapeText(first(c, 'LOCATION')?.value ?? ''),
    url: (first(c, 'URL')?.value ?? '').trim(),
    status: (first(c, 'STATUS')?.value ?? '').trim().toUpperCase(),
    start,
    end: parseTime(dtend),
    durationMs: parseDuration(first(c, 'DURATION')?.value),
    rule: parseRule(first(c, 'RRULE')?.value, first(c, 'DTSTART')),
    exdates: c.props
      .filter((p) => p.name === 'EXDATE')
      .flatMap((p) => p.value.split(',').map((v) => parseTime(p, v)))
      .filter((t): t is IcsTime => t !== null),
    recurrenceId: parseTime(first(c, 'RECURRENCE-ID')),
  };
}

/** Canvas puts assignment copies in its calendar feed; the API is their source of truth. */
export function isCanvasAssignment(uid: string, url: string): boolean {
  return uid.startsWith('event-assignment-') || /\/courses\/\d+\/assignments\/\d+/.test(url);
}

function occurrenceStamp(t: IcsTime, zones: Map<string, Observance[]>): string {
  return t.kind === 'date' ? `${t.wall.y}${t.wall.m}${t.wall.d}` : String(instant(t, zones));
}

export function parseFeed(text: string, rangeStart: Date, rangeEnd: Date, skipAssignments: boolean): ParsedFeed {
  const root = parseComponents(text);
  const calendar = root.children.find((c) => c.type === 'VCALENDAR') ?? root;
  const zones = readZones(root);
  const name = first(calendar, 'X-WR-CALNAME')?.value;
  const events = calendar.children.filter((c) => c.type === 'VEVENT').map(readEvent).filter((e): e is VEvent => e !== null);

  const overrides = new Map<string, VEvent>();
  for (const e of events) if (e.recurrenceId) overrides.set(`${e.uid}|${occurrenceStamp(e.recurrenceId, zones)}`, e);

  const out: FeedEvent[] = [];
  let skipped = 0;
  const from = rangeStart.getTime();
  const to = rangeEnd.getTime();

  const emit = (e: VEvent, startT: IcsTime, key: string) => {
    if (e.status === 'CANCELLED') return;
    const allDay = startT.kind === 'date';
    const startMs = instant(startT, zones);
    let endMs: number | null = null;
    let end: string | null = null;
    if (allDay) {
      // All-day spans count calendar days, so a DST change inside them cannot shift the end.
      const days = e.end ? Math.round((wallMs(e.end.kind === 'utc' ? toWall(e.end.ms) : e.end.wall) - wallMs(e.start.kind === 'utc' ? toWall(e.start.ms) : e.start.wall)) / 86400000) : e.durationMs !== null ? Math.round(e.durationMs / 86400000) : 0;
      if (days > 1) {
        const w = (startT as { wall: Wall }).wall;
        const endDate = new Date(w.y, w.m - 1, w.d + days);
        endMs = endDate.getTime();
        end = dayKey(endDate);
      }
    } else if (e.end) {
      endMs = startMs + (instant(e.end, zones) - instant(e.start, zones));
      end = new Date(endMs).toISOString();
    } else if (e.durationMs !== null) {
      endMs = startMs + e.durationMs;
      end = new Date(endMs).toISOString();
    }
    const lastMs = endMs ?? startMs + (allDay ? 86400000 : 0);
    if (lastMs < from || startMs > to) return;
    out.push({
      key,
      title: e.summary || '—',
      start: allDay ? dayKey(new Date(startMs)) : new Date(startMs).toISOString(),
      end,
      allDay,
      location: e.location,
    });
  };

  for (const e of events) {
    if (e.recurrenceId) continue;
    if (skipAssignments && isCanvasAssignment(e.uid, e.url)) {
      skipped++;
      continue;
    }
    if (!e.rule) {
      emit(e, e.start, e.uid);
      continue;
    }
    const excluded = new Set(e.exdates.map((t) => occurrenceStamp(t, zones)));
    const tzid = e.start.kind === 'local' ? e.start.tzid : null;
    const startWall = e.start.kind === 'utc' ? toWall(e.start.ms) : e.start.wall;
    const limit = to + 2 * 86400000;
    const untilMs = e.rule.until ? instant(e.rule.until, zones) : null;
    let n = 0;
    for (const w of expandWalls(startWall, e.rule, limit)) {
      const t: IcsTime =
        e.start.kind === 'date' ? { kind: 'date', wall: w } : e.start.kind === 'utc' ? { kind: 'utc', ms: wallMs(w) } : { kind: 'local', wall: w, tzid };
      const ms = instant(t, zones);
      if (untilMs !== null && ms > untilMs + (e.start.kind === 'date' ? 86399999 : 0)) break;
      n++;
      if (e.rule.count !== null && n > e.rule.count) break;
      const stamp = occurrenceStamp(t, zones);
      if (excluded.has(stamp)) continue;
      const key = `${e.uid}|${stamp}`;
      const override = overrides.get(key);
      if (override) emit(override, override.start, key);
      else emit(e, t, key);
    }
  }
  // Overrides whose master is missing still describe a real occurrence.
  for (const [key, o] of overrides) if (!out.some((x) => x.key === key) && !events.some((e) => e.uid === o.uid && !e.recurrenceId)) emit(o, o.start, key);

  out.sort((a, b) => a.start.localeCompare(b.start));
  return { name: name ? unescapeText(name) : null, events: out, skippedAssignments: skipped };
}
