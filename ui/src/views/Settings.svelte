<script lang="ts">
  import { isCanvasFeed } from '../lib/agenda';
  import { schoolSearches, type School } from '../lib/canvas';
  import { call } from '../lib/host';
  import { app, normalizeHost } from '../lib/state.svelte';
  import { monthDay, t, timeOrDate } from '../lib/i18n';
  import { dayKey, fromDayKey, hhmm, parseIso } from '../lib/time';
  import { slide } from 'svelte/transition';
  import { easeOut, fade, isReduced, move } from '../lib/motion';
  import type { Lang, Theme } from '../lib/model';
  import DateField from '../components/DateField.svelte';
  import Icon from '../components/Icon.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Toggle from '../components/Toggle.svelte';

  const THEMES: Theme[] = ['aura', 'light', 'dark'];

  let lang = $state<Lang>(app.data.settings.lang);
  let token = $state('');
  let canvasBusy = $state(false);
  let canvasError = $state('');
  let feedUrl = $state('');
  let feedBusy = $state(false);
  let feedError = $state('');
  let feedGuide = $state(false);
  // A new token for the same Canvas keeps everything synced from it; a rejected one opens this.
  let replacing = $state(app.data.canvas.error === 'token');

  $effect(() => {
    if (lang !== app.data.settings.lang) app.setLanguage(lang);
  });

  // A course hidden as a whole is shown again from its own row, not item by item here.
  const hidden = $derived(Object.values(app.data.assignments).filter((a) => a.hidden && app.courseShown(a.courseId)));
  // Hidden occurrences that are still on the synced calendar, so they can be brought back.
  const hiddenEvents = $derived(
    app.data.hiddenEvents.flatMap((key) => {
      let found: { title: string; start: string; allDay: boolean } | undefined;
      let from: string | null = null;
      if (key.startsWith('c:')) {
        const event = app.data.canvasEvents.find((e) => `c:${e.id}` === key);
        found = event;
        from = event?.course ?? null;
      } else {
        const feed = app.data.feeds.find((f) => key.startsWith(`f:${f.id}:`));
        found = feed && app.data.feedEvents[feed.id]?.find((e) => key === `f:${feed.id}:${e.key}`);
        from = feed?.name ?? null;
      }
      const start = found && (found.allDay ? fromDayKey(found.start) : parseIso(found.start));
      if (!found || !start) return [];
      const when = found.allDay ? monthDay(start) : `${monthDay(start)} ${hhmm(start)}`;
      return [{ key, title: found.title, sub: [when, from].filter(Boolean).join(' · ') }];
    }),
  );
  const courseList = $derived(
    Object.entries(app.data.canvas.courses)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const canvasSync = $derived(parseIso(app.data.canvas.lastSync));
  const initials = $derived((app.data.canvas.user ?? '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase());

  // The school is found by name in Instructure's directory, or given as any link into its Canvas.
  let school = $state('');
  let chosen = $state<School | null>(null);
  let schools = $state<School[] | null>([]);
  let answered = $state(false);
  let active = $state(0);
  let searchTimer = 0;
  const typedHost = $derived(school.includes('.') && !/\s/.test(school.trim()) ? normalizeHost(school) : null);
  const host = $derived(chosen?.domain ?? typedHost);
  const listed = $derived(chosen || typedHost || !answered ? [] : (schools ?? []).slice(0, 6));

  // The list follows each keystroke after a short pause; an answer to an older query is dropped.
  function search() {
    chosen = null;
    clearTimeout(searchTimer);
    const query = school;
    if (typedHost || !schoolSearches(query).length) {
      answered = false;
      return;
    }
    searchTimer = window.setTimeout(async () => {
      const found = await app.findSchools(query);
      if (query !== school) return;
      schools = found;
      answered = true;
      active = 0;
    }, 160);
  }

  function choose(s: School) {
    chosen = s;
    school = s.name;
  }

  // Up and down walk the list, and Enter takes the highlighted school instead of sending the form.
  function schoolKey(e: KeyboardEvent) {
    if (!listed.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : listed.length - 1)) % listed.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(listed[active]);
    }
  }

  async function connect(target: string) {
    canvasBusy = true;
    canvasError = '';
    // Whatever goes wrong on the way, the button comes back and says so.
    const result = await app.connectCanvas(target, token).catch(() => 'offline' as const);
    canvasBusy = false;
    if (result === 'ok') {
      token = '';
      replacing = false;
    } else canvasError = t(result === 'badHost' ? 'canvas.badHost' : result === 'rejected' ? 'canvas.rejected' : 'canvas.offline');
  }

  // Disconnecting drops every synced assignment and removing a feed forgets its link, and neither
  // can be undone, so each takes a second, deliberate click on the same button.
  let armed = $state<string | null>(null);
  let armTimer = 0;
  function confirm(what: string, run: () => void) {
    clearTimeout(armTimer);
    if (armed !== what) {
      armed = what;
      armTimer = window.setTimeout(() => (armed = null), 3000);
      return;
    }
    armed = null;
    run();
  }

  async function addFeed() {
    if (!feedUrl.trim()) return;
    feedBusy = true;
    feedError = '';
    const result = await app.addFeed(feedUrl).catch(() => 'offline' as const);
    feedBusy = false;
    if (result === 'ok') feedUrl = '';
    else feedError = t(result === 'https' ? 'feeds.https' : result === 'long' ? 'feeds.long' : result === 'bad' ? 'feeds.bad' : 'feeds.offline');
  }
</script>

<!-- The token is made on Canvas itself: a way straight to that page, and what to press there. -->
{#snippet guide(host: string | null)}
  <div class="guide">
    <button type="button" class="btn quiet open" onclick={() => void call('open', { url: `https://${host}/profile/settings` })}>
      {t('canvas.openSettings')}<Icon name="external" size={13} />
    </button>
    <ol>
      <li>{t('canvas.step1')}</li>
      <li>{t('canvas.step2')}</li>
      <li>{t('canvas.step3')}</li>
    </ol>
    <p class="hint">{t('canvas.noButton')}</p>
  </div>
{/snippet}

<div class="settings">
  <PageHeader title={t('settings.title')} />
  <div class="content scroll">
    <section>
      <h3>{t('settings.appearance')}</h3>
      <div class="themes">
        {#each THEMES as theme (theme)}
          <button class="theme" class:on={app.data.settings.theme === theme} onclick={() => app.setTheme(theme)}>
            <span class="swatch" data-theme-preview={theme}><span></span></span>
            <span class="theme-name">{t(`theme.${theme}`)}</span>
          </button>
        {/each}
      </div>
      <div class="line">
        <span>{t('settings.language')}</span>
        <Segmented
          small
          bind:value={lang}
          options={[
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>
    </section>

    <section>
      <h3>{t('canvas.title')}</h3>
      {#if app.data.canvas.host && app.data.canvas.user !== null}
        <div class="account" in:fade={{ duration: 200 }}>
          <span class="avatar">
            {#if app.canvasAvatar}<img src={app.canvasAvatar} alt="" />{:else}{initials}{/if}
          </span>
          <span class="who">
            <span class="name ellipsis">{app.data.canvas.user}</span>
            <span class="sub ellipsis">{app.data.canvas.host}{canvasSync ? ` · ${t('sync.last', { t: timeOrDate(canvasSync, app.now) })}` : ''}</span>
          </span>
          <button class="text-btn danger" class:armed={armed === 'canvas'} onclick={() => confirm('canvas', () => void app.disconnectCanvas())}>
            {t(armed === 'canvas' ? 'canvas.confirm' : 'canvas.disconnect')}
          </button>
        </div>
        {#if app.data.canvas.error === 'token'}<p class="hint error">{t('sync.token')}</p>{/if}
        <div class="line">
          <span>{t('canvas.token')}</span>
          <button
            class="text-btn"
            onclick={() => {
              replacing = !replacing;
              token = '';
              canvasError = '';
            }}>{t(replacing ? 'cancel' : 'canvas.replace')}</button
          >
        </div>
        {#if replacing}
          <div class="replace" in:fade={{ duration: 200 }}>
            {@render guide(app.data.canvas.host)}
            <form
              class="inline"
              onsubmit={(e) => {
                e.preventDefault();
                void connect(app.data.canvas.host!);
              }}
            >
              <input class="input" type="password" bind:value={token} placeholder={t('canvas.token')} aria-label={t('canvas.token')} />
              <button class="btn quiet" type="submit" disabled={canvasBusy || !token.trim()}>{canvasBusy ? t('canvas.verifying') : t('canvas.connect')}</button>
            </form>
            {#if canvasError}<p class="hint error">{canvasError}</p>{/if}
          </div>
        {/if}
        <div class="line">
          <span>{t('canvas.expires')}</span>
          <div class="expires">
            <DateField
              bind:value={
                () => (app.data.canvas.tokenExpires ? fromDayKey(app.data.canvas.tokenExpires) : null),
                (d) => {
                  app.data.canvas.tokenExpires = d ? dayKey(d) : null;
                  app.persist();
                }
              }
              placeholder={t('canvas.expiresNone')}
              clearable
            />
          </div>
        </div>
        <div class="toggles">
          <Toggle
            checked={app.data.settings.notifications}
            label={t('settings.notifications')}
            onchange={(v) => {
              app.data.settings.notifications = v;
              app.persist();
            }}
          />
        </div>
      {:else}
        <form
          class="connect"
          onsubmit={(e) => {
            e.preventDefault();
            if (host) void connect(host);
          }}
        >
          <input
            class="input"
            bind:value={school}
            oninput={search}
            onkeydown={schoolKey}
            placeholder={t('canvas.schoolHint')}
            spellcheck="false"
            autocomplete="off"
            aria-label={t('canvas.school')}
          />
          {#if listed.length}
            <div class="schools" role="listbox" aria-label={t('canvas.school')}>
              {#each listed as s, i (s.domain)}
                <button type="button" class="school" class:active={i === active} role="option" aria-selected={i === active} onpointerenter={() => (active = i)} onclick={() => choose(s)}>
                  <span class="name ellipsis">{s.name}</span>
                  <span class="sub ellipsis">{s.domain}</span>
                </button>
              {/each}
            </div>
          {:else if answered && !host}
            <p class="hint" class:error={schools === null}>{t(schools === null ? 'canvas.schoolOffline' : 'canvas.noSchool')}</p>
          {:else if chosen}
            <p class="hint">{chosen.domain}</p>
          {/if}
          {#if host}
            <div class="steps" in:fade={{ duration: 200 }}>
              {@render guide(host)}
              <input class="input" type="password" bind:value={token} placeholder={t('canvas.token')} aria-label={t('canvas.token')} />
              {#if canvasError}<p class="hint error" transition:fade={{ duration: 150 }}>{canvasError}</p>{/if}
              <button class="btn primary" type="submit" disabled={canvasBusy || !token.trim()}>
                {canvasBusy ? t('canvas.verifying') : t('canvas.connect')}
              </button>
            </div>
          {/if}
        </form>
      {/if}
    </section>

    <!-- A name only the student can choose: each field shows Canvas's name until they type their own. -->
    {#if app.data.canvas.host && courseList.length}
      <section>
        <h3>{t('tasks.courses')}</h3>
        <p class="hint lead">{t('courses.hint')}</p>
        {#each courseList as c (c.id)}
          {@const off = !app.courseShown(c.id)}
          <div class="course" class:off>
            <i class="course-dot" style:--course={app.data.canvas.colors[c.id]}></i>
            <input
              class="input"
              value={app.data.settings.courseNames[c.id] ?? ''}
              placeholder={c.name}
              title={c.name}
              aria-label={c.name}
              spellcheck="false"
              onchange={(e) => app.renameCourse(c.id, e.currentTarget.value)}
              onkeydown={(e) => e.key === 'Enter' && !e.isComposing && e.currentTarget.blur()}
            />
            <button class="text-btn" onclick={() => app.toggleCourse(c.id)}>{t(off ? 'courses.show' : 'courses.hide')}</button>
          </div>
        {/each}
      </section>
    {/if}

    <section>
      <h3>{t('feeds.title')}</h3>
      <p class="hint lead">{t(app.data.canvas.host ? 'feeds.aboutCanvas' : 'feeds.about')}</p>
      <!-- Each kind of calendar keeps its subscription link somewhere different. -->
      <button class="text-btn how" class:open={feedGuide} aria-expanded={feedGuide} onclick={() => (feedGuide = !feedGuide)}>
        {t('feeds.how')}<Icon name="down" size={13} />
      </button>
      {#if feedGuide}
        <div class="guide sources" transition:slide={{ duration: isReduced() ? 0 : 260, easing: easeOut }}>
          <dl>
            <dt>Google</dt>
            <dd>{t('feeds.google')}</dd>
            <dt>Outlook</dt>
            <dd>{t('feeds.outlook')}</dd>
            <dt>{t('feeds.timetable')}</dt>
            <dd>{t('feeds.timetableHow')}</dd>
          </dl>
          <p class="hint">{t(app.mac ? 'feeds.private.mac' : 'feeds.private')}</p>
        </div>
      {/if}
      {#each app.data.feeds as feed (feed.id)}
        {@const covered = isCanvasFeed(app.data, feed)}
        <div class="feed" class:covered in:move={{ y: 6, duration: 260, easing: easeOut }} out:fade={{ duration: 150 }}>
          <span class="feed-dot" class:error={feed.error && !covered}></span>
          <span class="who">
            <span class="name ellipsis">{feed.name}</span>
            <span class="sub ellipsis"
              >{covered ? t('feeds.canvasCovered') : `${feed.host} · ${t('feeds.events', { n: app.data.feedEvents[feed.id]?.length ?? 0 })}`}</span
            >
          </span>
          <button class="text-btn danger" class:armed={armed === feed.id} onclick={() => confirm(feed.id, () => void app.removeFeed(feed.id))}>
            {t(armed === feed.id ? 'feeds.confirm' : 'feeds.remove')}
          </button>
        </div>
      {:else}
        <p class="hint">{t('feeds.none')}</p>
      {/each}
      <form
        class="inline"
        onsubmit={(e) => {
          e.preventDefault();
          void addFeed();
        }}
      >
        <input class="input" bind:value={feedUrl} placeholder={t('feeds.urlHint')} spellcheck="false" aria-label={t('feeds.url')} />
        <button class="btn quiet" type="submit" disabled={feedBusy || !feedUrl.trim()}>{feedBusy ? t('feeds.reading') : t('feeds.add')}</button>
      </form>
      {#if feedError}<p class="hint error" transition:fade={{ duration: 150 }}>{feedError}</p>{/if}
    </section>

    <section>
      <h3>{t('settings.general')}</h3>
      <div class="toggles">
        <Toggle checked={app.autostart} label={t(app.mac ? 'settings.autostart.mac' : 'settings.autostart')} onchange={(v) => void app.setAutostart(v)} />
        <Toggle checked={app.data.settings.topmost} label={t('settings.topmost')} onchange={(v) => app.setTopmost(v)} />
        <Toggle checked={app.data.settings.locked} label={t('settings.locked')} onchange={(v) => app.setLocked(v)} />
        {#if app.morph !== null}
          <Toggle checked={app.morph} label={t('settings.morph')} onchange={(v) => app.setMorph(v)} />
        {/if}
      </div>
    </section>

    {#if hidden.length || hiddenEvents.length}
      <section>
        <h3>{t('settings.hidden')}</h3>
        {#each hidden as a (a.id)}
          <div class="feed" out:fade={{ duration: 150 }}>
            <span class="who">
              <span class="name ellipsis">{a.title}</span>
              <span class="sub ellipsis">{a.course}</span>
            </span>
            <button
              class="text-btn"
              onclick={() => {
                a.hidden = false;
                app.persist();
              }}>{t('settings.restore')}</button
            >
          </div>
        {/each}
        {#each hiddenEvents as e (e.key)}
          <div class="feed" out:fade={{ duration: 150 }}>
            <span class="who">
              <span class="name ellipsis">{e.title}</span>
              <span class="sub ellipsis num">{e.sub}</span>
            </span>
            <button
              class="text-btn"
              onclick={() => {
                app.data.hiddenEvents = app.data.hiddenEvents.filter((k) => k !== e.key);
                app.persist();
              }}>{t('settings.restore')}</button
            >
          </div>
        {/each}
      </section>
    {/if}

    <p class="version">{t('settings.version', { v: app.version })}</p>
  </div>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .content {
    flex: 1;
    padding: 0 12px 24px 16px;
  }

  section {
    padding: 8px 0 14px;
  }

  section + section {
    border-top: 1px solid var(--line);
  }

  h3 {
    margin: 6px 6px 10px;
    font-size: 11.5px;
    font-weight: 650;
    color: var(--muted);
  }

  .themes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin: 0 6px 10px;
  }

  .theme {
    display: grid;
    gap: 6px;
    justify-items: center;
    padding: 6px 6px 8px;
    border-radius: 12px;
    transition: background-color var(--t-micro);
  }

  .theme:hover {
    background: var(--control);
  }

  .swatch {
    position: relative;
    width: 100%;
    height: 52px;
    border-radius: 9px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--line);
    transition: box-shadow var(--t-short);
  }

  .theme.on .swatch {
    box-shadow: 0 0 0 2px var(--accent);
  }

  .swatch span {
    position: absolute;
    left: 10px;
    right: 22px;
    top: 12px;
    height: 7px;
    border-radius: 4px;
    box-shadow: 0 13px 0 -1px currentColor;
    background: currentColor;
    opacity: 0.55;
  }

  [data-theme-preview='aura'] {
    color: #fff;
    background:
      radial-gradient(circle at 30% 30%, rgba(255, 214, 107, 0.9), transparent 45%),
      linear-gradient(150deg, #4cc7f2, #7fb7e8 60%, #b9a6e8);
  }

  /* The Porcelain and Midnight cards' own ink and background. */
  [data-theme-preview='light'] {
    color: #252d29;
    background: #faf9f6;
  }

  [data-theme-preview='dark'] {
    color: #eceef1;
    background: #17191c;
  }

  .theme-name {
    font-size: 12px;
    font-weight: 500;
  }

  .theme.on .theme-name {
    color: var(--accent);
    font-weight: 650;
  }

  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 40px;
    padding: 0 6px;
  }

  .expires {
    width: 200px;
  }

  /* The field sits at the row's right end, so its calendar opens leftward and stays on the card. */
  .expires :global(.popover) {
    left: auto;
    right: 0;
    transform-origin: top right;
  }

  .account,
  .feed {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 6px 8px;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex: none;
    overflow: hidden;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    color: var(--accent-ink);
    background: var(--accent);
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .who {
    display: grid;
    flex: 1;
    min-width: 0;
  }

  .name {
    font-weight: 600;
  }

  .sub {
    font-size: 11.5px;
    color: var(--muted);
  }

  .text-btn {
    flex: none;
    padding: 5px 10px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
  }

  .text-btn:hover {
    background: var(--accent-soft);
  }

  .text-btn.danger {
    color: var(--danger);
    transition: background-color var(--t-short), color var(--t-short);
  }

  .text-btn.danger:hover {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  /* The card's own surface colour reads on the danger fill in every theme; white does not on the
     pale danger of the dark ones. */
  .text-btn.armed,
  .text-btn.armed:hover {
    color: var(--raised);
    background: var(--danger);
  }

  .connect {
    display: grid;
    gap: 8px;
    padding: 0 6px;
  }

  .hint {
    margin: 0;
    padding: 0 6px;
  }

  .connect .hint {
    padding: 0 2px;
  }

  /* Matches as they are typed, each with the address it leads to; the pointer and the arrow keys
     move the same highlight. */
  .schools {
    display: grid;
    gap: 2px;
    padding: 4px;
    border-radius: 12px;
    background: var(--control);
  }

  .school {
    display: grid;
    min-width: 0;
    padding: 6px 10px;
    border-radius: 9px;
    text-align: left;
  }

  .school.active {
    background: var(--control-hover);
  }

  .steps {
    display: grid;
    gap: 8px;
  }

  .guide {
    display: grid;
    gap: 8px;
    padding: 2px 0 4px;
  }

  .replace .guide {
    padding: 4px 6px 0;
  }

  .guide .open {
    justify-self: start;
    height: 32px;
    padding: 0 12px;
    font-size: 12.5px;
  }

  .guide ol,
  .guide dl {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 0 2px;
    list-style: none;
    counter-reset: step;
    font-size: 12.5px;
    line-height: 1.45;
  }

  .guide li {
    display: flex;
    gap: 8px;
    counter-increment: step;
  }

  .guide li::before {
    content: counter(step);
    display: grid;
    flex: none;
    place-items: center;
    width: 17px;
    height: 17px;
    margin-top: 1px;
    border-radius: 50%;
    color: var(--accent);
    background: var(--accent-soft);
    font-size: 10.5px;
    font-weight: 600;
  }

  .guide .hint {
    padding: 0 2px;
  }

  .how {
    display: flex;
    align-items: center;
    gap: 3px;
    margin: -4px 0 4px -4px;
    padding-right: 7px;
  }

  .how :global(.icon) {
    transition: transform var(--t-medium) var(--ease-out);
  }

  .how.open :global(.icon) {
    transform: rotate(180deg);
  }

  .sources {
    padding: 2px 4px 10px;
  }

  /* Each calendar's name beside the way to its link. */
  .sources dl {
    grid-template-columns: auto 1fr;
    gap: 8px 12px;
  }

  .sources dt {
    font-weight: 600;
  }

  .sources dd {
    margin: 0;
  }

  .feed-dot {
    width: 8px;
    height: 8px;
    flex: none;
    margin: 0 4px 0 2px;
    border-radius: 50%;
    background: var(--accent);
  }

  .feed-dot.error {
    background: var(--warm);
  }

  .lead {
    margin: -4px 0 8px;
    line-height: 1.5;
  }

  /* A Canvas feed the Canvas connection now covers: still listed so it can be removed. */
  .covered .name {
    color: var(--muted);
  }

  .covered .feed-dot {
    background: var(--faint);
  }

  .replace {
    padding-bottom: 6px;
  }

  .course {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 3px 6px;
  }

  .course .input {
    flex: 1;
    min-width: 0;
    height: 32px;
    text-overflow: ellipsis;
  }

  /* A hidden course stays in the list, faded, so it can be shown again. */
  .course.off .course-dot,
  .course.off .input {
    opacity: 0.45;
  }

  .course .text-btn {
    min-width: 48px;
  }

  /* A field with its button beside it: a feed link, a replacement token. */
  .inline {
    display: flex;
    gap: 8px;
    padding: 8px 6px 6px;
  }

  .inline .input {
    flex: 1;
    min-width: 0;
  }

  .inline .btn {
    height: 36px;
    padding: 0 12px;
    flex: none;
  }

  .toggles {
    margin: 0 -6px;
  }

  .version {
    margin: 10px 0 0;
    text-align: center;
    font-size: 11.5px;
    color: var(--faint);
  }
</style>
