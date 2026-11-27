import type { Hand } from '@piano/shared';
import { mix } from '../../lib/appearance';

// A colour and what is made of it, kept: they are asked for at every picture.
export interface Tone {
  main: string;
  // Towards white, nearly white, towards black.
  light: string;
  hot: string;
  dark: string;
  // A little darker: the sides of a satin note.
  shade: string;
  // "r, g, b", for the see-through ones.
  rgb: string;
}

const tones = new Map<string, Tone>();
export function tone(main: string): Tone {
  let t = tones.get(main);
  if (!t) {
    t = {
      main,
      light: mix(main, '#ffffff', 0.6),
      hot: mix(main, '#ffffff', 0.18),
      dark: mix(main, '#000000', 0.4),
      shade: mix(main, '#000000', 0.22),
      rgb: [1, 3, 5].map((i) => parseInt(main.slice(i, i + 2), 16)).join(', '),
    };
    // Colours being picked go through many.
    if (tones.size > 600) tones.clear();
    tones.set(main, t);
  }
  return t;
}
export const alpha = (t: Tone, a: number) => `rgba(${t.rgb}, ${a})`;

export function hex(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

// Far from the keyboard, then on it: notes warm up as they come.
type Pair = readonly [far: string, near: string];

export function pairOf(hand: Hand | null, midi: number, hands: Record<Hand, string>): Pair {
  const own = hands[hand ?? (midi >= 60 ? 'right' : 'left')];
  return [own, mix(own, '#ffffff', 0.82)];
}

// By steps: a few colours, kept, rather than one for each pixel of the way.
const STEPS = 10;
const between = new Map<string, string>();
// `near`: 0 far away, 1 on the keyboard.
export function warm([far, close]: Pair, near: number): string {
  const step = Math.round(Math.max(0, Math.min(1, near)) ** 1.4 * STEPS);
  const key = far + close + step;
  let c = between.get(key);
  if (!c) {
    c = mix(close, far, step / STEPS);
    if (between.size > 600) between.clear();
    between.set(key, c);
  }
  return c;
}
