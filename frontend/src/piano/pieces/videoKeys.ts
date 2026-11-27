import type { Hand, PieceNote } from '@piano/shared';
import { isBlack } from '@piano/shared';

// Notes of a video where the keys of a drawn keyboard light up (falling notes).
// The keyboard is found by the pattern of its black keys, twos and threes, then
// each key is watched for colour. No AI: the same pixels give the same notes.

export interface Picture {
  width: number;
  height: number;
  data: ArrayLike<number>; // RGBA
}

export interface WatchedKey {
  midi: number;
  // Where to look: on the key, and just above it (notes about to touch it).
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  above: number; // y
}

export interface FoundKeyboard {
  keys: WatchedKey[];
  // All 88 keys are there: the octave is certain.
  whole: boolean;
}

// Place of the black keys in an octave, in white keys from C.
const BLACKS = [1, 2, 4, 5, 6];
const BLACK_PITCH = [1, 3, 6, 8, 10];
const WHITE_PITCH = [0, 2, 4, 5, 7, 9, 11];
const MIN_BLACKS = 7;

interface Row {
  centers: number[];
  // Of the first black key, in BLACKS.
  rotation: number;
  width: number; // of a black key
}

const luminance = (p: Picture, x: number, y: number) => {
  const i = (y * p.width + x) * 4;
  return 0.3 * p.data[i] + 0.59 * p.data[i + 1] + 0.11 * p.data[i + 2];
};

export function findKeyboard(p: Picture): FoundKeyboard | null {
  // Consecutive rows showing the same black keys.
  let best: { y0: number; y1: number; row: Row } | null = null;
  let current: { y0: number; y1: number; row: Row } | null = null;
  for (let y = Math.floor(p.height * 0.1); y < p.height; y++) {
    const row = blackRow(p, y);
    if (row && current && row.rotation === current.row.rotation && row.centers.length === current.row.centers.length
      && Math.abs(row.centers[0] - current.row.centers[0]) < row.width * 0.5) current.y1 = y;
    else if (row) current = { y0: y, y1: y, row };
    else if (current && y - current.y1 > 2) current = null;
    if (current && (!best || current.y1 - current.y0 > best.y1 - best.y0)) best = { ...current };
  }
  if (!best || best.y1 - best.y0 < Math.max(6, p.height * 0.01)) return null;
  return keyboardOf(p, best.y0, best.y1, best.row);
}

function blackRow(p: Picture, y: number): Row | null {
  const line = new Float64Array(p.width);
  for (let x = 0; x < p.width; x++) line[x] = luminance(p, x, y);
  const sorted = [...line].sort((a, b) => a - b);
  const dark = sorted[Math.floor(p.width * 0.08)];
  const light = sorted[Math.floor(p.width * 0.85)];
  if (light - dark < 60) return null;
  const limit = (dark + light) / 2;
  const runs: { x0: number; x1: number }[] = [];
  for (let x = 0; x < p.width;) {
    if (line[x] >= limit) { x++; continue; }
    let end = x;
    while (end < p.width && line[end] < limit) end++;
    // Cut by the edge of the picture: not a whole key.
    if (x > 0 && end < p.width) runs.push({ x0: x, x1: end });
    x = end;
  }
  if (runs.length < MIN_BLACKS) return null;
  const widths = runs.map((r) => r.x1 - r.x0).sort((a, b) => a - b);
  const usual = widths[widths.length >> 1];
  if (usual < 2) return null;
  // The longest stretch of keys of about the same width.
  let own: typeof runs = [];
  let stretch: typeof runs = [];
  for (const r of runs) {
    const w = r.x1 - r.x0;
    // The thin lines between two white keys do not count.
    if (w <= usual * 0.5) continue;
    if (w < usual * 1.7) stretch.push(r);
    else stretch = [];
    if (stretch.length > own.length) own = [...stretch];
  }
  if (own.length < MIN_BLACKS) return null;
  const centers = own.map((r) => (r.x0 + r.x1) / 2);
  const rotation = pattern(centers);
  return rotation === null ? null : { centers, rotation, width: usual };
}

// Which black key comes first, for the gaps between them to make sense.
function pattern(centers: number[]): number | null {
  const gaps = centers.slice(1).map((c, i) => c - centers[i]);
  const total = gaps.reduce((a, g) => a + g, 0);
  const errors = BLACKS.map((_, rotation) => {
    const expected = gaps.map((_g, i) => units(rotation + i + 1) - units(rotation + i));
    const unit = total / expected.reduce((a, e) => a + e, 0);
    return gaps.reduce((sum, g, i) => sum + Math.abs(g / unit - expected[i]), 0) / gaps.length;
  });
  const order = [0, 1, 2, 3, 4].sort((a, b) => errors[a] - errors[b]);
  return errors[order[0]] < 0.22 && errors[order[1]] > errors[order[0]] * 1.6 ? order[0] : null;
}

// The n-th black key counted from the first C#, in white keys.
const units = (n: number) => Math.floor(n / 5) * 7 + BLACKS[n % 5];
const blackMidi = (n: number) => Math.floor(n / 5) * 12 + BLACK_PITCH[n % 5];

function keyboardOf(p: Picture, y0: number, y1: number, row: Row): FoundKeyboard {
  const blacks = row.centers.map((x, i) => ({ x, n: row.rotation + i }));
  // Straight line from white keys to pixels.
  const mean = (f: (b: (typeof blacks)[number]) => number) => blacks.reduce((s, b) => s + f(b), 0) / blacks.length;
  const mu = mean((b) => units(b.n));
  const mx = mean((b) => b.x);
  const unit = blacks.reduce((s, b) => s + (units(b.n) - mu) * (b.x - mx), 0) / blacks.reduce((s, b) => s + (units(b.n) - mu) ** 2, 0);
  const at = (u: number) => mx + (u - mu) * unit;

  const whole = blacks.length === 36 && row.rotation === 4;
  // Pitch of the first C: exact on a whole keyboard, else the middle of the
  // keyboard is near middle C.
  const middle = blackMidi(blacks[blacks.length >> 1].n);
  const base = whole ? 22 - blackMidi(blacks[0].n) : Math.round((60 - middle) / 12) * 12;

  const tall = y1 - y0;
  const bottom = Math.min(p.height - 1, y1 + Math.max(3, tall * 0.4));
  const keys: WatchedKey[] = [];
  const above = Math.max(0, y0 - Math.max(3, Math.round(tall * 0.08)));
  for (const b of blacks) {
    keys.push({ midi: base + blackMidi(b.n), x0: b.x - row.width * 0.25, x1: b.x + row.width * 0.25, y0: y0 + tall * 0.5, y1: y0 + tall * 0.9, above });
  }
  // Up to two white keys beyond the last black ones: what is further is not the keyboard.
  for (let u = units(blacks[0].n) - 2; u < units(blacks[blacks.length - 1].n) + 2; u++) {
    const [left, right] = [at(u), at(u + 1)];
    const seen = Math.min(p.width, right) - Math.max(0, left);
    if (seen < unit * 0.6) continue;
    const midi = base + Math.floor(u / 7) * 12 + WHITE_PITCH[((u % 7) + 7) % 7];
    if (midi < 21 || midi > 108) continue;
    keys.push({ midi, x0: Math.max(0, left + unit * 0.3), x1: Math.min(p.width, right - unit * 0.3), y0: Math.min(p.height - 2, y1 + Math.max(2, tall * 0.12)), y1: bottom, above });
  }
  return { keys: keys.filter((k) => k.midi >= 21 && k.midi <= 108).sort((a, b) => a.midi - b.midi), whole };
}

// --- Watching -------------------------------------------------------------------------

// Mean colour of each key, then of the strip above it: 6 numbers per key.
export function sample(p: Picture, keyboard: FoundKeyboard): Float32Array {
  const out = new Float32Array(keyboard.keys.length * 6);
  keyboard.keys.forEach((k, i) => {
    mean(p, k.x0, k.y0, k.x1, k.y1, out, i * 6);
    mean(p, k.x0, k.above - 2, k.x1, k.above, out, i * 6 + 3);
  });
  return out;
}

function mean(p: Picture, x0: number, y0: number, x1: number, y1: number, out: Float32Array, at: number) {
  let count = 0;
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(p.height - 1, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(p.width - 1, Math.ceil(x1)); x++) {
      const i = (y * p.width + x) * 4;
      out[at] += p.data[i];
      out[at + 1] += p.data[i + 1];
      out[at + 2] += p.data[i + 2];
      count++;
    }
  }
  if (count) for (let c = 0; c < 3; c++) out[at + c] /= count;
}

const ON = 42;
const OFF = 26;
const MIN_FRAMES = 2;
// Hands over the keys light up neighbours together.
const CLUMPED = 0.3;

export class NoLitKeys extends Error {}

export function notesOf(samples: Float32Array[], keyboard: FoundKeyboard, frameRate: number): PieceNote[] {
  const onKeys = watch(samples, keyboard, frameRate, 0);
  const above = onKeys.length >= 5 ? onKeys : watch(samples, keyboard, frameRate, 3);
  const found = above.length > onKeys.length ? above : onKeys;
  if (found.length < 3) throw new NoLitKeys('Le clavier est visible, mais aucune touche ne s’allume');
  if (clumped(found)) throw new NoLitKeys('Des mains cachent le clavier : les touches jouées ne se voient pas');
  return hands(found);
}

type Seen = PieceNote & { hue: number };

function watch(samples: Float32Array[], keyboard: FoundKeyboard, frameRate: number, offset: number): Seen[] {
  const out: Seen[] = [];
  keyboard.keys.forEach((key, k) => {
    const at = k * 6 + offset;
    const rest = [0, 1, 2].map((c) => median(samples.map((s) => s[at + c])));
    // How far from its usual colour; more colour counts, shadows do not.
    const far = samples.map((s) => {
      const [r, g, b] = [s[at], s[at + 1], s[at + 2]];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const usual = Math.max(...rest) - Math.min(...rest);
      const brighter = isBlack(key.midi) ? (r + g + b) / 3 - (rest[0] + rest[1] + rest[2]) / 3 - 25 : 0;
      return Math.max(chroma - usual, brighter);
    });
    let start = -1;
    for (let i = 0; i <= far.length; i++) {
      const lit = i < far.length && far[i] > (start < 0 ? ON : OFF);
      if (lit && start < 0) start = i;
      else if (!lit && start >= 0) {
        if (i - start >= MIN_FRAMES) {
          const middle = samples[Math.min(samples.length - 1, (start + i) >> 1)];
          out.push({
            midi: key.midi, time: start / frameRate, duration: (i - start) / frameRate, velocity: 0.75, hand: null,
            hue: hueOf(middle[at], middle[at + 1], middle[at + 2]),
          });
        }
        start = -1;
      }
    }
  });
  out.sort((a, b) => a.time - b.time || a.midi - b.midi);
  if (offset === 0) return out;
  // Above the keys, a white key's note is wider than the gap between black keys.
  const step = 1.5 / frameRate;
  return out.filter((n) => !isBlack(n.midi) || !out.some((o) => !isBlack(o.midi) && Math.abs(o.midi - n.midi) === 1
    && Math.abs(o.time - n.time) < step && Math.abs(o.time + o.duration - n.time - n.duration) < step));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d < 1) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// Many notes with both neighbours on at the same time.
function clumped(notes: Seen[]): boolean {
  const starts = new Set<string>();
  for (const n of notes) for (let t = Math.floor(n.time * 4); t <= Math.floor((n.time + n.duration) * 4); t++) starts.add(`${n.midi}@${t}`);
  const inside = notes.filter((n) => {
    const t = Math.floor(n.time * 4);
    return starts.has(`${n.midi - 1}@${t}`) && starts.has(`${n.midi + 1}@${t}`);
  });
  return inside.length > notes.length * CLUMPED;
}

const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// Two colours: one for each hand, the lower one on the left.
function hands(notes: Seen[]): PieceNote[] {
  const plain = (n: Seen, hand: Hand | null): PieceNote => ({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity, hand });
  let [a, b] = [notes[0].hue, notes.reduce((far, n) => (apart(n.hue, notes[0].hue) > apart(far, notes[0].hue) ? n.hue : far), notes[0].hue)];
  let groups: [Seen[], Seen[]] = [[], []];
  for (let i = 0; i < 6; i++) {
    groups = [[], []];
    for (const n of notes) groups[apart(n.hue, a) <= apart(n.hue, b) ? 0 : 1].push(n);
    if (!groups[0].length || !groups[1].length) break;
    [a, b] = groups.map((g) => circularMean(g.map((n) => n.hue))) as [number, number];
  }
  const enough = groups.every((g) => g.length >= notes.length * 0.08);
  if (!enough || apart(a, b) < 35) return notes.map((n) => plain(n, null));
  const pitch = groups.map((g) => g.reduce((s, n) => s + n.midi, 0) / g.length);
  const left = new Set(groups[pitch[0] < pitch[1] ? 0 : 1]);
  return notes.map((n) => plain(n, left.has(n) ? 'left' : 'right'));
}

function circularMean(hues: number[]): number {
  let x = 0;
  let y = 0;
  for (const h of hues) {
    x += Math.cos((h * Math.PI) / 180);
    y += Math.sin((h * Math.PI) / 180);
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Each pixel's usual colour over several pictures: the keyboard without what moves.
export function usualPicture(pictures: Picture[]): Picture {
  const { width, height } = pictures[0];
  const data = new Uint8ClampedArray(width * height * 4);
  const values = new Array<number>(pictures.length);
  for (let i = 0; i < data.length; i++) {
    for (let k = 0; k < pictures.length; k++) values[k] = pictures[k].data[i];
    values.sort((a, b) => a - b);
    data[i] = values[values.length >> 1];
  }
  return { width, height, data };
}
