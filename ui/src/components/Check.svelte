<script lang="ts">
  let { checked, label, onchange }: { checked: boolean; label: string; onchange: (value: boolean) => void } = $props();
</script>

<button
  class="check"
  class:on={checked}
  role="checkbox"
  aria-checked={checked}
  aria-label={label}
  onclick={(e) => {
    e.stopPropagation();
    onchange(!checked);
  }}
>
  <span class="fill"></span>
  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.8 10.4l2.8 2.8 5.6-6.1" /></svg>
</button>

<style>
  .check {
    position: relative;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ink) 34%, transparent);
    transition: box-shadow var(--t-short) var(--ease-standard);
  }

  .check::before {
    content: '';
    position: absolute;
    inset: -8px;
    border-radius: 50%;
  }

  .check:hover {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }

  .fill {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--accent);
    transform: scale(0.2);
    opacity: 0;
    transition:
      transform var(--t-medium) var(--ease-out),
      opacity var(--t-short) var(--ease-standard);
  }

  .on .fill {
    transform: scale(1);
    opacity: 1;
  }

  svg {
    position: relative;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--accent-ink);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 14;
    stroke-dashoffset: 14;
    transition: stroke-dashoffset var(--t-medium) var(--ease-out) 60ms;
  }

  .check:not(.on):hover svg {
    stroke: var(--accent);
    stroke-dashoffset: 0;
    opacity: 0.45;
    transition: none;
  }

  .on svg {
    stroke-dashoffset: 0;
  }
</style>
