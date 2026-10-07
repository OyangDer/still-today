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
