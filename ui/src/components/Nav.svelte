<script lang="ts">
  import { todos } from '../lib/agenda';
  import { call } from '../lib/host';
  import { app, TABS } from '../lib/state.svelte';
  import { t } from '../lib/i18n';
  import { fade, follow, type Frame } from '../lib/motion';
  import Toast from './Toast.svelte';

  /** The bar rides the window's bottom edge and spreads its tabs across the window's width. */
  let { frame }: { frame: Frame } = $props();

  // Laid out for the widest window; `frame` pulls each tab in to its slot at the current width.
  const WIDE = 440;
  const TALL = 600;
  const INSET = 10;
  const TAB = 85;
  const PILL = 88;
  const PILL_MS = 280;
  const centre = (w: number, i: number) => INSET + ((i + 0.5) * (w - 2 * INSET)) / 4;

  let band = $state<HTMLElement>();
  let middle = $state<HTMLElement>();
  let pill = $state<HTMLElement>();
  const tabs: HTMLElement[] = [];
  let placed: Frame | undefined;

  const index = $derived(TABS.indexOf(app.tab));
  const updates = $derived(todos(app.data).some((i) => i.updated));

  $effect(() => {
    const { w, h, start, ms } = frame;
    follow(band!, `translate3d(0, ${h - TALL}px, 0)`, start, ms);
    follow(middle!, `translate3d(${(w - WIDE) / 2}px, 0, 0)`, start, ms);
    tabs.forEach((tab, i) => follow(tab, `translate3d(${centre(w, i) - centre(WIDE, i)}px, 0, 0)`, start, ms));
  });

  // The pill travels with the window when a tab change resizes it, and on its own otherwise.
  $effect(() => {
    const x = centre(frame.w, index) - PILL / 2;
    const to = `translate3d(${x}px, 0, 0)`;
    const ms = placed === frame ? PILL_MS : frame.ms;
    if (placed === frame) follow(pill!, to, Date.now(), PILL_MS);
    else follow(pill!, to, frame.start, frame.ms);
    placed = frame;
    // On macOS 26 the Mac draws the pill in Liquid Glass, just behind the page.
    if (app.liquid) void call('pill', { x, ms, show: liquid && !app.tabBarAway });
  });

  const liquid = $derived(app.liquid && app.data.settings.theme === 'aura');
</script>

<div class="band" class:away={app.tabBarAway} class:liquid bind:this={band} role="tablist">
  <span class="pill" bind:this={pill}></span>
  {#each TABS as tab, i (tab)}
    <button
      role="tab"
      bind:this={tabs[i]}
      style:left="{centre(WIDE, i) - TAB / 2}px"
      class:active={app.tab === tab}
      aria-selected={app.tab === tab}
      inert={app.tabBarAway}
      onclick={() => app.go(tab)}
    >
      {t(`tab.${tab}`)}
      {#if tab === 'tasks' && updates}<i class="badge" transition:fade></i>{/if}
    </button>
  {/each}
  <div class="middle" bind:this={middle}><Toast /></div>
</div>

<style>
  .band {
    position: absolute;
    left: 0;
    top: calc(var(--tall) - var(--nav-h));
    width: 440px;
    height: var(--nav-h);
    border-top: 1px solid var(--line);
    background: var(--nav);
    z-index: 5;
    transition:
      translate var(--t-medium) var(--ease-page),
      background-color var(--t-short),
      border-color var(--t-short);
  }

  /* A full-card page (Settings, announcements): the bar slides out through the bottom edge. The
     toast it carries stays visible and ends up just above that edge. */
  .band.away {
    translate: 0 var(--nav-h);
    background-color: transparent;
    border-top-color: transparent;
    pointer-events: none;
  }

  /* The Mac's Liquid Glass stands in for the bar's ground and its pill. */
  .band.liquid {
    background: transparent;
    border-top-color: transparent;
  }

  .band.liquid .pill {
    visibility: hidden;
  }

  .band.away .pill,
  .band.away button {
    opacity: 0;
  }

  .band.away .middle {
    pointer-events: auto;
  }

  .pill,
  button {
    position: absolute;
    top: 7px;
    height: 38px;
    border-radius: 14px;
  }

  .pill {
    left: 0;
    width: 88px;
    background: var(--pill);
    transition: opacity var(--t-short);
  }

  button {
    width: 85px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--muted);
    transition:
      color var(--t-short),
      opacity var(--t-short);
  }

  button:hover,
  button.active {
    color: var(--ink);
  }

  button.active {
    font-weight: 650;
  }

  .badge {
    position: absolute;
    top: 9px;
    right: calc(50% - 22px);
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .middle {
    position: absolute;
    left: 220px;
    bottom: 0;
  }
</style>
