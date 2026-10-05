<script lang="ts" module>
  const PATHS = {
    sync: 'M19.5 12a7.5 7.5 0 0 1-13.1 5M4.5 12a7.5 7.5 0 0 1 13.1-5M17.6 3.5V7h-3.5M6.4 20.5V17h3.5',
    more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
    left: 'M14.5 6 8.5 12l6 6',
    right: 'M9.5 6l6 6-6 6',
    down: 'M6.5 9.5 12 15l5.5-5.5',
    plus: 'M12 5.5v13M5.5 12h13',
    search: 'M10.8 17.1a6.3 6.3 0 1 0 0-12.6 6.3 6.3 0 0 0 0 12.6zM19.5 19.5l-4.2-4.2',
    check: 'M5.5 12.5l4.2 4.2 8.8-9.4',
    external: 'M13.5 4.5h6v6M19.5 4.5l-8 8M18 14v4.2c0 .7-.6 1.3-1.3 1.3H5.8c-.7 0-1.3-.6-1.3-1.3V7.3c0-.7.6-1.3 1.3-1.3H10',
    trash: 'M4.5 7h15M9.5 7V5.2c0-.4.3-.7.7-.7h3.6c.4 0 .7.3.7.7V7M6.5 7l.8 11.6c.1.8.7 1.4 1.5 1.4h6.4c.8 0 1.4-.6 1.5-1.4L17.5 7',
    hide: 'M4 4l16 16M9.9 5.7A9 9 0 0 1 12 5.5c4.8 0 8 4.2 9 6.5-.4 1-1.2 2.3-2.4 3.5M6.6 7.3C4.8 8.6 3.6 10.4 3 12c1 2.3 4.2 6.5 9 6.5 1.6 0 3-.5 4.2-1.2M10 10.1a2.8 2.8 0 0 0 3.9 3.9',
    pause: 'M9 6.5v11M15 6.5v11',
    play: 'M8.5 6.2v11.6c0 .6.6.9 1.1.6l9-5.8c.5-.3.5-.9 0-1.2l-9-5.8c-.5-.3-1.1 0-1.1.6z',
    close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
    clock: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 2',
    calendar: 'M6.5 5.5h11c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2h-11c-1.1 0-2-.9-2-2v-10c0-1.1.9-2 2-2zM4.5 10h15M8.5 3.5v3.5M15.5 3.5v3.5',
    pin: 'M12 20.5s-6-5.3-6-10.5a6 6 0 0 1 12 0c0 5.2-6 10.5-6 10.5zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
    edit: 'M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10v4zM13.5 6.5l4 4',
    alert: 'M12 9v4.5M12 16.8v.2M10.3 4.4 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0z',
    stop: 'M7.5 6.5h9c.6 0 1 .4 1 1v9c0 .6-.4 1-1 1h-9c-.6 0-1-.4-1-1v-9c0-.6.4-1 1-1z',
    target: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    news: 'M4.5 10v4c0 .6.4 1 1 1H8l6.5 4V5L8 9H5.5c-.6 0-1 .4-1 1zM17.5 9.5a3.5 3.5 0 0 1 0 5M8.5 15l1 4.5',
    doc: 'M7 3.5h6.5l4.5 4.5v11.5c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1v-15c0-.6.4-1 1-1zM13.5 3.5V8H18M9 12.5h6M9 16h4',
    bell: 'M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14l1.5-2zM10 20.5h4',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 18, fill = false }: { name: IconName; size?: number; fill?: boolean } = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={fill ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width={name === 'more' ? 2.8 : 1.7}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
