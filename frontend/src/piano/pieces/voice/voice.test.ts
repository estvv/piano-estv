import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stretch } from './stretch';
import { conflict, syncOf } from './sync';
import { VoicePlayer, type Leader, type Sound } from './VoicePlayer';

describe('a recording and a piece', () => {
  it('go together from one moment, or two', () => {
    expect(syncOf([])).toEqual({ offset: 0, speed: 1 });
    expect(syncOf([{ piece: 2, audio: 14 }])).toEqual({ offset: 12, speed: 1 });
    const { offset, speed } = syncOf([{ piece: 110, audio: 112 }, { piece: 10, audio: 10 }]);
    expect(speed).toBeCloseTo(1.02);
    expect(110 * speed + offset).toBeCloseTo(112);
    // Too close to tell a speed, or no speed at all.
    expect(syncOf([{ piece: 2, audio: 4 }, { piece: 5, audio: 9 }])).toEqual({ offset: 2, speed: 1 });
    expect(syncOf([{ piece: 0, audio: 5 }, { piece: 100, audio: 20 }])).toEqual({ offset: 5, speed: 1 });
    expect([conflict([{ piece: 0, audio: 5 }, { piece: 100, audio: 20 }]), conflict([{ piece: 0, audio: 5 }, { piece: 100, audio: 106 }]), conflict([])]).toEqual([true, false, false]);
  });
});

describe('a sound made slower or faster', () => {
  const RATE = 22_050;
  const tone = (hz: number, seconds: number) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE));
  // Upward crossings a second, away from the ends.
  const pitch = (x: Float32Array) => {
    const [a, b] = [Math.round(x.length * 0.2), Math.round(x.length * 0.8)];
    let n = 0;
    for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
    return n / ((b - a) / RATE);
  };
  const power = (x: Float32Array) => Math.sqrt(x.subarray(x.length >> 2, (x.length * 3) >> 2).reduce((s, v) => s + v * v, 0) / (x.length / 2));

  it.each([0.5, 0.75, 1.02, 1.25])('keeps its pitch and its strength: × %s', (rate) => {
    for (const hz of [110, 220, 523]) {
      const source = tone(hz, 2);
      const [out] = stretch([source], RATE, rate);
      expect(out.length / source.length).toBeCloseTo(1 / rate, 2);
      expect(Math.abs(pitch(out) / hz - 1)).toBeLessThan(0.02);
      expect(power(out) / power(source)).toBeGreaterThan(0.85);
      expect(power(out) / power(source)).toBeLessThan(1.15);
      // No crack: never a step bigger than a wave of that strength makes.
      const biggest = out.reduce((m, v, i) => (i ? Math.max(m, Math.abs(v - out[i - 1])) : m), 0);
      expect(biggest).toBeLessThan(0.5 * ((2 * Math.PI * 523) / RATE) * 1.6);
    }
  });

  it('takes any length, and leaves silence silent', () => {
    expect(stretch([new Float32Array(10)], RATE, 0.5)[0]).toHaveLength(20);
    expect(stretch([], RATE, 0.5)).toEqual([]);
    const [l, r] = stretch([tone(200, 1), new Float32Array(RATE)], RATE, 0.75);
    expect(l.length).toBe(r.length);
    expect(r.every((v) => v === 0)).toBe(true);
  });
});

describe('a recording that follows', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  // The clock and the piece, together unless told otherwise.
  const start = async (points = [{ piece: 0, audio: 5 }]) => {
    const state = { playing: false };
    const leader = { position: 0, rate: 1, state: { get: () => state } };
    const allow = { on: true };
    const clock = { now: 100, ahead: 0.1 };
    const started: { at: { when: number; from: number; rate: number; volume: number }; stopped: boolean; volume: number; buffer: unknown }[] = [];
    const made: number[] = [];
    const buffer = { duration: 100 } as AudioBuffer;
    const sound: Sound = {
      clock: () => clock,
      start: (b, at) => {
        const clip = { at, stopped: false, volume: at.volume, buffer: b };
        started.push(clip);
        return { stop: () => { clip.stopped = true; }, setVolume: (v) => { clip.volume = v; } };
      },
      decode: async () => buffer,
      atRate: async (_, rate) => {
        made.push(rate);
        return { duration: 100 / rate } as AudioBuffer;
      },
    };
    const voice = new VoicePlayer(new Blob(), leader as Leader, () => allow.on, sound);
    voice.set(points, 0.5);
    // Seconds, by pictures; `slip`: the piece goes that much slower than the clock.
    const go = async (seconds: number, slip = 0) => {
      for (let i = 0; i < seconds * 50; i++) {
        clock.now += 0.02;
        if (state.playing) leader.position += 0.02 * leader.rate * (1 - slip);
        await vi.advanceTimersByTimeAsync(20);
      }
    };
    await go(0.2);
    return { state, leader, allow, clock, voice, started, made, go };
  };
  const running = (started: { stopped: boolean }[]) => started.filter((c) => !c.stopped).length;

  it('starts once, with the notes, and is left alone', async () => {
    const { state, leader, clock, started, go, voice } = await start();
    expect(started).toHaveLength(0);
    state.playing = true;
    leader.position = 2;
    await go(60);
    expect(started).toHaveLength(1);
    const { when, from, rate, volume } = started[0].at;
    expect([rate, volume]).toEqual([1, 0.5]);
    // Where it is now is where the notes asked for now will be heard.
    expect(from + (clock.now + clock.ahead - when)).toBeCloseTo(leader.position + 5, 1);
    voice.set([{ piece: 0, audio: 5 }], 0.9);
    expect(started[0].volume).toBe(0.9);
    voice.dispose();
    expect(started[0].stopped).toBe(true);
  });

  it('does not mind pictures that come late', async () => {
    const { state, leader, started, go, voice } = await start();
    state.playing = true;
    await go(1);
    for (let i = 0; i < 60; i++) {
      // The page stops for a moment, then catches up.
      leader.position -= 0.06;
      await go(0.06);
      leader.position += 0.06;
      await go(0.4);
    }
    expect(started).toHaveLength(1);
    voice.dispose();
  });

  it('goes where the piece goes, one at a time', async () => {
    const { state, leader, started, go, voice } = await start();
    state.playing = true;
    await go(3);
    leader.position = 40;
    await go(1);
    expect(started).toHaveLength(2);
    expect(started[1].at.from).toBeCloseTo(45, 1);
    expect(running(started)).toBe(1);
    state.playing = false;
    await go(0.2);
    expect(running(started)).toBe(0);
    state.playing = true;
    await go(0.5);
    expect(running(started)).toBe(1);
    voice.dispose();
  });

  it('comes back when the clocks come apart, rarely', async () => {
    const { state, started, go, voice } = await start();
    state.playing = true;
    // Two in a thousand: far more than real clocks.
    await go(80, 0.002);
    expect(started.length).toBeGreaterThan(1);
    expect(started.length).toBeLessThan(7);
    voice.dispose();
  });

  it('takes another speed at the same pitch, silent until it is made', async () => {
    const { state, leader, started, made, go, voice } = await start();
    state.playing = true;
    await go(2);
    leader.rate = 0.5;
    await go(1);
    expect(made).toEqual([0.5]);
    const last = started[started.length - 1];
    expect(last.at.rate).toBe(1);
    // In samples twice as long.
    expect(last.at.from).toBeGreaterThan(13);
    expect(running(started)).toBe(1);
    await go(20);
    expect(made).toHaveLength(1);
    // A hair from its own speed: played as it is.
    leader.rate = 1.001;
    await go(1);
    expect(started[started.length - 1].at.rate).toBe(1.001);
    expect(made).toHaveLength(1);
    voice.dispose();
  });

  it('is silent before it starts, after it ends, and when it is off', async () => {
    const { state, leader, allow, started, go, voice } = await start([{ piece: 10, audio: 0 }]);
    state.playing = true;
    await go(5);
    expect(started).toHaveLength(0);
    leader.position = 12;
    await go(1);
    expect(running(started)).toBe(1);
    allow.on = false;
    await go(0.2);
    expect(running(started)).toBe(0);
    allow.on = true;
    leader.position = 115;
    await go(1);
    expect(running(started)).toBe(0);
    voice.dispose();
    const { length } = started;
    leader.position = 20;
    await go(1);
    expect(started).toHaveLength(length);
  });
});
