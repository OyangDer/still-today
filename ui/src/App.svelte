<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { app, TABS, WIDE_TABS } from './lib/state.svelte';
  import { call } from './lib/host';
  import { easeIn, easePage, follow, isReduced, move, MORPH_MS, type Frame } from './lib/motion';
  import Header from './components/Header.svelte';
  import Nav from './components/Nav.svelte';
  import Today from './views/Today.svelte';
  import Calendar from './views/Calendar.svelte';
  import Focus from './views/Focus.svelte';
  import Tasks from './views/Tasks.svelte';
  import TaskDetail from './views/TaskDetail.svelte';
  import TaskEditor from './views/TaskEditor.svelte';
  import EventEditor from './views/EventEditor.svelte';
  import Settings from './views/Settings.svelte';
  import Announcements from './views/Announcements.svelte';
  import Announcement from './views/Announcement.svelte';

  // The WebView is always EXPANDED in size; the native window clips it to the current card. Keep
  // in step with host/WidgetForm.cs.
  const EXPANDED = { w: 440, h: 600 };
  // On the Mac, as wide as the system's medium and large widgets, so the card
  // lines up in a column with them.
  const COMPACT_W = app.mac ? 344 : 360;
  const COMPACT_MIN_H = 320;
  const HEAD = 36;
  const NAV = 53;
  // Time for the morph request to reach the host before the shared start instant.
  const LEAD_MS = 34;

  let heights = $state({ today: 0, focus: 0 });
  const wide = $derived(app.pages.length > 0 || WIDE_TABS.includes(app.tab));
  const target = $derived(
    wide ? EXPANDED : { w: COMPACT_W, h: Math.max(COMPACT_MIN_H, HEAD + NAV + heights[app.tab as 'today' | 'focus']) },
  );

  // Where the chrome is heading; Header and Nav move their pieces on the window's timeline.
  let frame = $state.raw<Frame>({ ...EXPANDED, start: 0, ms: 0 });
  let current = { w: 0, h: 0 };
  let entering = $state(true);
  // Content enters a beat into the morph, as in the WPF release: sooner when the card shrinks, and
  // at once when the size holds. It is worked out per navigation rather than in the morph effect, so
  // it reaches the DOM in the same update as the view's class flip.
  let wasWide: boolean | undefined;
  const pageDelay = $derived.by(() => {
    void [app.tab, app.pages.length];
    const delay = wasWide === undefined || wasWide === wide ? 0 : wide ? 125 : 85;
    wasWide = wide;
    return delay;
  });
  let stage = $state<HTMLElement>();
  let content = $state<HTMLElement>();

  // The window is still hidden here, and a hidden page gets neither animation frames nor
  // ResizeObserver callbacks. So the first size is measured by forcing layout, and the fade-in
  // waits for the first frame, which only arrives once the host has shown the window.
  onMount(async () => {
    await tick();
    for (const el of document.querySelectorAll<HTMLElement>('[data-measure]'))
      heights[el.dataset.measure as 'today' | 'focus'] = el.offsetHeight;
    await tick();
    current = target;
    frame = { ...current, start: 0, ms: 0 };
    await tick();
    await call('ready', { width: current.w, height: current.h });
    requestAnimationFrame(() => (entering = false));
  });

  $effect(() => {
    const size = target;
    if (!current.w || (size.w === current.w && size.h === current.h)) return;
    current = size;
    const ms = isReduced() || app.morph === false ? 0 : MORPH_MS;
    const start = Date.now() + LEAD_MS;
    void call('morph', { width: size.w, height: size.h, start, ms });
    frame = { ...size, start, ms };
  });

  // A press on anything that is not a control moves the widget, as in the WPF release. The host
  // runs the native move loop, so dragging across monitors and DPI changes behave like any window.
  const CONTROLS = 'button, a, input, textarea, select, label, [role=button], [role=tab], [role=spinbutton], [tabindex]:not([tabindex="-1"])';
  function moves(e: MouseEvent): boolean {
    if (e.button !== 0 || app.data.settings.locked) return false;
    const target = e.target as HTMLElement;
    if (target.closest(CONTROLS)) return false;
    // Presses on a scrollbar scroll.
    return !(target.scrollHeight > target.clientHeight && e.offsetX >= target.clientWidth);
  }
  function press(e: PointerEvent) {
    if (moves(e)) void call('drag');
  }
  // The press that moves the widget mustn't also begin a text selection: a fast drag outruns the
  // window, and WebKit, still holding the button, selects the text the pointer crosses. Holding the
  // press back also keeps focus where it was, so a field being edited is let go here instead.
  function hold(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!moves(e) || getComputedStyle(target).getPropertyValue('-webkit-user-select') !== 'none') return;
    e.preventDefault();
    const field = document.activeElement;
    if (field instanceof HTMLElement && field.matches('input, textarea')) field.blur();
  }

  // The stage's bottom edge rides the nav bar while its content holds still, so nothing slides
  // under the translucent bar mid-morph. A language change rebuilds the card, so the elements are
  // unbound for a moment and the new ones take the offsets when they bind.
  $effect(() => {
    const { h, start, ms } = frame;
    if (!stage || !content) return;
    follow(stage, `translate3d(0, ${h - EXPANDED.h}px, 0)`, start, ms);
    follow(content, `translate3d(0, ${EXPANDED.h - h}px, 0)`, start, ms);
  });
</script>

<svelte:window onpointerdown={press} onmousedown={hold} />

{#key app.data.settings.lang}
  <div
    class="card"
    class:entering
    class:bare={app.tabBarAway}
    style:--head="{HEAD}px"
    style:--nav-h="{NAV}px"
    style:--tall="{EXPANDED.h}px"
    style:--page-delay="{pageDelay}ms"
  >
    <div class="backdrop" aria-hidden="true"></div>
    <Header {frame} />
    <main class="stage" bind:this={stage}>
      <div class="content" bind:this={content}>
        <div class="layer" class:covered={app.pages.length > 0}>
          {#each TABS as tab (tab)}
            {@const active = app.tab === tab}
            <section class="view" class:wide={WIDE_TABS.includes(tab)} class:active inert={!active || app.pages.length > 0}>
              {#if tab === 'today'}
                <div data-measure="today" bind:offsetHeight={heights.today}><Today /></div>
              {:else if tab === 'focus'}
                <div data-measure="focus" bind:offsetHeight={heights.focus}><Focus /></div>
              {:else if tab === 'calendar'}
                <Calendar />
              {:else}
                <Tasks />
              {/if}
            </section>
          {/each}
        </div>
        {#each app.pages as page, i (page)}
          <section
            class="view wide page active"
            class:covered={i < app.pages.length - 1}
            in:move={{ x: 24, duration: 300, delay: pageDelay, easing: easePage }}
            out:move={{ x: 24, duration: 150, easing: easeIn }}
          >
            {#if page.kind === 'task'}
              <TaskDetail key={page.key} />
            {:else if page.kind === 'taskEdit'}
              <TaskEditor id={page.id} />
            {:else if page.kind === 'event'}
              <EventEditor day={page.day} id={page.id ?? null} />
            {:else if page.kind === 'announcements'}
              <Announcements />
            {:else if page.kind === 'announcement'}
              <Announcement id={page.id} />
            {:else}
              <Settings />
            {/if}
          </section>
        {/each}
      </div>
    </main>
    <Nav {frame} />
  </div>
{/key}

<style>
  .card {
    position: relative;
    width: 440px;
    height: var(--tall);
    overflow: hidden;
    transition:
      opacity var(--t-long) var(--ease-standard),
      transform var(--t-long) var(--ease-morph);
  }

  .card.entering {
    opacity: 0;
    transform: translate3d(0, 8px, 0);
  }

  .backdrop {
    position: absolute;
    inset: 0;
    background: var(--sheen), var(--bg);
    box-shadow: var(--edge);
    pointer-events: none;
  }

  :global([data-theme='aura']) .backdrop {
    background: var(--sheen), var(--scrim, rgba(245, 249, 252, 0.4));
    transition: background-color var(--t-long) var(--ease-standard);
  }

  /* Energy saver or the Transparency switch has stopped Windows blurring, which would leave the
     scrim over black: the wallpaper's own colours stand in for the blur. */
  :global([data-theme='aura'][data-glass='off']) .backdrop {
    background: var(--sheen), linear-gradient(var(--scrim), var(--scrim)), var(--aura-fill);
  }

  .stage {
    position: absolute;
    top: var(--head);
    left: 0;
    width: 440px;
    height: calc(var(--tall) - var(--head) - var(--nav-h));
    overflow: hidden;
  }

  .card.bare .stage {
    height: calc(var(--tall) - var(--head));
  }

  .content {
    position: absolute;
    inset: 0;
  }

  .layer {
    position: absolute;
    inset: 0;
    transition:
      transform var(--t-medium) var(--ease-page),
      opacity var(--t-short) var(--ease-standard);
  }

  /* Every tab stays mounted, so switching never waits on a first render and the content moves on
     the same frame as the window. */
  .view {
    position: absolute;
    top: 0;
    left: 0;
    width: 360px;
    opacity: 0;
    visibility: hidden;
    transform: translate3d(0, 6px, 0);
    transition:
      opacity 105ms var(--ease-in),
      transform 105ms var(--ease-in),
      visibility 0s linear 105ms;
  }

  :global([data-os='mac']) .view {
    width: 344px;
  }

  .view.wide {
    width: 440px;
    height: 100%;
  }

  .view.active {
    opacity: 1;
    visibility: visible;
    transform: none;
    transition:
      opacity var(--t-page) var(--ease-page) var(--page-delay),
      transform var(--t-page) var(--ease-page) var(--page-delay),
      visibility 0s;
  }

  .layer.covered,
  .page.covered {
    transform: translate3d(-20px, 0, 0);
    opacity: 0;
    pointer-events: none;
  }

  .page {
    transition:
      transform var(--t-medium) var(--ease-page),
      opacity var(--t-short) var(--ease-standard);
  }
</style>
