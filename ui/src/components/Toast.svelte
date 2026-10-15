<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { easeIn, easeMorph, move } from '../lib/motion';
</script>

{#if app.toast}
  {#key app.toast.id}
    <div class="toast" role="status" in:move={{ y: 18, scale: 0.96, duration: 380, easing: easeMorph }} out:move={{ y: 10, duration: 160, easing: easeIn }}>
      <span class="lines">
        <span class="text ellipsis">{app.toast.text}</span>
        {#if app.toast.hint}<span class="hint ellipsis">{app.toast.hint}</span>{/if}
      </span>
      {#if app.toast.action}
        {@const action = app.toast.action}
        <button
          onclick={() => {
            action.run();
            app.toast = null;
          }}>{action.label}</button
        >
      {/if}
    </div>
  {/key}
{/if}

<style>
  .toast {
    /* Lives in the nav's centre point, so it rides the bottom edge through a morph. */
    position: absolute;
    left: 0;
    bottom: 62px;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 12px;
    width: max-content;
    max-width: 330px;
    padding: 9px 10px 9px 14px;
    border-radius: 12px;
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-pop);
    z-index: 30;
  }

  .lines {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  .text {
    min-width: 0;
    font-size: 12.5px;
  }

  .hint {
    min-width: 0;
    font-size: 11.5px;
    color: var(--muted);
  }

  button {
    flex: none;
    padding: 3px 8px;
    border-radius: 6px;
    font-weight: 600;
    font-size: 12.5px;
    color: var(--accent);
  }

  button:hover {
    background: var(--accent-soft);
  }
</style>
