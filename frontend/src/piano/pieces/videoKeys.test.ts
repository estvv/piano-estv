import { isBlack } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { findKeyboard, NoLitKeys, notesOf, sample, usualPicture, type Picture } from './videoKeys';

type Color = [number, number, number];
const BLUE: Color = [60, 140, 240];
const GREEN: Color = [90, 220, 90];
interface Played { midi: number; from: number; to: number; color: Color }
interface Look { from: number; to: number; width: number; height: number; top: number; blackTall: number; noise: number; light: 'keys' | 'above' }
const LOOK: Look = { from: 21, to: 108, width: 640, height: 360, top: 250, blackTall: 60, noise: 6, light: 'keys' };

// One picture of the video, drawn key by key.
function draw(look: Look, played: Played[], t: number): Picture {
  const { width, height } = look;
  const data = new Uint8ClampedArray(width * height * 4);
  const rect = (x0: number, y0: number, x1: number, y1: number, c: Color) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(height, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(width, Math.round(x1)); x++) {
        const i = (y * width + x) * 4;
        for (let k = 0; k < 3; k++) data[i + k] = c[k] + look.noise * Math.sin(x * 12.9 + y * 78.2 + t * 37 + k);
        data[i + 3] = 255;
      }
    }
  };
  rect(0, 0, width, height, [20, 20, 28]);
  const whites: number[] = [];
  for (let m = look.from; m <= look.to; m++) if (!isBlack(m)) whites.push(m);
  const unit = width / whites.length;
  const box = (m: number): [number, number] => {
    if (!isBlack(m)) return [whites.indexOf(m) * unit, (whites.indexOf(m) + 1) * unit];
    const edge = (whites.indexOf(m - 1) + 1) * unit;
    return [edge - unit * 0.3, edge + unit * 0.3];
  };
  const on = new Map(played.filter((p) => t >= p.from && t < p.to).map((p) => [p.midi, p.color]));
  if (look.light === 'above') for (const [m, c] of on) { const [a, b] = box(m); rect(a + 1, 100, b - 1, look.top, c); }
  for (const m of whites) {
    const [a, b] = box(m);
    rect(a, look.top, b, height, [240, 240, 240]);
    rect(b - 1, look.top, b, height, [90, 90, 90]);
    const c = look.light === 'keys' ? on.get(m) : undefined;
    if (c) rect(a, look.top, b - 1, height, c);
  }
  for (let m = look.from; m <= look.to; m++) {
    if (!isBlack(m)) continue;
    const [a, b] = box(m);
    rect(a, look.top, b, look.top + look.blackTall, (look.light === 'keys' && on.get(m)) || [25, 25, 25]);
  }
  return { width, height, data };
}

const FPS = 20;
function read(look: Look, played: Played[], seconds: number) {
  const pictures = Array.from({ length: Math.round(seconds * FPS) }, (_, i) => draw(look, played, i / FPS));
  const keyboard = findKeyboard(usualPicture(pictures.filter((_, i) => i % Math.ceil(pictures.length / 15) === 0)));
  if (!keyboard) return null;
  return { keyboard, notes: notesOf(pictures.map((p) => sample(p, keyboard)), keyboard, FPS) };
}
const tune: Played[] = [
  [60, 0.5, 1], [64, 1, 1.5], [67, 1.5, 2], [70, 2, 2.4], [70, 2.5, 3], [73, 3, 3.5], [43, 0.5, 2], [46, 2, 3.5],
].map(([midi, from, to]) => ({ midi, from, to, color: midi >= 60 ? BLUE : GREEN }));
const text = (notes: { midi: number; time: number; hand: string | null }[]) => notes.map((n) => `${n.midi}${n.hand?.[0] ?? '?'}@${+n.time.toFixed(2)}`).join(' ');
const EXPECTED = '43l@0.5 60r@0.5 64r@1 67r@1.5 46l@2 70r@2 70r@2.5 73r@3';

describe('videos of falling notes', () => {
  it('reads a whole keyboard: pitches, times, hands by colour', () => {
    const r = read(LOOK, tune, 4)!;
    expect(r.keyboard.whole).toBe(true);
    expect(r.keyboard.keys).toHaveLength(88);
    expect(text(r.notes)).toBe(EXPECTED);
    expect(r.notes[0].duration).toBeCloseTo(1.5, 1);
  });

  it('reads a few octaves, upright like a phone', () => {
    const r = read({ ...LOOK, from: 36, to: 83, width: 400, height: 500, top: 330, blackTall: 70 }, tune, 4)!;
    expect(r.keyboard.whole).toBe(false);
    expect(text(r.notes)).toBe(EXPECTED);
  });

  it('starts anywhere in the octave', () => {
    // F to E: the middle of the keyboard says the octave.
    const r = read({ ...LOOK, from: 41, to: 76, width: 420 }, tune, 4)!;
    expect(text(r.notes)).toBe(EXPECTED);
  });

  it('reads keys that do not light up from the notes touching them', () => {
    expect(text(read({ ...LOOK, light: 'above' }, tune, 4)!.notes)).toBe(EXPECTED);
  });

  it('leaves hands unknown when there is one colour', () => {
    const r = read(LOOK, tune.map((p) => ({ ...p, color: BLUE })), 4)!;
    expect(new Set(r.notes.map((n) => n.hand))).toEqual(new Set([null]));
  });

  it('finds no keyboard where there is none', () => {
    const { width, height } = LOOK;
    const picture = (f: (x: number, y: number) => number): Picture => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i++) data[i] = f((i >> 2) % width, Math.floor((i >> 2) / width));
      return { width, height, data };
    };
    expect(findKeyboard(picture((x, y) => (Math.sin(x * 0.7 + y) + 1) * 120))).toBeNull();
    // Evenly spaced bars are no keyboard.
    expect(findKeyboard(picture((x) => (x % 20 < 8 ? 10 : 240)))).toBeNull();
    expect(findKeyboard(picture(() => 128))).toBeNull();
  });

  it('gives up when nothing lights up, or when hands cover the keys', () => {
    expect(() => read(LOOK, [], 2)).toThrow(NoLitKeys);
    const hand: Played[] = [];
    for (let k = 0; k < 8; k++) for (let m = 55; m < 68; m++) hand.push({ midi: m + (k % 3), from: 0.5 + k * 0.5, to: 0.8 + k * 0.5, color: [225, 170, 140] });
    expect(() => read(LOOK, hand, 5)).toThrow('mains');
  });
});
