<script lang="ts">
  // `aurora` dresses the switch in Aura's own colours, drifting, so it reads as an effect to try.
  let {
    checked = $bindable(),
    label,
    aurora = false,
    onchange,
  }: { checked: boolean; label: string; aurora?: boolean; onchange?: (value: boolean) => void } = $props();
</script>

<button
  class="toggle"
  class:aurora
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

  /* A colour band that starts and ends on the same pink, so sliding it one tile on loops seamlessly. */
  .aurora {
    --aurora: linear-gradient(90deg, #ff5fa2, #a66bff 25%, #3fb8ff 50%, #3ddc97 75%, #ff5fa2);
  }

  .aurora .label {
    font-weight: 650;
    color: transparent;
    background: var(--aurora) 0 0 / 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    animation: aurora-label 9s linear infinite;
  }

  /* Off, the colours only show faintly, and wake under the pointer; on, they run at full strength. */
  .aurora .track {
    background: var(--aurora) 0 0 / 300% 100%;
    filter: saturate(0.3);
    opacity: 0.55;
    animation: aurora-flow 6s linear infinite;
    transition:
      filter var(--t-short) var(--ease-standard),
      opacity var(--t-short) var(--ease-standard),
      box-shadow var(--t-short) var(--ease-standard);
  }

  .aurora:hover .track {
    filter: saturate(0.8);
    opacity: 0.8;
  }

  .aurora .track.on {
    filter: none;
    opacity: 1;
    box-shadow: 0 0 10px rgba(166, 107, 255, 0.45);
  }

  .aurora .on .knob {
    background: #fff;
  }

  /* One tile on: 200% of a band twice as wide as the label, 150% of one three times the track. */
  @keyframes aurora-label {
    to {
      background-position: 200% 0;
    }
  }

  @keyframes aurora-flow {
    to {
      background-position: 150% 0;
    }
  }
</style>
