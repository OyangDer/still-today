<script lang="ts">
  import { flip } from 'svelte/animate';
  import { app } from '../lib/state.svelte';
  import { bucketOf, byDue, coursesOf, todos, type Bucket, type TodoItem } from '../lib/agenda';
  import { dueLabel, monthDay, t } from '../lib/i18n';
  import { easeIn, easeMorph, easeOut, fade, isReduced, move } from '../lib/motion';
  import Check from '../components/Check.svelte';
  import CourseFilter from '../components/CourseFilter.svelte';
  import Icon from '../components/Icon.svelte';
  import Segmented from '../components/Segmented.svelte';

  type Entry = { kind: 'head'; key: string; label: string } | { kind: 'item'; key: string; item: TodoItem };

  const filter = $derived(app.tasksFilter);
  let list = $state<HTMLElement>();
  let query = $state('');
  let searching = $state(false);
  let input = $state<HTMLInputElement>();
  let field = $state<HTMLElement>();
  const PERSONAL = '';
  let course = $state<string | null>(null);
  // Items just completed under "To do" stay a beat so the tick lands before the row leaves.
  let lingering = $state<string[]>([]);

  const now = $derived(app.now);
  const items = $derived(todos(app.data));
  const courses = $derived(coursesOf(items));
  const hasPersonal = $derived(items.some((i) => i.kind === 'local'));
  // A course whose last task went away falls back to all of them.
  const active = $derived(course === null || (course === PERSONAL ? hasPersonal : courses.some((c) => c.code === course)) ? course : null);
  $effect.pre(() => {
    if (active !== course) course = active;
  });
  const inCourse = (i: TodoItem) => active === null || (active === PERSONAL ? i.course === null : i.course === active);
  const pending = $derived(items.filter((i) => !i.done && inCourse(i)).length);
  const updatedCount = $derived(items.filter((i) => i.updated && inCourse(i)).length);
  const entries = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const out: Entry[] = [];
    // The search field covers the filters while it is open, so a search looks through everything:
    // open work first, then done.
    if (q) {
      const found = items.filter((i) => i.title.toLowerCase().includes(q) || (i.course ?? '').toLowerCase().includes(q));
      for (const item of found.sort((a, b) => Number(a.done) - Number(b.done) || byDue(a, b))) out.push({ kind: 'item', key: item.key, item });
      return out;
    }
    const match = inCourse;
    if (filter === 'todo') {
      let current: Bucket | null = null;
      for (const item of items.filter((i) => (!i.done || lingering.includes(i.key)) && match(i)).sort(byDue)) {
        const bucket = bucketOf(item, now);
        if (bucket !== current) {
          current = bucket;
          out.push({ kind: 'head', key: `h:${bucket}`, label: t(`bucket.${bucket}`) });
        }
        out.push({ kind: 'item', key: item.key, item });
      }
    } else if (filter === 'updated') {
      for (const item of items.filter((i) => i.updated && match(i)).sort(byDue)) out.push({ kind: 'item', key: item.key, item });
    } else {
      const done = items.filter((i) => i.done && match(i)).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '') || byDue(a, b));
      for (const item of done) out.push({ kind: 'item', key: item.key, item });
    }
    return out;
  });

  // Each filter opens at its top.
  $effect(() => {
    void [filter, active];
    if (list) list.scrollTop = 0;
  });

  function openSearch() {
    searching = true;
    requestAnimationFrame(() => input?.focus());
  }

  function closeSearch() {
    query = '';
    searching = false;
  }

  // An empty search folds away when the press lands anywhere else; one with text stays until closed.
  function pressAway(e: PointerEvent) {
    if (searching && !query && !field?.contains(e.target as Node)) searching = false;
  }

  function toggle(item: TodoItem, value: boolean) {
    app.setDone(item.key, value);
    if (value && filter === 'todo') {
      lingering = [...lingering, item.key];
      setTimeout(() => (lingering = lingering.filter((k) => k !== item.key)), isReduced() ? 0 : 700);
    }
  }

  // The course gives way before the date does: a long name is cut short, the due never.
  function meta(item: TodoItem): { source: string; due: string | null; tone: string } {
    const source = item.course ? item.course : t('tasks.personal');
    if (!item.due) return { source, due: null, tone: 'normal' };
    // Finished work is not overdue, however long ago it was due.
    if (item.done) return { source, due: monthDay(item.due), tone: 'normal' };
    const due = dueLabel(item.due, now, item.timed);
    return { source, due: due.text, tone: due.tone };
  }
</script>

<svelte:window onpointerdown={pressAway} />

<div class="tasks">
  <header>
    <h2>{t('tasks.title')}</h2>
    <span class="count num">{t('tasks.pending', { n: pending })}</span>
    <button class="new" onclick={() => app.push({ kind: 'taskEdit', id: null })}><Icon name="plus" size={14} />{t('tasks.new')}</button>
  </header>

  <!-- Search is not an everyday way in: it waits as a pill beside the filters and opens over them. -->
  <div class="filters" class:searching>
    <div class="bar" inert={searching}>
      <Segmented
        bind:value={app.tasksFilter}
        small
        options={[
          { value: 'todo', label: t('tasks.todo') },
          { value: 'updated', label: updatedCount ? `${t('tasks.updated')} ${updatedCount}` : t('tasks.updated') },
          { value: 'done', label: t('tasks.done') },
        ]}
      />
      {#if courses.length > 1 || (courses.length && hasPersonal)}
        <div class="courses"><CourseFilter bind:value={course} {courses} personal={hasPersonal} /></div>
      {/if}
    </div>
    <div class="search" class:open={searching} bind:this={field}>
      <Icon name="search" size={15} />
      <input
        bind:this={input}
        bind:value={query}
        placeholder={t('tasks.search')}
        spellcheck="false"
        tabindex={searching ? 0 : -1}
        onkeydown={(e) => e.key === 'Escape' && closeSearch()}
      />
      <button class="toggle" aria-label={t(searching ? 'cancel' : 'tasks.search')} onclick={() => (searching ? closeSearch() : openSearch())}>
        <span class="glyph" class:gone={searching}><Icon name="search" size={15} /></span>
        <span class="glyph" class:gone={!searching}><Icon name="close" size={13} /></span>
      </button>
    </div>
  </div>

  <div class="list scroll" bind:this={list}>
    <!-- A filter or course change swaps the whole list: the old one fades in place while the new one
         rises into the same grid cell, so the two never stack or reflow each other. -->
    <div class="stack">
      {#key `${filter}:${active}`}
        <div class="page" in:move={{ y: 8, duration: 280, delay: 90, easing: easeOut }} out:fade={{ duration: 110 }}>
          {#each entries as entry (entry.key)}
            <div class="entry" class:head={entry.kind === 'head'} animate:flip={{ duration: isReduced() ? 0 : 420, easing: easeMorph }} in:move={{ y: 6, duration: 280, easing: easeOut }} out:move={{ x: 24, duration: 200, easing: easeIn }}>
              {#if entry.kind === 'head'}
                <h3 class:overdue={entry.key === 'h:overdue'}>{entry.label}</h3>
              {:else}
                {@const item = entry.item}
                {@const m = meta(item)}
                <div class="row" class:done={item.done} role="button" tabindex="0" onclick={() => app.openTask(item.key)} onkeydown={(e) => e.key === 'Enter' && app.openTask(item.key)}>
                  <Check checked={item.done} label={item.title} onchange={(v) => toggle(item, v)} />
                  <div class="body">
                    <span class="title ellipsis">{item.title}</span>
                    <span class="meta num" data-tone={m.tone} title={item.course ?? undefined}
                      >{#if item.color}<i class="course-dot" style:--course={item.color}></i>{/if}<span class="ellipsis">{m.source}</span
                      >{#if m.due}<span class="due">&nbsp;· {m.due}</span>{/if}</span
                    >
                  </div>
                  {#if item.updated}<span class="updated">{t('tasks.updatedTag')}</span>{/if}
                </div>
              {/if}
            </div>
          {:else}
            <div class="empty" in:fade={{ duration: 200, delay: 120 }}>
              {#if query}
                {t('tasks.none')}
              {:else if !app.data.canvas.host && items.length === 0}
                <p>{t('tasks.connect')}</p>
                <button class="link" onclick={() => app.push({ kind: 'settings' })}>{t('menu.settings')} →</button>
              {:else}
                {t(filter === 'updated' ? 'tasks.noUpdates' : 'tasks.clear')}
              {/if}
            </div>
          {/each}
        </div>
      {/key}
    </div>
  </div>
</div>

<style>
  .tasks {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding-top: 10px;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 4px 18px 10px 23px;
  }

  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.3px;
  }

  .count {
    flex: 1;
    font-size: 12.5px;
    color: var(--muted);
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

  .filters {
    position: relative;
    height: 28px;
    margin: 0 23px 8px;
  }

  /* Opening the search pushes the filters out to the left: they travel exactly as far as the field's
     left edge does, on the same curve, so the edge never overtakes them; they fade on the way. */
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    padding-right: 36px;
    transition:
      transform var(--t-medium) var(--ease-page),
      opacity var(--t-short) var(--ease-standard);
  }

  .searching .bar {
    transform: translate3d(calc(-100% + 28px), 0, 0);
    opacity: 0;
  }

  .courses {
    min-width: 0;
    margin-left: auto;
  }

  /* One field that is always full width; collapsed, only its right end shows, as a round pill. */
  .search {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 11px;
    border-radius: 14px;
    color: var(--muted);
    background: var(--control);
    clip-path: inset(0 0 0 calc(100% - 28px) round 14px);
    transition:
      clip-path var(--t-medium) var(--ease-page),
      background-color var(--t-micro);
  }

  .search.open {
    clip-path: inset(0 round 14px);
  }

  .search:not(.open):hover {
    background: var(--control-hover);
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    font-size: 13px;
    color: var(--ink);
  }

  .search input::placeholder {
    color: var(--faint);
  }

  /* The whole pill shows focus; the field inside draws no ring of its own. */
  .search input:focus-visible {
    outline: none;
  }

  .search.open:focus-within {
    background: var(--control-hover);
  }

  .toggle {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--muted);
  }

  .glyph {
    grid-area: 1 / 1;
    display: grid;
    transition:
      opacity var(--t-short),
      transform var(--t-medium) var(--ease-out);
  }

  .glyph.gone {
    opacity: 0;
    transform: rotate(-60deg) scale(0.6);
  }

  .list {
    position: relative;
    flex: 1;
    padding: 0 9px 64px 13px;
  }

  .stack {
    display: grid;
  }

  .page {
    grid-area: 1 / 1;
    min-width: 0;
  }

  .entry {
    position: relative;
  }

  h3 {
    margin: 14px 10px 2px;
    font-size: 11.5px;
    font-weight: 650;
    color: var(--muted);
  }

  h3.overdue {
    color: var(--danger);
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 11px 10px;
    border-radius: var(--radius-m);
    transition: background-color var(--t-micro);
  }

  /* Rows are divided from each other; a heading already sets its first row apart. */
  .entry:not(.head) + .entry .row::before {
    content: '';
    position: absolute;
    top: 0;
    left: 42px;
    right: 10px;
    border-top: 1px solid var(--line);
    transition: opacity var(--t-micro);
  }

  .row:hover {
    background: var(--control);
  }

  .row:hover::before,
  .entry:hover + .entry .row::before {
    opacity: 0;
  }

  .body {
    display: grid;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .title {
    font-size: 13.5px;
    font-weight: 600;
    transition: color var(--t-medium);
  }

  .done .title {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--muted) 60%, transparent);
  }

  .meta {
    display: flex;
    align-items: center;
    min-width: 0;
    font-size: 12px;
    color: var(--muted);
  }

  .due {
    flex: none;
    white-space: nowrap;
  }

  .meta .course-dot {
    margin: 0 6px 0 0;
  }

  .meta[data-tone='soon'] {
    color: var(--warm);
  }

  .meta[data-tone='overdue'] {
    color: var(--danger);
  }

  .updated {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-soft);
  }

  .empty {
    padding: 56px 24px;
    text-align: center;
    color: var(--muted);
  }

  .empty p {
    margin: 0 0 10px;
  }

  .link {
    color: var(--accent);
    font-weight: 600;
  }
</style>
