export type Theme = 'aura' | 'light' | 'dark';

/** Shorter focus sessions are not kept: not when they end, not from an import, not from an old save. */
export const MIN_FOCUS_SECONDS = 10 * 60;
export type Lang = 'zh' | 'en';

export interface Settings {
  theme: Theme;
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
  /** ISO instant; when `timed` is false only its local day matters. */
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
    settings: { theme: 'aura', lang, topmost: false, locked: false, focusSeconds: 25 * 60, notifications: true, courseNames: {}, hiddenCourses: [] },
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

/** Fills fields added after a file was written, so older saves keep loading. */
export function normalize(raw: Partial<Data>, lang: Lang): Data {
  const base = emptyData(lang);
  return {
    ...base,
    ...raw,
    v: 1,
    settings: { ...base.settings, ...raw.settings },
    focus: (raw.focus ?? base.focus).filter((s) => s.seconds >= MIN_FOCUS_SECONDS),
    canvas: { ...base.canvas, ...raw.canvas },
  };
}

/** A saved file's data, or null when it cannot be read as one (cut short, emptied, damaged). */
export function readSaved(text: string | null, lang: Lang): Data | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? normalize(raw as Partial<Data>, lang) : null;
  } catch {
    return null;
  }
}
