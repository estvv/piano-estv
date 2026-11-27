import type { PieceNote } from '@piano/shared';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { RecentreButton } from './useFollow';
import { look, shadesOf, type Shades, type Theme } from '../../lib/appearance';
import { keyLayout } from '../keyGeometry';
import { Scene, type SeenNote } from '../stage/scene';
import { stage } from '../stage/settings';

// Notes falling towards the keyboard below: a note reaches the bottom edge
// when it must be played. Drawn on a canvas every animation frame, the classic way
// here, the others by their style (stage/).

const LOOKAHEAD = 3; // seconds visible above the keyboard, at normal tempo
// Pale while they come, strong while they sound; a little darker on black keys.
// These: of no known hand.
const NONE: Record<Theme, Shades> = { light: shadesOf('#8b5cf6', 'light'), dark: shadesOf('#a78bfa', 'dark') };
// White keys' notes leave room to the black keys' ones.
const WHITE_INSET = 0.16;
const FONT = (size: number) => `700 ${size}px "Plus Jakarta Sans", sans-serif`;

// What is played: a PiecePlayer, or what looks like one.
export interface NoteSource {
  readonly position: number;
  readonly rate: number;
  readonly notes: PieceNote[];
  readonly state: { get(): { expected: { midi: number }[]; playing: boolean } };
}

// Draws the notes of a moment on a canvas: on the screen, or in a video.
// Pixels between a note and the same key played again.
const REPEAT_GAP = 5;
// When each note's key is played next (seconds), for each list of notes.
const nextTimes = new WeakMap<readonly PieceNote[], Map<PieceNote, number>>();
export function nextOf(notes: readonly PieceNote[]): Map<PieceNote, number> {
  let out = nextTimes.get(notes);
  if (!out) {
    out = new Map();
    const last = new Map<number, number>();
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const t = last.get(n.midi);
      if (t !== undefined && t > n.time) out.set(n, t);
      last.set(n.midi, n.time);
    }
    nextTimes.set(notes, out);
  }
  return out;
}

export class NotesPainter {
  private scene = new Scene();
  private before: { at: number; position: number } | null = null;
  readonly layout: ReturnType<typeof keyLayout>;

  constructor(from: number, to: number) {
    this.layout = keyLayout(from, to);
  }

  // `at`: milliseconds, as performance.now(); `calm`: no sparks; `view`: the
  // moment seen at the keyboard, when it is not the one played.
  paint(ctx: CanvasRenderingContext2D, w: number, h: number, player: NoteSource, extra: { numbers?: ReadonlyMap<PieceNote, number>; parts?: { start: number; label: string }[]; calm?: boolean; keys?: CanvasRenderingContext2D | null; keysSize?: [number, number]; view?: number | null }, at: number) {
    const { layout } = this;
    // What is seen, and what is played.
    const seen = extra.view ?? player.position;
    const now = player.position;
    const before = this.before ?? { at, position: seen };
    // Where a note is drawn, in pixels; null when out of view.
    const place = (n: PieceNote) => {
      const keyBox = layout.get(n.midi);
      const pos = seen;
      const span = LOOKAHEAD * player.rate;
      if (!keyBox || n.time > pos + span || n.time + n.duration < pos) return null;
      const pps = h / span;
      const bottom = h - (n.time - pos) * pps;
      // Played again soon: a gap is seen between them, as in the editor.
      const again = nextOf(player.notes).get(n);
      const top = Math.min(bottom - Math.min(4, n.duration * pps), Math.max(bottom - n.duration * pps, again === undefined ? -Infinity : h - (again - pos) * pps + REPEAT_GAP));
      // Thin keys (a whole keyboard on a phone) keep almost all their width.
      const gap = keyBox.black ? Math.min(1, keyBox.width * w * 0.1) : keyBox.width * w * WHITE_INSET;
      const x = keyBox.x * w + gap;
      const width = Math.max(3, keyBox.width * w - 2 * gap);
      const y = Math.max(-4, top);
      return { x, y, width, height: Math.max(4, Math.min(h, bottom) - y), top, bottom };
    };
    const chosen = stage.get();
    const classic = chosen.style === 'classic';

    const colors = look.get();
    const line = (share: number) => (colors.theme === 'dark' ? `rgba(255,255,255,${share * 1.5})` : `rgba(0,0,0,${share})`);

    const pos = seen;
    const span = LOOKAHEAD * player.rate;
    const expected = new Set(player.state.get().expected.map((n) => n.midi));

    if (!classic) {
      const notes: SeenNote[] = [];
      for (const n of player.notes) {
        if (n.time > pos + span) break;
        const r = place(n);
        if (!r) continue;
        notes.push({
          id: n, midi: n.midi, hand: n.hand,
          box: { x: r.x, y: Math.min(r.top, r.bottom - 6), w: r.width, h: Math.max(6, r.bottom - r.top) },
          active: n.time <= now + 0.001 && n.time + n.duration > now && (expected.size === 0 || expected.has(n.midi)),
        });
      }
      const settings = extra.calm ? { ...chosen, effects: 'off' as const } : chosen;
      this.scene.draw(ctx, {
        w, h, layout, notes,
        moving: player.state.get().playing && pos > before.position,
        hands: { left: colors.left.strong, right: colors.right.strong },
      }, settings, (at - before.at) / 1000);
      if (extra.keys && extra.keysSize && chosen.keys !== 'off') this.scene.drawKeys(extra.keys, extra.keysSize[0], extra.keysSize[1], layout, chosen.keys === 'solid', chosen.keyColor);
    }
    this.before = { at, position: pos };

    // Where a part begins.
    const { numbers: numbered, parts: cuts } = extra;
    ctx.textBaseline = 'middle';
    for (const cut of cuts ?? []) {
      if (cut.start <= pos || cut.start > pos + span) continue;
      const y = h - (cut.start - pos) * (h / span);
      ctx.fillStyle = line(0.12);
      ctx.fillRect(0, y, w, 1);
      ctx.fillStyle = line(0.4);
      ctx.font = FONT(12);
      ctx.textAlign = 'left';
      ctx.fillText(cut.label, 2, y - 9);
    }
    const labels: { text: string; x: number; y: number; size: number; color: string }[] = [];

    for (const n of player.notes) {
      if (n.time > pos + span) break;
      const r = place(n);
      if (!r) continue;
      const color = n.hand ? colors[n.hand] : NONE[colors.theme];
      const active = n.time <= now + 0.001 && n.time + n.duration > now && (expected.size === 0 || expected.has(n.midi));
      const number = numbered?.get(n);
      const size = Math.round(Math.min(17, Math.max(10, r.width * 0.5)));
      // Tall enough for its number.
      if (number !== undefined && r.height < size + 6) {
        r.y -= size + 6 - r.height;
        r.height = size + 6;
      }
      if (classic) {
        ctx.fillStyle = active ? color.strong : layout.get(n.midi)!.black ? color.deep : color.pale;
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.width, r.height, Math.min(6, r.width / 3));
        ctx.fill();
      }
      if (number !== undefined) {
        labels.push({ text: String(number), x: r.x + r.width / 2, y: r.y + r.height - size * 0.55 - 3, size, color: !classic ? '#ffffff' : active ? color.on : color.ink });
      }
    }
    ctx.globalAlpha = 1;

    // Above all the notes.
    ctx.textAlign = 'center';
    for (const l of labels) {
      ctx.font = FONT(l.size);
      // Whatever is behind.
      if (!classic) {
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.strokeText(l.text, l.x, l.y);
      }
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, l.y);
    }

  }
}

export function FallingNotes({ player, from, to, numbers, parts, keyLight }: {
  player: NoteSource;
  from: number;
  to: number;
  // Written on the notes, and where they start again at 1 (see numbers.ts).
  numbers?: ReadonlyMap<PieceNote, number>;
  parts?: { start: number; label: string }[];
  // Over the keyboard below, for the light of the notes.
  keyLight?: RefObject<HTMLCanvasElement | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Scrolled by hand (wheel or a finger up and down): the view stays on that
  // moment while the piece goes on, until recentred.
  const view = useRef<number | null>(null);
  const [shifted, setShifted] = useState(false);
  const moveBy = (seconds: number) => {
    const last = player.notes.length ? Math.max(...player.notes.map((n) => n.time + n.duration)) : 0;
    view.current = Math.max(0, Math.min(last, (view.current ?? player.position) + seconds));
    setShifted(true);
  };
  const recentre = () => {
    view.current = null;
    setShifted(false);
  };
  // Seconds per pixel.
  const perPixel = () => (LOOKAHEAD * player.rate) / Math.max(1, canvas.current?.clientHeight ?? 1);
  const latestMove = useRef(moveBy);
  latestMove.current = moveBy;
  useEffect(() => {
    const el = canvas.current!;
    // Not React's: it must be able to keep the page from scrolling.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      // Down: what was played, below.
      latestMove.current(-px * perPixelRef.current());
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const perPixelRef = useRef(perPixel);
  perPixelRef.current = perPixel;
  const drag = useRef<{ id: number; y: number } | null>(null);
  // Read by the drawing loop without restarting it.
  const numbersRef = useRef({ numbers, parts });
  numbersRef.current = { numbers, parts };
  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const painter = new NotesPainter(from, to);
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    const draw = () => {
      const { clientWidth: w, clientHeight: h } = el;
      // A wide keyboard on a sharp phone screen would be a huge canvas.
      const dpr = Math.min(window.devicePixelRatio || 1, Math.max(1, 5120 / w));
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const over = keyLight?.current;
      const keys = over?.getContext('2d') ?? null;
      if (over) {
        const [kw, kh] = [over.clientWidth, over.clientHeight];
        if (over.width !== kw || over.height !== kh) Object.assign(over, { width: kw, height: kh });
      }
      painter.paint(ctx, w, h, player, { ...numbersRef.current, calm: calm.matches, keys, keysSize: over ? [over.clientWidth, over.clientHeight] : undefined, view: view.current }, performance.now());
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [player, from, to, keyLight]);

  return (
    <>
      <canvas
        ref={canvas}
        // Sideways stays the page's (a keyboard wider than the screen).
        className="block h-full w-full cursor-grab touch-pan-x active:cursor-grabbing"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { id: e.pointerId, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          // The notes follow the finger: pulled down, what comes later is seen.
          moveBy((e.clientY - d.y) * perPixel());
          d.y = e.clientY;
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <RecentreButton free={shifted} onClick={recentre} className="left-1/2 top-3 -translate-x-1/2" />
    </>
  );
}
