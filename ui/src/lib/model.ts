/** Light, dark, or worked out: from the wallpaper behind Aura on Windows, else from the system. */
export type Mode = 'light' | 'dark' | 'auto';
/** The single choice earlier saves made, Aura standing beside light and dark. */
type Theme = 'aura' | 'light' | 'dark';

/** Shorter focus sessions are not kept: not when they end, not from an import, not from an old save. */
export const MIN_FOCUS_SECONDS = 10 * 60;
export type Lang = 'zh' | 'en';

export interface Settings {
  /** The desktop showing through the widget, in light or dark as `mode` says. */
  aura: boolean;
  /** Behind Aura on macOS 26: airy Liquid Glass, as the system's widgets wear it, else Mist, the Windows widget's Aura. */
  clearGlass: boolean;
  mode: Mode;
  lang: Lang;
  topmost: boolean;
  locked: boolean;
  /** Last focus length chosen, so the next session starts from it. */
  focusSeconds: number;
  /** Windows notifications for released grades and new announcements. */
  notifications: boolean;
  /** Course id → the name the student gave the course here, shown in place of Canvas's. */
  courseNames: Record<string, string>;
  /** Ids of courses the student has hidden: still synced, so showing one again loses nothing, but shown nowhere. */
  hiddenCourses: string[];
}

export interface CanvasState {
  host: string | null;
  user: string | null;
  /** Day key the personal access token stops working: read from Canvas, else as the user recorded it. */
  tokenExpires: string | null;
  /** Whether Canvas gave the expiry, so it is shown rather than asked for; null there means the token never expires. */
  tokenExpiresFromCanvas: boolean;
  lastSync: string | null;
  error: SyncError | null;
  /** Course id → the colour the user gave the course in Canvas. */
  colors: Record<string, string>;
  /** Course id → the course's name as Canvas gives it (the student's Canvas nickname, else its code). */
  courses: Record<string, string>;
  /** Where news starts: the first pass sets it, so what was already posted then is not new. */
  announcementsSeen: string | null;
  /** When the announcement list was last open: the overview counts only what came after. */
  announcementsViewed: string | null;
}

export type SyncError = 'token' | 'network' | 'partial';

export interface Feed {
  id: string;
  name: string;
  host: string;
  lastSync: string | null;
  error: SyncError | null;
}

/** How Canvas takes the work: through Canvas, on paper, or not at all. */
export type HandIn = 'online' | 'paper' | 'none';

export interface Submission {
  state: string | null;
  submittedAt: string | null;
  late: boolean;
  missing: boolean;
  excused: boolean;
  /** Null while Canvas holds the grade back; absent from copies saved before grades were tracked. */
  score?: number | null;
  grade?: string | null;
}

export interface Assignment {
  id: string;
  courseId: string;
  course: string;
  title: string;
  /** ISO instant, or null when Canvas has no due date. */
  due: string | null;
  /** When the assignment unlocks and locks on Canvas (ISO instants), if it has such a window. */
  opens: string | null;
  closes: string | null;
  url: string | null;
  points: number | null;
  quiz: boolean;
  description: string | null;
  /** Absent from copies saved before it was tracked; they read as online. */
  handIn?: HandIn;
  submission: Submission | null;
  /** Last Canvas submission.workflow_state this app saw. */
  canvasState: string | null;
  done: boolean;
  doneAt: string | null;
  /** Who decided the done state. Canvas never overrides a decision the user made. */
  doneBy: 'canvas' | 'user' | null;
  /** Canvas changed it since the user last opened it. */
  updated: boolean;
  hidden: boolean;
}

export interface Task {
  id: string;
  title: string;
  /** An ISO instant when timed; without a time a day key (older saves: that day's local midnight as an instant). Read through taskDue(). */
  due: string | null;
  timed: boolean;
  notes: string;
  done: boolean;
  doneAt: string | null;
  created: string;
}

export interface LocalEvent {
  id: string;
  title: string;
  /** Day key when allDay, otherwise an ISO instant. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string;
}

export interface FeedEvent {
  key: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string;
}

/** A course or personal event on the user's Canvas calendar. */
export interface CanvasEvent {
  id: string;
  title: string;
  /** Day key when allDay, otherwise an ISO instant. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string;
  /** Null for the user's own Canvas events. */
  courseId: string | null;
  course: string | null;
}

export interface Announcement {
  id: string;
  title: string;
  courseId: string;
  course: string;
  postedAt: string;
  author: string | null;
  /** Teacher-authored HTML, shown through sanitize(). */
  message: string | null;
  url: string | null;
  /** Read on the Canvas web, or opened here. */
  read: boolean;
}

export interface FocusSession {
  id: string;
  /** 'a:<canvas id>' or 't:<task id>', or null for an unlinked session. */
  task: string | null;
  title: string | null;
  start: string;
  seconds: number;
  completed: boolean;
}

export interface TimerState {
  task: string | null;
  duration: number;
  /** Epoch ms the running timer ends; null while paused. */
  endsAt: number | null;
  /** Seconds left, meaningful while paused. */
  remaining: number;
  startedAt: string;
}

export interface Data {
  v: 1;
  settings: Settings;
  canvas: CanvasState;
  feeds: Feed[];
  assignments: Record<string, Assignment>;
  tasks: Record<string, Task>;
  events: Record<string, LocalEvent>;
  feedEvents: Record<string, FeedEvent[]>;
  canvasEvents: CanvasEvent[];
  announcements: Announcement[];
  hiddenEvents: string[];
  focus: FocusSession[];
  timer: TimerState | null;
}

export function emptyData(lang: Lang): Data {
  return {
    v: 1,
    settings: { aura: true, clearGlass: true, mode: 'auto', lang, topmost: false, locked: false, focusSeconds: 25 * 60, notifications: true, courseNames: {}, hiddenCourses: [] },
    canvas: { host: null, user: null, tokenExpires: null, tokenExpiresFromCanvas: false, lastSync: null, error: null, colors: {}, courses: {}, announcementsSeen: null, announcementsViewed: null },
    feeds: [],
    assignments: {},
    tasks: {},
    events: {},
    feedEvents: {},
    canvasEvents: [],
    announcements: [],
    hiddenEvents: [],
    focus: [],
    timer: null,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** A saved object, or an empty one in place of anything else. */
const record = <T>(v: unknown): Record<string, T> => (isRecord(v) ? (v as Record<string, T>) : {});
/** A saved list of objects, or an empty one, without the holes (nulls) a damaged file can have. */
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v.filter(isRecord) as T[]) : []);
/** A saved map of objects (tasks, events, assignments), without the holes. */
const entries = <T>(v: unknown): Record<string, T> =>
  Object.fromEntries(Object.entries(record(v)).filter(([, item]) => isRecord(item))) as Record<string, T>;

/** A timer that can run: anything less (a hand-edited file, say) showed NaN:NaN and kept a NaN session. */
function timer(v: unknown): TimerState | null {
  if (!isRecord(v)) return null;
  const t = v as Partial<TimerState>;
  const runs = Number.isFinite(t.duration) && Number.isFinite(t.remaining) && typeof t.startedAt === 'string' && (t.endsAt === null || Number.isFinite(t.endsAt));
  return runs ? (t as TimerState) : null;
}

/**
 * Fills fields added after a file was written, so older saves keep loading. What readSaved lets through
 * from a damaged file (a setting of the wrong kind, a hole in a list) falls back to its empty value: a
 * null list left the widget blank at every start, and a language other than zh or en stopped it
 * starting at all.
 */
export function normalize(raw: Partial<Data>, lang: Lang): Data {
  const base = emptyData(lang);
  const settings = { ...base.settings, ...appearance(record(raw.settings)) };
  const canvas = { ...base.canvas, ...record(raw.canvas) };
  const seconds = settings.focusSeconds;
  return {
    ...base,
    ...raw,
    v: 1,
    settings: {
      ...settings,
      lang: settings.lang === 'zh' || settings.lang === 'en' ? settings.lang : lang,
      focusSeconds: Number.isFinite(seconds) && seconds >= 1 && seconds <= 10 * 3600 ? seconds : base.settings.focusSeconds,
      courseNames: record(settings.courseNames),
      hiddenCourses: Array.isArray(settings.hiddenCourses) ? settings.hiddenCourses.filter((id) => typeof id === 'string') : [],
    },
    canvas: { ...canvas, colors: record(canvas.colors), courses: record(canvas.courses) },
    feeds: list(raw.feeds),
    assignments: entries(raw.assignments),
    tasks: entries(raw.tasks),
    events: entries(raw.events),
    canvasEvents: list(raw.canvasEvents),
    announcements: list(raw.announcements),
    focus: list<FocusSession>(raw.focus).filter((s) => s.seconds >= MIN_FOCUS_SECONDS),
    timer: timer(raw.timer),
    hiddenEvents: padHiddenKeys(raw.hiddenEvents),
    feedEvents: padFeedKeys(raw.feedEvents),
  };
}

/**
 * Up to 0.2.3 an all-day occurrence's key ended in its date without zero padding, so 11 January and
 * 1 November both read "2026111". Keys are padded now; these give an old key its padded readings,
 * none when it is not an all-day stamp at all (a bare UID, an instant in milliseconds).
 */
function paddedKeys(key: string): string[] {
  const m = /^(f:[^:]+:.+\|)(\d{4})(\d{2,3})$/.exec(key);
  if (!m) return [];
  const [, head, year, rest] = m;
  const readings = rest.length === 2 ? [[rest[0], rest[1]]] : [[rest[0], rest.slice(1)], [rest.slice(0, 2), rest[2]]];
  return readings
    .filter(([month, day]) => +month >= 1 && +month <= 12 && +day >= 1 && +day <= 31)
    .map(([month, day]) => `${head}${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`);
}

/** Where an old hidden key could be read two ways both stay hidden, as both were before. */
function padHiddenKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const out = new Set<string>();
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const padded = paddedKeys(key);
    if (padded.length) for (const k of padded) out.add(k);
    else out.add(key);
  }
  return [...out];
}

/** The next sync rewrites the stored feed; until then its keys must match the hidden ones. */
function padFeedKeys(feeds: unknown): Record<string, FeedEvent[]> {
  if (!feeds || typeof feeds !== 'object' || Array.isArray(feeds)) return {};
  const out: Record<string, FeedEvent[]> = {};
  for (const [id, events] of Object.entries(feeds as Record<string, unknown>)) {
    if (!Array.isArray(events)) continue;
    out[id] = (events.filter(isRecord) as unknown as FeedEvent[]).map((e) => {
      if (typeof e?.key !== 'string') return e;
      const padded = paddedKeys(`f:${id}:${e.key}`);
      if (!padded.length) return e;
      // Its own start day says which reading was meant; an occurrence moved elsewhere takes the first.
      const day = typeof e.start === 'string' ? e.start.slice(0, 10).replace(/-/g, '') : '';
      const chosen = padded.find((k) => k.endsWith(`|${day}`)) ?? padded[0];
      return { ...e, key: chosen.slice(`f:${id}:`.length) };
    });
  }
  return out;
}

/** Aura on its own was the dark or light that suited the wallpaper; light and dark were solid. */
export const THEMES: Record<Theme, Pick<Settings, 'aura' | 'mode'>> = {
  aura: { aura: true, mode: 'auto' },
  light: { aura: false, mode: 'light' },
  dark: { aura: false, mode: 'dark' },
};

function appearance(saved: Partial<Settings> & { theme?: Theme } = {}): Partial<Settings> {
  const { theme, ...rest } = saved;
  return theme && rest.aura === undefined ? { ...THEMES[theme], ...rest } : rest;
}

/** Whether every list and map of the user's things is whole: one that is not sends the page to the backup. */
function intact(raw: Record<string, unknown>): boolean {
  const whole = (v: unknown) => Array.isArray(v) && v.every(isRecord);
  const lists = ['feeds', 'canvasEvents', 'announcements', 'focus'].every((key) => raw[key] === undefined || whole(raw[key]));
  const maps = ['assignments', 'tasks', 'events'].every((key) => raw[key] === undefined || (isRecord(raw[key]) && Object.values(raw[key]).every(isRecord)));
  const feeds = raw.feedEvents === undefined || (isRecord(raw.feedEvents) && Object.values(raw.feedEvents).every(whole));
  const parts = [raw.settings, raw.canvas].every((v) => v === undefined || isRecord(v)) && (raw.timer == null || isRecord(raw.timer));
  return lists && maps && feeds && parts && (raw.hiddenEvents === undefined || Array.isArray(raw.hiddenEvents));
}

/**
 * A saved file's data, or null when it cannot be read as one (cut short, emptied, damaged). With
 * `salvage`, a damaged file gives whatever of it is still whole: the last resort, when the backup is
 * no better, in place of starting empty and saving that over it.
 */
export function readSaved(text: string | null, lang: Lang, salvage = false): Data | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    return isRecord(raw) && (salvage || intact(raw)) ? normalize(raw as Partial<Data>, lang) : null;
  } catch {
    return null;
  }
}
