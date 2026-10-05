<script lang="ts">
  import { dismiss } from '../lib/dismiss';
  import { app } from '../lib/state.svelte';
  import { monthDay, monthTitle, t, weekdayShort } from '../lib/i18n';
  import { addMonths } from '../lib/time';
  import { easeOut, fade, move } from '../lib/motion';
  import Icon from './Icon.svelte';
  import MonthGrid from './MonthGrid.svelte';

  /** `clearable` puts a button beside a set date that empties it back to the placeholder. */
  let { value = $bindable(), placeholder = '', clearable = false }: { value: Date | null; placeholder?: string; clearable?: boolean } = $props();

  let open = $state(false);
  let month = $state(new Date((value ?? app.now).getFullYear(), (value ?? app.now).getMonth(), 1));
  let direction = $state(1);

  function toggle() {
    open = !open;
    if (open) month = new Date((value ?? app.now).getFullYear(), (value ?? app.now).getMonth(), 1);
  }
</script>

<div class="date-field">
  <button class="control" class:empty={!value} class:open onclick={toggle}>
    <Icon name="calendar" size={15} />
    <span class="ellipsis">{value ? `${monthDay(value)} ${weekdayShort(value)}` : placeholder}</span>
  </button>
  {#if clearable && value}
    <button class="clear" aria-label={placeholder} title={placeholder} onclick={() => (value = null)} transition:fade={{ duration: 120 }}>
      <Icon name="close" size={14} />
    </button>
  {/if}
  {#if open}
    <div class="popover" use:dismiss={() => (open = false)} in:move={{ y: -6, scale: 0.98, duration: 240, easing: easeOut }} out:fade={{ duration: 120 }}>
      <div class="head">
        <span>{monthTitle(month)}</span>
        <span class="arrows">
          <button aria-label={t('cal.prev')} onclick={() => ((direction = -1), (month = addMonths(month, -1)))}><Icon name="left" size={15} /></button>
          <button aria-label={t('cal.next')} onclick={() => ((direction = 1), (month = addMonths(month, 1)))}><Icon name="right" size={15} /></button>
        </span>
      </div>
      <MonthGrid
        small
        {month}
        {direction}
        selected={value}
        today={app.now}
        onselect={(d) => {
          value = d;
          open = false;
        }}
      />
    </div>
  {/if}
</div>

<style>
  .date-field {
    position: relative;
    display: flex;
    gap: 6px;
  }

  .control {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    height: 36px;
    padding: 0 12px;
    border-radius: 10px;
    background: var(--control);
    color: var(--ink);
    transition: background-color var(--t-micro), box-shadow var(--t-short);
  }

  .control :global(.icon) {
    color: var(--muted);
  }

  .control:hover {
    background: var(--control-hover);
  }

  .control.open {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent);
  }

  .empty span {
    color: var(--faint);
  }

  .clear {
    display: grid;
    place-items: center;
    width: 36px;
    flex: none;
    border-radius: 10px;
    color: var(--muted);
    background: var(--control);
    transition: background-color var(--t-micro), color var(--t-micro);
  }

  .clear:hover {
    color: var(--ink);
    background: var(--control-hover);
  }

  .popover {
    position: absolute;
    top: 42px;
    left: 0;
    width: 264px;
    padding: 10px 10px 8px;
    border-radius: 14px;
    background: var(--raised);
    box-shadow: var(--shadow-pop);
    transform-origin: top left;
    z-index: 40;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2px 6px 6px;
    font-weight: 600;
  }

  .arrows {
    display: flex;
  }

  .arrows button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    color: var(--muted);
  }

  .arrows button:hover {
    color: var(--ink);
    background: var(--control-hover);
  }
</style>
