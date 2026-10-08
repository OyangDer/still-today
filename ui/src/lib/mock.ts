import './mock.css';
import { reply } from './demo';

// Browser stand-in for the native host, used only while designing in a normal browser. It draws a
// desktop behind a 380px frame and clips the frame the way the real window does.

type Emit = (event: string, data: unknown) => void;

export function createMock(emit: Emit) {
  document.documentElement.classList.add('mock');
  const params = new URLSearchParams(location.search);
  const dark = params.has('night');
  document.documentElement.classList.toggle('mock-night', dark);

  return async (m: string, p: Record<string, unknown>): Promise<unknown> => {
    switch (m) {
      case 'boot':
        return {
          version: 'dev',
          locale: params.get('lang') ?? 'zh-CN',
          data: params.has('fresh') ? null : localStorage.getItem('st-data'),
          backup: null,
          legacy: false,
          autostart: false,
          canvasHost: params.has('nocanvas') ? null : 'canvas.example.edu',
          canvasAvatar: null,
          glass: !params.has('noglass'),
        };
      case 'save':
        localStorage.setItem('st-data', p.data as string);
        return;
      case 'ready':
      case 'morph': {
        const frame = document.documentElement;
        frame.style.setProperty('--mock-ms', `${(p.ms as number) ?? 0}ms`);
        frame.style.setProperty('--mock-delay', `${Math.max(0, ((p.start as number) ?? 0) - Date.now())}ms`);
        frame.style.setProperty('--mock-w', `${p.width}px`);
        frame.style.setProperty('--mock-h', `${p.height}px`);
        if (m === 'ready')
          setTimeout(() => emit('aura', dark
            ? { average: '#1c2430', darkest: '#05070a', brightest: '#8aa4c0' }
            : { average: '#56c4ee', darkest: '#1f7fb0', brightest: '#ffffff' }), 50);
        return;
      }
      case 'autostart':
        return p.on;
      default:
        return (await reply(m, p, params)) ?? null;
    }
  };
}
