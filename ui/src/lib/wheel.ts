// Mouse wheels and touchpads, turned into steps. A mouse wheel sends one event a notch (4px a notch in
// the Mac's WebKit, measured on a real mouse; 100 in WebView2), and every notch after a pause is its
// own. A touchpad sends one event a frame for as long as the fingers move, and goes on through the
// momentum after they lift, which only ever slows. A quick next swipe begins before that momentum has
// stopped, 45-80ms after its last frame: it shows as a frame that speeds up again. A pixel or two may
// still trickle in after a swipe. Stepping per so many pixels gave a mouse notch nothing (4px of 40)
// and a swipe several pages.

/** Longer than a frame's gap within a swipe (16ms), shorter than a wheel's between notches (90ms+). */
const PAUSE = 80;
/** A notch is one event this big, and a swipe has one within its first few frames. */
const NOTCH = 4;
/** A swipe slow enough to stay under a notch a frame counts once it has gone this far; the trickle
    after a swipe never does. */
const CREEP = 12;

type Wheel = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'timeStamp'>;

/**
 * Calls `step` once for each notch and each swipe, with the way it turns (1 down or left, -1 up or
 * right): a pager. With `travel`, a swipe steps again for every `travel` px it goes on: a dial.
 * Sideways swipes turn it only with `sideways`; otherwise they are left alone.
 */
export function stepper(step: (way: 1 | -1) => void, { travel = 0, sideways = false } = {}): (e: Wheel) => void {
  let last = -Infinity;
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
    const across = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const delta = across ? (sideways ? e.deltaX : 0) : e.deltaY;
    if (e.timeStamp - last > PAUSE) reset();
    last = e.timeStamp;
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
