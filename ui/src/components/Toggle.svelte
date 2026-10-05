<script lang="ts">
  let { checked = $bindable(), label, onchange }: { checked: boolean; label: string; onchange?: (value: boolean) => void } = $props();
</script>

<button
  class="toggle"
  role="switch"
  aria-checked={checked}
  onclick={() => {
    checked = !checked;
    onchange?.(checked);
  }}
>
  <span class="label">{label}</span>
  <span class="track" class:on={checked}><span class="knob"></span></span>
</button>

<style>
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 9px 12px;
    border-radius: 10px;
    text-align: left;
    transition: background-color var(--t-micro);
  }

  .toggle:hover {
    background: var(--control);
  }

  .track {
    position: relative;
    width: 34px;
    height: 20px;
    flex: none;
    border-radius: 999px;
    background: var(--control-press);
    transition: background-color var(--t-short) var(--ease-standard);
  }

  .track.on {
    background: var(--accent);
  }

  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    transition: transform var(--t-medium) var(--ease-morph);
  }

  .on .knob {
    transform: translateX(14px);
    background: var(--accent-ink);
  }
</style>
