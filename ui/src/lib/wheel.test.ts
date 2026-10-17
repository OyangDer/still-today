import { describe, expect, it, vi } from 'vitest';
import { stepper } from './wheel';

// Recorded in the Mac's WebKit on 2026-10-17 over the calendar's month grid: [ms from the first event, deltaX, deltaY].
type Recorded = [number, number, number][];
const NOTCH: Recorded = [[0, 0, 4]];
const SLOW_NOTCHES: Recorded = [[0, 0, -4], [157, 0, -4], [390, 0, -4], [582, 0, -4]];
const FAST_NOTCHES: Recorded = [[0, 0, -4], [105, 0, -9.25], [217, 0, -23.1], [310, 0, -37.13]];
// A mouse wheel spun hard: seven notches, each faster than the last, with no pause between them.
const SPIN: Recorded = [[0, 0, -4], [44, 0, -31.58], [77, 0, -116.89], [113, 0, -174.23], [150, 0, -220.24], [180, 0, -244.52], [244, 0, -255.77]];
const SWIPE_UP: Recorded = [
  [0, 0, 1], [16, 1, 3], [32, 1, 7], [47, 1, 8], [66, -1, 8], [83, -1, 8], [99, -1, 6], [114, -1, 6], [132, -1, 4], [148, -1, 3], [164, 0, 2],
  [181, -1, 1], [199, -1, 1], [215, -1, 0], [232, -1, 0], [264, -1, 0], [282, -1, 0], [297, -1, -1], [314, -1, -1], [331, -1, -1], [347, -1, -1],
];
// A swipe to the left, and five pixels that trickled in a quarter of a second after it.
const SWIPE_LEFT: Recorded = [
  [0, 1, 0], [15, 6, 0], [32, 10, -1], [49, 12, -2], [65, 12, -2], [82, 11, -1], [99, 9, -1], [116, 6, -1], [133, 5, -1], [148, 3, -1], [165, 2, -1],
  [183, 1, -1], [200, 0, -1], [215, 0, -1], [274, 0, -1], [282, 0, -1], [548, 1, 0], [566, 1, 0], [583, 1, 0], [599, 1, 0], [615, 1, 0],
];
// Three swipes to the left in a row, each begun while the last one's momentum was still running.
const THREE_SWIPES: Recorded = [
  [0, 1, 0], [17, 4, 0], [34, 19, 0], [50, 68, -1], [72, 100, -6], [85, 96, -7], [86, 151, 0], [103, 156, 0], [119, 152, 0], [136, 143, 0], [153, 137, 0],
  [169, 129, 0], [186, 120, 0], [203, 114, 0], [220, 109, 0], [236, 104, 0], [253, 98, 0], [270, 94, 0], [286, 90, 0], [303, 85, 0], [320, 81, 0],
  [336, 76, 0], [353, 72, 0], [370, 66, 0], [386, 62, 0], [403, 58, 0], [420, 54, 0], [436, 51, 0], [453, 47, 0], [470, 43, 0], [487, 40, 0],
  [503, 37, 0], [519, 34, 0], [536, 31, 0], [552, 28, 0], [569, 26, 0], [586, 24, 0], [603, 22, 0], [620, 19, 0], [636, 18, 0], [700, 3, 0],
  [717, 16, 1], [734, 40, -3], [750, 103, 0], [767, 110, 0], [783, 108, 0], [800, 106, 0], [817, 102, 0], [833, 97, 0], [850, 95, 0], [867, 90, 0],
  [883, 85, 0], [900, 81, 0], [917, 76, 0], [934, 72, 0], [950, 66, 0], [967, 62, 0], [983, 58, 0], [1000, 55, 0], [1017, 51, 0], [1034, 47, 0],
  [1050, 43, 0], [1067, 40, 0], [1084, 37, 0], [1100, 34, 0], [1116, 31, 0], [1134, 28, 0], [1150, 26, 0], [1167, 24, 0], [1234, 2, 0], [1250, 11, 2],
  [1267, 25, -1], [1284, 75, -10], [1300, 112, -20], [1317, 119, -25], [1334, 64, -16], [1350, 55, -15], [1367, 33, -10], [1384, 18, -4], [1400, 13, -4],
  [1417, 8, -2], [1434, 3, -1], [1450, 2, -1], [1500, 0, -1], [1517, 0, -1], [1534, 0, -1], [1550, 0, -1],
];

// The 2026-10-17 swipe up that ran the months to 2032: its first frame was a 4px step, and was taken for a notch.
const SWIPE_UP_FROM_4: Recorded = [
  [0, 0, 4], [16, 0, 4], [31, -1, 20], [49, -2, 26], [65, -2, 26], [81, -1, 15], [99, -1, 11], [115, 0, 25], [131, 0, 28], [148, 0, 29], [165, 0, 15],
  [165, 0, 3], [165, 0, 3], [181, 0, 13], [181, 1, 1], [198, 0, 17], [198, 1, 1], [214, 0, 30], [215, 0, -1], [232, 0, 28], [232, 0, -1], [248, 0, 26],
  [249, 0, -2], [265, 0, 23], [265, 0, -3], [281, 0, 21], [281, 0, -8], [298, 0, 19], [298, -1, -17], [314, 0, 18],
];
// A swipe down and back up whose fingers drifted sideways by a few pixels.
const WANDERING_UP_DOWN: Recorded = [
  [0, 0, 1], [16, -1, 5], [33, -3, 13], [50, -2, 9], [66, -1, 6], [83, -1, 4], [100, -1, 3], [116, 0, 1], [133, 0, 1], [200, 0, -1], [216, 0, -1],
  [233, 0, -1], [250, 0, -2], [266, 0, -4], [283, 0, -6], [300, 1, -8], [316, 1, -7], [333, 0, -5], [350, 0, -4], [366, 0, -3], [383, -1, -4],
  [390, 0, -5], [406, 0, -5], [423, 0, -5], [439, 0, -5], [456, 0, -5], [473, 0, -5], [490, 0, -5], [506, 0, -5],
];

/** Plays recorded events on the clock they came in, so a 4px step waits as it would in the page. */
function play(events: Recorded, options?: Parameters<typeof stepper>[1]): number[] {
  vi.useFakeTimers();
  try {
    const steps: number[] = [];
    const wheel = stepper((way) => steps.push(way), options);
    let now = 0;
    for (const [t, deltaX, deltaY] of events) {
      vi.advanceTimersByTime(t - now);
      now = t;
      wheel({ timeStamp: 1000 + t, deltaX, deltaY });
    }
    vi.advanceTimersByTime(1000);
    return steps;
  } finally {
    vi.useRealTimers();
  }
}

describe('wheel steps', () => {
  it('turns a step for each notch of a mouse wheel, slow, fast or spun', () => {
    expect(play(NOTCH)).toEqual([1]);
    expect(play(SLOW_NOTCHES)).toEqual([-1, -1, -1, -1]);
    expect(play(FAST_NOTCHES)).toEqual([-1, -1, -1, -1]);
    expect(play(SPIN)).toEqual([-1, -1, -1, -1, -1, -1, -1]);
  });

  it('lets a mouse wheel turn a control that a touchpad turns sideways', () => {
    expect(play(NOTCH, { axis: 'x' })).toEqual([1]);
    expect(play(SLOW_NOTCHES, { axis: 'x' })).toEqual([-1, -1, -1, -1]);
  });

  it('turns one page for a swipe, however far its momentum carries it', () => {
    expect(play(SWIPE_UP)).toEqual([1]);
    expect(play(SWIPE_LEFT, { axis: 'x' })).toEqual([1]);
  });

  it('turns a page for each swipe of a quick run, though their momentum runs together', () => {
    expect(play(THREE_SWIPES, { axis: 'x' })).toEqual([1, 1, 1]);
  });

  it('turns back for a swipe back', () => {
    const back = SWIPE_LEFT.slice(0, 12).concat(SWIPE_LEFT.slice(0, 12).map(([t, dx, dy]) => [t + 240, -dx, dy] as [number, number, number]));
    expect(play(back, { axis: 'x' })).toEqual([1, -1]);
  });

  it('turns a control by touchpad only the way it moves', () => {
    expect(play(SWIPE_LEFT)).toEqual([]);
    expect(play(SWIPE_UP, { axis: 'x' })).toEqual([]);
    expect(play([[0, 4, 0]], { axis: 'x' })).toEqual([1]);
  });

  it('tells a swipe that starts with a 4px frame from a mouse notch', () => {
    expect(play(SWIPE_UP_FROM_4, { axis: 'x' })).toEqual([]);
    // 30 frames, 374px of net travel: once at the start, then once each 40px of the 370 after it, never back.
    expect(play(SWIPE_UP_FROM_4, { travel: 40 })).toEqual(Array(10).fill(1));
  });

  it('leaves a swipe the other way alone, however its fingers wander', () => {
    expect(play(WANDERING_UP_DOWN, { axis: 'x' })).toEqual([]);
    expect(play(WANDERING_UP_DOWN, { travel: 40 })).toEqual([1, -1]);
  });

  it('leaves the twitches back inside a run of swipes out of its count', () => {
    // Two swipes: the first slows to 3px at 165ms and the second speeds up from there. The frames back
    // between them (-1px to -17px) turned the page to and fro once each.
    const first = SWIPE_UP_FROM_4.filter(([t]) => t <= 165);
    expect(play(first)).toEqual([1]);
    expect(play(SWIPE_UP_FROM_4)).toEqual([1, 1]);
    const sideways = SWIPE_UP_FROM_4.map(([t, dx, dy]) => [t, dy, dx] as [number, number, number]);
    expect(play(sideways, { axis: 'x' })).toEqual([1, 1]);
  });

  it('turns back once for a swipe back that starts while the last one still runs', () => {
    // A swipe left, then, while its momentum slows, a swipe right, the two interleaved frame by frame.
    const swipe: Recorded = [[0, 2, 0], [16, 8, 0], [32, 30, 0], [48, 60, 0], [64, 58, 0], [80, 55, 0], [96, 50, 0]];
    let [t, momentum, back] = [112, 46, 3];
    for (let i = 0; i < 10; i++, t += 16, momentum = Math.round(momentum * 0.9), back = Math.min(60, back * 2))
      swipe.push([t, momentum, 0], [t, -back, 0]);
    expect(play(swipe, { axis: 'x' })).toEqual([1, -1]);
  });

  it('turns a step for each notch of a mouse wheel in WebView2, 100px a notch', () => {
    const slow: Recorded = [[0, 0, 100], [200, 0, 100], [400, 0, -100], [600, 0, 100]];
    expect(play(slow, { axis: 'x' })).toEqual([1, 1, -1, 1]);
    expect(play(slow, { travel: 40 })).toEqual([1, 1, -1, 1]);
  });

  it('turns a dial again for each stretch of a swipe, and once a notch', () => {
    expect(play(SWIPE_UP, { travel: 40 })).toEqual([1, 1]);
    expect(play(NOTCH, { travel: 40 })).toEqual([1]);
  });

  it('counts a slow swipe once it has gone far enough, and steps the way it went', () => {
    const slow: Recorded = Array.from({ length: 10 }, (_, i) => [i * 16, 0, -2]);
    expect(play(slow)).toEqual([-1]);
    expect(play([[0, 0, 1], [16, 0, 1], [32, 0, 1]])).toEqual([]);
  });
});
