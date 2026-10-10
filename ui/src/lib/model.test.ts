import { describe, expect, it } from 'vitest';
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
