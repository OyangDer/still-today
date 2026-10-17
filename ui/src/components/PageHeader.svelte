<script lang="ts">
  import type { Snippet } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { t } from '../lib/i18n';
  import Icon from './Icon.svelte';

  let { title = '', children }: { title?: string; children?: Snippet } = $props();
</script>

<header>
  <button class="back" onclick={() => app.pop()}>
    <Icon name="left" size={17} />
    <span>{title || t('back')}</span>
  </button>
  <div class="tools">{@render children?.()}</div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 12px 6px 10px;
  }

  /* A capsule, as the widget's other buttons are; its rounder ends take a little more room, which the
     margin gives back, so the chevron stays where it was. */
  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 30px;
    margin-left: -2px;
    padding: 0 12px 0 6px;
    border-radius: 999px;
    font-weight: 600;
    color: var(--ink);
    transition: background-color var(--t-micro);
  }

  .back:hover {
    background: var(--control-hover);
  }

  .tools {
    display: flex;
    gap: 2px;
  }
</style>
