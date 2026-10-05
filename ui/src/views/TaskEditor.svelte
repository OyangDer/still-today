<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { t } from '../lib/i18n';
  import { parseIso } from '../lib/time';
  import { fade } from '../lib/motion';
  import DateField from '../components/DateField.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import TimeField from '../components/TimeField.svelte';
  import Toggle from '../components/Toggle.svelte';

  let { id }: { id: string | null } = $props();

  // Edits start from a copy; nothing reaches the store until Save.
  const existing = untrack(() => (id ? $state.snapshot(app.data.tasks[id]) : null));
  const due = parseIso(existing?.due);

  let title = $state(existing?.title ?? '');
  let date = $state<Date | null>(due);
  let timed = $state(existing?.timed ?? false);
  let time = $state(due && existing?.timed ? due.getHours() * 60 + due.getMinutes() : 23 * 60 + 59);
  let notes = $state(existing?.notes ?? '');
  let error = $state('');

  function save() {
    if (!title.trim()) {
      error = t('event.required');
      return;
    }
    const at = date ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), timed ? Math.floor(time / 60) : 0, timed ? time % 60 : 0) : null;
    app.saveTask({ id, title: title.trim(), due: at?.toISOString() ?? null, timed: date !== null && timed, notes: notes.trim() });
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
  <PageHeader title={t(existing ? 'task.edit' : 'task.new')} />
  <!-- Not a form: every button in a form submits it unless told otherwise, so picking a date saved. -->
  <div class="form">
    <label class="field">
      <span class="field-label">{t('task.title')}</span>
      <input class="input big" bind:value={title} placeholder={t('task.placeholder')} use:autofocus oninput={() => (error = '')} onkeydown={enter} />
      {#if error}<span class="hint error" transition:fade={{ duration: 150 }}>{error}</span>{/if}
    </label>

    <div class="field">
      <span class="field-label">{t('task.due')}</span>
      <DateField bind:value={date} placeholder={t('task.noDate')} clearable />
      {#if date}
        <div class="time-row" transition:fade={{ duration: 160 }}>
          <div class="toggle-wrap"><Toggle bind:checked={timed} label={t('task.time')} /></div>
          <TimeField bind:value={time} disabled={!timed} />
        </div>
      {/if}
    </div>

    <label class="field">
      <span class="field-label">{t('task.notes')}</span>
      <textarea class="input" bind:value={notes}></textarea>
    </label>
  </div>
  <div class="spacer"></div>
  <div class="actions-bar">
    <button class="btn quiet" onclick={() => app.pop()}>{t('cancel')}</button>
    <button class="btn primary" onclick={save}>{t(existing ? 'save' : 'task.create')}</button>
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

  .time-row {
    display: grid;
    grid-template-columns: 1fr 120px;
    align-items: center;
    gap: 8px;
  }

  .toggle-wrap {
    margin-left: -12px;
  }
</style>
