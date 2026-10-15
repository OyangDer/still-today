// Mouse wheels and touchpads, turned into steps. Measured on the Mac with a real mouse and touchpad:
// a mouse wheel sends one event a notch, up or down only, 4px for a gentle notch (100 in WebView2) and
// more when spun; a touchpad sends one event a frame for as long as the fingers move, starting at a
// pixel or two, and goes on through the momentum after they lift, which only ever slows. A quick next
// swipe begins before that momentum has stopped, 45-80ms after its last frame: it shows as a frame that
// speeds up again. A pixel or two may still trickle in after a swipe. Stepping per so many pixels gave
// a mouse notch nothing (4px of 40) and a swipe several pages.

/** Longer than a frame's gap within a swipe (16ms): a pause this long starts a new swipe or run of notches. */
const PAUSE = 80;
/** A mouse notch is at least this, and a swipe has a frame this big within its first few. */
const NOTCH = 4;
/** A swipe slow enough to stay under a notch a frame counts once it has gone this far; the trickle
    after a swipe never does. */
const CREEP = 12;

type Wheel = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'timeStamp'>;

/**
 * Calls `step` with the way it turns (1 down or left, -1 up or right). A mouse wheel steps once a notch,
 * up and down, on every control. A touchpad steps once a swipe, and only the way the control moves: `x`
 * sideways, `y` up and down; with `travel`, a swipe steps again for every `travel` px it goes on (a dial).
 */
export function stepper(step: (way: 1 | -1) => void, { travel = 0, axis = 'y' }: { travel?: number; axis?: 'x' | 'y' } = {}): (e: Wheel) => void {
  let last = -Infinity;
  // Whether the events since the last pause come from a mouse wheel: their first one says.
  let wheel: boolean | null = null;
  let moved = 0;
  // The swipe under way: its direction (0 before it counts), its fastest frame, its slowest since.
  let way = 0;
  let peak = 0;
  let floor = Infinity;
  const reset = () => {
    moved = 0;
    way = 0;
    peak = 0;
    floor = Infinity;
  };
  return (e) => {
    if (e.timeStamp - last > PAUSE) {
      reset();
      wheel = null;
    }
    last = e.timeStamp;
    if (!e.deltaX && !e.deltaY) return;
    // A notch is up or down only and 4px or more; a swipe starts a pixel or two at a time, or sideways.
    wheel ??= e.deltaX === 0 && Math.abs(e.deltaY) >= NOTCH;
    if (wheel) {
      if (e.deltaY) step(e.deltaY > 0 ? 1 : -1);
      return;
    }
    const across = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const delta = across === (axis === 'x') ? (across ? e.deltaX : e.deltaY) : 0;
    if (!delta) return;
    const size = Math.abs(delta);
    if (way) {
      if (Math.sign(delta) !== way) floor = 0;
      else if (size >= peak) [peak, floor] = [size, Infinity];
      else floor = Math.min(floor, size);
      // Slowed to a quarter or a crawl, then faster again: the next swipe.
      if (floor <= Math.max(3, peak / 4) && size >= floor * 2 + 4) reset();
    }
    if (Math.sign(delta) !== Math.sign(moved)) moved = 0;
    moved += delta;
    const turns = way ? travel > 0 && Math.abs(moved) >= travel : size >= NOTCH || Math.abs(moved) >= CREEP;
    if (!turns) return;
    const dir = moved > 0 ? 1 : -1;
    if (!way) [way, peak, floor] = [dir, size, Infinity];
    moved = 0;
    step(dir);
  };
}
