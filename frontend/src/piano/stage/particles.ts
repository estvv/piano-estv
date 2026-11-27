// What rises from the keys: clouds of motes, carried by the same moving air, so
// that each cloud turns and stretches as one; and now and then a flash. No more
// than a fixed number of them: the oldest make room for the new ones.

export type Kind = 'mote' | 'flash' | 'ember';

export interface Particle {
  kind: Kind;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  age: number;
  life: number; // seconds
  seed: number;
}

// The air: waves of several sizes, drifting. It turns and never gathers (a curl).
const WAVES = [
  { x: 0.009, y: 0.007, t: 0.35, a: 62 },
  { x: -0.021, y: 0.015, t: -0.5, a: 52 },
  { x: 0.041, y: -0.033, t: 0.8, a: 40 },
  { x: 0.074, y: 0.069, t: -1.1, a: 22 },
];
export function wind(x: number, y: number, time: number): [number, number] {
  let vx = 0;
  let vy = 0;
  WAVES.forEach((w, i) => {
    const slope = Math.cos(x * w.x + y * w.y + time * w.t * 2 + i * 1.9) * w.a;
    vx += slope * w.y * 60;
    vy -= slope * w.x * 60;
  });
  return [vx, vy];
}

// How quickly they take the speed of the air, and lose their own.
const CARRIED = 1.7;
// Of embers, pushed up (pixels a second each second).
const EMBER_RISE = 22;
const RISE = 46;

export class Particles {
  readonly all: Particle[] = [];
  private time = 0;

  constructor(public limit: number) {}

  add(p: Omit<Particle, 'age' | 'seed'>) {
    if (this.limit <= 0) return;
    if (this.all.length >= this.limit) this.all.splice(0, this.all.length - this.limit + 1);
    this.all.push({ ...p, age: 0, seed: Math.random() * 100 });
  }

  // `scale`: of the stage next to a usual one.
  step(dt: number, scale = 1) {
    this.time += dt;
    const keep = Math.exp(-CARRIED * dt);
    let kept = 0;
    for (const p of this.all) {
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.kind === 'mote') {
        const [wx, wy] = wind(p.x / scale, p.y / scale, this.time);
        // Let go of slowly: together first, then each its own way.
        const free = Math.min(1, p.age * 1.6);
        p.vx = p.vx * keep + (wx * free * scale) * (1 - keep);
        p.vy = p.vy * keep + ((wy * free - RISE) * scale) * (1 - keep);
      } else if (p.kind === 'ember') {
        // Hot air: up, slower and slower, swaying each its own way.
        const sway = Math.sin(p.seed * 3 + p.age * (1.6 + (p.seed % 1.3))) * 34 * scale;
        p.vx = p.vx * Math.exp(-1.8 * dt) + sway * dt * 3;
        p.vy = p.vy * Math.exp(-0.9 * dt) - EMBER_RISE * scale * dt;
      } else {
        p.vx += Math.cos(p.seed) * 260 * scale * dt;
        p.vy *= Math.exp(-0.8 * dt);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this.all[kept++] = p;
    }
    this.all.length = kept;
  }
}

// How much of it is left to see, 0 to 1: comes at once, goes slowly, twinkling.
export function presence(p: Particle): number {
  const t = p.age / p.life;
  if (p.kind === 'flash') return Math.sin(Math.PI * Math.min(1, t)) ** 1.5;
  // Embers flicker hard, now and then nearly out.
  if (p.kind === 'ember') return Math.min(1, p.age * 12) * (1 - t) ** 0.9 * (0.55 + 0.45 * Math.sin(p.seed * 5 + p.age * (6 + (p.seed % 9))) ** 2);
  return Math.min(1, p.age * 30) * (1 - t) ** 1.3 * (0.72 + 0.28 * Math.sin(p.seed * 7 + p.age * (9 + (p.seed % 7))));
}
