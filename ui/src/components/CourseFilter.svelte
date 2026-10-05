<script lang="ts">
  import { dismiss } from '../lib/dismiss';
  import { t } from '../lib/i18n';
  import { easeOut, fade, move } from '../lib/motion';
  import Icon from './Icon.svelte';

  /** A course pill and its menu. `value` null is every course; '' is personal work, offered with `personal`. */
  let {
    value = $bindable(),
    courses,
    personal = false,
  }: { value: string | null; courses: { code: string; color: string | null }[]; personal?: boolean } = $props();

  let open = $state(false);
  const color = $derived(courses.find((c) => c.code === value)?.color ?? null);

  function pick(next: string | null) {
    value = next;
    open = false;
  }
</script>

<div class="anchor">
  <button class="pill-btn" class:on={value !== null} aria-expanded={open} onclick={() => (open = !open)}>
    {#if value !== null}<i class="course-dot" style:--course={color}></i>{/if}
    <span class="ellipsis">{value === null ? t('tasks.courses') : value === '' ? t('tasks.personal') : value}</span>
    <Icon name="down" size={13} />
  </button>
  {#if open}
    <div class="menu" use:dismiss={() => (open = false)} in:move={{ y: -6, scale: 0.97, duration: 220, easing: easeOut }} out:fade={{ duration: 110 }}>
      <button class:chosen={value === null} onclick={() => pick(null)}>{t('tasks.allCourses')}</button>
      {#each courses as c (c.code)}
        <button class:chosen={value === c.code} title={c.code} onclick={() => pick(c.code)}
          ><i class="course-dot" style:--course={c.color}></i><span class="name">{c.code}</span></button
        >
      {/each}
      {#if personal}
        <button class:chosen={value === ''} onclick={() => pick('')}><i class="course-dot"></i>{t('tasks.personal')}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Never narrower than its pill, which caps itself at 150px; the heading beside it gives way instead. */
  .anchor {
    position: relative;
    flex: none;
  }

  .pill-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 150px;
    height: 28px;
    padding: 0 8px 0 11px;
    border-radius: 999px;
    font-size: 12px;
    color: var(--muted);
    background: var(--control);
    transition:
      background-color var(--t-micro),
      color var(--t-micro);
  }

  .pill-btn:hover,
  .pill-btn[aria-expanded='true'] {
    color: var(--ink);
    background: var(--control-hover);
  }

  .pill-btn.on {
    color: var(--ink);
    font-weight: 600;
  }

  .pill-btn :global(.icon) {
    flex: none;
    color: var(--muted);
  }

  .menu {
    position: absolute;
    top: 34px;
    right: 0;
    min-width: 160px;
    width: max-content;
    /* Within the compact card whichever pill it opens from; a longer name takes a second line. */
    max-width: 296px;
    max-height: 320px;
    overflow-y: auto;
    padding: 5px;
    border-radius: 12px;
    background: var(--raised);
    box-shadow: var(--shadow-pop);
    transform-origin: top right;
    z-index: 20;
  }

  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border-radius: 7px;
    font-size: 12.5px;
    text-align: left;
    white-space: nowrap;
  }

  .menu button:hover {
    background: var(--control-hover);
  }

  .name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    white-space: normal;
    line-height: 1.35;
  }

  .menu button.chosen {
    font-weight: 650;
    background: var(--control);
  }
</style>
