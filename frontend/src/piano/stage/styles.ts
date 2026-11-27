import { mix } from '../../lib/appearance';
import { alpha, type Tone } from './colors';
import { halo, light, round, vertical, type Box } from './draw';
import type { StyleId } from './settings';

type Ctx = CanvasRenderingContext2D;

// How a note is drawn. `lit`: how much it sounds, 0 to 1.
export type DrawNote = (ctx: Ctx, b: Box, t: Tone, lit: number) => void;

const RADIUS = 7;

// Plain and full, as a lamp behind paper.
const glow: DrawNote = (ctx, b, t, lit) => {
  round(ctx, b, RADIUS);
  halo(ctx, t, 1 + 1.8 * lit);
  ctx.fillStyle = vertical(ctx, b, lit > 0.5 ? [[0, t.main], [0.7, t.light], [1, t.hot]] : [[0, t.main], [1, t.light]]);
  ctx.fill();
  // Its upper edge catches the light.
  round(ctx, { x: b.x + 1.5, y: b.y + 1.5, w: b.w - 3, h: Math.min(b.h - 3, 10) }, RADIUS - 1);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fill();
};

// Seen through, its rim bright.
const glass: DrawNote = (ctx, b, t, lit) => {
  round(ctx, b, RADIUS);
  halo(ctx, t, 0.6 + 1.6 * lit);
  ctx.fillStyle = vertical(ctx, b, [[0, alpha(t, 0.14 + 0.4 * lit)], [1, alpha(t, 0.42 + 0.5 * lit)]]);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = alpha(t, 0.95);
  ctx.stroke();
  const shine = { x: b.x + b.w * 0.16, y: b.y + 5, w: Math.max(1.5, b.w * 0.1), h: b.h - 10 };
  if (shine.h > 4) {
    round(ctx, shine, shine.w / 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.28 + 0.4 * lit})`;
    ctx.fill();
  }
};

// Only its edge, as a tube of light.
const outline: DrawNote = (ctx, b, t, lit) => {
  round(ctx, b, RADIUS);
  ctx.fillStyle = alpha(t, 0.06 + 0.5 * lit);
  ctx.fill();
  halo(ctx, t, 0.9 + 1.6 * lit);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = t.main;
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.hot;
  ctx.stroke();
};

// Bright where it strikes, fading behind.
const comet: DrawNote = (ctx, b, t, lit) => {
  round(ctx, b, b.w / 2);
  ctx.fillStyle = vertical(ctx, b, [[0, alpha(t, 0.03 + 0.15 * lit)], [0.55, alpha(t, 0.4 + 0.2 * lit)], [1, t.light]]);
  ctx.fill();
  const x = b.x + b.w / 2;
  const y = b.y + b.h - b.w / 2;
  ctx.globalCompositeOperation = 'lighter';
  light(ctx, t.main, x, y, b.w * (1.5 + lit), b.w * (1.5 + lit), 0.75);
  light(ctx, t.hot, x, y, b.w * 0.55, b.w * 0.55, 0.95);
  ctx.globalCompositeOperation = 'source-over';
};

// Sober: the hand's colour as it is, flat, barely rounded, no halo. Sounding: a
// little brighter, its edge on the keys lit.
const plain: DrawNote = (ctx, b, t, lit) => {
  const r = Math.min(4, b.w * 0.2);
  round(ctx, b, r);
  ctx.fillStyle = lit > 0 ? mix(t.main, '#ffffff', 1 - 0.22 * lit) : t.main;
  ctx.fill();
  // Notes one above the other stay apart.
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.dark;
  ctx.stroke();
  if (lit > 0) {
    round(ctx, { x: b.x + 1, y: b.y + b.h - 3, w: b.w - 2, h: 2 }, 1);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.8 * lit})`;
    ctx.fill();
  }
};

export const STYLES: Record<Exclude<StyleId, 'classic'>, DrawNote> = { glow, glass, outline, comet, plain };
