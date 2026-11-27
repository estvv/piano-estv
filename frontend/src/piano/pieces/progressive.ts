import { readJson, writeJson } from '../../lib/storage';
import { Observable } from '../../lib/store';

// A loop played slowly first, a little faster each time it goes well, up to the
// tempo wanted. Kept on this device.

export interface Progressive {
  on: boolean;
  from: number;
  to: number;
}

// Faster by this much, after a take that scores at least that.
export const STEP = 0.05;
export const GOOD = 80;
export const FROM = [0.4, 0.5, 0.6, 0.7, 0.8];
export const TO = [0.8, 0.9, 1, 1.1, 1.25];

const KEY = 'piano.progressive.v1';
const one = (v: unknown, of: number[], otherwise: number) => (of.includes(v as number) ? (v as number) : otherwise);

export function cleanedProgressive(p: Partial<Progressive>): Progressive {
  const from = one(p.from, FROM, 0.6);
  const to = one(p.to, TO, 1);
  // Above where it starts.
  return { on: p.on === true, from, to: to > from ? to : TO.find((t) => t > from)! };
}

export const progressive = new Observable<Progressive>(cleanedProgressive(readJson<Partial<Progressive>>(KEY, {})));
progressive.subscribe(() => writeJson(KEY, progressive.get()));
export const setProgressive = (patch: Partial<Progressive>) => progressive.set((p) => cleanedProgressive({ ...p, ...patch }));

// The tempo after a take; the same when it did not go well enough, or is there.
export function nextRate(rate: number, score: number, { to }: Progressive): number {
  if (score < GOOD || rate >= to - 1e-6) return rate;
  return Math.min(to, Math.round((rate + STEP) * 100) / 100);
}
