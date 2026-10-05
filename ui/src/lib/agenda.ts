import type { Assignment, Data, Feed, Task } from './model';
import { addDays, dayKey, fromDayKey, parseIso, startOfDay } from './time';

// Read models for the views: one list of things to do, one timeline of things to attend.

export interface TodoItem {
  key: string;
  kind: 'canvas' | 'local';
  title: string;
  course: string | null;
  due: Date | null;
  /** False for a date-only personal task: it is due at the end of that day. */
  timed: boolean;
  done: boolean;
  doneAt: string | null;
  updated: boolean;
  /** The course's Canvas colour, when it has one. */
  color: string | null;
  source: Assignment | Task;
}

export interface Occurrence {
  key: string;
  kind: 'event' | 'feed' | 'deadline' | 'token';
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  location: string;
  /** Feed name, course code, or null. */
  label: string | null;
  /** The course's Canvas colour, when it has one. */
  color: string | null;
  /** The todo a deadline row opens. */
  todo?: TodoItem;
  feedId?: string;
}

export function todos(data: Data): TodoItem[] {
  const out: TodoItem[] = [];
  for (const a of Object.values(data.assignments)) {
    if (a.hidden || data.settings.hiddenCourses.includes(a.courseId)) continue;
    out.push({
      key: `a:${a.id}`,
      kind: 'canvas',
      title: a.title,
      course: a.course,
      due: parseIso(a.due),
      timed: true,
      done: a.done,
      doneAt: a.doneAt,
      updated: a.updated,
      color: data.canvas.colors[a.courseId] ?? null,
      source: a,
    });
  }
  for (const t of Object.values(data.tasks)) {
    const due = parseIso(t.due);
    out.push({
      key: `t:${t.id}`,
      kind: 'local',
      title: t.title,
      course: null,
      due: due && !t.timed ? new Date(due.getFullYear(), due.getMonth(), due.getDate(), 23, 59, 59) : due,
      timed: t.timed,
      done: t.done,
      doneAt: t.doneAt,
      updated: false,
      color: null,
      source: t,
    });
  }
  return out;
}

export function byDue(a: TodoItem, b: TodoItem): number {
  if (a.due && b.due) return a.due.getTime() - b.due.getTime() || a.title.localeCompare(b.title);
  if (a.due) return -1;
  if (b.due) return 1;
  return a.title.localeCompare(b.title);
}

/** The courses some work comes from, for a course filter, so no choice there is ever empty. */
export function coursesOf(items: TodoItem[]): { code: string; color: string | null }[] {
  const seen = new Map<string, string | null>();
  for (const i of items) if (i.course) seen.set(i.course, i.color);
  return [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([code, color]) => ({ code, color }));
}

/** Open work still ahead, soonest first. Overdue work is the task list's job, not the glance. */
export function upcomingDeadlines(items: TodoItem[], now: Date): TodoItem[] {
  return items.filter((t) => !t.done && t.due && t.due > now).sort(byDue);
}

export type Bucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'undated';

export function bucketOf(item: TodoItem, now: Date): Bucket {
  if (!item.due) return 'undated';
  if (item.due < now) return 'overdue';
  const today = startOfDay(now);
  const day = startOfDay(item.due).getTime();
  if (day === today.getTime()) return 'today';
  if (day === addDays(today, 1).getTime()) return 'tomorrow';
  if (day < addDays(today, 7).getTime()) return 'week';
  return 'later';
}

/**
 * A feed from the connected Canvas itself. Its events now come straight from Canvas, so the feed is
 * neither synced nor shown.
 */
export function isCanvasFeed(data: Data, feed: Feed): boolean {
  return data.canvas.host !== null && feed.host === data.canvas.host;
}

export function occurrences(data: Data, from: Date, to: Date): Occurrence[] {
  const out: Occurrence[] = [];
  const inRange = (start: Date, end: Date | null) => start < to && (end ?? start) >= from;
  const hidden = new Set(data.hiddenEvents);

  for (const e of Object.values(data.events)) {
    const start = e.allDay ? fromDayKey(e.start) : parseIso(e.start);
    if (!start) continue;
    const end = e.end ? (e.allDay ? fromDayKey(e.end) : parseIso(e.end)) : null;
    if (inRange(start, end)) out.push({ key: `e:${e.id}`, kind: 'event', title: e.title, start, end, allDay: e.allDay, location: e.location, label: null, color: null });
  }
  if (data.canvas.host) {
    for (const e of data.canvasEvents) {
      const key = `c:${e.id}`;
      if (hidden.has(key) || (e.courseId && data.settings.hiddenCourses.includes(e.courseId))) continue;
      const start = e.allDay ? fromDayKey(e.start) : parseIso(e.start);
      if (!start) continue;
      const end = e.end ? parseIso(e.end) : null;
      const color = e.courseId ? (data.canvas.colors[e.courseId] ?? null) : null;
      if (inRange(start, end)) out.push({ key, kind: 'feed', title: e.title, start, end, allDay: e.allDay, location: e.location, label: e.course, color });
    }
  }
  for (const feed of data.feeds) {
    if (isCanvasFeed(data, feed)) continue;
    for (const e of data.feedEvents[feed.id] ?? []) {
      const key = `f:${feed.id}:${e.key}`;
      if (hidden.has(key)) continue;
      const start = e.allDay ? fromDayKey(e.start) : parseIso(e.start);
      if (!start) continue;
      const end = e.end ? (e.allDay ? fromDayKey(e.end) : parseIso(e.end)) : null;
      if (inRange(start, end)) out.push({ key, kind: 'feed', title: e.title, start, end, allDay: e.allDay, location: e.location, label: feed.name, color: null, feedId: feed.id });
    }
  }
  for (const t of todos(data)) {
    if (!t.due || t.done || !inRange(t.due, null)) continue;
    out.push({ key: `d:${t.key}`, kind: 'deadline', title: t.title, start: t.due, end: null, allDay: !t.timed, location: '', label: t.course, color: t.color, todo: t });
  }
  if (data.canvas.host && data.canvas.tokenExpires) {
    const start = fromDayKey(data.canvas.tokenExpires);
    if (inRange(start, null)) out.push({ key: 'token', kind: 'token', title: '', start, end: null, allDay: true, location: '', label: null, color: null });
  }
  return out.sort(byStart);
}

function byStart(a: Occurrence, b: Occurrence): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title);
}

/** Everything touching one local day: all-day items first, then by time. */
export function dayAgenda(data: Data, day: Date): Occurrence[] {
  const start = startOfDay(day);
  const end = addDays(start, 1);
  return occurrences(data, start, end).filter((o) => {
    if (o.allDay && o.end) return o.start < end && o.end > start;
    return o.start >= start && o.start < end || (o.end !== null && o.start < start && o.end > start);
  });
}

/** Timed events from the one in progress onwards, over the next two months. */
export function upcomingEvents(data: Data, now: Date): Occurrence[] {
  return occurrences(data, now, addDays(now, 60)).filter(
    (o) => (o.kind === 'event' || o.kind === 'feed') && !o.allDay && (o.start >= now || (o.end !== null && o.end > now)),
  );
}

export interface DayMarks {
  events: number;
  deadlines: number;
}

export function monthMarks(data: Data, days: Date[]): Map<string, DayMarks> {
  const marks = new Map<string, DayMarks>();
  const from = startOfDay(days[0]);
  const to = addDays(startOfDay(days[days.length - 1]), 1);
  for (const o of occurrences(data, from, to)) {
    const lastDay = o.allDay && o.end ? addDays(o.end, -1) : o.start;
    for (let d = startOfDay(o.start); d <= lastDay && d < to; d = addDays(d, 1)) {
      if (d < from) continue;
      const key = dayKey(d);
      const m = marks.get(key) ?? { events: 0, deadlines: 0 };
      if (o.kind === 'deadline' || o.kind === 'token') m.deadlines++;
      else m.events++;
      marks.set(key, m);
    }
  }
  return marks;
}

export function focusSeconds(data: Data, task: string | null, since?: Date): number {
  return data.focus
    .filter((s) => (task === null || s.task === task) && (!since || (parseIso(s.start) ?? since) >= since))
    .reduce((sum, s) => sum + s.seconds, 0);
}
