import { auraLook } from './aura';
import { isCanvasFeed } from './agenda';
import {
  fetchAnnouncements,
  fetchAssignments,
  fetchColors,
  fetchCourses,
  fetchEvents,
  fetchProfile,
  gradeText,
  mergeAssignments,
  rankSchools,
  schoolSearches,
  type School,
} from './canvas';
import { call, on, type AuraSample, type BootInfo, type HttpReply } from './host';
import { duration, setLang, t } from './i18n';
import { parseFeed } from './ics';
import { importLegacy, type LegacyDump } from './legacy';
import { emptyData, MIN_FOCUS_SECONDS, readSaved, type Announcement, type Data, type Lang, type LocalEvent, type Settings, type Task } from './model';
import { addDays, dayKey, parseIso, uid } from './time';

export type Tab = 'today' | 'focus' | 'calendar' | 'tasks';
export const TABS: Tab[] = ['today', 'focus', 'calendar', 'tasks'];
/** Tabs that need the large card; the others fit the compact one. */
export const WIDE_TABS: Tab[] = ['calendar', 'tasks'];

export type Page =
  | { kind: 'task'; key: string }
  | { kind: 'taskEdit'; id: string | null }
  | { kind: 'event'; day: string; id?: string }
  | { kind: 'announcements' }
  | { kind: 'announcement'; id: string }
  | { kind: 'settings' };

export type TaskFilter = 'todo' | 'updated' | 'done';

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export interface Finished {
  seconds: number;
  title: string | null;
  task: string | null;
}

/** Canvas pushes nothing to a widget; a released grade is noticed within this long. */
const SYNC_EVERY = 10 * 60_000;
const FEED_PAST_DAYS = 60;
const FEED_FUTURE_DAYS = 400;
/** How far back the announcement list reaches. */
const ANNOUNCEMENT_DAYS = 14;

class Store {
  data = $state<Data>(emptyData('zh'));
  now = $state(new Date());
  tab = $state<Tab>('today');
  pages = $state<Page[]>([]);
  syncing = $state(false);
  toast = $state<Toast | null>(null);
  aura = $state<AuraSample | null>(null);
  /** Whether Windows blurs behind the widget; Aura stands in for the blur when it does not. */
  glass = $state(true);
  autostart = $state(false);
  /** Liquid Glass behind Aura and as the tab bar's selection, from the Mac host on macOS 26. */
  liquid = $state(false);
  /** Running in the Mac host, which words a few things its own way. */
  mac = $state(false);
  /** Whether the window eases between sizes; null where the host has no switch for it. */
  morph = $state<boolean | null>(null);
  /** The Canvas profile picture (data: URL); Settings shows initials without one. */
  canvasAvatar = $state<string | null>(null);
  visible = $state(true);
  finished = $state<Finished | null>(null);
  /** The last session ended too short to keep. The focus view says so itself: a toast would sit over its buttons. */
  unrecorded = $state(false);
  version = $state('');
  /** Direction of the last tab change, for slide transitions. */
  direction = $state(1);
  /** Day the calendar shows; other views set it when they open the calendar on a date. */
  calendarDay = $state<Date>(new Date());
  /** The task list's filter; a grade notice opens the list on "Updated". */
  tasksFilter = $state<TaskFilter>('todo');
  /** Task the focus view should preselect, set by "Focus on this". */
  focusTarget = $state<string | null>(null);

  private saveTimer = 0;
  private schools = new Map<string, Promise<School[] | null>>();
  private clockTimer = 0;
  private toastTimer = 0;
  private toastSeq = 0;

  // ---- lifecycle ---------------------------------------------------------------------------

  async boot(): Promise<void> {
    const info = await call<BootInfo>('boot');
    this.version = info.version;
    this.autostart = info.autostart;
    this.canvasAvatar = info.canvasAvatar;
    this.glass = info.glass;
    this.liquid = info.liquid ?? false;
    // Auto may follow the system's light or dark appearance.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    this.mac = info.platform === 'macos';
    // Styles that only the Mac's fonts need key off this.
    if (this.mac) document.documentElement.dataset.os = 'mac';
    this.morph = info.morph ?? null;
    const lang: Lang = info.locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    // A save cut short can leave the file unreadable; the one before it then stands in. Only when
    // there was never a file is this a first run.
    const saved = readSaved(info.data, lang) ?? readSaved(info.backup, lang);
    // The Canvas host is whatever the stored token belongs to: no token, no host.
    if (saved || info.data !== null) {
      this.data = saved ?? emptyData(lang);
      this.data.canvas.host = info.canvasHost;
    } else {
      const fresh = emptyData(lang);
      fresh.canvas.host = info.canvasHost;
      // The import copies the old token itself, so it may connect Canvas that the boot info did not see.
      if (info.legacy) {
        const dump = await call<LegacyDump | null>('legacy');
        if (dump) importLegacy(fresh, dump);
      }
      this.data = fresh;
      this.persist();
      // A first run starts with Windows; Settings turns it off for good.
      void this.setAutostart(true);
    }
    setLang(this.data.settings.lang);
    if (info.installed) this.notify(t('app.installed'));

    on('aura', (d) => {
      this.aura = d as AuraSample;
      this.applyTheme();
    });
    on('glass', (d) => {
      this.glass = d as boolean;
      this.applyTheme();
    });
    on('tray', (d) => this.onTray(d as string));
    on('shown', () => this.setVisible(true));
    on('hidden', () => this.setVisible(false));
    on('alarm', () => this.completeTimer());
    on('notice', (d) => this.openNotice(d as string));
    on('wake', () => {
      this.tick();
      void this.sync();
    });

    this.applyTheme();
    if (this.data.settings.topmost) void call('topmost', { on: true });
    this.restoreTimer();
    this.tick();
    this.updateTray();
    setTimeout(() => void this.sync(), 1200);
    setInterval(() => void this.sync(), SYNC_EVERY);
  }

  // Changes made in one go are written once, straight after; a longer wait was a window in which
  // quitting from the tray lost the last change.
  persist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void call('save', { data: JSON.stringify($state.snapshot(this.data)) }));
  }

  /** Minute ticks normally; second ticks while a visible focus timer runs. */
  tick = (): void => {
    this.now = new Date();
    const timer = this.data.timer;
    if (timer?.endsAt && Date.now() >= timer.endsAt) this.completeTimer();
    clearTimeout(this.clockTimer);
    const fast = this.visible && this.data.timer?.endsAt;
    const ms = Date.now();
    this.clockTimer = window.setTimeout(this.tick, fast ? 1000 - (ms % 1000) + 5 : 60_000 - (ms % 60_000) + 20);
  };

  private setVisible(visible: boolean): void {
    this.visible = visible;
    this.tick();
    this.updateTray();
  }

  // ---- navigation --------------------------------------------------------------------------

  go(tab: Tab): void {
    if (tab === this.tab && this.pages.length === 0) return;
    this.direction = TABS.indexOf(tab) >= TABS.indexOf(this.tab) ? 1 : -1;
    this.pages = [];
    this.tab = tab;
    if (tab !== 'focus') {
      this.finished = null;
      this.unrecorded = false;
    }
  }

  /** Settings and the announcements take the whole card; the tab bar steps out of the way for them. */
  get tabBarAway(): boolean {
    const kind = this.pages.at(-1)?.kind;
    return kind === 'settings' || kind === 'announcements' || kind === 'announcement';
  }

  push(page: Page): void {
    this.pages = [...this.pages, page];
  }

  pop(): void {
    this.pages = this.pages.slice(0, -1);
  }

  openTask(key: string): void {
    const a = key.startsWith('a:') ? this.data.assignments[key.slice(2)] : null;
    if (a?.updated) {
      a.updated = false;
      this.persist();
    }
    this.push({ kind: 'task', key });
  }

  notify(text: string, action?: Toast['action']): void {
    clearTimeout(this.toastTimer);
    this.toast = { id: ++this.toastSeq, text, action };
    this.toastTimer = window.setTimeout(() => (this.toast = null), action ? 5000 : 3200);
  }

  // ---- appearance --------------------------------------------------------------------------

  applyTheme(): void {
    const { aura, mode } = this.data.settings;
    const root = document.documentElement;
    // Auto takes the wallpaper's side behind Aura where the host samples it, else the system's.
    const dark =
      mode === 'auto'
        ? aura && !this.mac
          ? auraLook(this.aura).ink === 'light'
          : matchMedia('(prefers-color-scheme: dark)').matches
        : mode === 'dark';
    root.dataset.theme = aura ? 'aura' : dark ? 'dark' : 'light';
    const liquid = aura && this.liquid;
    root.dataset.liquid = liquid ? 'on' : 'off';
    if (liquid) {
      root.dataset.ink = dark ? 'light' : 'dark';
      root.dataset.glass = 'on';
      // Clear glass shows the desktop as the system's look leaves it: a chosen look against the
      // system's shades it toward itself, so the ink stays readable; one that matches looks as auto does.
      const shade = this.data.settings.clearGlass && dark !== matchMedia('(prefers-color-scheme: dark)').matches;
      root.style.setProperty('--scrim', shade ? (dark ? 'rgba(20, 20, 24, 0.45)' : 'rgba(250, 250, 252, 0.55)') : 'transparent');
      root.style.setProperty('--sheen', 'none');
    } else if (aura) {
      const look = auraLook(this.aura, dark ? 'light' : 'dark');
      root.style.removeProperty('--sheen');
      root.dataset.ink = look.ink;
      root.dataset.glass = this.glass ? 'on' : 'off';
      root.style.setProperty('--scrim', look.scrim);
      root.style.setProperty('--aura-fill', look.fill);
    } else {
      root.style.removeProperty('--sheen');
      delete root.dataset.ink;
    }
    void call('material', { aura, dark, auto: mode === 'auto', clear: this.data.settings.clearGlass });
  }

  setAppearance(change: Partial<Pick<Settings, 'aura' | 'clearGlass' | 'mode'>>): void {
    Object.assign(this.data.settings, change);
    this.applyTheme();
    this.persist();
  }

  setLanguage(lang: Lang): void {
    this.data.settings.lang = lang;
    setLang(lang);
    this.persist();
    this.updateTray();
  }

  setTopmost(on: boolean): void {
    this.data.settings.topmost = on;
    void call('topmost', { on });
    this.persist();
  }

  setLocked(on: boolean): void {
    this.data.settings.locked = on;
    this.persist();
  }

  setMorph(on: boolean): void {
    this.morph = on;
    void call('morph.set', { on });
  }

  async setAutostart(on: boolean): Promise<void> {
    this.autostart = await call<boolean>('autostart', { on });
  }

  updateTray(): void {
    void call('tray', {
      labels: {
        toggle: t(this.visible ? 'tray.hide' : 'tray.show'),
        settings: t('tray.settings'),
        quit: t('tray.quit'),
      },
    });
  }

  private onTray(action: string): void {
    if (action === 'settings' && this.pages.at(-1)?.kind !== 'settings') this.push({ kind: 'settings' });
  }

  /** A click on a Windows notification opens what it was about. */
  private openNotice(tag: string): void {
    const at = tag.indexOf(':');
    const kind = at < 0 ? tag : tag.slice(0, at);
    const id = tag.slice(at + 1);
    if (kind === 'task' || kind === 'updated') {
      this.tasksFilter = 'updated';
      this.go('tasks');
      if (kind === 'task') this.openTask(id);
    } else if (kind === 'announcement') {
      this.pages = [{ kind: 'announcement', id }];
    } else if (kind === 'announcements') {
      this.pages = [{ kind: 'announcements' }];
    } else {
      this.go(kind === 'focus' ? 'focus' : 'today');
    }
  }

  // ---- tasks -------------------------------------------------------------------------------

  setDone(key: string, done: boolean): void {
    const find = () => (key.startsWith('a:') ? this.data.assignments[key.slice(2)] : this.data.tasks[key.slice(2)]);
    const item = find();
    if (!item) return;
    // Undo puts back exactly what was there, so an assignment that was never the user's call stays
    // Canvas's to complete. It looks the item up again: a sync may have replaced it meanwhile.
    const before = 'doneBy' in item ? { done: item.done, doneAt: item.doneAt, doneBy: item.doneBy } : { done: item.done, doneAt: item.doneAt };
    Object.assign(item, { done, doneAt: done ? new Date().toISOString() : null }, 'doneBy' in item ? { doneBy: 'user' } : {});
    this.persist();
    if (done)
      this.notify(t('tasks.completed', { t: item.title }), {
        label: t('undo'),
        run: () => {
          const now = find();
          if (now) Object.assign(now, before);
          this.persist();
        },
      });
  }

  hideAssignment(id: string): void {
    const a = this.data.assignments[id];
    if (!a) return;
    a.hidden = true;
    this.persist();
    this.notify(t('detail.hidden', { t: a.title }), {
      label: t('undo'),
      run: () => {
        a.hidden = false;
        this.persist();
      },
    });
  }

  saveTask(task: Omit<Task, 'id' | 'created' | 'done' | 'doneAt'> & { id: string | null }): void {
    if (task.id && this.data.tasks[task.id]) {
      Object.assign(this.data.tasks[task.id], { title: task.title, due: task.due, timed: task.timed, notes: task.notes });
    } else {
      const id = uid();
      this.data.tasks[id] = { ...task, id, created: new Date().toISOString(), done: false, doneAt: null };
    }
    this.persist();
  }

  deleteTask(id: string): void {
    const task = this.data.tasks[id];
    if (!task) return;
    delete this.data.tasks[id];
    this.persist();
    this.notify(t('tasks.deleted'), {
      label: t('undo'),
      run: () => {
        this.data.tasks[id] = task;
        this.persist();
      },
    });
  }

  /** Names a course here, or with an empty name gives it back its Canvas name; everything it owns follows at once. */
  renameCourse(id: string, name: string): void {
    const chosen = name.trim();
    if (chosen) this.data.settings.courseNames[id] = chosen;
    else delete this.data.settings.courseNames[id];
    const shown = chosen || this.data.canvas.courses[id];
    for (const a of Object.values(this.data.assignments)) if (a.courseId === id) a.course = shown;
    for (const a of this.data.announcements) if (a.courseId === id) a.course = shown;
    for (const e of this.data.canvasEvents) if (e.courseId === id) e.course = shown;
    this.persist();
  }

  titleOf(key: string | null): string | null {
    if (!key) return null;
    return key.startsWith('a:') ? (this.data.assignments[key.slice(2)]?.title ?? null) : (this.data.tasks[key.slice(2)]?.title ?? null);
  }

  // ---- events ------------------------------------------------------------------------------

  saveEvent(event: Omit<LocalEvent, 'id'> & { id: string | null }): void {
    const id = event.id ?? uid();
    this.data.events[id] = { ...event, id };
    this.persist();
  }

  removeOccurrence(key: string): void {
    if (key.startsWith('e:')) {
      const id = key.slice(2);
      const event = this.data.events[id];
      delete this.data.events[id];
      this.notify(t('cal.deleted'), {
        label: t('undo'),
        run: () => {
          this.data.events[id] = event;
          this.persist();
        },
      });
    } else if (key.startsWith('f:') || key.startsWith('c:')) {
      this.data.hiddenEvents.push(key);
      this.notify(t('cal.hidden'), {
        label: t('undo'),
        run: () => {
          this.data.hiddenEvents = this.data.hiddenEvents.filter((k) => k !== key);
          this.persist();
        },
      });
    }
    this.persist();
  }

  // ---- focus timer -------------------------------------------------------------------------

  startTimer(seconds: number, task: string | null): void {
    this.finished = null;
    this.unrecorded = false;
    this.data.timer = { task, duration: seconds, endsAt: Date.now() + seconds * 1000, remaining: seconds, startedAt: new Date().toISOString() };
    this.armAlarm();
    this.persist();
    this.tick();
  }

  pauseTimer(): void {
    const timer = this.data.timer;
    if (!timer?.endsAt) return;
    timer.remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
    timer.endsAt = null;
    void call('alarm', { at: null });
    this.persist();
    this.tick();
  }

  resumeTimer(): void {
    const timer = this.data.timer;
    if (!timer || timer.endsAt !== null) return;
    timer.endsAt = Date.now() + timer.remaining * 1000;
    this.armAlarm();
    this.persist();
    this.tick();
  }

  /** After a restart a running timer keeps its end; a paused one stays paused. */
  private restoreTimer(): void {
    const timer = this.data.timer;
    if (!timer?.endsAt) return;
    if (Date.now() >= timer.endsAt) this.completeTimer();
    else this.armAlarm();
  }

  endTimer(): void {
    const timer = this.data.timer;
    if (!timer) return;
    const left = timer.endsAt ? Math.max(0, (timer.endsAt - Date.now()) / 1000) : timer.remaining;
    this.unrecorded = !this.record(timer.task, timer.startedAt, Math.round(timer.duration - left), false);
    this.data.timer = null;
    void call('alarm', { at: null });
    this.persist();
    this.tick();
  }

  completeTimer(): void {
    const timer = this.data.timer;
    if (!timer?.endsAt) return;
    const kept = this.record(timer.task, timer.startedAt, timer.duration, true);
    this.finished = { seconds: timer.duration, title: this.titleOf(timer.task), task: timer.task };
    this.unrecorded = !kept;
    this.data.timer = null;
    this.persist();
    this.tick();
    // The focus view shows the end itself; anywhere else a toast says it.
    if (this.tab !== 'focus' || this.pages.length > 0) this.notify(`${t('focus.notify')} · ${kept ? duration(timer.duration) : t('focus.notRecorded')}`);
  }

  private armAlarm(): void {
    const timer = this.data.timer;
    if (!timer?.endsAt) return;
    void call('alarm', { at: timer.endsAt, title: t('focus.notify'), body: this.titleOf(timer.task) ?? duration(timer.duration) });
  }

  /** Keeps a session as a focus record unless it was too short to count; says which. */
  private record(task: string | null, start: string, seconds: number, completed: boolean): boolean {
    if (seconds < MIN_FOCUS_SECONDS) return false;
    this.data.focus.push({ id: uid(), task, title: this.titleOf(task), start, seconds, completed });
    return true;
  }

  // ---- sync --------------------------------------------------------------------------------

  async sync(manual = false): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const feeds = this.data.feeds.filter((f) => !isCanvasFeed(this.data, f));
      // Anything else that stops a pass (a login portal's page where JSON should be, a host error)
      // counts as not getting through, so the header says so instead of the last good time.
      await Promise.all([
        this.syncCanvas().catch(() => void (this.data.canvas.error = 'network')),
        ...feeds.map((f) => this.syncFeed(f.id).catch(() => void (f.error = 'network'))),
      ]);
    } finally {
      this.syncing = false;
      this.persist();
    }
    const error = this.syncError;
    if (manual && error) this.notify(t(error === 'token' ? 'sync.token' : error === 'partial' ? 'sync.partial' : 'sync.network'));
  }

  // Assignments decide whether the pass worked; the calendar, announcements, colours and picture
  // each keep their last good copy when their own request fails.
  private async syncCanvas(): Promise<void> {
    if (!this.data.canvas.host) return;
    const api = { get: (path: string) => call<HttpReply>('canvas.get', { path }) };
    const [list, profile] = await Promise.all([fetchCourses(api), fetchProfile(api)]);
    if (typeof list === 'string') {
      this.data.canvas.error = list;
      return;
    }
    // Canvas's names are kept for Settings to show; the work goes by any name the student gave a course here.
    this.data.canvas.courses = Object.fromEntries(list.map((c) => [c.id, c.code]));
    const courses = list.map((c) => ({ ...c, code: this.data.settings.courseNames[c.id] || c.code }));
    const now = new Date();
    const [pass, events, announcements, colors, avatar, token] = await Promise.all([
      fetchAssignments(api, courses),
      profile ? fetchEvents(api, courses, profile.id, addDays(now, -FEED_PAST_DAYS), addDays(now, FEED_FUTURE_DAYS)) : null,
      fetchAnnouncements(api, courses, addDays(now, -ANNOUNCEMENT_DAYS)),
      fetchColors(api),
      // A picture the host will not fetch (one kept on another domain, say) leaves the last one.
      profile ? call<string | null>('canvas.avatar', { url: profile.avatar }).catch(() => undefined) : undefined,
      call<HttpReply>('canvas.token'),
    ]);
    // The expiry chosen in Canvas when the token was made. Where Canvas will not say, the date the user
    // typed stands, unless Canvas still takes the token after it: then the date was wrong.
    if (token.status === 200 && token.body) {
      const { expires_at } = JSON.parse(token.body) as { expires_at: string | null };
      Object.assign(this.data.canvas, { tokenExpires: expires_at ? dayKey(new Date(expires_at)) : null, tokenExpiresFromCanvas: true });
    } else if (this.data.canvas.tokenExpires && this.data.canvas.tokenExpires < dayKey(now)) this.data.canvas.tokenExpires = null;
    const graded = mergeAssignments(this.data, pass.items, pass.complete, now);
    if (events) this.data.canvasEvents = events;
    let news: Announcement[] = [];
    if (announcements) {
      // What was opened here stays read; Canvas only knows what was read on its own site.
      const before = new Map(this.data.announcements.map((a) => [a.id, a]));
      for (const a of announcements) a.read ||= before.get(a.id)?.read ?? false;
      const seen = this.data.canvas.announcementsSeen;
      if (seen) news = announcements.filter((a) => !before.has(a.id) && !a.read && after(a.postedAt, seen));
      this.data.announcements = announcements;
      // The first pass only marks where "new" starts; what was already there is not news.
      this.data.canvas.announcementsSeen ??= now.toISOString();
    }
    if (colors) this.data.canvas.colors = colors;
    if (avatar !== undefined) this.canvasAvatar = avatar;
    this.data.canvas.lastSync = now.toISOString();
    this.data.canvas.error = pass.complete ? null : 'partial';
    // A hidden assignment, or any work of a hidden course, says nothing when it changes.
    const heard = graded.filter((id) => !this.data.assignments[id].hidden && this.courseShown(this.data.assignments[id].courseId));
    this.announceGrades(heard);
    this.tellWindows(heard, news.filter((a) => this.courseShown(a.courseId)));
  }

  /**
   * One Windows notification per pass for released grades and new announcements, for when the
   * widget is not what the user is looking at. A click opens what it names (openNotice).
   */
  private tellWindows(graded: string[], news: Announcement[]): void {
    if (!this.data.settings.notifications || document.hasFocus() || graded.length + news.length === 0) return;
    const grades = graded.map((id) => this.data.assignments[id]);
    let title: string;
    let body: string;
    let tag: string;
    if (grades.length === 1 && news.length === 0) {
      const a = grades[0];
      title = t('notice.graded', { t: a.title });
      body = [a.course, gradeText(a)].filter(Boolean).join(' · ');
      tag = `task:a:${a.id}`;
    } else if (news.length === 1 && grades.length === 0) {
      title = t('notice.newOne', { c: news[0].course });
      body = news[0].title;
      tag = `announcement:${news[0].id}`;
    } else {
      const lines = [
        ...grades.map((a) => [a.title, gradeText(a)].filter(Boolean).join(' · ')),
        ...news.map((a) => `${a.course}: ${a.title}`),
      ];
      title = news.length === 0 ? t('notice.gradedMany', { n: grades.length }) : grades.length === 0 ? t('news.new', { n: news.length }) : t('notice.mixed', { n: lines.length });
      body = lines.slice(0, 3).join('\n') + (lines.length > 3 ? '\n…' : '');
      tag = news.length === 0 ? 'updated' : grades.length === 0 ? 'announcements' : 'today';
    }
    void call('notify', { title, body, tag });
  }

  private announceGrades(ids: string[]): void {
    if (ids.length === 1) {
      const a = this.data.assignments[ids[0]];
      this.notify(t('grade.posted', { t: a.title, g: gradeText(a) ?? '' }), { label: t('grade.view'), run: () => this.openTask(`a:${a.id}`) });
    } else if (ids.length > 1) {
      this.notify(t('grade.postedMany', { n: ids.length }), {
        label: t('grade.view'),
        run: () => {
          this.tasksFilter = 'updated';
          this.go('tasks');
        },
      });
    }
  }

  /** New until it is opened, here or on Canvas; like unread mail, looking at the list is not reading. */
  isNew(a: Announcement): boolean {
    const since = this.data.canvas.announcementsSeen;
    return !a.read && since !== null && after(a.postedAt, since);
  }

  /**
   * The overview's count: unread news posted since the list was last looked at. Opening the list
   * acknowledges it, as a badge goes; the list keeps marking what has not been opened.
   */
  get newAnnouncements(): number {
    const viewed = this.data.canvas.announcementsViewed;
    return this.shownAnnouncements.filter((a) => this.isNew(a) && (viewed === null || after(a.postedAt, viewed))).length;
  }

  /** Announcements outside the courses the student has hidden. */
  get shownAnnouncements(): Announcement[] {
    return this.data.announcements.filter((a) => this.courseShown(a.courseId));
  }

  courseShown(id: string): boolean {
    return !this.data.settings.hiddenCourses.includes(id);
  }

  /** Hides a course everywhere, or shows it again; it keeps syncing either way, so nothing is lost. */
  toggleCourse(id: string): void {
    const hidden = this.data.settings.hiddenCourses;
    this.data.settings.hiddenCourses = hidden.includes(id) ? hidden.filter((c) => c !== id) : [...hidden, id];
    this.persist();
  }

  viewAnnouncements(): void {
    this.data.canvas.announcementsViewed = new Date().toISOString();
    this.persist();
  }

  markRead(announcements: Announcement[]): void {
    for (const a of announcements) a.read = true;
    this.persist();
  }

  private async syncFeed(id: string): Promise<void> {
    const reply = await call<HttpReply>('feed.get', { id });
    const feed = this.data.feeds.find((f) => f.id === id);
    if (!feed) return;
    if (reply.status !== 200 || !reply.body) {
      feed.error = reply.status === 401 || reply.status === 403 ? 'token' : 'network';
      return;
    }
    this.storeFeed(id, reply.body);
    feed.lastSync = new Date().toISOString();
    feed.error = null;
  }

  private storeFeed(id: string, body: string): string | null {
    const now = new Date();
    const parsed = parseFeed(body, addDays(now, -FEED_PAST_DAYS), addDays(now, FEED_FUTURE_DAYS), this.data.canvas.host !== null);
    this.data.feedEvents[id] = parsed.events;
    return parsed.name;
  }

  get lastSync(): string | null {
    const stamps = [this.data.canvas.lastSync, ...this.data.feeds.map((f) => f.lastSync)].filter((s): s is string => !!s);
    return stamps.sort().at(-1) ?? null;
  }

  get syncError(): string | null {
    return this.data.canvas.error ?? this.data.feeds.find((f) => f.error && !isCanvasFeed(this.data, f))?.error ?? null;
  }

  // ---- connections -------------------------------------------------------------------------

  async connectCanvas(input: string, token: string): Promise<'ok' | 'badHost' | 'rejected' | 'offline'> {
    const host = normalizeHost(input);
    if (!host) return 'badHost';
    const reply = await call<HttpReply>('canvas.connect', { host, token });
    if (reply.status === -3) return 'badHost';
    if (reply.status === 401 || reply.status === 403) return 'rejected';
    if (reply.status !== 200 || !reply.body) return 'offline';
    const user = JSON.parse(reply.body) as { name?: string };
    // The same Canvas with a new token keeps what was synced from it; the sync that follows reads the new token's expiry.
    if (this.data.canvas.host && this.data.canvas.host !== host) this.forgetCanvas();
    Object.assign(this.data.canvas, { host, user: user.name ?? null, error: null, tokenExpires: null, tokenExpiresFromCanvas: false });
    this.persist();
    void this.sync();
    return 'ok';
  }

  /** Schools in Instructure's directory matching what has been typed so far; null when it cannot be reached. */
  async findSchools(query: string): Promise<School[] | null> {
    const answers = await Promise.all(
      schoolSearches(query).map((name) => {
        let answer = this.schools.get(name);
        if (!answer) {
          answer = call<HttpReply>('canvas.schools', { name })
            .then((r) => {
              if (r.status !== 200 || !r.body) throw new Error(`status ${r.status}`);
              return JSON.parse(r.body) as School[];
            })
            // A failed lookup is asked again with the next keystroke rather than remembered.
            .catch(() => {
              this.schools.delete(name);
              return null;
            });
          this.schools.set(name, answer);
        }
        return answer;
      }),
    );
    return answers.includes(null) ? null : rankSchools(query, answers.flat() as School[]);
  }

  async disconnectCanvas(): Promise<void> {
    await call('canvas.disconnect');
    this.canvasAvatar = null;
    Object.assign(this.data.canvas, { host: null, user: null, lastSync: null, error: null, tokenExpires: null, tokenExpiresFromCanvas: false });
    this.forgetCanvas();
    this.persist();
  }

  /** Everything that belonged to one Canvas account. */
  private forgetCanvas(): void {
    this.data.assignments = {};
    this.data.canvasEvents = [];
    this.data.announcements = [];
    Object.assign(this.data.canvas, { colors: {}, courses: {}, announcementsSeen: null, announcementsViewed: null });
  }

  async addFeed(url: string): Promise<'ok' | 'https' | 'long' | 'bad' | 'offline'> {
    const reply = await call<HttpReply & { id?: string; host?: string }>('feed.add', { url });
    if (reply.status === -4) return 'https';
    if (reply.status === -6) return 'long';
    if (reply.status === -3) return 'bad';
    if (!reply.id || !reply.body) return reply.status === 200 ? 'bad' : 'offline';
    this.data.feeds.push({ id: reply.id, name: reply.host ?? 'Calendar', host: reply.host ?? '', lastSync: new Date().toISOString(), error: null });
    const name = this.storeFeed(reply.id, reply.body);
    if (name) this.data.feeds[this.data.feeds.length - 1].name = name;
    this.persist();
    return 'ok';
  }

  async removeFeed(id: string): Promise<void> {
    await call('feed.remove', { id });
    this.data.feeds = this.data.feeds.filter((f) => f.id !== id);
    delete this.data.feedEvents[id];
    this.data.hiddenEvents = this.data.hiddenEvents.filter((k) => !k.startsWith(`f:${id}:`));
    this.persist();
  }
}

/** Compares instants, not text: Canvas writes "…:00Z" where this app writes "…:00.000Z". */
const after = (a: string, b: string) => (parseIso(a)?.getTime() ?? 0) > (parseIso(b)?.getTime() ?? 0);

/** Accepts "canvas.x.edu", "https://canvas.x.edu/courses/1" and the like. */
export function normalizeHost(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.includes('.') ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export const app = new Store();
