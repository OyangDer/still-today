<script lang="ts" generics="T extends string">
  let { value = $bindable(), options, small = false }: { value: T; options: { value: T; label: string }[]; small?: boolean } = $props();

  const buttons: Record<string, HTMLButtonElement> = {};
  let pill = $state({ x: 0, w: 0 });
  let ready = $state(false);

  $effect(() => {
    const el = buttons[value];
    if (!el) return;
    pill = { x: el.offsetLeft, w: el.offsetWidth };
    // The first placement must not animate in from the left edge.
    requestAnimationFrame(() => (ready = true));
  });
</script>

<div class="seg" class:small role="radiogroup">
  <span class="pill" class:ready style:transform="translate3d({pill.x}px,0,0)" style:width="{pill.w}px"></span>
  {#each options as option (option.value)}
    <button
      role="radio"
      aria-checked={value === option.value}
      class:active={value === option.value}
      bind:this={buttons[option.value]}
      onclick={() => (value = option.value)}>{option.label}</button
    >
  {/each}
</div>

<style>
  /* A capsule, like the pills it sits beside. */
  .seg {
    position: relative;
    display: inline-flex;
    padding: 2px;
    border-radius: 999px;
    background: var(--control);
  }

  .pill {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 0;
    border-radius: 999px;
    background: var(--raised);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .pill.ready {
    transition:
      transform var(--t-medium) var(--ease-morph),
      width var(--t-medium) var(--ease-morph);
  }

  :global([data-theme='aura']) .pill {
    background: color-mix(in srgb, var(--raised) 78%, transparent);
  }

  :global([data-theme='aura'][data-ink='light']) .pill,
  :global([data-theme='dark']) .pill {
    background: var(--control-press);
    box-shadow: none;
  }

  button {
    position: relative;
    height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 12.5px;
    color: var(--muted);
    white-space: nowrap;
    transition: color var(--t-short);
  }

  .small button {
    height: 24px;
    padding: 0 11px;
    font-size: 12px;
  }

  button:hover,
  button.active {
    color: var(--ink);
  }

  button.active {
    font-weight: 600;
  }
</style>
