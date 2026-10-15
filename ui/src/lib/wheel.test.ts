import { describe, expect, it } from 'vitest';
import { stepper } from './wheel';

// Recorded in the Mac's WebKit on 2026-10-17 over the calendar's month grid: [ms from the first event, deltaX, deltaY].
type Recorded = [number, number, number][];
const NOTCH: Recorded = [[0, 0, 4]];
const SLOW_NOTCHES: Recorded = [[0, 0, -4], [157, 0, -4], [390, 0, -4], [582, 0, -4]];
const FAST_NOTCHES: Recorded = [[0, 0, -4], [105, 0, -9.25], [217, 0, -23.1], [310, 0, -37.13]];
const SWIPE_UP: Recorded = [
  [0, 0, 1], [16, 1, 3], [32, 1, 7], [47, 1, 8], [66, -1, 8], [83, -1, 8], [99, -1, 6], [114, -1, 6], [132, -1, 4], [148, -1, 3], [164, 0, 2],
  [181, -1, 1], [199, -1, 1], [215, -1, 0], [232, -1, 0], [264, -1, 0], [282, -1, 0], [297, -1, -1], [314, -1, -1], [331, -1, -1], [347, -1, -1],
];
// A swipe to the left, and five pixels that trickled in a quarter of a second after it.
const SWIPE_LEFT: Recorded = [
  [0, 1, 0], [15, 6, 0], [32, 10, -1], [49, 12, -2], [65, 12, -2], [82, 11, -1], [99, 9, -1], [116, 6, -1], [133, 5, -1], [148, 3, -1], [165, 2, -1],
  [183, 1, -1], [200, 0, -1], [215, 0, -1], [274, 0, -1], [282, 0, -1], [548, 1, 0], [566, 1, 0], [583, 1, 0], [599, 1, 0], [615, 1, 0],
];

function play(events: Recorded, options?: Parameters<typeof stepper>[1]): number[] {
  const steps: number[] = [];
  const wheel = stepper((way) => steps.push(way), options);
  for (const [t, deltaX, deltaY] of events) wheel({ timeStamp: 1000 + t, deltaX, deltaY });
  return steps;
}

describe('wheel steps', () => {
  it('turns a page for each notch of a mouse wheel, slow or fast', () => {
    expect(play(NOTCH)).toEqual([1]);
    expect(play(SLOW_NOTCHES)).toEqual([-1, -1, -1, -1]);
    expect(play(FAST_NOTCHES)).toEqual([-1, -1, -1, -1]);
  });

  it('turns one page for a swipe, however far its momentum carries it', () => {
    expect(play(SWIPE_UP)).toEqual([1]);
    expect(play(SWIPE_UP, { sideways: true })).toEqual([1]);
    expect(play(SWIPE_LEFT, { sideways: true })).toEqual([1]);
  });

  it('leaves a sideways swipe to a control that only turns up and down', () => {
    expect(play(SWIPE_LEFT)).toEqual([]);
  });

  it('turns a dial again for each stretch of a swipe', () => {
    expect(play(SWIPE_UP, { travel: 40 })).toEqual([1, 1]);
    expect(play(NOTCH, { travel: 40 })).toEqual([1]);
  });

  it('counts a slow swipe once it has gone far enough, and steps the way it went', () => {
    const slow: Recorded = Array.from({ length: 10 }, (_, i) => [i * 16, 0, -2]);
    expect(play(slow)).toEqual([-1]);
    expect(play([[0, 0, 1], [16, 0, 1], [32, 0, 1]])).toEqual([]);
  });
});
