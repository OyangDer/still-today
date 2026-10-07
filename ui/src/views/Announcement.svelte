<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { monthDay, t, weekdayShort } from '../lib/i18n';
  import { hasText } from '../lib/sanitize';
  import { hhmm, parseIso } from '../lib/time';
  import CanvasLink from '../components/CanvasLink.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import RichText from '../components/RichText.svelte';

  let { id }: { id: string } = $props();

  const a = $derived(app.data.announcements.find((x) => x.id === id));
  const posted = $derived(parseIso(a?.postedAt));

  // Opening it is the reading: the list loses its "New" mark and the overview's count goes down.
  untrack(() => {
    const opened = app.data.announcements.find((x) => x.id === id);
    if (opened && !opened.read) app.markRead([opened]);
  });
</script>

<div class="announcement">
  <PageHeader>
    {#if a?.url}<CanvasLink url={a.url} />{/if}
  </PageHeader>
  {#if a}
    <div class="content scroll">
      <p class="eyebrow"><i class="course-dot" style:--course={app.data.canvas.colors[a.courseId]}></i>{a.course} · {t('news.title')}</p>
      <h2>{a.title}</h2>
      <p class="meta num">{[a.author, posted ? `${monthDay(posted)} ${weekdayShort(posted)} ${hhmm(posted)}` : ''].filter(Boolean).join(' · ')}</p>
      <div class="message">
        {#if hasText(a.message)}
          <RichText html={a.message ?? ''} />
        {:else}
          <p class="muted">{t('detail.noDescription')}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .announcement {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .content {
    flex: 1;
    padding: 6px 12px 18px 22px;
  }

  .eyebrow {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.2px;
    color: var(--accent);
  }

  .eyebrow .course-dot {
    margin: -1px 6px 0 0;
  }

  h2 {
    margin: 0;
    font-size: 21px;
    line-height: 1.3;
    font-weight: 650;
    letter-spacing: -0.2px;
    -webkit-user-select: text;
    user-select: text;
  }

  .meta {
    margin: 8px 0 0;
    font-size: 12.5px;
    color: var(--muted);
  }

  .message {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }

  .message p {
    margin: 0;
  }
</style>
