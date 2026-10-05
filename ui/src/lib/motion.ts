// Motion tokens. Transitions only ever touch transform and opacity, so the compositor runs them off
// the main thread. The values are the WPF release's, which the user preferred.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isReduced = reduced;

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
  const c = (p1: number) => 3 * p1;
  const at = (t: number, p1: number, p2: number) => ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
  const slope = (t: number, p1: number, p2: number) => 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);
  return (x: number) => {
    if (x <= 0 || x >= 1) return x;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      t -= (at(t, x1, x2) - x) / s;
    }
    return at(t, y1, y2);
  };
}

/** Window morph: host/Motion.cs samples the same curve. */
export const MORPH_CURVE = 'cubic-bezier(0.22, 0.8, 0.22, 1)';
export const MORPH_MS = 440;
export const easeMorph = bezier(0.22, 0.8, 0.22, 1);
export const easePage = bezier(0.2, 0.75, 0.25, 1);
export const easeOut = bezier(0.16, 1, 0.3, 1);
export const easeIn = bezier(0.5, 0, 0.75, 0);

/** The window size the chrome is heading for, and the shared instant and duration of the move. */
export interface Frame {
  w: number;
  h: number;
  start: number;
  ms: number;
}

/**
 * Moves one piece of chrome on the window's timeline: from wherever it is now to `to`, starting at
 * the wall-clock instant `start` (Date.now() units) that the host also starts the window at. The
 * animation runs on the compositor, so a busy main thread cannot make it drift from the window edge.
 */
export function follow(el: HTMLElement, to: string, start: number, ms: number) {
  const from = getComputedStyle(el).transform;
  for (const running of el.getAnimations()) running.cancel();
  el.style.transform = to;
  if (ms <= 0 || reduced()) return;
  const animation = el.animate([{ transform: from === 'none' ? 'translate(0px, 0px)' : from }, { transform: to }], {
    duration: ms,
    easing: MORPH_CURVE,
    fill: 'backwards',
  });
  // The page's timeline stands still while the PC sleeps and the wall clock does not, so after days
  // of sleep and wake the two are far apart: the start is placed by its distance from now instead.
  animation.startTime = (document.timeline.currentTime as number) + (start - Date.now());
}

interface Move {
  x?: number;
  y?: number;
  scale?: number;
  duration?: number;
  delay?: number;
  easing?: (t: number) => number;
}

export function move(_: Element, { x = 0, y = 0, scale = 1, duration = 230, delay = 0, easing = easePage }: Move = {}) {
  return {
    duration: reduced() ? 0 : duration,
    delay: reduced() ? 0 : delay,
    easing,
    css: (t: number, u: number) => `transform: translate3d(${x * u}px, ${y * u}px, 0) scale(${1 - (1 - scale) * u}); opacity: ${t};`,
  };
}

export function fade(_: Element, { duration = 160, delay = 0 }: { duration?: number; delay?: number } = {}) {
  return { duration: reduced() ? 0 : duration, delay: reduced() ? 0 : delay, css: (t: number) => `opacity: ${t};` };
}
