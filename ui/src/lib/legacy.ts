import { shortCourse } from './canvas';
import { MIN_FOCUS_SECONDS, type Assignment, type Data, type LocalEvent, type Submission, type Task, type Theme } from './model';
import { parseIso } from './time';

// Maps the WPF release's SQLite rows (read by the host through winsqlite3) into the new model.
// Feed occurrences are not carried over: the feeds themselves are, and they re-sync at once.

type Row = Record<string, unknown>;

export interface LegacyDump {
  tables: Record<string, Row[]>;
  canvasConnected: boolean;
  feeds: string[];
}

const THEMES: Record<string, Theme> = { Glass: 'aura', Porcelain: 'light', Midnight: 'dark' };

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const flag = (v: unknown) => v === 1 || v === '1';

/** An all-day value was stored as midnight with some offset; its written date is the day meant. */
const datePart = (v: string) => v.slice(0, 10);

export function importLegacy(data: Data, dump: LegacyDump): void {
  const t = dump.tables;
  const setting = (key: string) => str(t.settings?.find((r) => r.key === key)?.value);

  data.settings.theme = THEMES[setting('still-today.theme') ?? ''] ?? data.settings.theme;
  const language = setting('app.language');
  if (language === 'Chinese') data.settings.lang = 'zh';
  if (language === 'English') data.settings.lang = 'en';

  const canvas = t.source_connections?.find((r) => r.kind === 'Canvas');
  if (canvas && dump.canvasConnected) {
    data.canvas.host = str(canvas.host);
    data.canvas.user = str(canvas.display_name);
    data.canvas.lastSync = str(canvas.last_synced_at);
  }

  const states = new Map((t.item_user_state ?? []).map((r) => [r.item_id, r]));
  const details = new Map((t.canvas_assignment_details ?? []).map((r) => [r.calendar_item_id, r]));
  for (const item of t.calendar_items ?? []) {
    const id = str(item.canvas_assignment_id);
    if (!id) continue;
    const state = states.get(item.id);
    const detail = details.get(item.id);
    let submission: Submission | null = null;
    try {
      const raw = JSON.parse(str(detail?.submission_state_json) ?? 'null');
      if (raw) {
        submission = {
          state: raw.workflowState ?? null,
          submittedAt: raw.submittedAt ?? null,
          late: raw.late === true,
          missing: raw.missing === true,
          excused: raw.excused === true,
        };
      }
    } catch {
      submission = null;
    }
    const done = state?.status === 'Completed';
    const source = str(state?.completion_source);
    const url = str(detail?.html_url) ?? str(item.source_url);
    const assignment: Assignment = {
      id,
      courseId: /\/courses\/(\d+)\//.exec(url ?? '')?.[1] ?? '',
      course: shortCourse(str(item.course_code) ?? '', undefined),
      title: str(item.title) ?? '',
      due: str(item.starts_at),
      opens: str(detail?.unlock_at),
      closes: str(detail?.lock_at),
      url,
      points: typeof item.points_possible === 'number' ? item.points_possible : null,
      quiz: item.item_type === 'Quiz',
      description: str(detail?.description_html),
      submission,
      canvasState: str(state?.canvas_submission_state),
      done,
      doneAt: done ? str(state?.completed_at) : null,
      doneBy: source === 'Canvas' ? 'canvas' : source === 'User' ? 'user' : done ? 'user' : null,
      updated: flag(state?.has_update),
      hidden: flag(state?.is_hidden) || flag(state?.is_deleted),
    };
    data.assignments[id] = assignment;
  }

  for (const row of t.local_tasks ?? []) {
    const due = parseIso(str(row.due_at));
    const task: Task = {
      id: String(row.id),
      title: str(row.title) ?? '',
      due: due ? due.toISOString() : null,
      timed: due !== null && (due.getHours() !== 0 || due.getMinutes() !== 0),
      notes: str(row.description) ?? '',
      done: row.status === 'Completed',
      doneAt: str(row.completed_at),
      created: new Date().toISOString(),
    };
    data.tasks[task.id] = task;
  }

  for (const row of t.local_events ?? []) {
    const id = String(row.id);
    const start = str(row.starts_at);
    if (!start) continue;
    if (id.startsWith('canvas-token-expiry:')) {
      data.canvas.tokenExpires = datePart(start);
      continue;
    }
    const allDay = row.starts_kind === 'AllDay';
    const end = str(row.ends_at);
    const event: LocalEvent = {
      id,
      title: str(row.title) ?? '',
      start: allDay ? datePart(start) : (parseIso(start)?.toISOString() ?? start),
      end: end ? (allDay ? datePart(end) : (parseIso(end)?.toISOString() ?? null)) : null,
      allDay,
      location: '',
    };
    data.events[id] = event;
  }

  const localFocusIds = new Map((t.local_tasks ?? []).filter((r) => typeof r.focus_id === 'number').map((r) => [r.focus_id as number, String(r.id)]));
  for (const row of t.focus_sessions ?? []) {
    if ((Number(row.duration_seconds) || 0) < MIN_FOCUS_SECONDS) continue;
    const target = Number(row.assignment_id);
    const task = target > 0 ? `a:${target}` : target < 0 && localFocusIds.has(target) ? `t:${localFocusIds.get(target)}` : null;
    const title = task?.startsWith('a:') ? (data.assignments[task.slice(2)]?.title ?? null) : task ? (data.tasks[task.slice(2)]?.title ?? null) : null;
    data.focus.push({
      id: `legacy-${row.id}`,
      task,
      title,
      start: parseIso(str(row.started_at))?.toISOString() ?? str(row.started_at) ?? '',
      seconds: Number(row.duration_seconds) || 0,
      completed: flag(row.completed),
    });
  }

  const copied = new Set(dump.feeds);
  for (const row of t.subscriptions ?? []) {
    const id = String(row.id);
    if (!copied.has(id)) continue;
    data.feeds.push({ id, name: str(row.display_name) || str(row.source_host) || 'Calendar', host: str(row.source_host) ?? '', lastSync: null, error: null });
  }
}

