import type { Announcement, Assignment, CanvasEvent, Data, HandIn, Submission, SyncError } from './model';

// Canvas API sync. The host attaches the token and pins the host; this module only chooses paths
// and merges what comes back.

export interface CanvasApi {
  get(path: string): Promise<{ status: number; body: string | null; next: string | null }>;
}

interface RawCourse {
  id: number | string;
  name?: string;
  /** Present when the student has nicknamed the course on Canvas; `name` then carries the nickname. */
  original_name?: string;
  course_code?: string;
}

interface RawAssignment {
  id: number | string;
  name?: string;
  due_at?: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  points_possible?: number | null;
  is_quiz_assignment?: boolean;
  html_url?: string | null;
  description?: string | null;
  submission_types?: string[];
  submission?: {
    workflow_state?: string | null;
    submitted_at?: string | null;
    late?: boolean;
    missing?: boolean;
    excused?: boolean | null;
    score?: number | null;
    grade?: string | null;
  } | null;
}

interface RawEvent {
  id: number | string;
  title?: string;
  start_at?: string | null;
  end_at?: string | null;
  all_day?: boolean;
  all_day_date?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  context_code?: string;
  workflow_state?: string;
  hidden?: boolean;
}

interface RawAnnouncement {
  id: number | string;
  title?: string;
  posted_at?: string | null;
  created_at?: string | null;
  context_code?: string;
  author?: { display_name?: string } | null;
  user_name?: string | null;
  message?: string | null;
  html_url?: string | null;
  read_state?: string;
}

/** An active course: its id and the short code the widget shows. */
export interface Course {
  id: string;
  code: string;
}

export interface Fetched {
  id: string;
  courseId: string;
  course: string;
  title: string;
  due: string | null;
  opens: string | null;
  closes: string | null;
  url: string | null;
  points: number | null;
  quiz: boolean;
  description: string | null;
  handIn: HandIn;
  submission: Submission | null;
}

/** Canvas states in which the student's side of the work is finished. */
const FINISHED = new Set(['submitted', 'pending_review', 'graded']);

/** "PMGT5850 (ALL)" reads as "PMGT5850": a section in brackets says nothing in the widget. */
export function shortCourse(code: string | undefined, name: string | undefined): string {
  const value = (code || name || '').trim();
  return value.replace(/\s*\([^)]*\)\s*$/, '') || value;
}

/** Work Canvas never receives stays "not submitted" there forever; say how it is handed in instead. */
export function handInOf(types: string[] | undefined): HandIn {
  if (!types?.length || types.some((t) => t !== 'on_paper' && t !== 'none' && t !== 'not_graded')) return 'online';
  return types.includes('on_paper') ? 'paper' : 'none';
}

async function getAll<T>(api: CanvasApi, path: string): Promise<T[] | SyncError> {
  const out: T[] = [];
  let next: string | null = path;
  for (let page = 0; next && page < 50; page++) {
    const res = await api.get(next);
    if (res.status === 401 || res.status === 403) return 'token';
    if (res.status !== 200 || res.body === null) return 'network';
    out.push(...(JSON.parse(res.body) as T[]));
    next = res.next;
  }
  return out;
}

export async function fetchCourses(api: CanvasApi): Promise<Course[] | SyncError> {
  const courses = await getAll<RawCourse>(api, '/api/v1/courses?enrollment_state=active&per_page=100');
  if (typeof courses === 'string') return courses;
  // A nickname the student gave a course on Canvas is the name they chose for it, and wins.
  return courses.map((c) => ({ id: String(c.id), code: c.original_name && c.name ? c.name.trim() : shortCourse(c.course_code, c.name) }));
}

export async function fetchAssignments(api: CanvasApi, courses: Course[]): Promise<{ items: Fetched[]; complete: boolean }> {
  const items: Fetched[] = [];
  let complete = true;
  const queue = [...courses];
  const worker = async () => {
    for (let course = queue.shift(); course; course = queue.shift()) {
      const list = await getAll<RawAssignment>(
        api,
        `/api/v1/courses/${encodeURIComponent(course.id)}/assignments?per_page=100&include[]=submission&order_by=due_at`,
      );
      // A course that refuses (for example one the student can no longer see) just stays as it was.
      if (typeof list === 'string') {
        complete = false;
        continue;
      }
      for (const a of list) {
        if (a.id === undefined || !a.name?.trim()) continue;
        const s = a.submission;
        items.push({
          id: String(a.id),
          courseId: course.id,
          course: course.code,
          title: a.name.trim(),
          due: a.due_at ?? null,
          opens: a.unlock_at ?? null,
          closes: a.lock_at ?? null,
          url: a.html_url ?? null,
          points: typeof a.points_possible === 'number' ? a.points_possible : null,
          quiz: a.is_quiz_assignment === true,
          description: a.description ?? null,
          handIn: handInOf(a.submission_types),
          submission: s
            ? {
                state: s.workflow_state?.trim().toLowerCase() || null,
                submittedAt: s.submitted_at ?? null,
                late: s.late === true,
                missing: s.missing === true,
                excused: s.excused === true,
                score: typeof s.score === 'number' ? s.score : null,
                grade: s.grade ?? null,
              }
            : null,
        });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { items, complete };
}

/**
 * The user's id and profile picture URL. The picture is null when they have none (Canvas then
 * answers with its own placeholder, or with nothing where a school turns pictures off); the whole
 * profile is undefined when Canvas did not answer.
 */
export async function fetchProfile(api: CanvasApi): Promise<{ id: string; avatar: string | null } | undefined> {
  const res = await api.get('/api/v1/users/self/profile');
  if (res.status !== 200 || res.body === null) return undefined;
  const profile = JSON.parse(res.body) as { id?: number | string; avatar_url?: string | null };
  if (profile.id === undefined) return undefined;
  const url = profile.avatar_url;
  return { id: String(profile.id), avatar: url && !url.includes('/images/messages/avatar-') ? url : null };
}

const courseOf = (code: string | undefined) => (code?.startsWith('course_') ? code.slice(7) : null);

/** Canvas takes a bounded number of calendars per request. */
function chunks<T>(items: T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The course calendars and the user's own Canvas calendar over a window: the events the Canvas
 * calendar feed carries. Null when any part fails, so the last good copy stays.
 */
export async function fetchEvents(api: CanvasApi, courses: Course[], userId: string, from: Date, to: Date): Promise<CanvasEvent[] | null> {
  const out: CanvasEvent[] = [];
  const codes = [...courses.map((c) => `course_${c.id}`), `user_${userId}`];
  for (const part of chunks(codes)) {
    const query = part.map((c) => `context_codes[]=${c}`).join('&');
    const list = await getAll<RawEvent>(api, `/api/v1/calendar_events?type=event&${query}&start_date=${from.toISOString()}&end_date=${to.toISOString()}&per_page=100`);
    if (typeof list === 'string') return null;
    for (const e of list) {
      if (e.hidden || e.workflow_state === 'deleted' || !e.title?.trim() || !e.start_at) continue;
      const courseId = courseOf(e.context_code);
      const day = e.all_day ? (e.all_day_date ?? null) : null;
      out.push({
        id: String(e.id),
        title: e.title.trim(),
        start: day ?? e.start_at,
        end: day ? null : (e.end_at ?? null),
        allDay: day !== null,
        location: e.location_name || e.location_address || '',
        courseId,
        course: courses.find((c) => c.id === courseId)?.code ?? null,
      });
    }
  }
  return out;
}

/** Announcements in the courses since a day, newest first. Null when any part fails. */
export async function fetchAnnouncements(api: CanvasApi, courses: Course[], since: Date): Promise<Announcement[] | null> {
  const out: Announcement[] = [];
  const day = since.toISOString().slice(0, 10);
  for (const part of chunks(courses)) {
    const query = part.map((c) => `context_codes[]=course_${c.id}`).join('&');
    const list = await getAll<RawAnnouncement>(api, `/api/v1/announcements?${query}&start_date=${day}&per_page=50`);
    if (typeof list === 'string') return null;
    for (const a of list) {
      const courseId = courseOf(a.context_code);
      const postedAt = a.posted_at ?? a.created_at;
      if (!courseId || !postedAt) continue;
      out.push({
        id: String(a.id),
        title: a.title?.trim() ?? '',
        courseId,
        course: courses.find((c) => c.id === courseId)?.code ?? '',
        postedAt,
        author: a.author?.display_name ?? a.user_name ?? null,
        message: a.message ?? null,
        url: a.html_url ?? null,
        read: a.read_state === 'read',
      });
    }
  }
  return out.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

/** Course id → the colour the user picked in Canvas. Only plain hex colours ever reach a style. */
export async function fetchColors(api: CanvasApi): Promise<Record<string, string> | null> {
  const res = await api.get('/api/v1/users/self/colors');
  if (res.status !== 200 || res.body === null) return null;
  const custom = (JSON.parse(res.body) as { custom_colors?: Record<string, string> }).custom_colors ?? {};
  const out: Record<string, string> = {};
  for (const [code, color] of Object.entries(custom)) {
    const id = courseOf(code);
    if (id && /^#[0-9a-f]{6}$/i.test(color)) out[id] = color;
  }
  return out;
}

/** "18 / 20" for a points score; a grade Canvas words itself ("DI", "85%") leads, with the score beside it. */
export function gradeText(a: Assignment): string | null {
  const score = a.submission?.score ?? null;
  const grade = a.submission?.grade ?? null;
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const points = score !== null && a.points !== null ? `${n(score)} / ${n(a.points)}` : null;
  if (grade === null || Number(grade) === score) return points ?? (score === null ? null : n(score));
  return points ? `${grade} · ${points}` : grade;
}

/**
 * Folds one Canvas pass into the store.
 *
 * Completion is a one-way latch from Canvas: submitted, pending_review and graded complete an
 * item, other states leave it alone, and a decision the user made (doneBy 'user') is never
 * overridden. Work Canvas calls missing stays open whatever its state: a zero given for work
 * never handed in reads as graded, and the course may still take it late. A tick Canvas gave such
 * work, before this rule or on its say-so since, is taken back. `updated` rises only
 * for a real change on an item this app already knew; a grade released since the last pass is
 * one, and those ids are returned so the user can be told.
 */
export function mergeAssignments(data: Data, fetched: Fetched[], complete: boolean, now: Date): string[] {
  const seen = new Set<string>();
  const graded: string[] = [];
  for (const f of fetched) {
    seen.add(f.id);
    const existing: Assignment | undefined = data.assignments[f.id];
    const state = f.submission?.state ?? null;
    const known = existing !== undefined;
    const changed = known && (existing.canvasState ?? null) !== state;
    const autoComplete = state !== null && FINISHED.has(state) && !f.submission?.missing && existing?.doneBy !== 'user' && !existing?.done;
    const reopen = !!f.submission?.missing && existing?.doneBy === 'canvas';
    // Only a copy that recorded "no grade yet" can tell a release from a grade it never tracked.
    const before = existing?.submission;
    const newGrade = before?.score === null && before.grade === null && (f.submission?.score != null || f.submission?.grade != null);

    const next: Assignment = {
      id: f.id,
      courseId: f.courseId,
      course: f.course,
      title: f.title,
      due: f.due,
      opens: f.opens,
      closes: f.closes,
      url: f.url,
      points: f.points,
      quiz: f.quiz,
      description: f.description,
      handIn: f.handIn,
      submission: f.submission,
      canvasState: state,
      done: existing?.done ?? false,
      doneAt: existing?.doneAt ?? null,
      doneBy: existing?.doneBy ?? null,
      updated: existing?.updated ?? false,
      hidden: existing?.hidden ?? false,
    };
    if (autoComplete) {
      next.done = true;
      next.doneAt = existing?.doneAt ?? now.toISOString();
      next.doneBy = 'canvas';
    }
    if (reopen) {
      next.done = false;
      next.doneAt = null;
      next.doneBy = null;
    }
    if (known && (autoComplete || newGrade || (changed && existing.canvasState !== null))) next.updated = true;
    if (newGrade) graded.push(f.id);
    data.assignments[f.id] = next;
  }
  // Only a complete pass can prove an assignment is gone from Canvas.
  if (complete) for (const id of Object.keys(data.assignments)) if (!seen.has(id)) delete data.assignments[id];
  return graded;
}

// ---- finding a school's Canvas ----------------------------------------------------------------

export interface School {
  name: string;
  domain: string;
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * What to ask the directory for while a name is typed. It matches the text as one piece, so
 * "university sydney" finds nothing; each word is asked for as well, and the answers are put
 * together here. Under three letters a search returns the first page of the alphabet.
 */
export function schoolSearches(query: string): string[] {
  const text = query.trim().toLowerCase();
  return [...new Set([text, ...wordsOf(text)])].filter((s) => s.length >= 3);
}

/**
 * Schools whose name has every typed word starting one of its words, in any order. Those that
 * read as the typed phrase come first, then the shortest names; one entry per Canvas address,
 * since a school's test and non-SSO entries lead to the same place.
 */
export function rankSchools(query: string, found: School[]): School[] {
  const want = wordsOf(query);
  const phrase = ` ${want.join(' ')}`;
  const seen = new Set<string>();
  return found
    .map((school) => ({ school, words: wordsOf(school.name) }))
    .filter(({ words }) => want.every((w) => words.some((word) => word.startsWith(w))))
    .map(({ school, words }) => ({ school, phrase: ` ${words.join(' ')}`.includes(phrase) }))
    .sort((a, b) => Number(b.phrase) - Number(a.phrase) || a.school.name.length - b.school.name.length)
    .map(({ school }) => school)
    .filter((school) => !seen.has(school.domain) && !!seen.add(school.domain));
}
