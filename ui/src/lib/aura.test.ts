import { describe, expect, it } from 'vitest';
import { auraLook, mistLook } from './aura';

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

describe('mistLook', () => {
  // Aura's card on Windows 11 over plain greys, measured below its sheen: the grey it shows for each.
  const windows: [number, [number, number, number]][] = [
    [39, [116, 117, 118]],
    [127, [162, 163, 164]],
    [224, [213, 214, 215]],
  ];

  it('shows a plain wallpaper as Aura does on Windows, over a blur that keeps its colours', () => {
    const [r, g, b, a] = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(mistLook('dark').scrim)!.slice(1).map(Number);
    for (const [grey, shown] of windows) {
      [r, g, b].forEach((c, i) => expect(Math.abs(c * a + grey * (1 - a) - shown[i])).toBeLessThan(1.5));
    }
  });

  it('smokes the card for light ink', () => {
    expect(mistLook('light').ink).toBe('light');
    expect(mistLook('light').scrim).toBe('rgba(23, 29, 35, 0.440)');
  });
});
