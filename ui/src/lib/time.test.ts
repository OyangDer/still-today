import { describe, expect, it } from 'vitest';
import { atMinutes, daysBetween, startOfDay } from './time';

const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

// What the event editor does: it reads an event as its start day, two times and the days the end
// lies after the start, then writes it back from those.
function roundTrip(start: Date, end: Date) {
  const days = daysBetween(start, end);
  const day = startOfDay(start);
  return { start: atMinutes(day, minutes(start)), end: atMinutes(day, minutes(end), days), days };
}

describe('time', () => {
  it('puts minutes past midnight on the local day, and on a later one', () => {
    const d = new Date(2026, 9, 19, 15, 30);
    expect(atMinutes(d, 22 * 60 + 15)).toEqual(new Date(2026, 9, 19, 22, 15));
    expect(atMinutes(d, 60, 1)).toEqual(new Date(2026, 9, 20, 1, 0));
    expect(atMinutes(new Date(2026, 9, 31), 30, 1)).toEqual(new Date(2026, 10, 1, 0, 30));
  });

  it('gives an event past midnight back unchanged after the editor reads and saves it', () => {
    const cases: [Date, Date][] = [
      [new Date(2026, 9, 19, 22, 0), new Date(2026, 9, 20, 1, 0)],
      [new Date(2026, 9, 19, 9, 0), new Date(2026, 9, 21, 17, 0)],
      [new Date(2026, 9, 31, 23, 0), new Date(2026, 10, 1, 0, 0)],
      [new Date(2026, 11, 31, 20, 0), new Date(2027, 0, 1, 2, 0)],
    ];
    for (const [start, end] of cases) {
      const back = roundTrip(start, end);
      expect(back.start).toEqual(start);
      expect(back.end).toEqual(end);
      expect(back.days).toBeGreaterThan(0);
    }
  });
});
