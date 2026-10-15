// Mouse wheels and touchpads, turned into steps. Measured on the Mac with a real mouse and touchpad:
// - A mouse wheel sends one event a notch, up or down only: exactly 4px for a gentle notch (100 in
//   WebView2), a fraction of a pixel off a whole number when spun (9.1, 23.1, 244.52).
// - A touchpad sends one event a frame (16ms) in whole pixels, starting at a pixel or two, and goes on
//   through the momentum after the fingers lift, which only ever slows. A quick next swipe begins
//   before that momentum has stopped, 45-80ms after its last frame, and shows as a frame that speeds
//   up again. A pixel or two may still trickle in after a swipe.
// So a fraction means a mouse, a whole number other than a 4px step up or down means a touchpad, and a
// 4px step waits a moment: a touchpad's next frame follows within 16ms, a mouse's next notch does not.
// Taking a swipe's 4px first frame for a notch stepped the months once a frame, years in one swipe.

/** A pause this long (longer than a frame's gap within a swipe) starts a new swipe or run of notches. */
const PAUSE = 80;
/** A gentle mouse notch, and the size of frame that starts a swipe. */
const NOTCH = 4;
/** A swipe slow enough to stay under a notch a frame counts once it has gone this far; the trickle
    after a swipe never does. */
const CREEP = 12;
/** How long a 4px step up or down waits to see whether a touchpad's next frame follows. */
const HOLD = 40;

type Wheel = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'timeStamp'>;
type Device = 'wheel' | 'pad';

/** What an event says of its device on its own: null for a 4px step up or down, which either sends. */
function device(e: Wheel): Device | null {
  if (e.deltaX === 0 && !Number.isInteger(e.deltaY)) return 'wheel';
  return e.deltaX === 0 && Math.abs(e.deltaY) === NOTCH ? null : 'pad';
}

/**
 * Calls `step` with the way it turns (1 down or left, -1 up or right). A mouse wheel steps once a notch,
 * up and down, on every control. A touchpad steps once a swipe, and only for a swipe the way the control
 * moves (`x` sideways, `y` up and down); a swipe the other way is left alone, however its fingers
 * wander. With `travel` it is a dial: a swipe steps at once, then again for every `travel` px of net
 * travel its way, until the touchpad pauses.
 */
export function stepper(step: (way: 1 | -1) => void, { travel = 0, axis = 'y' }: { travel?: number; axis?: 'x' | 'y' } = {}): (e: Wheel) => void {
  let last = -Infinity;
  // The device sending the events since the last pause, once known, and a 4px step waiting to learn it.
  let from: Device | null = null;
  let held: Wheel | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The swipe under way: its travel until its way is known, then that way (`along`, `dir`), its fastest
  // frame and its slowest since, and a dial's travel since its last step.
  let sx = 0;
  let sy = 0;
  let along: 'x' | 'y' | null = null;
  let dir = 0;
  let peak = 0;
  let floor = Infinity;
  let moved = 0;
  const reset = () => {
    [sx, sy, along, dir, peak, floor, moved] = [0, 0, null, 0, 0, Infinity, 0];
  };

  const swipe = (e: Wheel) => {
    // A dial follows the swipe's net travel its way: a swipe back while the last one's momentum still
    // runs sends both at once, interleaved, and they cancel out rather than turning it to and fro.
    if (along && travel) {
      if (along !== axis) return;
      moved += along === 'x' ? e.deltaX : e.deltaY;
      while (Math.abs(moved) >= travel) {
        const way = moved > 0 ? 1 : -1;
        moved -= way * travel;
        step(way);
      }
      return;
    }
    if (along) {
      const d = along === 'x' ? e.deltaX : e.deltaY;
      const size = Math.abs(d);
      if (d && Math.sign(d) !== dir) floor = 0;
      else if (size >= peak) [peak, floor] = [size, Infinity];
      else floor = Math.min(floor, size);
      // Slowed to a quarter or a crawl (or turned back), then faster again: the next swipe, which this
      // frame starts.
      if (floor > Math.max(3, peak / 4) || size < floor * 2 + 4) return;
      reset();
    }
    sx += e.deltaX;
    sy += e.deltaY;
    if (Math.max(Math.abs(e.deltaX), Math.abs(e.deltaY)) < NOTCH && Math.max(Math.abs(sx), Math.abs(sy)) < CREEP) return;
    along = Math.abs(sx) > Math.abs(sy) ? 'x' : 'y';
    dir = Math.sign(along === 'x' ? sx : sy);
    [peak, floor, moved] = [Math.abs(along === 'x' ? e.deltaX : e.deltaY), Infinity, 0];
    if (along === axis) step(dir > 0 ? 1 : -1);
  };

  const take = (e: Wheel) => {
    if (from === 'pad') swipe(e);
    else if (e.deltaY) step(e.deltaY > 0 ? 1 : -1);
  };

  return (e) => {
    if (e.timeStamp - last > PAUSE) {
      reset();
      from = null;
    }
    last = e.timeStamp;
    if (!e.deltaX && !e.deltaY) return;
    const says = device(e);
    if (held) {
      clearTimeout(timer);
      from = says === 'wheel' ? 'wheel' : 'pad';
      const first = held;
      held = null;
      take(first);
      take(e);
      return;
    }
    if (says && says !== from) {
      if (says === 'pad') reset();
      from = says;
    }
    if (from) {
      take(e);
      return;
    }
    held = e;
    timer = setTimeout(() => {
      if (!held) return;
      from = 'wheel';
      const notch = held;
      held = null;
      take(notch);
    }, HOLD);
  };
}
