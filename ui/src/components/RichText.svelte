<script lang="ts">
  import { call } from '../lib/host';
  import { sanitize } from '../lib/sanitize';

  /** Teacher-authored Canvas HTML, rebuilt through the sanitizer; its links open in the browser or the mail app. */
  let { html }: { html: string } = $props();

  function paint(node: HTMLElement, value: string) {
    node.replaceChildren(sanitize(value));
    return { update: (next: string) => node.replaceChildren(sanitize(next)) };
  }

  function click(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!a) return;
    e.preventDefault();
    void call('open', { url: a.href });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (the links inside take the keyboard) -->
<div class="rich" use:paint={html} onclick={click}></div>

<style>
  .rich {
    font-size: 13.5px;
    line-height: 1.7;
    -webkit-user-select: text;
    user-select: text;
    overflow-wrap: anywhere;
  }

  .rich :global(p),
  .rich :global(div) {
    margin: 0 0 0.75em;
  }

  .rich :global(div > div),
  .rich :global(div > p:last-child),
  .rich :global(li > p) {
    margin-bottom: 0.4em;
  }

  .rich :global(ul),
  .rich :global(ol) {
    margin: 0 0 0.75em;
    padding-left: 1.4em;
  }

  .rich :global(li) {
    margin: 0.2em 0;
  }

  .rich :global(li::marker) {
    color: var(--muted);
  }

  .rich :global(h4) {
    margin: 1.1em 0 0.35em;
    font-size: 14px;
    font-weight: 650;
  }

  .rich :global(:first-child) {
    margin-top: 0;
  }

  .rich :global(blockquote) {
    margin: 0 0 0.75em;
    padding-left: 12px;
    border-left: 3px solid var(--line);
    color: var(--muted);
  }

  .rich :global(hr) {
    margin: 1em 0;
    border: 0;
    border-top: 1px solid var(--line);
  }

  /* Only a link that goes somewhere looks like one. */
  .rich :global(a[href]) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .rich :global(table) {
    border-collapse: collapse;
    margin: 0 0 0.8em;
    font-size: 12px;
    line-height: 1.5;
  }

  .rich :global(td),
  .rich :global(th) {
    padding: 5px 7px;
    border: 1px solid var(--line);
    vertical-align: top;
  }

  .rich :global(pre),
  .rich :global(code) {
    font-family: 'Cascadia Mono', Consolas, monospace;
    font-size: 12px;
  }
</style>
