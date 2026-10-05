<script lang="ts">
  import { slide } from 'svelte/transition';
  import { app } from '../lib/state.svelte';
  import { focusSeconds } from '../lib/agenda';
  import { gradeText } from '../lib/canvas';
  import { dueLabel, duration, monthDay, t, weekdayShort } from '../lib/i18n';
  import { hasText } from '../lib/sanitize';
  import { hhmm, parseIso } from '../lib/time';
  import { easeOut, isReduced } from '../lib/motion';
  import CanvasLink from '../components/CanvasLink.svelte';
  import Icon from '../components/Icon.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import RichText from '../components/RichText.svelte';

  let { key }: { key: string } = $props();

  const assignment = $derived(key.startsWith('a:') ? app.data.assignments[key.slice(2)] : null);
  const task = $derived(key.startsWith('t:') ? app.data.tasks[key.slice(2)] : null);
  const title = $derived(assignment?.title ?? task?.title ?? '');
  const done = $derived(assignment?.done ?? task?.done ?? false);
  const due = $derived(parseIso(assignment?.due ?? task?.due));
  const timed = $derived(task ? task.timed : true);
  const focused = $derived(focusSeconds(app.data, key));
  const sessions = $derived(app.data.focus.filter((s) => s.task === key).sort((a, b) => b.start.localeCompare(a.start)));
  let showSessions = $state(false);

  const stamp = (d: Date, withTime = true) => `${monthDay(d)} ${weekdayShort(d)}${withTime ? ` ${hhmm(d)}` : ''}`;

  const dueText = $derived.by(() => {
    if (!due) return t('detail.noDue');
    const rel = dueLabel(due, app.now, timed);
    const abs = stamp(due, timed);
    // Finished work is not overdue, however long ago it was due. The date already gives the time,
    // so "Tomorrow 23:59" beside it says only "Tomorrow".
    const relText = timed && rel.text.endsWith(hhmm(due)) ? dueLabel(due, app.now, false).text : rel.text;
    return done || rel.tone === 'normal' ? abs : `${abs} · ${relText}`;
  });
  const tone = $derived(due && !done ? dueLabel(due, app.now, timed).tone : 'normal');

  const statuses = $derived.by(() => {
    const s = assignment?.submission;
    if (!s) return [];
    const out: { text: string; tone: string }[] = [];
    if (s.excused) out.push({ text: t('status.excused'), tone: 'good' });
    else if (s.state === 'submitted' || s.state === 'pending_review' || s.state === 'graded') out.push({ text: t(`status.${s.state}`), tone: 'good' });
    else if (assignment?.handIn === 'paper' || assignment?.handIn === 'none') out.push({ text: t(`status.${assignment.handIn}`), tone: 'plain' });
    else if (s.missing) out.push({ text: t('status.missing'), tone: 'bad' });
    else out.push({ text: t('status.unsubmitted'), tone: 'plain' });
    if (s.late) out.push({ text: t('status.late'), tone: 'warn' });
    return out;
  });
  const opens = $derived(parseIso(assignment?.opens));
  const closes = $derived(parseIso(assignment?.closes));
  const grade = $derived(assignment ? gradeText(assignment) : null);
  const color = $derived(assignment ? (app.data.canvas.colors[assignment.courseId] ?? null) : null);
  const hasFacts = $derived(statuses.length > 0 || grade !== null || assignment?.points != null || opens !== null || closes !== null);

  function focusHere() {
    app.go('focus');
    app.focusTarget = key;
  }
</script>

{#if assignment || task}
  <div class="detail">
    <PageHeader>
      {#if assignment?.url}
        <CanvasLink url={assignment.url} />
      {/if}
      {#if assignment}
        <button
          class="tool"
          title={t('detail.hide')}
          aria-label={t('detail.hide')}
          onclick={() => {
            app.hideAssignment(assignment!.id);
            app.pop();
          }}><Icon name="hide" size={16} /></button
        >
      {:else if task}
        <button class="tool" title={t('detail.edit')} aria-label={t('detail.edit')} onclick={() => app.push({ kind: 'taskEdit', id: task!.id })}>
          <Icon name="edit" size={16} />
        </button>
        <button
          class="tool"
          title={t('detail.delete')}
          aria-label={t('detail.delete')}
          onclick={() => {
            app.deleteTask(task!.id);
            app.pop();
          }}><Icon name="trash" size={16} /></button
        >
      {/if}
    </PageHeader>

    <div class="content scroll">
      <p class="eyebrow">
        {#if color}<i class="course-dot" style:--course={color}></i>{/if}
        {assignment ? `${assignment.course} · ${t(assignment.quiz ? 'kind.quiz' : 'kind.assignment')}` : t('kind.personal')}
      </p>
      <h2 class:done>{title}</h2>
      <p class="due" data-tone={tone}><Icon name="calendar" size={15} />{dueText}</p>

      <!-- Where the work stands on Canvas comes first; the focus spent on it follows. -->
      {#if assignment && hasFacts}
        <section class="card facts">
          {#if statuses.length}
            <div class="fact">
              <span class="key">{t('detail.status')}</span>
              <span class="value">{#each statuses as s (s.text)}<span class="pill" data-tone={s.tone}>{s.text}</span>{/each}</span>
            </div>
          {/if}
          {#if grade}
            <div class="fact"><span class="key">{t('detail.grade')}</span><span class="value num grade">{grade}</span></div>
          {/if}
          {#if assignment.points != null}
            <div class="fact"><span class="key">{t('detail.pointsLabel')}</span><span class="value num">{t('detail.points', { n: assignment.points })}</span></div>
          {/if}
          {#if opens}
            <div class="fact"><span class="key">{t('detail.opens')}</span><span class="value num">{stamp(opens)}</span></div>
          {/if}
          {#if closes}
            <div class="fact"><span class="key">{t('detail.closes')}</span><span class="value num">{stamp(closes)}</span></div>
          {/if}
        </section>
      {/if}

      <section class="card">
        <div class="focus">
          <span class="focus-sum">
            <span class="label">{t('detail.focused')}</span>
            {#if sessions.length}
              <span class="total num">{duration(focused)}<span class="count">{t(sessions.length === 1 ? 'detail.session' : 'detail.sessions', { n: sessions.length })}</span></span>
            {:else}
              <span class="none">{t('detail.noFocus')}</span>
            {/if}
          </span>
          {#if sessions.length}
            <button class="records" class:open={showSessions} aria-expanded={showSessions} onclick={() => (showSessions = !showSessions)}>
              {t('detail.records')}<Icon name="down" size={14} />
            </button>
          {/if}
        </div>
        {#if showSessions}
          <ul class="sessions" transition:slide={{ duration: isReduced() ? 0 : 260, easing: easeOut }}>
            {#each sessions as s (s.id)}
              {@const start = parseIso(s.start)}
              <li>
                <span class="when num">{start ? stamp(start) : ''}</span>
                {#if !s.completed}<span class="early">{t('detail.endedEarly')}</span>{/if}
                <span class="length num">{duration(s.seconds)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="description">
        <h3>{t(task ? 'task.notes' : 'detail.description')}</h3>
        {#if assignment && hasText(assignment.description)}
          <RichText html={assignment.description ?? ''} />
        {:else if task?.notes}
          <p class="notes">{task.notes}</p>
        {:else}
          <p class="muted">{t('detail.noDescription')}</p>
        {/if}
      </section>
    </div>

    <footer class="actions-bar">
      <button class="btn quiet" onclick={() => app.setDone(key, !done)}>
        <Icon name={done ? 'left' : 'check'} size={16} />
        {t(done ? 'detail.markTodo' : 'detail.markDone')}
      </button>
      {#if !done}
        <button class="btn primary" onclick={focusHere}><Icon name="target" size={16} />{t('detail.focus')}</button>
      {/if}
    </footer>
  </div>
{/if}

<style>
  .detail {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .tool {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--muted);
    transition: background-color var(--t-micro), color var(--t-micro);
  }

  .tool:hover {
    color: var(--ink);
    background: var(--control-hover);
  }

  .content {
    flex: 1;
    padding: 6px 12px 18px 22px;
  }

  .eyebrow {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.2px;
    color: var(--accent);
  }

  h2 {
    margin: 0;
    font-size: 21px;
    line-height: 1.3;
    font-weight: 650;
    letter-spacing: -0.2px;
    user-select: text;
  }

  h2.done {
    color: var(--muted);
  }

  .due {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--muted);
  }

  .due[data-tone='soon'] {
    color: var(--warm);
    font-weight: 600;
  }

  .due[data-tone='overdue'] {
    color: var(--danger);
    font-weight: 600;
  }

  .card {
    margin-top: 14px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--control);
  }

  .card + .card {
    margin-top: 10px;
  }

  .focus {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .focus-sum {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--muted);
  }

  .total {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 19px;
    font-weight: 650;
  }

  .count {
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
  }

  .none {
    font-size: 13px;
    color: var(--muted);
  }

  .records {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    height: 30px;
    padding: 0 8px 0 11px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    background: var(--control-hover);
    transition: background-color var(--t-micro);
  }

  .records:hover {
    background: var(--control-press);
  }

  .records :global(.icon) {
    color: var(--muted);
    transition: transform var(--t-medium) var(--ease-out);
  }

  .records.open :global(.icon) {
    transform: rotate(180deg);
  }

  .sessions {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .sessions li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    font-size: 12.5px;
    border-top: 1px solid var(--line);
  }

  .sessions li:first-child {
    margin-top: 10px;
  }

  .when {
    flex: 1;
    min-width: 0;
  }

  .early {
    font-size: 11.5px;
    color: var(--muted);
  }

  .length {
    min-width: 58px;
    text-align: right;
    font-weight: 600;
  }

  .facts {
    padding-top: 4px;
    padding-bottom: 4px;
  }

  .fact {
    display: grid;
    grid-template-columns: 64px 1fr;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    font-size: 13px;
  }

  .fact + .fact {
    border-top: 1px solid var(--line);
  }

  .key {
    font-size: 12px;
    color: var(--muted);
  }

  .value {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .pill {
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    background: var(--control-hover);
  }

  .pill[data-tone='good'] {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .pill[data-tone='warn'] {
    color: var(--warm);
    background: var(--warm-soft);
  }

  .pill[data-tone='bad'] {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }

  .description {
    margin-top: 20px;
  }

  h3 {
    margin: 0 0 8px;
    font-size: 11.5px;
    font-weight: 650;
    color: var(--muted);
  }

  .description p {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.7;
  }

  .notes {
    white-space: pre-wrap;
    user-select: text;
  }

  .grade {
    font-weight: 650;
  }

  .eyebrow .course-dot {
    margin: -1px 6px 0 0;
  }
</style>
