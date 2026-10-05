<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { ago, t } from '../lib/i18n';
  import { parseIso } from '../lib/time';
  import { fade } from '../lib/motion';
  import CourseFilter from '../components/CourseFilter.svelte';
  import PageHeader from '../components/PageHeader.svelte';

  let course = $state<string | null>(null);
  const courses = $derived.by(() => {
    const seen = new Map<string, string | null>();
    for (const a of app.shownAnnouncements) seen.set(a.course, app.data.canvas.colors[a.courseId] ?? null);
    return [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([code, color]) => ({ code, color }));
  });
  // A course whose announcements all aged out while the page was open falls back to all of them.
  const active = $derived(course !== null && courses.some((c) => c.code === course) ? course : null);
  $effect.pre(() => {
    if (active !== course) course = active;
  });
  const list = $derived(active === null ? app.shownAnnouncements : app.shownAnnouncements.filter((a) => a.course === active));
  const unread = $derived(list.filter((a) => app.isNew(a)));

  // Looking at the list settles the overview's count, including news that arrives while it is open;
  // each row stays marked until it is opened.
  untrack(() => app.viewAnnouncements());
  onDestroy(() => app.viewAnnouncements());
</script>

<div class="announcements">
  <PageHeader title={t('news.title')}>
    {#if unread.length}
      <button class="mark" transition:fade={{ duration: 150 }} onclick={() => app.markRead(unread)}>{t('news.markRead')}</button>
    {/if}
    {#if courses.length > 1}<CourseFilter bind:value={course} {courses} />{/if}
  </PageHeader>
  <div class="list scroll">
    {#each list as a (a.id)}
      {@const posted = parseIso(a.postedAt)}
      {@const fresh = app.isNew(a)}
      <button class="row" class:fresh onclick={() => app.push({ kind: 'announcement', id: a.id })}>
        <span class="body">
          <span class="title ellipsis">{a.title}</span>
          <!-- The course gives way first, then the author; when it was posted always shows. -->
          <span class="meta" title={a.course}>
            <i class="course-dot" style:--course={app.data.canvas.colors[a.courseId]}></i><span class="ellipsis course">{a.course}</span
            >{#if posted}<span class="when">&nbsp;· {ago(posted, app.now)}</span>{/if}{#if a.author}<span class="ellipsis author">&nbsp;· {a.author}</span>{/if}
          </span>
        </span>
        {#if fresh}<span class="tag">{t('news.newTag')}</span>{/if}
      </button>
    {:else}
      <p class="empty">{t('news.empty')}</p>
    {/each}
  </div>
</div>

<style>
  .announcements {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  /* A text action, like "New task" beside the task list's title. */
  .mark {
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
    transition: background-color var(--t-micro);
  }

  .mark:hover {
    background: var(--accent-soft);
  }

  .list {
    flex: 1;
    padding: 0 9px 18px 13px;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 11px 10px;
    border-radius: var(--radius-m);
    text-align: left;
    transition: background-color var(--t-micro);
  }

  .row + .row::before {
    content: '';
    position: absolute;
    top: 0;
    left: 10px;
    right: 10px;
    border-top: 1px solid var(--line);
    transition: opacity var(--t-micro);
  }

  .row:hover {
    background: var(--control);
  }

  .row:hover::before,
  .row:hover + .row::before {
    opacity: 0;
  }

  .body {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .title {
    font-size: 13.5px;
    font-weight: 500;
  }

  .fresh .title {
    font-weight: 650;
  }

  .meta {
    display: flex;
    align-items: center;
    min-width: 0;
    font-size: 12px;
    color: var(--muted);
  }

  .meta .course {
    flex: 0 1 auto;
    min-width: 3em;
  }

  .when {
    flex: none;
    white-space: nowrap;
  }

  .author {
    flex: 0 100 auto;
  }

  .meta .course-dot {
    margin: 0 6px 0 0;
    flex: none;
  }

  .tag {
    flex: none;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 650;
    color: var(--accent);
    background: var(--accent-soft);
  }

  .empty {
    margin: 40px 0 0;
    text-align: center;
    color: var(--muted);
  }
</style>
