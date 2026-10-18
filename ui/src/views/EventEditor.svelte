<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { shortDate, t } from '../lib/i18n';
  import { atMinutes, dayKey, daysBetween, fromDayKey, parseIso, startOfDay } from '../lib/time';
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
  // An event past midnight keeps the days it spans: the fields set its start day and the hours, and
  // the end lands that many days on. Read as one day, 22:00–01:00 saved untouched came back 22:00–23:00.
  const endDays = from && to ? Math.max(0, daysBetween(from, to)) : 0;
  // A new event starts at the next whole hour when it is for today, otherwise at 09:00.
  const nextHour = app.now.getHours() + 1;
  const isToday = initialDay === dayKey(app.now);
  const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

  let title = $state(existing?.title ?? '');
  // An event opens on its own start day, though one over several days is listed on each of them.
  let date = $state<Date | null>(from ? startOfDay(from) : fromDayKey(initialDay));
  let allDay = $state(existing?.allDay ?? false);
  let start = $state(from ? minutes(from) : (isToday && nextHour < 23 ? nextHour : 9) * 60);
  let end = $state(to ? minutes(to) : (isToday && nextHour < 23 ? nextHour + 1 : 10) * 60);
  let location = $state(existing?.location ?? '');
  let error = $state('');

  $effect(() => {
    // Moving the start keeps the length the user set; a start past the end drags the end along.
    // An end on a later day is after any start.
    if (endDays === 0 && end <= start) end = Math.min(start + 60, 1439);
  });

  // The page takes clicks and keys while it slides away, so a double click or a held Enter reached
  // Save again and made a second event: it saves once.
  let saved = false;

  function save() {
    if (saved) return;
    if (!title.trim()) {
      error = t('event.required');
      return;
    }
    if (!date) return;
    if (!allDay && endDays === 0 && end <= start) {
      error = t('event.order');
      return;
    }
    saved = true;
    if (allDay) {
      app.saveEvent({ id, title: title.trim(), start: dayKey(date), end: null, allDay: true, location: location.trim() });
    } else {
      app.saveEvent({
        id,
        title: title.trim(),
        start: atMinutes(date, start).toISOString(),
        end: atMinutes(date, end, endDays).toISOString(),
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
      {#if endDays > 0 && !allDay && date}<span class="hint">{t('event.ends', { d: shortDate(atMinutes(date, 0, endDays)) })}</span>{/if}
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
