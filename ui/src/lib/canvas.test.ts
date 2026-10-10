import { describe, expect, it } from 'vitest';
import {
  fetchAnnouncements,
  fetchAssignments,
  fetchColors,
  fetchCourses,
  fetchEvents,
  fetchProfile,
  gradeText,
  handInOf,
  mergeAssignments,
  rankSchools,
  schoolSearches,
  shortCourse,
  type CanvasApi,
  type Fetched,
} from './canvas';
import { emptyData } from './model';

const now = new Date('2026-09-24T10:00:00Z');
const item = (id: string, state: string | null, extra: Partial<Fetched> = {}): Fetched => ({
  id,
  courseId: '73635',
  course: 'PMGT5850',
  title: `A${id}`,
  due: '2026-09-30T13:59:59Z',
  opens: null,
  closes: null,
  url: null,
  points: 10,
  quiz: false,
  description: null,
  handIn: 'online',
  submission: state === null ? null : { state, submittedAt: null, late: false, missing: false, excused: false, score: null, grade: null },
  ...extra,
});

/** A fake Canvas answering fixed paths; anything else is a 404. */
const canvas = (pages: Record<string, { status?: number; body?: unknown; next?: string | null }>): CanvasApi => ({
  get: async (path) => {
    const page = pages[path];
    if (!page) return { status: 404, body: null, next: null };
    return { status: page.status ?? 200, body: page.body === undefined ? null : JSON.stringify(page.body), next: page.next ?? null };
  },
});

describe('mergeAssignments', () => {
  it('completes submitted, pending_review and graded work without flagging a first import', () => {
    const data = emptyData('zh');
    mergeAssignments(data, [item('1', 'submitted'), item('2', 'pending_review'), item('3', 'graded'), item('4', 'unsubmitted')], true, now);
    expect(Object.values(data.assignments).map((a) => [a.id, a.done, a.doneBy, a.updated])).toEqual([
      ['1', true, 'canvas', false],
      ['2', true, 'canvas', false],
      ['3', true, 'canvas', false],
      ['4', false, null, false],
    ]);
  });

  it('flags a known item when Canvas completes it or its state moves', () => {
    const data = emptyData('zh');
    mergeAssignments(data, [item('1', 'unsubmitted'), item('2', 'submitted')], true, now);
    mergeAssignments(data, [item('1', 'submitted'), item('2', 'graded')], true, now);
    expect(data.assignments['1']).toMatchObject({ done: true, doneBy: 'canvas', updated: true });
    expect(data.assignments['2']).toMatchObject({ done: true, updated: true });
  });

  it('never overrides a decision the user made, and re-syncing an unchanged item changes nothing', () => {
    const data = emptyData('zh');
    mergeAssignments(data, [item('1', 'unsubmitted')], true, now);
    Object.assign(data.assignments['1'], { done: false, doneBy: 'user' });
    mergeAssignments(data, [item('1', 'graded')], true, now);
    expect(data.assignments['1']).toMatchObject({ done: false, doneBy: 'user', updated: true });
    data.assignments['1'].updated = false;
    mergeAssignments(data, [item('1', 'graded')], true, now);
    expect(data.assignments['1'].updated).toBe(false);
  });

  it('leaves work Canvas calls missing open, though a zero for it reads as graded', () => {
    const data = emptyData('zh');
    const missing = item('1', 'graded', { submission: { state: 'graded', submittedAt: null, late: false, missing: true, excused: false, score: 0, grade: '0' } });
    mergeAssignments(data, [missing], true, now);
    expect(data.assignments['1']).toMatchObject({ done: false, doneBy: null });
    const late = item('1', 'submitted', { submission: { state: 'submitted', submittedAt: '2026-09-25T01:00:00Z', late: true, missing: false, excused: false, score: 0, grade: '0' } });
    mergeAssignments(data, [late], true, now);
    expect(data.assignments['1']).toMatchObject({ done: true, doneBy: 'canvas' });
  });

  it('takes back the tick Canvas gave missing work, but not one the user gave', () => {
    const data = emptyData('zh');
    const zero = (id: string) => item(id, 'graded', { submission: { state: 'graded', submittedAt: null, late: false, missing: true, excused: false, score: 0, grade: '0' } });
    // Ticked by an earlier version that completed anything graded.
    mergeAssignments(data, [item('1', 'graded'), item('2', 'graded')], true, now);
    Object.assign(data.assignments['2'], { doneBy: 'user' });
    mergeAssignments(data, [zero('1'), zero('2')], true, now);
    expect(data.assignments['1']).toMatchObject({ done: false, doneAt: null, doneBy: null });
    expect(data.assignments['2']).toMatchObject({ done: true, doneBy: 'user' });
  });

  it('reports a grade released since the last pass, but not one it never tracked', () => {
    const graded = (score: number) => item('1', 'graded', { submission: { state: 'graded', submittedAt: null, late: false, missing: false, excused: false, score, grade: String(score) } });
    const data = emptyData('zh');
    mergeAssignments(data, [item('1', 'submitted')], true, now);
    expect(mergeAssignments(data, [graded(18)], true, now)).toEqual(['1']);
    expect(data.assignments['1'].updated).toBe(true);
    expect(mergeAssignments(data, [graded(18)], true, now)).toEqual([]);

    // A copy saved before grades were tracked has no score field at all.
    const old = emptyData('zh');
    mergeAssignments(old, [item('1', 'graded')], true, now);
    delete old.assignments['1'].submission!.score;
    delete old.assignments['1'].submission!.grade;
    expect(mergeAssignments(old, [graded(18)], true, now)).toEqual([]);
  });

  it('keeps local state and only drops missing items after a complete pass', () => {
    const data = emptyData('zh');
    mergeAssignments(data, [item('1', null), item('2', null)], true, now);
    data.assignments['1'].hidden = true;
    mergeAssignments(data, [item('1', null, { title: 'Renamed' })], false, now);
    expect(Object.keys(data.assignments)).toEqual(['1', '2']);
    expect(data.assignments['1']).toMatchObject({ title: 'Renamed', hidden: true });
    mergeAssignments(data, [item('1', null)], true, now);
    expect(Object.keys(data.assignments)).toEqual(['1']);
  });
});

describe('fetchCourses and fetchAssignments', () => {
  it('follows pagination and reports a refused course as an incomplete pass', async () => {
    const api = canvas({
      '/api/v1/courses?enrollment_state=active&per_page=100': { body: [{ id: 1, course_code: 'PMGT5850 (ALL)' }], next: '/api/v1/courses?page=2' },
      '/api/v1/courses?page=2': { body: [{ id: 2, course_code: 'X' }] },
      '/api/v1/courses/1/assignments?per_page=100&include[]=submission&order_by=due_at': {
        body: [{ id: 9, name: ' Charter ', due_at: null, submission: { workflow_state: 'Graded', score: 18, grade: '18' } }],
      },
      '/api/v1/courses/2/assignments?per_page=100&include[]=submission&order_by=due_at': { status: 403 },
    });
    const courses = await fetchCourses(api);
    expect(courses).toEqual([{ id: '1', code: 'PMGT5850' }, { id: '2', code: 'X' }]);
    const result = await fetchAssignments(api, courses as { id: string; code: string }[]);
    expect(result).toMatchObject({
      complete: false,
      items: [{ id: '9', courseId: '1', course: 'PMGT5850', title: 'Charter', submission: { state: 'graded', score: 18, grade: '18' } }],
    });
  });

  it('reports a rejected token', async () => {
    const api: CanvasApi = { get: async () => ({ status: 401, body: null, next: null }) };
    expect(await fetchCourses(api)).toBe('token');
  });

  it('shortens course codes', () => {
    expect(shortCourse('PMGT5850 (ALL)', 'Project')).toBe('PMGT5850');
    expect(shortCourse('', 'Learning Hub')).toBe('Learning Hub');
  });
});

describe('fetchProfile', () => {
  const profile = (body: object | null, status = 200) => canvas({ '/api/v1/users/self/profile': { status, body: body ?? undefined } });

  it('returns an uploaded picture, and null for the placeholder or a school without pictures', async () => {
    const url = 'https://canvas.sydney.edu.au/images/thumbnails/10000001/ExampleThumb';
    expect(await fetchProfile(profile({ id: 7, avatar_url: url }))).toEqual({ id: '7', avatar: url });
    expect(await fetchProfile(profile({ id: 7, avatar_url: 'https://canvas.sydney.edu.au/images/messages/avatar-50.png' }))).toEqual({ id: '7', avatar: null });
    expect(await fetchProfile(profile({ id: 7, name: 'Jordan Lee' }))).toEqual({ id: '7', avatar: null });
  });

  it('leaves everything alone when Canvas does not answer', async () => {
    expect(await fetchProfile(profile(null, -1))).toBeUndefined();
  });
});

describe('course calendar, announcements and colours', () => {
  const courses = [{ id: '1', code: 'PMGT5850' }];
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-10-01T00:00:00Z');
  const events = `/api/v1/calendar_events?type=event&context_codes[]=course_1&context_codes[]=user_7&start_date=${from.toISOString()}&end_date=${to.toISOString()}&per_page=100`;

  it('maps course and personal events, and keeps the last copy when Canvas fails', async () => {
    const api = canvas({
      [events]: {
        body: [
          { id: 3, title: 'Seminar', start_at: '2026-09-29T08:00:00Z', end_at: '2026-09-29T11:00:00Z', location_name: 'Zoom', context_code: 'course_1' },
          { id: 4, title: 'Census date', start_at: '2026-09-30T14:00:00Z', all_day: true, all_day_date: '2026-10-01', context_code: 'user_7' },
          { id: 5, title: 'Gone', start_at: '2026-09-29T08:00:00Z', workflow_state: 'deleted', context_code: 'course_1' },
        ],
      },
    });
    expect(await fetchEvents(api, courses, '7', from, to)).toEqual([
      { id: '3', title: 'Seminar', start: '2026-09-29T08:00:00Z', end: '2026-09-29T11:00:00Z', allDay: false, location: 'Zoom', courseId: '1', course: 'PMGT5850' },
      { id: '4', title: 'Census date', start: '2026-10-01', end: null, allDay: true, location: '', courseId: null, course: null },
    ]);
    expect(await fetchEvents(canvas({}), courses, '7', from, to)).toBeNull();
  });

  it('lists an event once however many contexts return it', async () => {
    const api = canvas({
      [events]: {
        body: [
          { id: 3, title: 'Seminar', start_at: '2026-09-29T08:00:00Z', context_code: 'course_1' },
          { id: 3, title: 'Seminar', start_at: '2026-09-29T08:00:00Z', context_code: 'user_7' },
        ],
      },
    });
    expect((await fetchEvents(api, courses, '7', from, to))?.map((e) => e.id)).toEqual(['3']);
  });

  it('lists announcements newest first with their read state', async () => {
    const api = canvas({
      '/api/v1/announcements?context_codes[]=course_1&start_date=2026-09-10&per_page=50': {
        body: [
          { id: 1, title: 'Week 7', posted_at: '2026-09-20T01:00:00Z', context_code: 'course_1', author: { display_name: 'Tutor' }, read_state: 'read' },
          { id: 2, title: 'Week 8', posted_at: '2026-09-24T01:00:00Z', context_code: 'course_1', user_name: 'Lecturer', read_state: 'unread' },
        ],
      },
    });
    const list = await fetchAnnouncements(api, courses, new Date('2026-09-10T12:00:00Z'));
    expect(list?.map((a) => [a.id, a.course, a.author, a.read])).toEqual([
      ['2', 'PMGT5850', 'Lecturer', false],
      ['1', 'PMGT5850', 'Tutor', true],
    ]);
  });

  it('keeps only course colours that are plain hex', async () => {
    const api = canvas({ '/api/v1/users/self/colors': { body: { custom_colors: { course_1: '#F06291', user_7: '#000000', course_2: 'red;x' } } } });
    expect(await fetchColors(api)).toEqual({ '1': '#F06291' });
  });

  it('writes a grade as points when it is a score, else as Canvas words it', () => {
    const graded = (score: number | null, grade: string | null) => ({ points: 20, submission: { score, grade } }) as Parameters<typeof gradeText>[0];
    expect(gradeText(graded(18, '18'))).toBe('18 / 20');
    expect(gradeText(graded(17.5, 'HD'))).toBe('HD · 17.5 / 20');
    expect(gradeText(graded(null, 'complete'))).toBe('complete');
    expect(gradeText(graded(null, null))).toBeNull();
  });

  it('tells work handed in on paper or not at all from work Canvas receives', () => {
    expect(handInOf(['online_upload'])).toBe('online');
    expect(handInOf(['online_upload', 'on_paper'])).toBe('online');
    expect(handInOf(['on_paper'])).toBe('paper');
    expect(handInOf(['none'])).toBe('none');
    expect(handInOf(['not_graded'])).toBe('none');
    expect(handInOf(undefined)).toBe('online');
  });
});

describe('finding a school', () => {
  // As the directory answered "sydney" and "university of melbourne" (2026-10-04), trimmed.
  const directory = [
    { name: 'Cranbrook Sydney (Parents & External Users)', domain: 'cranbrookau.instructure.com' },
    { name: 'Hampden - Sydney', domain: 'hsc.instructure.com' },
    { name: 'The University of Melbourne', domain: 'canvas.lms.unimelb.edu.au' },
    { name: 'The University of Melbourne (non-SSO)', domain: 'canvas.lms.unimelb.edu.au' },
    { name: 'The University of Melbourne Online - Dev', domain: 'unimelb-online-dev.instructure.com' },
    { name: 'The University of Sydney', domain: 'canvas.sydney.edu.au' },
    { name: 'University of Technology Sydney', domain: 'canvas.uts.edu.au' },
    { name: 'Western Sydney University RTO', domain: 'wsucollege.instructure.com' },
  ];
  const names = (query: string) => rankSchools(query, directory).map((s) => s.name);

  it('asks for the whole text and each word of three letters or more', () => {
    expect(schoolSearches(' Univ of Syd ')).toEqual(['univ of syd', 'univ', 'syd']);
    expect(schoolSearches('sy')).toEqual([]);
  });

  it('matches words by their start, in any order, before the name is finished', () => {
    expect(names('univ syd')).toEqual(['The University of Sydney', 'Western Sydney University RTO', 'University of Technology Sydney']);
    expect(names('sydney uni')).toContain('The University of Sydney');
    expect(names('syd tech')).toEqual(['University of Technology Sydney']);
  });

  it('puts the name read as typed first, and keeps one entry per Canvas address', () => {
    expect(names('university of syd')[0]).toBe('The University of Sydney');
    expect(names('university of melb')).toEqual(['The University of Melbourne', 'The University of Melbourne Online - Dev']);
  });
});
