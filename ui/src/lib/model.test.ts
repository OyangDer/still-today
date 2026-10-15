import { describe, expect, it } from 'vitest';
import { dayAgenda, todos, upcomingEvents } from './agenda';
import { readSaved } from './model';

const settings = (saved: object) => readSaved(JSON.stringify({ settings: saved }), 'zh')!.settings;

describe('appearance', () => {
  it('reads an older single theme as Aura and a mode', () => {
    expect(settings({ theme: 'aura' })).toMatchObject({ aura: true, mode: 'auto' });
    expect(settings({ theme: 'light' })).toMatchObject({ aura: false, mode: 'light' });
    expect(settings({ theme: 'dark' })).toMatchObject({ aura: false, mode: 'dark' });
    expect(settings({ theme: 'dark' })).not.toHaveProperty('theme');
  });

  it('keeps Aura and the mode once they are saved', () => {
    expect(settings({ aura: false, mode: 'auto' })).toMatchObject({ aura: false, mode: 'auto' });
    expect(settings({})).toMatchObject({ aura: true, mode: 'auto' });
  });
});

describe('occurrence keys', () => {
  it('pads the all-day dates older versions wrote unpadded, keeping both readings of an ambiguous one', () => {
    const data = readSaved(
      JSON.stringify({
        hiddenEvents: ['f:feed1:m|2026111', 'f:feed1:m|202611', 'f:feed1:m|20261111', 'f:feed1:m|1767139200000', 'f:feed1:bare', 'c:5'],
        feedEvents: { feed1: [{ key: 'm|2026111', title: 'Stamp', start: '2026-11-01', end: null, allDay: true, location: '' }] },
      }),
      'zh',
    )!;
    expect(data.hiddenEvents).toEqual([
      'f:feed1:m|20260111',
      'f:feed1:m|20261101',
      'f:feed1:m|20260101',
      'f:feed1:m|20261111',
      'f:feed1:m|1767139200000',
      'f:feed1:bare',
      'c:5',
    ]);
    expect(data.feedEvents.feed1[0].key).toBe('m|20261101');
  });
});

describe('damaged files', () => {
  const now = new Date(2026, 9, 16, 9, 0);
  const damaged: Record<string, object> = {
    'null lists and maps': { tasks: null, assignments: null, events: null, feeds: null, announcements: null, canvasEvents: null, focus: null },
    'holes in lists and maps': { tasks: { a: null }, events: { e: 3 }, feeds: [null], announcements: [null, 'x'], focus: [null], feedEvents: { f: [null] } },
    'lists where maps belong': { tasks: [1], assignments: 'x', feedEvents: [] },
    'settings and canvas of the wrong kind': { settings: null, canvas: 'x' },
    'odd settings': { settings: { lang: 'fr', hiddenCourses: null, courseNames: [], focusSeconds: 1e12 } },
    'colors and courses null': { canvas: { colors: null, courses: null } },
    'a timer without its fields': { timer: {} },
  };

  for (const [name, raw] of Object.entries(damaged)) {
    it(`salvages ${name} as empty fields that the views can draw`, () => {
      const data = readSaved(JSON.stringify(raw), 'zh', true)!;
      expect(data).not.toBeNull();
      for (const key of ['feeds', 'canvasEvents', 'announcements', 'focus', 'hiddenEvents'] as const) expect(Array.isArray(data[key])).toBe(true);
      for (const key of ['tasks', 'assignments', 'events', 'feedEvents'] as const) expect(data[key]).toBeTypeOf('object');
      expect(['zh', 'en']).toContain(data.settings.lang);
      expect(data.settings.focusSeconds).toBeLessThanOrEqual(10 * 3600);
      expect(Array.isArray(data.settings.hiddenCourses)).toBe(true);
      expect(data.timer).toBeNull();
      expect(() => [todos(data), upcomingEvents(data, now), dayAgenda(data, now)]).not.toThrow();
    });
  }

  it('turns down a file with a damaged list or map, so the backup stands in', () => {
    for (const key of ['tasks', 'assignments', 'events', 'feeds', 'announcements', 'canvasEvents', 'focus', 'feedEvents'])
      expect(readSaved(JSON.stringify({ [key]: null }), 'zh')).toBeNull();
    expect(readSaved(JSON.stringify({ tasks: { a: null } }), 'zh')).toBeNull();
    expect(readSaved(JSON.stringify({ feedEvents: { f: [null] } }), 'zh')).toBeNull();
  });

  it('reads a file whose only fault is in its settings, mending them', () => {
    const data = readSaved(JSON.stringify({ settings: { lang: 'fr', hiddenCourses: null, focusSeconds: 'x' }, timer: {} }), 'en')!;
    expect(data.settings).toMatchObject({ lang: 'en', hiddenCourses: [], focusSeconds: 25 * 60 });
    expect(data.timer).toBeNull();
  });

  it('salvages the good fields beside a bad one', () => {
    const task = { id: 'a', title: 'Essay', due: null, timed: false, notes: '', done: false, doneAt: null, created: '' };
    const data = readSaved(JSON.stringify({ tasks: { a: task, b: null }, events: null, settings: { lang: 'en', focusSeconds: 1500 } }), 'zh', true)!;
    expect(Object.keys(data.tasks)).toEqual(['a']);
    expect(data.settings).toMatchObject({ lang: 'en', focusSeconds: 1500 });
  });
});
