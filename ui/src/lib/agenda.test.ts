import { describe, expect, it } from 'vitest';
import { bucketOf, coursesOf, dayAgenda, monthMarks, taskDue, todos, upcomingDeadlines, upcomingEvents } from './agenda';
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

  it('marks each day a timed event runs over, and not the day it ends at midnight', () => {
    const d = emptyData('zh');
    d.feeds = [{ id: 'f', name: 'Uni', host: 'x', lastSync: null, error: null }];
    d.feedEvents = {
      f: [
        { key: 'conf', title: 'Conference', start: new Date(2026, 8, 21, 9).toISOString(), end: new Date(2026, 8, 23, 17).toISOString(), allDay: false, location: '' },
        { key: 'late', title: 'Late', start: new Date(2026, 8, 25, 22).toISOString(), end: new Date(2026, 8, 26).toISOString(), allDay: false, location: '' },
      ],
    };
    const marks = monthMarks(d, monthGrid(now));
    expect(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].map((k) => marks.get(k)?.events ?? 0)).toEqual([0, 1, 1, 1, 0]);
    expect(['2026-09-25', '2026-09-26'].map((k) => marks.get(k)?.events ?? 0)).toEqual([1, 0]);
  });

  it('spreads multi-day all-day events over each day they cover', () => {
    const marks = monthMarks(data(), monthGrid(now));
    expect(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map((k) => marks.get(k)?.events ?? 0)).toEqual([1, 1, 1, 0]);
    expect(marks.get('2026-09-25')?.deadlines).toBe(2);
    expect(dayAgenda(data(), new Date(2026, 8, 29)).map((o) => o.title)).toEqual(['Break']);
  });
});

describe('a personal task without a time', () => {
  const day = (d: Date | null) => d && [d.getFullYear(), d.getMonth() + 1, d.getDate()];

  it('is due on the day it was given, wherever the clock is set', () => {
    expect(day(taskDue({ due: '2026-10-18', timed: false }))).toEqual([2026, 10, 18]);
    expect(taskDue({ due: '2026-10-18', timed: false })!.getHours()).toBe(0);
  });

  it('keeps the day of an older save made under a clock up to 12 hours away', () => {
    // The tests run in Sydney. 18 October at midnight in Shanghai, London and Auckland, as older saves kept it.
    expect(day(taskDue({ due: '2026-10-17T16:00:00.000Z', timed: false }))).toEqual([2026, 10, 18]);
    expect(day(taskDue({ due: '2026-10-17T23:00:00.000Z', timed: false }))).toEqual([2026, 10, 18]);
    expect(day(taskDue({ due: '2026-10-17T11:00:00.000Z', timed: false }))).toEqual([2026, 10, 18]);
    // And one made here.
    expect(day(taskDue({ due: new Date(2026, 9, 18).toISOString(), timed: false }))).toEqual([2026, 10, 18]);
  });

  it('leaves a timed task at its instant', () => {
    expect(taskDue({ due: '2026-10-17T22:00:00.000Z', timed: true })!.toISOString()).toBe('2026-10-17T22:00:00.000Z');
    expect(taskDue({ due: null, timed: false })).toBeNull();
  });
});
