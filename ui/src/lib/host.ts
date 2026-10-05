// The page's side of host/Bridge.cs. Outside the WebView (plain browser during design work) a mock
// host stands in, so every screen can be built and inspected without the native shell.

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
}

export interface AuraSample {
  average: string;
  darkest: string;
  brightest: string;
}

const webview = (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview;
export const inHost = webview !== undefined;

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

let mock: ((m: string, p: Record<string, unknown>) => Promise<unknown>) | null = null;

export async function call<T = void>(m: string, p: Record<string, unknown> = {}): Promise<T> {
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
