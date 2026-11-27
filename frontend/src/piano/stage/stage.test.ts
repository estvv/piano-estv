import { describe, expect, it } from 'vitest';
import { keyLayout } from '../keyGeometry';
import { hex, pairOf, tone, warm } from './colors';
import { Particles, presence, wind, type Kind } from './particles';
import { Scene, type Picture, type SeenNote } from './scene';
import { cleanedStage, STYLE_IDS, type StageSettings } from './settings';

// A canvas that only counts what is drawn, and refuses what a real one would.
function canvas() {
  let calls = 0;
  const numbers = (args: unknown[]) => {
    for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error('not a number');
  };
  const gradient = { addColorStop: (at: number, color: string) => {
    if (!(at >= 0 && at <= 1) || /NaN|undefined/.test(color)) throw new Error(`bad stop ${at} ${color}`);
  } };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (own, name: string) => (name in own ? own[name] : (...args: unknown[]) => {
      numbers(args);
      calls++;
      return name.startsWith('create') ? gradient : undefined;
    }),
    set: (own, name: string, value) => {
      if (typeof value === 'string' && /NaN|undefined/.test(value)) throw new Error(`bad ${name}: ${value}`);
      own[name] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls: () => calls };
}
const settings = (more: Partial<StageSettings> = {}): StageSettings => ({ ...cleanedStage({}), style: 'glow', ...more });
const layout = keyLayout(48, 83);
const hands = { left: '#ff0000', right: '#0000ff' };
const id = {};
const note = (active: boolean, more: Partial<SeenNote> = {}): SeenNote => ({ id, midi: 60, hand: 'right', box: { x: 100, y: 200, w: 20, h: 200 }, active, ...more });
const picture = (notes: SeenNote[], moving = true): Picture => ({ w: 800, h: 400, layout, notes, moving, hands });

describe('how the notes look', () => {
  it('is the classic way unless chosen otherwise', () => {
    expect(cleanedStage({}).style).toBe('classic');
    expect(cleanedStage({ style: 'glass', led: false, effects: 'lots' as never })).toMatchObject({ style: 'glass', led: false, effects: 'max', keys: 'glow', sparks: 'cloud' });
    expect(cleanedStage({ keyColor: '#123456', ledColor: 'x' })).toMatchObject({ keyColor: '#123456', ledColor: '' });
    expect(cleanedStage({ style: 'gone' as never })).toMatchObject({ style: 'classic' });
    // Colours of their own there used to be: the hands' now.
    expect(cleanedStage({ mood: 'custom', custom: { left: '#000000' } } as never)).not.toHaveProperty('custom');
    // Styles there used to be: still in the dark.
    expect(cleanedStage({ style: 'crystal' as never }).style).toBe('glow');
  });

  it('takes the colours of the hands', () => {
    expect(pairOf('left', 60, hands)[0]).toBe('#ff0000');
    expect(pairOf(null, 40, hands)[0]).toBe('#ff0000');
    for (const m of [21, 60, 108]) for (const c of pairOf('right', m, hands)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect([hex(0, 1, 0.5), hex(120, 1, 0.5), hex(240, 1, 0.5)]).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(tone('#336699').rgb).toBe('51, 102, 153');
  });

  it('warms up as notes come, by a few colours only', () => {
    const pair = ['#000000', '#ffffff'] as const;
    expect([warm(pair, -1), warm(pair, 0), warm(pair, 1), warm(pair, 2)]).toEqual(['#000000', '#000000', '#ffffff', '#ffffff']);
    expect(new Set(Array.from({ length: 500 }, (_, i) => warm(pair, i / 499))).size).toBeLessThan(12);
  });

  it.each(STYLE_IDS.filter((s) => s !== 'classic'))('can be drawn: %s', (style) => {
    const scene = new Scene();
    const { ctx, calls } = canvas();
    {
      for (let i = 0; i < 40; i++) {
        // Coming, sounding, then gone; tall, flat, thin.
        const boxes = [{ x: 10, y: -50, w: 30, h: 300 }, { x: 60, y: 390, w: 3, h: 4 }, { x: 90, y: 100, w: 40, h: 8 }];
        scene.draw(ctx, picture(boxes.map((box, k) => note(i > 10 && i < 25, { box, midi: 60 + k, id: boxes[0] }))), settings({ style }), 0.016);
        scene.drawKeys(ctx, 800, 160, layout);
      }
    }
    expect(calls()).toBeGreaterThan(500);
  });

  it('throws sparks as notes start and last, as many as asked for', () => {
    const run = (effects: StageSettings['effects'], moving = true) => {
      const scene = new Scene();
      const { ctx } = canvas();
      for (let i = 0; i < 20; i++) scene.draw(ctx, picture([note(true)], moving), settings({ effects }), 0.016);
      return scene.particles.all.length;
    };
    expect(run('off')).toBe(0);
    expect(run('max', false)).toBe(0);
    expect(run('soft')).toBeGreaterThan(0);
    expect(run('max')).toBeGreaterThan(run('soft'));
  });

  it('asks less of a slow machine', () => {
    const scene = new Scene();
    const { ctx } = canvas();
    for (let i = 0; i < 400; i++) scene.draw(ctx, picture([]), settings(), 0.06);
    expect(scene.particles.limit).toBeLessThan(900);
    for (let i = 0; i < 1200; i++) scene.draw(ctx, picture([]), settings(), 0.012);
    expect(scene.particles.limit).toBe(2600);
  });

  it('never has too many sparks, and they all go', () => {
    const p = new Particles(50);
    const kinds: Kind[] = ['mote', 'flash'];
    for (let i = 0; i < 200; i++) p.add({ kind: kinds[i % 2], color: '#ffffff', x: 0, y: 0, vx: 10, vy: -200, size: 1, life: 1 });
    expect(p.all).toHaveLength(50);
    p.step(0.5);
    expect(p.all.every((x) => Number.isFinite(x.x + x.y) && presence(x) >= 0 && presence(x) <= 1)).toBe(true);
    p.step(0.6);
    expect(p.all).toHaveLength(0);
    p.limit = 0;
    p.add({ kind: 'mote', color: '#ffffff', x: 0, y: 0, vx: 0, vy: 0, size: 1, life: 1 });
    expect(p.all).toHaveLength(0);
  });

  it('carries a cloud as one, then lets it spread', () => {
    const p = new Particles(500);
    for (let i = 0; i < 100; i++) p.add({ kind: 'mote', color: '#ffffff', x: 300 + (i % 10), y: 500 - i / 10, vx: 0, vy: -250 - (i % 7) * 10, size: 1, life: 3 });
    const spread = () => {
      const xs = p.all.map((x) => x.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    for (let i = 0; i < 15; i++) p.step(1 / 60);
    const early = spread();
    expect(early).toBeLessThan(40);
    for (let i = 0; i < 90; i++) p.step(1 / 60);
    // Higher, curled, but still a cloud.
    expect(p.all.every((x) => x.y < 480)).toBe(true);
    expect(spread()).toBeGreaterThan(early);
    expect(spread()).toBeLessThan(420);
    // The air turns, it does not gather: as much goes in as comes out.
    const e = 0.01;
    for (const [x, y, t] of [[10, 20, 0], [300, 140, 2], [777, 400, 5]]) {
      const out = (wind(x + e, y, t)[0] - wind(x - e, y, t)[0] + wind(x, y + e, t)[1] - wind(x, y - e, t)[1]) / (2 * e);
      expect(Math.abs(out)).toBeLessThan(0.01);
    }
  });
});
