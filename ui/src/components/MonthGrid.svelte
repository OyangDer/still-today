<script lang="ts">
  import type { DayMarks } from '../lib/agenda';
  import { weekdayHeaders } from '../lib/i18n';
  import { dayKey, monthGrid, startOfDay } from '../lib/time';
  import { easeIn, easeMorph, move } from '../lib/motion';

  let {
    month,
    selected,
    today,
    marks = new Map(),
    direction = 1,
    small = false,
    onselect,
    onopen,
  }: {
    month: Date;
    selected: Date | null;
    today: Date;
    marks?: Map<string, DayMarks>;
    direction?: number;
    small?: boolean;
    onselect: (day: Date) => void;
    onopen?: (day: Date) => void;
  } = $props();

  const days = $derived(monthGrid(month));
  const monthKey = $derived(`${month.getFullYear()}-${month.getMonth()}`);
  const todayKey = $derived(dayKey(today));
  const selectedIndex = $derived(selected ? days.findIndex((d) => startOfDay(d).getTime() === startOfDay(selected).getTime()) : -1);
</script>

<div class="grid-wrap" class:small>
  <div class="weekdays">
    {#each weekdayHeaders() as w (w)}<span>{w}</span>{/each}
  </div>
  <div class="viewport">
    {#key monthKey}
      <div
        class="grid"
        in:move={{ x: 36 * direction, duration: 420, easing: easeMorph }}
        out:move={{ x: -28 * direction, duration: 180, easing: easeIn }}
      >
        {#if selectedIndex >= 0}
          <!-- One highlight that slides between cells, positioned in whole-cell steps. -->
          <span class="selection" style:transform="translate3d({(selectedIndex % 7) * 100}%, {Math.floor(selectedIndex / 7) * 100}%, 0)"
            ><span></span></span
          >
        {/if}
        {#each days as day, i (i)}
          {@const key = dayKey(day)}
          {@const mark = marks.get(key)}
          <button
            class="day num"
            class:outside={day.getMonth() !== month.getMonth()}
            class:today={key === todayKey}
            class:selected={i === selectedIndex}
            onclick={() => onselect(day)}
            ondblclick={() => onopen?.(day)}
          >
            {day.getDate()}
            {#if mark && !small}
              <span class="marks">
                {#if mark.events}<i class="event"></i>{/if}
                {#if mark.deadlines}<i class="deadline"></i>{/if}
              </span>
            {/if}
          </button>
        {/each}
      </div>
    {/key}
  </div>
</div>

<style>
  .grid-wrap {
    --cell: 37px;
  }

  .small {
    --cell: 32px;
  }

  .weekdays,
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }

  .weekdays span {
    text-align: center;
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    padding-bottom: 4px;
  }

  .viewport {
    position: relative;
    height: calc(var(--cell) * 6);
    overflow: hidden;
  }

  .grid {
    position: absolute;
    inset: 0;
    grid-auto-rows: var(--cell);
  }

  .selection {
    position: absolute;
    top: 0;
    left: 0;
    width: calc(100% / 7);
    height: var(--cell);
    display: grid;
    place-items: center;
    pointer-events: none;
    transition: transform var(--t-medium) var(--ease-morph);
  }

  .selection span {
    width: calc(var(--cell) - 6px);
    height: calc(var(--cell) - 6px);
    border-radius: 50%;
    background: var(--accent);
  }

  .day {
    position: relative;
    display: grid;
    place-items: center;
    font-size: 13px;
    border-radius: 50%;
    transition: color var(--t-short);
  }

  .day::before {
    content: '';
    position: absolute;
    width: calc(var(--cell) - 6px);
    height: calc(var(--cell) - 6px);
    border-radius: 50%;
    transition: background-color var(--t-micro);
  }

  .day:hover::before {
    background: var(--control-hover);
  }

  .outside {
    color: var(--faint);
    opacity: 0.6;
  }

  .today {
    color: var(--accent);
    font-weight: 700;
  }

  .today::before {
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 55%, transparent);
  }

  .selected {
    color: var(--accent-ink);
    font-weight: 600;
  }

  .selected::before {
    display: none;
  }

  /* The dots sit inside the day's circle, under a numeral nudged up to make room, so the today ring
     and the selection never cut through them. */
  .grid-wrap:not(.small) .day {
    padding-bottom: 2px;
  }

  .marks {
    position: absolute;
    bottom: 8px;
    display: flex;
    gap: 3px;
  }

  .marks i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
  }

  .event {
    background: var(--accent);
  }

  .deadline {
    background: var(--warm);
  }

  .selected .marks i {
    background: var(--accent-ink);
    opacity: 0.8;
  }
</style>
