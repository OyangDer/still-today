<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { todos } from '../lib/agenda';
  import { dismiss } from '../lib/dismiss';
  import { call } from '../lib/host';
  import { t, timeOrDate } from '../lib/i18n';
  import { daysBetween, fromDayKey, parseIso } from '../lib/time';
  import { easeOut, fade, follow, move, type Frame } from '../lib/motion';
  import Icon from './Icon.svelte';

  /** The right-hand group rides the window's right edge; the island takes what room is left. */
  let { frame }: { frame: Frame } = $props();

  let actions = $state<HTMLElement>();
  let actionsWidth = $state(0);
  let menu = $state(false);
  let faceWidth = $state(0);
  let labelWidth = $state(0);

  const tokenDays = $derived(
    app.data.canvas.host && app.data.canvas.tokenExpires ? daysBetween(app.now, fromDayKey(app.data.canvas.tokenExpires)) : null,
  );
  const tokenNotice = $derived(
    tokenDays === null || tokenDays > 14 ? null : tokenDays < 0 ? t('token.expired') : tokenDays === 0 ? t('token.today') : t('token.soon', { n: tokenDays }),
  );

  const timer = $derived(app.data.timer);
  const timerLeft = $derived.by(() => {
    if (!timer) return '';
    const s = timer.endsAt ? Math.max(0, Math.ceil((timer.endsAt - app.now.getTime()) / 1000)) : timer.remaining;
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });

  const last = $derived(parseIso(app.lastSync));
  const error = $derived(app.syncing ? null : app.syncError);
  const status = $derived(
    app.syncing
      ? t('sync.syncing')
      : error
        ? t(error === 'token' ? 'sync.token' : error === 'partial' ? 'sync.partial' : 'sync.network')
        : last
          ? t('sync.last', { t: timeOrDate(last, app.now) })
          : t('sync.never'),
  );

  // The island has room for a few words; the whole sentence waits on the sync icon's tooltip.
  const alert = $derived(
    error ? t(error === 'token' ? 'sync.rejected' : error === 'partial' ? 'sync.incomplete' : 'sync.offline') : tokenNotice,
  );
  // The countdown belongs to the focus view while that view is on show.
  const focusing = $derived(!!timer && (app.tab !== 'focus' || app.pages.length > 0));
  const work = $derived(todos(app.data).filter((i) => i.updated).length);
  const news = $derived(app.newAnnouncements);
  const parts = $derived(
    (['alert', 'focus', 'updates'] as const).filter((p) => (p === 'alert' ? alert : p === 'focus' ? focusing : work || news)),
  );
  // The island wears the most pressing of these; with nothing going on, the sync control has the room.
  const first = $derived(parts.at(0) ?? (app.data.canvas.host ? 'rest' : 'connect'));
  // One pressed on the side takes the island over, until it is gone or what came first changes.
  let picked = $derived.by<'alert' | 'focus' | 'updates' | null>(() => {
    void first;
    return null;
  });
  // Gone is gone: a countdown picked, then hidden by the Focus view, does not take the island back.
  $effect(() => {
    if (picked && !parts.includes(picked)) picked = null;
  });
  const kind = $derived(picked && parts.includes(picked) ? picked : first);
  const others = $derived(parts.filter((p) => p !== kind));
  const space = $derived(frame.w - actionsWidth - 30);

  function open(kind: 'settings' | 'announcements') {
    menu = false;
    if (app.pages.at(-1)?.kind !== kind) app.push({ kind });
  }

  function openWork() {
    app.tasksFilter = 'updated';
    app.go('tasks');
  }

  // A rejected token is not fixed by trying again: the press goes where it can be replaced.
  function press() {
    if (error !== 'token') void app.sync(true);
    else open('settings');
  }

  $effect(() => follow(actions!, `translate3d(${frame.w - 440}px, 0, 0)`, frame.start, frame.ms));
</script>

<header class="head">
  <!-- The island. Sync keeps its place at the left: with nothing else going on it says when it
       last ran, otherwise it folds down to its icon and the most pressing thing grows beside it.
       Anything more follows as its sign alone; one that no longer fits wraps out of sight. -->
  <div class="island" style:max-width="{space}px">
    <button class="capsule sync" class:busy={app.syncing} class:folded={kind !== 'rest'} title={kind === 'rest' ? t('sync.now') : status} onclick={press}>
      <span class="spinner"><Icon name="sync" size={13} /></span>
      <span class="label" style:width="{kind === 'rest' ? labelWidth : 0}px">
        <span class="ellipsis" bind:offsetWidth={labelWidth} style:max-width="{space - 24}px">{status}</span>
      </span>
    </button>
    <div class="capsule main {kind}" style:width="{faceWidth}px">
      <div class="face" bind:offsetWidth={faceWidth} style:max-width="{space - 28}px">
        {#key kind}
          {#if kind !== 'rest'}
            <span class="parts" in:fade={{ duration: 200, delay: 70 }}>
              {#if kind === 'alert'}
                <button title={error ? t(error === 'token' ? 'canvas.replace' : 'sync.now') : undefined} onclick={error ? press : () => open('settings')}>
                  <Icon name="alert" size={13} /><span class="ellipsis">{alert}</span>
                </button>
              {:else if kind === 'focus'}
                <button title={t(timer?.endsAt ? 'today.focusing' : 'focus.paused')} onclick={() => app.go('focus')}>
                  <span class="pulse" class:paused={!timer?.endsAt}></span><span class="num">{timerLeft}</span>
                </button>
              {:else if kind === 'updates'}
                {#if work}<button onclick={openWork}><Icon name="doc" size={13} /><span class="ellipsis">{t('today.updated', { n: work })}</span></button>{/if}
                {#if work && news}<i class="rule"></i>{/if}
                {#if news}<button onclick={() => open('announcements')}><Icon name="news" size={13} /><span class="ellipsis">{t('news.count', { n: news })}</span></button>{/if}
              {:else}
                <button onclick={() => open('settings')}><span class="ellipsis">{t('today.connect')}</span></button>
              {/if}
            </span>
          {/if}
        {/key}
      </div>
    </div>
    {#each others as part (part)}
      <div class="capsule side {part}" in:move={{ x: -8, scale: 0.9, duration: 260, easing: easeOut }} out:fade={{ duration: 110 }}>
        <button
          title={part === 'alert'
            ? alert
            : part === 'focus'
              ? `${t(timer?.endsAt ? 'today.focusing' : 'focus.paused')} ${timerLeft}`
              : [work && t('today.updated', { n: work }), news && t('news.count', { n: news })].filter(Boolean).join(' · ')}
          onclick={() => (picked = part)}
        >
          {#if part === 'alert'}
            <Icon name="alert" size={13} />
          {:else if part === 'focus'}
            <span class="pulse" class:paused={!timer?.endsAt}></span>
          {:else}
            <Icon name="bell" size={13} /><span class="num">{work + news}</span>
          {/if}
        </button>
      </div>
    {/each}
  </div>

  <div class="actions" bind:this={actions} bind:offsetWidth={actionsWidth}>
    <div class="anchor">
      <button class="more" class:on={menu} aria-label={t('more')} aria-expanded={menu} onclick={() => (menu = !menu)}>
        <Icon name="more" size={16} />
      </button>
      {#if menu}
        <div class="menu" use:dismiss={() => (menu = false)} in:move={{ y: -6, scale: 0.97, duration: 220, easing: easeOut }} out:fade={{ duration: 110 }}>
          {#if app.data.canvas.host}
            <button onclick={() => open('announcements')}
              >{t('news.title')}{#if app.newAnnouncements}<span class="count num">{app.newAnnouncements}</span>{/if}</button
            >
          {/if}
          <button onclick={() => open('settings')}>{t('menu.settings')}</button>
          <button
            onclick={() => {
              menu = false;
              void call('hide');
            }}>{t(app.mac ? 'menu.hide.mac' : 'menu.hide')}</button
          >
        </div>
      {/if}
    </div>
  </div>
</header>

<style>
  .head {
    position: absolute;
    top: 0;
    left: 0;
    width: 440px;
    height: var(--head);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px 0 12px;
    border-bottom: 1px solid var(--line);
    z-index: 5;
  }

  .island {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    height: 24px;
    overflow: hidden;
    min-width: 0;
  }

  .capsule {
    display: flex;
    height: 24px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    transition:
      background-color var(--t-medium),
      color var(--t-medium);
  }

  /* The capsule's width follows what it shows, so a change of state reshapes it rather than
     swapping one chip for another. */
  .main {
    position: relative;
    flex: none;
    max-width: 100%;
    overflow: hidden;
    transition:
      width 360ms var(--ease-morph),
      background-color var(--t-medium),
      color var(--t-medium);
  }

  .face {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
  }

  .parts {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .capsule button {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    height: 24px;
    padding: 0 10px 0 8px;
    border-radius: 999px;
    transition: background-color var(--t-micro), color var(--t-micro);
  }

  .capsule button:hover {
    background: color-mix(in srgb, currentColor 9%, transparent);
  }

  /* On the side, a capsule keeps to its sign. */
  .side:not(.updates) button {
    justify-content: center;
    width: 24px;
    padding: 0;
  }

  .rule {
    flex: none;
    width: 1px;
    height: 12px;
    background: currentColor;
    opacity: 0.3;
  }

  /* Sync is a control, not news: bare like the menu button, its capsule shows on hover. */
  .sync {
    align-items: center;
    flex: none;
    padding: 0 5.5px;
    color: var(--muted);
  }

  .sync:hover {
    color: var(--ink);
    background: var(--control-hover);
  }

  /* Folded, the capsule closes to a circle round the icon. */
  .label {
    position: relative;
    height: 24px;
    overflow: hidden;
    transition:
      width 360ms var(--ease-morph),
      opacity var(--t-short);
  }

  .label > span {
    position: absolute;
    top: 0;
    left: 0;
    padding: 0 4.5px 0 5px;
    line-height: 24px;
  }

  .folded .label {
    opacity: 0;
  }

  .alert {
    color: var(--warm);
    background: var(--warm-soft);
  }

  .focus,
  .updates,
  .connect {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .pulse {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.8s var(--ease-standard) infinite;
  }

  .pulse.paused {
    animation: none;
    opacity: 0.5;
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
      transform: scale(0.8);
    }
  }

  .spinner {
    display: grid;
  }

  .busy .spinner :global(.icon) {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .actions {
    display: flex;
    align-items: center;
  }

  .anchor {
    position: relative;
  }

  .more {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: var(--muted);
    transition: background-color var(--t-micro), color var(--t-micro);
  }

  .more:hover,
  .more.on {
    color: var(--ink);
    background: var(--control-hover);
  }

  .menu {
    position: absolute;
    top: 34px;
    right: 0;
    min-width: 150px;
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
    gap: 12px;
    width: 100%;
    padding: 7px 10px;
    border-radius: 7px;
    text-align: left;
    white-space: nowrap;
  }

  .menu button:hover {
    background: var(--control-hover);
  }

  .count {
    min-width: 18px;
    margin-left: auto;
    padding: 0 5px;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 650;
    line-height: 18px;
    text-align: center;
    color: var(--accent-ink);
    background: var(--accent);
  }
</style>
