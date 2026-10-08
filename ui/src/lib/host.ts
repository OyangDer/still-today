// The page's side of host/Bridge.cs, and of mac/src/main.rs under Tauri. Outside either host (plain
// browser during design work) a mock host stands in, so every screen can be built and inspected
// without the native shell.

type Listener = (data: unknown) => void;

interface WebView {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
}

export interface HttpReply {
  status: number;
  body: string | null;
  next: string | null;
}

export interface BootInfo {
  version: string;
  locale: string;
  data: string | null;
  /** The save before the latest, kept beside it in case the latest was cut short. */
  backup: string | null;
  legacy: boolean;
  autostart: boolean;
  canvasHost: string | null;
  /** The cached Canvas profile picture, as a data: URL. */
  canvasAvatar: string | null;
  /** Whether Windows blurs behind the widget; energy saver and the Transparency switch stop it. */
  glass: boolean;
  /** Whether the Mac draws Liquid Glass (macOS 26 and later) behind Aura and under the tab bar's selection. */
  liquid?: boolean;
  /** The OS as Rust names it ("macos", "windows"); only the Tauri host sends it. */
  platform?: string;
  /** Whether this start is the Mac copy that has just moved itself into Applications. */
  installed?: boolean;
  /** The Mac started with STILL_TODAY_DEMO=1: Canvas and calendar feeds answer with sample data. */
  demo?: boolean;
  /** Whether the window eases between sizes; only the Tauri host offers the switch. */
  morph?: boolean;
}

export interface AuraSample {
  average: string;
  darkest: string;
  brightest: string;
}

// Tauri's global API (withGlobalTauri): the Mac host answers one command and speaks on one event.
interface Tauri {
  core: { invoke(cmd: string, args: Record<string, unknown>): Promise<unknown> };
  event: { listen(name: string, fn: (e: { payload: unknown }) => void): Promise<unknown> };
}

const webview = (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview;
const tauri = (window as unknown as { __TAURI__?: Tauri }).__TAURI__;
export const inHost = webview !== undefined || tauri !== undefined;

const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const listeners = new Map<string, Set<Listener>>();
let sequence = 0;

function dispatch(message: { id?: number; ok?: boolean; r?: unknown; e?: string; ev?: string; d?: unknown }) {
  if (message.id !== undefined) {
    const p = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) p?.resolve(message.r);
    else p?.reject(new Error(message.e ?? 'host error'));
  } else if (message.ev) {
    for (const fn of listeners.get(message.ev) ?? []) fn(message.d);
  }
}

webview?.addEventListener('message', (e) => dispatch(e.data as Parameters<typeof dispatch>[0]));
void tauri?.event.listen('host', (e) => dispatch(e.payload as Parameters<typeof dispatch>[0]));
// WKWebView has its own context menu (Reload among it), which the WebView2 host turns off natively.
if (tauri) addEventListener('contextmenu', (e) => e.preventDefault());
// WKWebView can still select text styled unselectable (Look Up on a force click, for one), so only text
// meant to be copied may begin a selection, and one that lands anywhere else is let go.
if (tauri) {
  const fixed = (node: Node | null) => {
    const el = node instanceof Element ? node : node?.parentElement;
    return !el || getComputedStyle(el).getPropertyValue('-webkit-user-select') === 'none';
  };
  addEventListener('selectstart', (e) => {
    if (fixed(e.target as Node)) e.preventDefault();
  });
  document.addEventListener('selectionchange', () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || document.activeElement?.matches('input, textarea')) return;
    if (fixed(selection.anchorNode)) selection.removeAllRanges();
  });
}

let mock: ((m: string, p: Record<string, unknown>) => Promise<unknown>) | null = null;
let demo: ((m: string, p: Record<string, unknown>) => Promise<unknown>) | null = null;

export async function call<T = void>(m: string, p: Record<string, unknown> = {}): Promise<T> {
  if (tauri) {
    const sample = await demo?.(m, p);
    if (sample !== undefined) return sample as T;
    // Errors arrive as the bare code string, the same `e` the WebView2 host sends.
    const reply = await tauri.core.invoke('bridge', { m, p }).catch((e: unknown) => {
      throw new Error(String(e));
    });
    if (m === 'boot' && (reply as BootInfo).demo) demo = (await import('./demo')).reply;
    return reply as T;
  }
  if (!webview) {
    if (!import.meta.env.DEV) throw new Error('Still Today runs inside its host');
    mock ??= (await import('./mock')).createMock((ev, d) => dispatch({ ev, d }));
    return (await mock(m, p)) as T;
  }
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    webview.postMessage({ id, m, p });
  });
}

export function on(event: string, fn: Listener): () => void {
  const set = listeners.get(event) ?? new Set();
  set.add(fn);
  listeners.set(event, set);
  return () => set.delete(fn);
}
