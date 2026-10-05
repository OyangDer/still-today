import { describe, expect, it } from 'vitest';
import { bucketOf, coursesOf, dayAgenda, monthMarks, todos, upcomingDeadlines, upcomingEvents } from './agenda';
import { emptyData, type Assignment } from './model';
import { monthGrid } from './time';

const now = new Date(2026, 8, 24, 19, 55);

function assignment(id: string, due: string | null, extra: Partial<Assignment> = {}): Assignment {
  return {
    id, courseId: '73635', course: 'PMGT5850', title: `A${id}`, due, opens: null, closes: null, url: null, points: null, quiz: false, description: null,
    submission: null, canvasState: null, done: false, doneAt: null, doneBy: null, updated: false, hidden: false, ...extra,
  };
}

function data() {
  const d = emptyData('zh');
  d.assignments = {
    past: assignment('past', new Date(2026, 8, 20, 23, 59).toISOString()),
    soon: assignment('soon', new Date(2026, 8, 25, 23, 59).toISOString()),
    done: assignment('done', new Date(2026, 8, 24, 21, 0).toISOString(), { done: true }),
    hidden: assignment('hidden', new Date(2026, 8, 24, 22, 0).toISOString(), { hidden: true }),
  };
  d.tasks = {
    mid: { id: 'mid', title: 'Mid-term', due: new Date(2026, 8, 25).toISOString(), timed: false, notes: '', done: false, doneAt: null, created: '' },
  };
  d.feeds = [{ id: 'f', name: 'Uni', host: 'x', lastSync: null, error: null }];
  d.feedEvents = {
    f: [
      { key: 'lec', title: 'Lecture', start: new Date(2026, 8, 24, 19, 0).toISOString(), end: new Date(2026, 8, 24, 21, 0).toISOString(), allDay: false, location: '' },
      { key: 'brk', title: 'Break', start: '2026-09-28', end: '2026-10-01', allDay: true, location: '' },
    ],
  };
  return d;
}

describe('agenda', () => {
  it('leaves out every assignment and Canvas event of a hidden course', () => {
    const d = data();
    d.canvas.host = 'canvas.example.edu';
    d.assignments.other = assignment('other', new Date(2026, 8, 25, 12, 0).toISOString(), { courseId: '999', course: 'OPELA' });
    d.canvasEvents = [{ id: 'e', title: 'OPELA drop-in', start: new Date(2026, 8, 25, 10, 0).toISOString(), end: null, allDay: false, location: '', courseId: '999', course: 'OPELA' }];
    d.settings.hiddenCourses = ['999'];
    expect(todos(d).some((i) => i.course === 'OPELA')).toBe(false);
    expect(dayAgenda(d, new Date(2026, 8, 25)).some((o) => o.label === 'OPELA')).toBe(false);
    d.settings.hiddenCourses = [];
    expect(todos(d).some((i) => i.course === 'OPELA')).toBe(true);
    expect(dayAgenda(d, new Date(2026, 8, 25)).filter((o) => o.label === 'OPELA')).toHaveLength(2);
  });

  it('lists future deadlines soonest first, skipping overdue, done and hidden work', () => {
    const upcoming = upcomingDeadlines(todos(data()), now);
    expect(upcoming[0]?.key).toBe('a:soon');
    expect(upcoming.every((t) => !t.done && t.due! > now)).toBe(true);
  });

  it('offers each course that has work once, in order, with its colour; personal work is not a course', () => {
    const d = data();
    d.assignments.other = assignment('other', null, { courseId: '1', course: 'COMP1000' });
    d.canvas.colors = { '73635': '#324a4d' };
    expect(coursesOf(todos(d))).toEqual([
      { code: 'COMP1000', color: null },
      { code: 'PMGT5850', color: '#324a4d' },
    ]);
  });

  it('treats a date-only personal task as due at the end of its day', () => {
    const mid = todos(data()).find((t) => t.key === 't:mid')!;
    expect(mid.due?.getHours()).toBe(23);
    expect(bucketOf(mid, now)).toBe('tomorrow');
  });

  it('leads the upcoming events with one in progress', () => {
    expect(upcomingEvents(data(), now)[0]?.title).toBe('Lecture');
  });

  it('spreads multi-day all-day events over each day they cover', () => {
    const marks = monthMarks(data(), monthGrid(now));
    expect(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map((k) => marks.get(k)?.events ?? 0)).toEqual([1, 1, 1, 0]);
    expect(marks.get('2026-09-25')?.deadlines).toBe(2);
    expect(dayAgenda(data(), new Date(2026, 8, 29)).map((o) => o.title)).toEqual(['Break']);
  });
});
