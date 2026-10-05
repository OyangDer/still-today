import { describe, expect, it } from 'vitest';
import { auraLook } from './aura';

const alpha = (scrim: string) => Number(/, ([\d.]+)\)$/.exec(scrim)![1]);

describe('auraLook', () => {
  it('uses dark ink on a bright wallpaper and light ink on a dark one', () => {
    expect(auraLook({ average: '#56c4ee', darkest: '#3aa8d8', brightest: '#ffffff' }).ink).toBe('dark');
    expect(auraLook({ average: '#101820', darkest: '#000000', brightest: '#8aa4c0' }).ink).toBe('light');
  });

  it('stands in for the blur with the wallpaper colours, lighter above and deeper below', () => {
    const look = auraLook({ average: '#56c4ee', darkest: '#10202a', brightest: '#ffffff' });
    expect(look.fill).toMatch(/^linear-gradient\(160deg, rgb\(\d+, \d+, \d+\), rgb\(86, 196, 238\) 55%, rgb\(\d+, \d+, \d+\)\)$/);
  });

  it('adds scrim only as far as contrast requires, above a frosted floor', () => {
    const calm = auraLook({ average: '#e8eef2', darkest: '#dfe6ea', brightest: '#ffffff' });
    const busy = auraLook({ average: '#56c4ee', darkest: '#10202a', brightest: '#ffffff' });
    expect(alpha(calm.scrim)).toBeCloseTo(0.37, 2);
    expect(alpha(busy.scrim)).toBeGreaterThan(alpha(calm.scrim));
    expect(alpha(busy.scrim)).toBeLessThanOrEqual(0.88);
  });
});
