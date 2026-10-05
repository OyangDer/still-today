<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { t } from '../lib/i18n';
  import { dayKey, fromDayKey, parseIso } from '../lib/time';
  import { fade } from '../lib/motion';
  import DateField from '../components/DateField.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import TimeField from '../components/TimeField.svelte';
  import Toggle from '../components/Toggle.svelte';

  let { day, id }: { day: string; id: string | null } = $props();

  // The page is created per request, so what it opened on is only a starting value. Edits start
  // from a copy; nothing reaches the store until Save.
  const initialDay = untrack(() => day);
  const existing = untrack(() => (id ? $state.snapshot(app.data.events[id]) : null));
  const from = existing && !existing.allDay ? parseIso(existing.start) : null;
  const to = existing && !existing.allDay ? parseIso(existing.end) : null;
  // A new event starts at the next whole hour when it is for today, otherwise at 09:00.
  const nextHour = app.now.getHours() + 1;
  const isToday = initialDay === dayKey(app.now);
  const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

  let title = $state(existing?.title ?? '');
  let date = $state<Date | null>(fromDayKey(initialDay));
  let allDay = $state(existing?.allDay ?? false);
  let start = $state(from ? minutes(from) : (isToday && nextHour < 23 ? nextHour : 9) * 60);
  let end = $state(to ? minutes(to) : (isToday && nextHour < 23 ? nextHour + 1 : 10) * 60);
  let location = $state(existing?.location ?? '');
  let error = $state('');

  $effect(() => {
    // Moving the start keeps the length the user set; a start past the end drags the end along.
    if (end <= start) end = Math.min(start + 60, 1439);
  });

  function at(d: Date, minutes: number): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60);
  }

  function save() {
    if (!title.trim()) {
      error = t('event.required');
      return;
    }
    if (!date) return;
    if (allDay) {
      app.saveEvent({ id, title: title.trim(), start: dayKey(date), end: null, allDay: true, location: location.trim() });
    } else {
      if (end <= start) {
        error = t('event.order');
        return;
      }
      app.saveEvent({
        id,
        title: title.trim(),
        start: at(date, start).toISOString(),
        end: at(date, end).toISOString(),
        allDay: false,
        location: location.trim(),
      });
    }
    app.calendarDay = date;
    app.pop();
  }

  // Enter saves, except while an IME is composing: there it confirms the candidate.
  function enter(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.isComposing) save();
  }

  function autofocus(node: HTMLInputElement) {
    if (!existing) setTimeout(() => node.focus(), 120);
  }
</script>

<div class="page">
  <PageHeader title={t(existing ? 'event.edit' : 'event.new')} />
  <!-- Not a form: every button in a form submits it unless told otherwise, so picking a date saved. -->
  <div class="form">
    <label class="field">
      <span class="field-label">{t('event.title')}</span>
      <input class="input big" bind:value={title} placeholder={t('event.placeholder')} use:autofocus oninput={() => (error = '')} onkeydown={enter} />
      {#if error}<span class="hint error" transition:fade={{ duration: 150 }}>{error}</span>{/if}
    </label>

    <div class="field">
      <span class="field-label">{t('event.date')}</span>
      <DateField bind:value={date} />
    </div>

    <div class="field">
      <span class="field-label">{t('event.time')}</span>
      <div class="times">
        <TimeField bind:value={start} disabled={allDay} />
        <span class="dash">–</span>
        <TimeField bind:value={end} disabled={allDay} />
      </div>
      <div class="toggle-wrap"><Toggle bind:checked={allDay} label={t('event.allDay')} /></div>
    </div>

    <label class="field">
      <span class="field-label">{t('event.location')}</span>
      <input class="input" bind:value={location} placeholder={t('event.optional')} onkeydown={enter} />
    </label>
  </div>
  <div class="spacer"></div>
  <div class="actions-bar">
    <button class="btn quiet" onclick={() => app.pop()}>{t('cancel')}</button>
    <button class="btn primary" onclick={save}>{t(existing ? 'save' : 'event.save')}</button>
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .spacer {
    flex: 1;
  }

  .times {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .times > :global(*:not(.dash)) {
    flex: 1;
  }

  .dash {
    color: var(--muted);
  }

  .toggle-wrap {
    margin: 0 -12px;
  }
</style>
