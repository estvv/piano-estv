import { alpha, tone, type Tone } from './colors';
import { presence, type Particle } from './particles';

// Brushes shared by the styles. Light is added up ("lighter") from pictures made
// once: blurring at every picture would be far too slow.

export interface Box { x: number; y: number; w: number; h: number }
type Ctx = CanvasRenderingContext2D;

function kept(size: number, stops: (t: Tone) => [number, string][]) {
  const all = new Map<string, HTMLCanvasElement>();
  return (color: string): HTMLCanvasElement => {
    let c = all.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      if (ctx) {
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        for (const [at, paint] of stops(tone(color))) g.addColorStop(at, paint);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }
      if (all.size > 200) all.clear();
      all.set(color, c);
    }
    return c;
  };
}
// A round light.
const glow = kept(64, (t) => [[0, alpha(t, 1)], [0.2, alpha(t, 0.55)], [0.5, alpha(t, 0.16)], [1, alpha(t, 0)]]);
// A speck: white, sharp, a little light of its colour around.
const speck = kept(32, (t) => [[0, '#ffffff'], [0.2, '#ffffff'], [0.3, alpha(tone(t.hot), 0.8)], [0.5, alpha(t, 0.3)], [1, alpha(t, 0)]]);

export function light(ctx: Ctx, color: string, x: number, y: number, rx: number, ry: number, a: number) {
  if (a <= 0.004 || rx <= 0 || ry <= 0) return;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(glow(color), x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = 1;
}

export function round(ctx: Ctx, b: Box, r: number) {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, Math.max(0, Math.min(r, b.w / 2, b.h / 2)));
}

// Light around the shape just traced.
export function halo(ctx: Ctx, t: Tone, strength: number) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [width, a] of [[44, 0.012], [32, 0.016], [22, 0.024], [14, 0.036], [8, 0.055], [4, 0.09]]) {
    ctx.lineWidth = width;
    ctx.strokeStyle = alpha(t, a * strength);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function vertical(ctx: Ctx, b: Box, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

export function drawParticles(ctx: Ctx, all: readonly Particle[]) {
  ctx.globalCompositeOperation = 'lighter';
  for (const p of all) {
    const a = presence(p);
    if (a <= 0.01) continue;
    if (p.kind === 'ember') {
      // A hot core, some light around; the big ones are soft.
      const big = p.size > 2.6;
      light(ctx, p.color, p.x, p.y, p.size * (big ? 5 : 4), p.size * (big ? 5 : 4), a * (big ? 0.4 : 0.8));
      ctx.globalAlpha = a * (big ? 0.6 : 1);
      ctx.fillStyle = big ? tone(p.color).hot : '#fff6e0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.8, p.size * (big ? 0.7 : 0.7)), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    if (p.kind === 'mote') {
      const r = p.size * 4;
      ctx.globalAlpha = a;
      ctx.drawImage(speck(p.color), p.x - r, p.y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      continue;
    }
    // A long thin light, along its way.
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    light(ctx, p.color, 0, 0, p.size * 9, p.size * 1.1, a * 0.7);
    light(ctx, tone(p.color).hot, 0, 0, p.size * 6, p.size * 0.4, a);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}
