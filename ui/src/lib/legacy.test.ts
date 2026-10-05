import { describe, expect, it } from 'vitest';
import { importLegacy } from './legacy';
import { emptyData, normalize, readSaved } from './model';

// Row shapes copied from a real desktop-kanban.db (secrets never leave the credential store).
const dump = {
  canvasConnected: true,
  feeds: ['df302027'],
  tables: {
    settings: [
      { key: 'still-today.theme', value: 'Glass' },
      { key: 'app.language', value: 'Chinese' },
    ],
    source_connections: [{ id: 'c1', kind: 'Canvas', host: 'canvas.sydney.edu.au', display_name: 'Jordan Lee', last_synced_at: '2026-09-24T09:18:11.0876164+00:00' }],
    subscriptions: [{ id: 'df302027', display_name: 'Jordan Lee Calendar (Canvas)', source_host: 'canvas.sydney.edu.au' }],
    calendar_items: [
      { id: 'canvas-assignment:687463', title: 'Wk 1 Quiz', starts_at: '2026-08-04T08:55:00.0000000+00:00', course_code: 'PMGT5850 (ALL)', item_type: 'Quiz', canvas_assignment_id: '687463', source_url: null, points_possible: 5 },
      { id: 'feed-item', title: 'Lecture', starts_at: '2026-09-29T08:00:00+00:00', canvas_assignment_id: null },
    ],
    item_user_state: [
      { item_id: 'canvas-assignment:687463', status: 'Completed', completed_at: '2026-09-24T09:38:59.2257637+00:00', is_hidden: 0, is_deleted: 0, canvas_submission_state: 'pending_review', completion_source: 'User', has_update: 1 },
    ],
    canvas_assignment_details: [
      { calendar_item_id: 'canvas-assignment:687463', html_url: 'https://canvas.sydney.edu.au/courses/73635/assignments/687463', description_html: '<p>Hi</p>', unlock_at: '2026-08-04T08:30:00.0000000+00:00', lock_at: '2026-08-04T08:55:00.0000000+00:00', submission_state_json: '{"workflowState":"pending_review","submittedAt":"2026-08-04T08:49:55+00:00","late":false}' },
    ],
    local_events: [
      { id: 'canvas-token-expiry:c1', title: 'Canvas 令牌到期', starts_at: '2026-12-23T00:00:00.0000000+00:00', starts_kind: 'AllDay' },
    ],
    local_tasks: [
      { id: '184c', title: 'PMGT5889 Mid-term', status: 'NotStarted', due_at: '2026-09-25T00:00:00.0000000+10:00', completed_at: null, description: null, focus_id: -5 },
    ],
    focus_sessions: [
      { id: 2, assignment_id: 687463, started_at: '2026-09-23T15:47:06.2447722+10:00', duration_seconds: 7, completed: 1 },
      { id: 3, assignment_id: -5, started_at: '2026-09-23T15:50:00+10:00', duration_seconds: 1500, completed: 0 },
      { id: 4, assignment_id: 0, started_at: '2026-09-23T16:00:00+10:00', duration_seconds: 900, completed: 1 },
    ],
  },
};

describe('importLegacy', () => {
  it('carries settings, Canvas, assignments, tasks, token reminder, focus history and feeds', () => {
    const data = emptyData('en');
    importLegacy(data, dump);
    expect(data.settings).toMatchObject({ theme: 'aura', lang: 'zh' });
    expect(data.canvas).toMatchObject({ host: 'canvas.sydney.edu.au', user: 'Jordan Lee', tokenExpires: '2026-12-23' });
    expect(data.assignments['687463']).toMatchObject({
      course: 'PMGT5850', quiz: true, done: true, doneBy: 'user', updated: true, canvasState: 'pending_review',
      url: 'https://canvas.sydney.edu.au/courses/73635/assignments/687463', submission: { state: 'pending_review' },
      opens: '2026-08-04T08:30:00.0000000+00:00', closes: '2026-08-04T08:55:00.0000000+00:00',
    });
    expect(Object.keys(data.assignments)).toEqual(['687463']);
    expect(data.tasks['184c']).toMatchObject({ title: 'PMGT5889 Mid-term', timed: false, done: false });
    expect(new Date(data.tasks['184c'].due!).getDate()).toBe(25);
    expect(data.events).toEqual({});
    // The 7-second session is under the 10-minute rule and stays behind.
    expect(data.focus.map((f) => [f.task, f.seconds, f.title])).toEqual([
      ['t:184c', 1500, 'PMGT5889 Mid-term'],
      [null, 900, null],
    ]);
    expect(data.feeds).toEqual([{ id: 'df302027', name: 'Jordan Lee Calendar (Canvas)', host: 'canvas.sydney.edu.au', lastSync: null, error: null }]);
  });
});

describe('normalize', () => {
  it('drops focus sessions under ten minutes from an older save', () => {
    const saved = emptyData('en');
    saved.focus = [
      { id: 'short', task: null, title: null, start: '2026-09-23T05:47:06Z', seconds: 7, completed: true },
      { id: 'kept', task: null, title: null, start: '2026-09-23T06:00:00Z', seconds: 1500, completed: true },
    ];
    expect(normalize(JSON.parse(JSON.stringify(saved)), 'en').focus.map((f) => f.id)).toEqual(['kept']);
  });
});

describe('readSaved', () => {
  it('reads a whole save', () => {
    const saved = emptyData('zh');
    saved.tasks.t1 = { id: 't1', title: 'Essay', due: null, timed: false, notes: '', done: false, doneAt: null, created: '2026-09-26T00:00:00Z' };
    expect(readSaved(JSON.stringify(saved), 'en')?.tasks.t1.title).toBe('Essay');
  });

  it('turns down what a cut-short or damaged write leaves', () => {
    for (const text of [null, '', '\0\0\0\0', '{"v":1,"tasks":{"t1":', '[]', 'null', '{"focus":42}']) expect(readSaved(text, 'en')).toBeNull();
  });
});

