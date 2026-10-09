<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { bucketOf, todos, upcomingDeadlines, upcomingEvents, type Occurrence, type TodoItem } from '../lib/agenda';
  import { dayPart, dueLabel, longDate, t } from '../lib/i18n';
  import { hhmm } from '../lib/time';
  import { easeIn, easeMorph, fade, isReduced, move } from '../lib/motion';

  const now = $derived(app.now);
  const digits = $derived(hhmm(now).replace(':', '').split(''));
  const deadlines = $derived(upcomingDeadlines(todos(app.data), now));
  const events = $derived(upcomingEvents(app.data, now));
  // What falls due from today through the sixth day on, as the task list's "this week" counts it.
  const soon = $derived(deadlines.filter((d) => bucketOf(d, now) !== 'later').length);
  // The count stands out from the words around it, wherever the language puts it.
  const soonWords = $derived(t('today.soon', { n: '\n' }).split('\n'));

  /**
   * The wheel over a row pages through what comes after its first item, sliding the row sideways;
   * leaving the row slides back to the first. Running past either end nudges the row instead.
   */
  class Pager {
    index = $state(0);
    direction = $state(1);
    hover = $state(false);
    el = $state<HTMLElement>();
    #delta = 0;
    #last = 0;
    #seen = 0;
    #way = 0;
    #nudged = false;
    #away = 0;

    readonly count: () => number;

    constructor(count: () => number) {
      this.count = count;
    }

    /** The index actually shown, should the list shrink under it. */
    get at() {
      return Math.min(this.index, Math.max(0, this.count() - 1));
    }

    go(i: number) {
      if (i === this.at) return;
      if (i < 0 || i >= this.count()) {
        if (!isReduced())
          this.el?.animate([{ transform: 'none' }, { transform: `translateX(${i < 0 ? 6 : -6}px)` }, { transform: 'none' }], {
            duration: 260,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
          });
        return;
      }
      this.direction = i > this.at ? 1 : -1;
      this.index = i;
    }

    wheel = (e: WheelEvent) => {
      if (this.count() < 2) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      // A swipe's momentum keeps the wheel turning after the finger lifts, so events without a pause
      // between them are one gesture, and it nudges at an end once rather than every page's worth.
      if (e.timeStamp - this.#seen > 200) this.#nudged = false;
      this.#seen = e.timeStamp;
      if (!delta) return;
      if (Math.sign(delta) !== this.#way) {
        this.#way = Math.sign(delta);
        this.#nudged = false;
      }
      if (Math.sign(delta) !== Math.sign(this.#delta)) this.#delta = 0;
      this.#delta += delta;
      // One page per notch; a touchpad pages every notch's worth of travel, but no faster than the
      // slide can be read.
      if (Math.abs(this.#delta) < 40 || e.timeStamp - this.#last < 110) return;
      this.#last = e.timeStamp;
      const to = this.at + Math.sign(this.#delta);
      this.#delta = 0;
      if (to < 0 || to >= this.count()) {
        if (this.#nudged) return;
        this.#nudged = true;
      }
      this.go(to);
    };

    key = (e: KeyboardEvent) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      this.go(this.at + step);
    };

    enter = () => {
      clearTimeout(this.#away);
      this.hover = true;
    };

    leave = () => {
      this.hover = false;
      this.#away = window.setTimeout(() => this.go(0), 900);
    };
  }

  // Outgoing and incoming items share one curve and stay a slot apart, so they push each other
  // along rather than cross over.
  function push(_: Element, { direction, entering }: { direction: number; entering: boolean }) {
    const sign = entering ? direction : -direction;
    return {
      duration: isReduced() ? 0 : 340,
      easing: easeMorph,
      css: (t: number, u: number) => `transform: translate3d(calc(${u * 100 * sign}% + ${u * 20 * sign}px), 0, 0); opacity: ${0.35 + 0.65 * t};`,
    };
  }

  const deadlinePager = new Pager(() => deadlines.length);
  const eventPager = new Pager(() => events.length);
  const deadline = $derived<TodoItem | null>(deadlines[deadlinePager.at] ?? null);
  const event = $derived<Occurrence | null>(events[eventPager.at] ?? null);
  const due = $derived(deadline?.due ? dueLabel(deadline.due, now, deadline.timed) : null);

  // The event row reads like the deadline row: where it is above the title, when it starts at the right.
  // One already under way says so, and when it ends.
  function eventWhen() {
    if (!event) return '';
    if (event.start > now) return dueLabel(event.start, now).text;
    return event.end ? t('today.until', { t: hhmm(event.end) }) : t('today.now');
  }

  function eventMeta() {
    const label = event && event.start <= now ? t('today.now') : t('today.event');
    const where = event?.location || (event?.label && event.label);
    return where ? `${label} · ${where}` : label;
  }

  // The detail opens over the overview, so Back returns here.
  function openDeadline() {
    if (deadline) app.openTask(deadline.key);
  }

  function openSoon() {
    app.tasksFilter = 'todo';
    app.go('tasks');
  }

  function openEvent() {
    app.calendarDay = event?.start ?? now;
    app.go('calendar');
  }
</script>

<div class="today">
  <div class="hero">
    <div class="time">
      <span class="clock num" aria-label={hhmm(now)}>
        {#each digits as digit, i (i)}
          {#if i === 2}<span class="colon">:</span>{/if}
          <span class="slot">
            {#key digit}
              <span class="digit" in:move={{ y: 24, duration: 520, easing: easeMorph }} out:move={{ y: -20, duration: 240, easing: easeIn }}>{digit}</span>
            {/key}
          </span>
        {/each}
      </span>
      <span class="part">{dayPart(now)}</span>
    </div>
    <div class="date">
      <span class="day">{longDate(now)}</span>
      <button class="soon" onclick={openSoon}>
        {#if soon}{soonWords[0]}<b class="num">{soon}</b>{soonWords[1]}{:else}{t('today.soonNone')}{/if}
      </button>
    </div>
  </div>

  <button
    class="row"
    disabled={!deadline}
    onclick={openDeadline}
    onwheel={deadlinePager.wheel}
    onkeydown={deadlinePager.key}
    onpointerenter={deadlinePager.enter}
    onpointerleave={deadlinePager.leave}
  >
    <span class="bar warm" style:--course={deadline?.color}></span>
    <span class="slides" bind:this={deadlinePager.el}>
      {#key deadline?.key}
        <span class="slide" in:push={{ direction: deadlinePager.direction, entering: true }} out:push={{ direction: deadlinePager.direction, entering: false }}>
          <span class="body">
            <span class="eyebrow ellipsis"
              >{t('today.due')}{deadline ? ` · ${deadline.course ? deadline.course : t('tasks.personal')}` : ''}</span
            >
            <span class="title ellipsis">{deadline?.title ?? t('today.nothingDue')}</span>
          </span>
          {#if due}<span class="when num" class:urgent={due.tone !== 'normal'}>{due.text}</span>{/if}
        </span>
      {/key}
    </span>
    {#if deadlinePager.hover && deadlines.length > 1}
      <span class="count num" transition:fade={{ duration: 140 }}>{deadlinePager.at + 1}/{deadlines.length}</span>
    {/if}
  </button>

  <button
    class="row"
    class:empty={!event}
    onclick={openEvent}
    onwheel={eventPager.wheel}
    onkeydown={eventPager.key}
    onpointerenter={eventPager.enter}
    onpointerleave={eventPager.leave}
  >
    <span class="bar accent" style:--course={event?.color}></span>
    <span class="slides" bind:this={eventPager.el}>
      {#key event?.key}
        <span class="slide" in:push={{ direction: eventPager.direction, entering: true }} out:push={{ direction: eventPager.direction, entering: false }}>
          <span class="body">
            <span class="eyebrow ellipsis">{eventMeta()}</span>
            <span class="title ellipsis">{event?.title ?? t('today.noEvent')}</span>
          </span>
          {#if event}<span class="when num" class:live={event.start <= now}>{eventWhen()}</span>{/if}
        </span>
      {/key}
    </span>
    {#if eventPager.hover && events.length > 1}
      <span class="count num" transition:fade={{ duration: 140 }}>{eventPager.at + 1}/{events.length}</span>
    {/if}
  </button>
</div>

<style>
  .today {
    padding: 0 20px 12px;
  }

  .hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 0 16px;
    border-bottom: 1px solid var(--line);
  }

  .time {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .clock {
    display: flex;
    font: 300 72px/1 var(--font-display);
    letter-spacing: -1.5px;
    font-variation-settings: 'wght' 270;
  }

  /* SF's figures run wider than Segoe's; at 72px the date beside them is pushed out of the card. */
  :global([data-os='mac']) .clock {
    font-size: 60px;
    letter-spacing: -2px;
  }

  .slot {
    display: inline-grid;
    overflow: hidden;
    height: 1.1em;
    align-items: center;
  }

  .slot > .digit {
    grid-area: 1 / 1;
  }

  .colon {
    padding: 0 1px 5px;
    opacity: 0.6;
  }

  .part {
    padding-bottom: 7px;
    font-size: 13px;
    color: var(--muted);
  }

  .date {
    display: grid;
    min-width: 0;
    justify-items: end;
    gap: 3px;
    padding-bottom: 6px;
  }

  .day {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 14px;
    font-weight: 650;
    white-space: nowrap;
  }

  .soon {
    margin-right: -6px;
    padding: 1px 6px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    transition:
      background-color var(--t-micro),
      color var(--t-micro);
  }

  .soon:hover {
    color: var(--ink);
    background: var(--control);
  }

  .soon b {
    font-weight: 650;
    color: var(--warm);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: calc(100% + 16px);
    margin: 0 -8px;
    padding: 12px 8px;
    border-radius: 10px;
    text-align: left;
    transition:
      background-color var(--t-micro),
      transform var(--t-short) var(--ease-out);
  }

  .row {
    position: relative;
  }

  /* The row's content slides inside this window; the bar stays put. */
  .slides {
    display: grid;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .slide {
    grid-area: 1 / 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .count {
    position: absolute;
    top: 7px;
    right: 10px;
    font-size: 10.5px;
    color: var(--muted);
    opacity: 0.8;
  }

  .row + .row::before {
    content: '';
    position: absolute;
    top: 0;
    left: 8px;
    right: 8px;
    border-top: 1px solid var(--line);
  }

  .row:not(:disabled):hover {
    background: var(--control);
  }

  .row:not(:disabled):hover + .row::before,
  .row:not(:disabled):hover::before {
    opacity: 0;
  }

  .row:not(:disabled):active {
    transform: scale(0.985);
  }

  .bar {
    align-self: stretch;
    width: 3px;
    margin: 2px 0;
    border-radius: 3px;
    flex: none;
    transition: background-color 340ms var(--ease-morph);
  }

  /* The bar wears the course colour of the item on show, and changes with it as the row pages. */
  .bar.warm {
    background: var(--course-lit, var(--warm));
  }

  .bar.accent {
    background: var(--course-lit, var(--accent));
  }

  .body {
    display: grid;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .eyebrow {
    font-size: 11.5px;
    color: var(--muted);
  }

  .title {
    font-size: 14px;
    font-weight: 650;
  }

  .row:disabled .title,
  .row.empty .title {
    color: var(--muted);
    font-weight: 500;
  }

  .when {
    flex: none;
    font-size: 12.5px;
    color: var(--muted);
  }

  .when.urgent {
    color: var(--warm);
    font-weight: 600;
  }

  .when.live {
    color: var(--accent);
    font-weight: 600;
  }
</style>
