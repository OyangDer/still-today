<script lang="ts">
  import { t } from '../lib/i18n';
  import Icon from './Icon.svelte';

  // Minutes since midnight. Each half responds to typing, the wheel and the arrow keys.
  let { value = $bindable(), disabled = false }: { value: number; disabled?: boolean } = $props();

  const hours = $derived(Math.floor(value / 60));
  const minutes = $derived(value % 60);
  const pad = (n: number) => String(n).padStart(2, '0');

  function set(h: number, m: number) {
    value = ((((h * 60 + m) % 1440) + 1440) % 1440);
  }

  function step(part: 'h' | 'm', delta: number) {
    if (part === 'h') set(hours + delta, minutes);
    else set(hours, Math.round((minutes + delta) / Math.abs(delta)) * Math.abs(delta));
  }

  function wheel(part: 'h' | 'm', e: WheelEvent) {
    if (disabled) return;
    e.preventDefault();
    step(part, (e.deltaY < 0 ? 1 : -1) * (part === 'm' ? 5 : 1));
  }

  function keys(part: 'h' | 'm', e: KeyboardEvent) {
    const delta = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    step(part, delta * (part === 'm' && !e.altKey ? 5 : 1));
  }

  function typed(part: 'h' | 'm', e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const n = parseInt(input.value.replace(/\D/g, ''), 10);
    if (!Number.isNaN(n)) {
      if (part === 'h') set(Math.min(23, n), minutes);
      else set(hours, Math.min(59, n));
    }
    // When the clamp lands on the value already held, or nothing could be read, nothing re-renders
    // and the typed "25" or "ab" would stay.
    input.value = pad(part === 'h' ? hours : minutes);
  }
</script>

<div class="time-field" class:disabled>
  <Icon name="clock" size={15} />
  <input
    class="num"
    value={pad(hours)}
    {disabled}
    inputmode="numeric"
    maxlength="2"
    aria-label={t('focus.hours')}
    onwheel={(e) => wheel('h', e)}
    onkeydown={(e) => keys('h', e)}
    onchange={(e) => typed('h', e)}
    onfocus={(e) => e.currentTarget.select()}
  />
  <span class="colon">:</span>
  <input
    class="num"
    value={pad(minutes)}
    {disabled}
    inputmode="numeric"
    maxlength="2"
    aria-label={t('focus.minutes')}
    onwheel={(e) => wheel('m', e)}
    onkeydown={(e) => keys('m', e)}
    onchange={(e) => typed('m', e)}
    onfocus={(e) => e.currentTarget.select()}
  />
</div>

<style>
  .time-field {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 10px 0 12px;
    border-radius: 10px;
    background: var(--control);
    transition: background-color var(--t-micro), opacity var(--t-short);
  }

  .time-field :global(.icon) {
    margin-right: 6px;
    color: var(--muted);
  }

  .time-field:hover {
    background: var(--control-hover);
  }

  .time-field:focus-within {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent);
  }

  .disabled {
    opacity: 0.45;
  }

  input {
    width: 24px;
    padding: 2px 0;
    border: 0;
    border-radius: 5px;
    background: none;
    text-align: center;
    font-size: 13.5px;
    cursor: ns-resize;
  }

  /* The field's ring shows focus; the half being typed in is tinted rather than outlined. */
  input:focus {
    background: var(--accent-soft);
    cursor: text;
  }

  input:focus-visible {
    outline: none;
  }

  .colon {
    padding: 0 1px;
    color: var(--muted);
  }
</style>
