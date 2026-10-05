<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { dayAgenda, monthMarks, type Occurrence } from '../lib/agenda';
  import { dueLabel, monthDay, monthTitle, t, weekdayLong } from '../lib/i18n';
  import { addMonths, dayKey, hhmm, monthGrid, startOfDay } from '../lib/time';
  import { easeOut, fade, move } from '../lib/motion';
  import Icon from '../components/Icon.svelte';
  import MonthGrid from '../components/MonthGrid.svelte';

  // The selected day is the store's, so a view that opens the calendar on a date (the overview's
  // next event, a saved event) selects it here as well; its month follows it into view.
  const selected = $derived(startOfDay(app.calendarDay));
  let month = $state(new Date(app.calendarDay.getFullYear(), app.calendarDay.getMonth(), 1));
  let direction = $state(1);
  let dayDirection = $state(1);

  $effect.pre(() => {
    const day = selected;
    untrack(() => {
      if (day.getMonth() === month.getMonth() && day.getFullYear() === month.getFullYear()) return;
      direction = day > month ? 1 : -1;
      month = new Date(day.getFullYear(), day.getMonth(), 1);
    });
  });

  const now = $derived(app.now);
  const marks = $derived(monthMarks(app.data, monthGrid(month)));
  const agenda = $derived(dayAgenda(app.data, selected));
  const isToday = $derived(dayKey(selected) === dayKey(now));
  const showsToday = $derived(month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth() && isToday);

  function select(day: Date) {
    dayDirection = day >= selected ? 1 : -1;
    app.calendarDay = startOfDay(day);
  }

  function shift(n: number) {
    direction = n;
    month = addMonths(month, n);
  }

  function wheel(e: WheelEvent) {
    if (Math.abs(e.deltaY) < 4) return;
    e.preventDefault();
    shift(e.deltaY > 0 ? 1 : -1);
  }

  function time(o: Occurrence): string {
    if (o.allDay) return t('cal.allDay');
    if (o.start < selected) return '…';
    return hhmm(o.start);
  }

  // The time is already beside it, so a deadline says whose it is and that it is due, or how late.
  function meta(o: Occurrence): string {
    if (o.kind === 'deadline') {
      const due = dueLabel(o.start, now, !o.allDay);
      return [o.label ? o.label : t('tasks.personal'), due.tone === 'overdue' ? due.text : t('cal.due')].join(' · ');
    }
    const parts: string[] = [];
    if (!o.allDay && o.end) parts.push(`${hhmm(o.start)}–${hhmm(o.end)}`);
    // Where it is matters more than which feed it came from.
    if (o.location) parts.push(o.location);
    else if (o.label) parts.push(o.label);
    return parts.join(' · ');
  }

  // What the user made here opens for editing; what came from Canvas or a feed only reads.
  const opens = (o: Occurrence) => o.kind !== 'feed';

  function open(o: Occurrence) {
    if (o.kind === 'deadline' && o.todo) app.openTask(o.todo.key);
    else if (o.kind === 'event') app.push({ kind: 'event', day: dayKey(o.start), id: o.key.slice(2) });
    else if (o.kind === 'token') app.push({ kind: 'settings' });
  }
</script>

<div class="calendar">
  <header>
    <h2>{monthTitle(month)}</h2>
    <div class="nav">
      {#if !showsToday}
        <button class="today-btn" transition:fade={{ duration: 150 }} onclick={() => select(now)}>{t('cal.today')}</button>
      {/if}
      <button class="icon-btn" aria-label={t('cal.prev')} onclick={() => shift(-1)}><Icon name="left" size={17} /></button>
      <button class="icon-btn" aria-label={t('cal.next')} onclick={() => shift(1)}><Icon name="right" size={17} /></button>
    </div>
  </header>

  <div class="month" onwheel={wheel}>
    <MonthGrid {month} {selected} today={now} {marks} {direction} onselect={select} onopen={(d) => app.push({ kind: 'event', day: dayKey(d) })} />
  </div>

  <section class="agenda">
    <div class="agenda-head">
      <span class="agenda-title">
        {monthDay(selected)} {weekdayLong(selected)}{#if isToday}<span class="today-tag">· {t('cal.today')}</span>{/if}
      </span>
      <button class="new" onclick={() => app.push({ kind: 'event', day: dayKey(selected) })}>
        <Icon name="plus" size={14} />{t('event.new')}
      </button>
    </div>

    <div class="list scroll">
      {#key dayKey(selected)}
        <div class="day-items" in:move={{ x: 14 * dayDirection, duration: 340, easing: easeOut }}>
          {#each agenda as o (o.key)}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (it is a button whenever it takes focus) -->
            <div
              class="item"
              class:opens={opens(o)}
              role={opens(o) ? 'button' : undefined}
              tabindex={opens(o) ? 0 : undefined}
              onclick={() => open(o)}
              onkeydown={(e) => e.key === 'Enter' && open(o)}
              out:move={{ x: 24, duration: 200 }}
            >
              <span class="time num">{time(o)}</span>
              <span class="bar" data-kind={o.kind} style:--course={o.color}></span>
              <span class="body">
                <span class="title ellipsis">{o.kind === 'token' ? t('token.event') : o.title}</span>
                {#if meta(o)}<span class="meta ellipsis">{meta(o)}</span>{/if}
              </span>
              {#if o.kind === 'event' || o.kind === 'feed'}
                <button
                  class="remove"
                  aria-label={t(o.kind === 'event' ? 'cal.delete' : 'cal.hide')}
                  title={t(o.kind === 'event' ? 'cal.delete' : 'cal.hide')}
                  onclick={(e) => {
                    e.stopPropagation();
                    app.removeOccurrence(o.key);
                  }}><Icon name={o.kind === 'event' ? 'trash' : 'hide'} size={15} /></button
                >
              {/if}
            </div>
          {:else}
            <p class="empty">{t('cal.empty')}</p>
          {/each}
        </div>
      {/key}
    </div>
  </section>
</div>

<style>
  .calendar {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px 8px 23px;
  }

  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.3px;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .today-btn {
    height: 26px;
    margin-right: 4px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-soft);
  }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--muted);
    transition: background-color var(--t-micro), color var(--t-micro);
  }

  .icon-btn:hover {
    color: var(--ink);
    background: var(--control-hover);
  }

  .month {
    padding: 0 17px;
  }

  .agenda {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    margin-top: 6px;
    border-top: 1px solid var(--line);
  }

  .agenda-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 18px 4px 23px;
  }

  .agenda-title {
    font-size: 12.5px;
    font-weight: 600;
  }

  .today-tag {
    margin-left: 5px;
    color: var(--accent);
  }

  .new {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 9px 0 7px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
    transition: background-color var(--t-micro);
  }

  .new:hover {
    background: var(--accent-soft);
  }

  .list {
    position: relative;
    flex: 1;
    padding: 2px 6px 64px 8px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px 7px 12px;
    border-radius: var(--radius-m);
    transition: background-color var(--t-micro);
  }

  .item.opens:hover {
    background: var(--control);
  }

  .time {
    width: 40px;
    flex: none;
    font-size: 12px;
    color: var(--muted);
  }

  /* A Canvas item's bar is its course's Canvas colour; the rest keep their kind's. */
  .bar {
    align-self: stretch;
    width: 3px;
    flex: none;
    border-radius: 3px;
    background: var(--course-lit, var(--accent));
  }

  .bar[data-kind='feed'] {
    background: var(--course-lit, color-mix(in srgb, var(--accent) 55%, transparent));
  }

  .bar[data-kind='deadline'],
  .bar[data-kind='token'] {
    background: var(--course-lit, var(--warm));
  }

  .body {
    display: grid;
    flex: 1;
    min-width: 0;
  }

  .title {
    font-size: 13px;
    font-weight: 500;
  }

  .meta {
    font-size: 11.5px;
    color: var(--muted);
  }

  .remove {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 7px;
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--t-micro), background-color var(--t-micro);
  }

  .item:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    color: var(--ink);
    background: var(--control-hover);
  }

  .empty {
    margin: 0;
    padding: 18px 22px;
    font-size: 12.5px;
    color: var(--muted);
  }
</style>
