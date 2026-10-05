import type { AuraSample } from './host';

// Aura picks its ink from the wallpaper under the widget. DWM only blurs; the page lays one scrim
// over the blur. The average decides light or dark ink; the least favourable blurred pixel (darkest
// for dark ink, brightest for light ink) decides how much scrim keeps ink and muted text at 4.5:1.

type Rgb = [number, number, number];

export interface AuraLook {
  ink: 'dark' | 'light';
  /** CSS colour laid over DWM's blur. */
  scrim: string;
  /**
   * What stands in for the blur when Windows stops blurring: the blurred wallpaper's own colours,
   * lighter above and deeper below, as the glass would show them.
   */
  fill: string;
}

const hex = (value: string): Rgb => {
  const v = value.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb;
};

const over = (top: Rgb, alpha: number, bottom: Rgb): Rgb => top.map((c, i) => c * alpha + bottom[i] * (1 - alpha)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const WHITE: Rgb = [255, 255, 255];

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v)).join(', ')})`;

// `floor` is the least scrim each mode shows, so the card still reads as frosted glass over a
// plain wallpaper where contrast alone would ask for none.
const FROST = { scrim: [245, 249, 252] as Rgb, floor: 0.34, ink: [22, 35, 43] as Rgb, muted: [58, 73, 82] as Rgb };
const SMOKE = { scrim: [16, 24, 32] as Rgb, floor: 0.3, ink: [241, 246, 248] as Rgb, muted: [201, 208, 212] as Rgb };

export function auraLook(sample: AuraSample | null): AuraLook {
  const average = hex(sample?.average ?? '#5a6a78');
  const darkInk = luminance(over(WHITE, 0x30 / 255, average)) >= 0.2;
  const mode = darkInk ? FROST : SMOKE;
  const worst = hex(darkInk ? (sample?.darkest ?? '#000000') : (sample?.brightest ?? '#ffffff'));
  let alpha = mode.floor;
  for (; alpha < 0.85; alpha += 0.01) {
    const surface = over(mode.scrim, alpha, worst);
    if (contrast(mode.ink, surface) >= 4.5 && contrast(mode.muted, surface) >= 4.5) break;
  }
  // A little headroom so a moving window never lands right on the threshold.
  alpha = Math.min(0.88, alpha + 0.03);
  const [r, g, b] = mode.scrim;
  const light = over(hex(sample?.brightest ?? '#ffffff'), 0.35, average);
  const deep = over(hex(sample?.darkest ?? '#000000'), 0.35, average);
  return {
    ink: darkInk ? 'dark' : 'light',
    scrim: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`,
    fill: `linear-gradient(160deg, ${css(light)}, ${css(average)} 55%, ${css(deep)})`,
  };
}
