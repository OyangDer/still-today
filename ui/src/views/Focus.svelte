<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { byDue, coursesOf, focusSeconds, todos } from '../lib/agenda';
  import { dueLabel, duration, t } from '../lib/i18n';
  import { startOfDay } from '../lib/time';
  import { easeIn, easeMorph, easeOut, fade, move } from '../lib/motion';
  import CourseFilter from '../components/CourseFilter.svelte';
  import Icon from '../components/Icon.svelte';

  const PRESETS = [15, 25, 45, 60];
  // Hours, minutes and seconds each adjust on their own, as in the WPF release.
  const UNITS = [3600, 60, 1];
  const MAX = 10 * 3600;
  const DRAG_STEP = 8;

  let seconds = $state(app.data.settings.focusSeconds);
  // Digits roll up while a length grows and down while it shrinks or counts down.
  let roll = $state(1);
  // A step that lands while the last one is still rolling swaps the digits without a roll, so a fast
  // scroll or drag never stacks several digits in one slot.
  const ROLL = 260;
  let steppedAt = 0;
  let instant = $state(false);
  let wheelDelta = 0;
  let task = $state<string | null>(app.focusTarget);
  let picking = $state(false);

  $effect(() => {
    // "Focus on this" from a task page lands here with that task chosen.
    if (app.focusTarget) {
      task = app.focusTarget;
      app.focusTarget = null;
    }
  });

  const timer = $derived(app.data.timer);
  const finished = $derived(app.finished);
  const phase = $derived(finished && !timer ? 'finished' : timer ? (timer.endsAt ? 'running' : 'paused') : 'idle');
  // While a session runs the time is the subject and its controls step back; pausing keeps that.
  const active = $derived(phase === 'running' || phase === 'paused');
  const stage = $derived(active ? 'active' : phase);
  const left = $derived.by(() => {
    if (!timer) return seconds;
    return timer.endsAt ? Math.max(0, Math.ceil((timer.endsAt - app.now.getTime()) / 1000)) : timer.remaining;
  });
  const progress = $derived(phase === 'finished' ? 1 : timer ? 1 - left / timer.duration : 0);
  const segments = $derived([Math.floor(left / 3600), Math.floor(left / 60) % 60, left % 60].map((n) => String(n).padStart(2, '0')));
  const direction = $derived(phase === 'idle' ? roll : -1);
  const rollMs = $derived(phase === 'idle' && instant ? 0 : ROLL);
  const unitNames = ['focus.hours', 'focus.minutes', 'focus.seconds'] as const;
  const choices = $derived(todos(app.data).filter((i) => !i.done).sort(byDue));
  // A task finished or deleted since it was chosen is no longer on offer.
  const chosen = $derived(choices.some((i) => i.key === task) ? task : null);
  // The task list's course pill, over the courses that still have open work.
  const courses = $derived(coursesOf(choices));
  const hasPersonal = $derived(choices.some((i) => i.course === null));
  let course = $state<string | null>(null);
  const listCourse = $derived(course === null || (course === '' ? hasPersonal : courses.some((c) => c.code === course)) ? course : null);
  $effect.pre(() => {
    if (listCourse !== course) course = listCourse;
  });
  const shown = $derived(listCourse === null ? choices : choices.filter((i) => (i.course ?? '') === listCourse));
  // A course keeps the list at the height it has for all of them: the card holds still while the
  // choice changes, and the course menu always has room to open.
  let fullHeight = $state(0);
  const taskTitle = $derived(app.titleOf(timer?.task ?? chosen));
  const today = $derived(focusSeconds(app.data, null, startOfDay(app.now)));

  function setSeconds(value: number) {
    const next = Math.max(1, Math.min(MAX, Math.round(value)));
    if (next === seconds) return;
    roll = next > seconds ? 1 : -1;
    instant = performance.now() - steppedAt < ROLL;
    steppedAt = performance.now();
    seconds = next;
  }

  // One step per wheel notch; a touchpad steps once per notch's worth of travel.
  function wheel(e: WheelEvent, unit: number) {
    if (phase !== 'idle') return;
    e.preventDefault();
    wheelDelta += e.deltaY;
    if (Math.abs(wheelDelta) < 40) return;
    setSeconds(seconds - Math.sign(wheelDelta) * unit);
    wheelDelta = 0;
  }

  function drag(e: PointerEvent, unit: number) {
    if (phase !== 'idle' || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startValue = seconds;
    const onMove = (m: PointerEvent) => setSeconds(startValue + Math.trunc((startY - m.clientY) / DRAG_STEP) * unit);
    // A drag the system takes over (a touch turned scroll, the window losing the pointer) ends in
    // pointercancel, not pointerup; without this the dial kept following the pointer for good.
    const up = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function key(e: KeyboardEvent, unit: number) {
    if (phase !== 'idle') return;
    const step = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (step) {
      e.preventDefault();
      setSeconds(seconds + step * unit);
    }
  }

  function start() {
    app.data.settings.focusSeconds = seconds;
    app.startTimer(seconds, chosen);
  }
</script>

<div class="focus">
  {#if picking}
    <div class="picker" in:move={{ y: 8, duration: 280, easing: easeOut }}>
      <div class="picker-head">
        <button class="back" onclick={() => (picking = false)}><Icon name="left" size={16} /><span class="ellipsis">{t('focus.pick')}</span></button>
        {#if courses.length > 1 || (courses.length && hasPersonal)}
          <CourseFilter bind:value={course} {courses} personal={hasPersonal} />
        {/if}
      </div>
      <div class="options scroll" bind:offsetHeight={fullHeight} style:min-height={listCourse === null ? null : `${fullHeight}px`}>
        <button class="option" class:chosen={chosen === null} onclick={() => ((task = null), (picking = false))}>
          <span class="dot free"></span><span class="ellipsis">{t('focus.free')}</span>
        </button>
        {#each shown.slice(0, 30) as item (item.key)}
          {@const due = item.due ? dueLabel(item.due, app.now, item.timed) : null}
          <button class="option" class:chosen={chosen === item.key} onclick={() => ((task = item.key), (picking = false))}>
            <span class="dot" style:--course={item.color}></span>
            <span class="option-body">
              <span class="ellipsis">{item.title}</span>
              <span class="option-meta" data-tone={due?.tone} title={item.course ?? undefined}
                ><span class="ellipsis">{item.course ? item.course : t('tasks.personal')}</span>{#if due}<span class="due">&nbsp;· {due.text}</span>{/if}</span
              >
            </span>
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <p class="caption ellipsis">
      {#key phase}
        <span in:fade={{ duration: 200, delay: 60 }}>
          {#if phase === 'idle'}{t('focus.prompt')}
          {:else if phase === 'finished'}{t('focus.done')}{finished?.title ? ` · ${finished.title}` : ''}
          {:else}{t(phase === 'running' ? 'focus.running' : 'focus.paused')}{taskTitle ? ` · ${taskTitle}` : ''}{/if}
        </span>
      {/key}
    </p>

    <div class="time num" class:active class:paused={phase === 'paused'} title={phase === 'idle' ? t('focus.adjust') : undefined}>
      {#if phase === 'finished'}
        <span class="done" in:move={{ scale: 0.7, duration: 480, easing: easeMorph }}><Icon name="check" size={34} />{duration(finished?.seconds ?? 0)}</span>
      {:else}
        {#each segments as segment, s (s)}
          {#if s > 0}<span class="colon">:</span>{/if}
          <span
            class="segment"
            class:adjustable={phase === 'idle'}
            role="spinbutton"
            tabindex={phase === 'idle' ? 0 : -1}
            aria-readonly={phase !== 'idle'}
            aria-label={t(unitNames[s])}
            aria-valuenow={Number(segment)}
            onwheel={(e) => wheel(e, UNITS[s])}
            onpointerdown={(e) => drag(e, UNITS[s])}
            onmousedown={(e) => e.preventDefault()}
            onkeydown={(e) => key(e, UNITS[s])}
          >
            {#each segment.split('') as digit, i (i)}
              <span class="slot">
                {#key digit}
                  <span class="digit" in:move={{ y: 22 * direction, duration: rollMs, easing: easeOut }} out:move={{ y: -18 * direction, duration: rollMs && 160, easing: easeIn }}>{digit}</span>
                {/key}
              </span>
            {/each}
          </span>
        {/each}
      {/if}
    </div>

    <div class="middle">
      {#if phase === 'idle'}
        <div class="presets" in:fade={{ duration: 200 }}>
          {#each PRESETS as p (p)}
            <button class:on={seconds === p * 60} onclick={() => setSeconds(p * 60)}>{p}</button>
          {/each}
          <span class="unit">{t('min')}</span>
        </div>
      {:else}
        <!-- One transform per second; the 1s linear transition lets the compositor fill in the frames. -->
        <div class="track" class:full={phase === 'finished'} in:fade={{ duration: 200 }}>
          <span class="fill" class:running={phase === 'running'} style:transform="scaleX({progress})"></span>
        </div>
      {/if}
    </div>

    <div class="controls">
      {#key stage}
        <div
          class="row"
          class:compact={active}
          in:move={{ scale: active ? 1.12 : 0.94, duration: 380, delay: 70, easing: easeOut }}
          out:move={{ scale: 0.92, duration: 150, easing: easeIn }}
        >
          {#if phase === 'idle'}
            <button class="btn quiet link-task" onclick={() => (picking = true)}>
              <Icon name="target" size={15} />
              <span class="ellipsis">{app.titleOf(chosen) ?? t('focus.free')}</span>
              <Icon name="down" size={14} />
            </button>
            <button class="btn primary" onclick={start}><Icon name="play" size={13} fill />{t('focus.start')}</button>
          {:else if phase === 'finished'}
            <button class="btn quiet" onclick={() => (app.finished = null)}>{t('focus.finish')}</button>
            <button class="btn primary" onclick={() => ((app.finished = null), start())}>{t('focus.again')}</button>
          {:else}
            <button class="btn quiet" onclick={() => app.endTimer()}><Icon name="stop" size={13} />{t('focus.end')}</button>
            {#if phase === 'running'}
              <button class="btn quiet" onclick={() => app.pauseTimer()}><Icon name="pause" size={14} />{t('focus.pause')}</button>
            {:else}
              <button class="btn soft" onclick={() => app.resumeTimer()}><Icon name="play" size={12} fill />{t('focus.resume')}</button>
            {/if}
          {/if}
        </div>
      {/key}
    </div>
    {#if app.unrecorded && !active}
      <p class="note" in:fade={{ duration: 200 }}>{t('focus.notRecorded')}</p>
    {:else if phase === 'idle' && today >= 60}
      <p class="note">{t('focus.today', { d: duration(today) })}</p>
    {/if}
  {/if}
</div>

<style>
  .focus {
    padding: 16px 20px 14px;
    text-align: center;
  }

  .caption {
    margin: 0;
    font-size: 12.5px;
    color: var(--muted);
  }

  /* Tall enough for the running scale, so starting only transforms the time and moves nothing. */
  .time {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 96px;
    font: 300 52px/1 var(--font-display);
    font-variation-settings: 'wght' 270;
    letter-spacing: -1px;
    transition: transform var(--t-long) var(--ease-morph);
  }

  .time.active {
    transform: scale(1.34);
  }

  .segment {
    display: flex;
    padding: 2px 3px;
    border-radius: 10px;
    touch-action: none;
    transition: background-color var(--t-micro);
  }

  .segment.adjustable {
    cursor: ns-resize;
  }

  .segment.adjustable:hover,
  .segment.adjustable:focus-visible {
    background: var(--control);
  }

  /* Each digit rolls inside its own clipped slot, so a change never reflows the row. */
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
    opacity: 0.5;
  }

  .paused {
    animation: breathe 2.4s var(--ease-standard) infinite;
  }

  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }

  .done {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 26px;
    font-weight: 500;
    color: var(--accent);
  }

  .middle {
    display: grid;
    place-items: center;
    height: 30px;
  }

  .presets {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .presets button {
    min-width: 44px;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    background: var(--control);
    transition: background-color var(--t-micro), color var(--t-micro), transform var(--t-short) var(--ease-out);
  }

  .presets button:hover {
    color: var(--ink);
    background: var(--control-hover);
  }

  .presets button:active {
    transform: scale(0.95);
  }

  .presets button.on {
    color: var(--accent);
    background: var(--accent-soft);
    font-weight: 650;
  }

  .unit {
    margin-left: 2px;
    font-size: 12px;
    color: var(--muted);
  }

  .track {
    width: 264px;
    height: 4px;
    margin-top: -6px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--control-press);
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: var(--accent);
    transform-origin: left center;
    transition: transform 700ms var(--ease-morph);
  }

  .fill.running {
    transition: transform 1s linear;
  }

  .track.full {
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 50%, transparent);
  }

  /* Both rows share one cell while they swap, and the cell keeps the full row's height, so the card
     does not change size under them. */
  .controls {
    display: grid;
    align-items: center;
    min-height: 38px;
    margin-top: 12px;
  }

  .row {
    grid-area: 1 / 1;
    display: flex;
    gap: 8px;
  }

  .row .btn {
    flex: 1;
  }

  .row.compact {
    justify-content: center;
    gap: 10px;
  }

  .row.compact .btn {
    flex: none;
    height: 32px;
    padding: 0 15px 0 13px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
  }

  .btn.soft {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .btn.soft:hover {
    filter: brightness(1.08);
  }

  .link-task {
    min-width: 0;
    padding: 0 12px;
    font-weight: 500;
  }

  .link-task span {
    flex: 1;
    min-width: 0;
    text-align: left;
  }

  .note {
    margin: 8px 0 0;
    font-size: 11.5px;
    color: var(--muted);
  }

  .picker {
    text-align: left;
    margin-top: -8px;
  }

  .picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 30px;
    padding: 0 10px 0 2px;
    border-radius: 8px;
    font-weight: 650;
  }

  .back:hover {
    background: var(--control-hover);
  }

  .options {
    max-height: 360px;
    margin: 0 -8px;
    padding: 0 0 0 6px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    border-radius: var(--radius-m);
    text-align: left;
    transition: background-color var(--t-micro);
  }

  .option:hover {
    background: var(--control);
  }

  .option.chosen {
    background: var(--accent-soft);
  }

  .dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: var(--course-lit, var(--warm));
  }

  .dot.free {
    background: var(--accent);
  }

  .option-body {
    display: grid;
    min-width: 0;
  }

  /* The course gives way before the date does. */
  .option-meta {
    display: flex;
    min-width: 0;
    font-size: 12px;
    color: var(--muted);
  }

  .due {
    flex: none;
    white-space: nowrap;
  }

  .option-meta[data-tone='soon'] {
    color: var(--warm);
  }

  .option-meta[data-tone='overdue'] {
    color: var(--danger);
  }
</style>
