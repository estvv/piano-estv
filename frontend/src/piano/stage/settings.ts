import { readJson, writeJson } from '../../lib/storage';
import { Observable } from '../../lib/store';

// How the falling notes look, on this device. All but the classic ones are played
// in the dark, with the same light and the same sparks: only the notes change.

export const STYLE_IDS = ['classic', 'glow', 'glass', 'outline', 'comet', 'plain'] as const;
export type StyleId = (typeof STYLE_IDS)[number];
export type Effects = 'off' | 'soft' | 'max';
// What rises from the keys: clouds carried by one wind, or embers each on its way.
export type Sparks = 'cloud' | 'embers';
// How keys played look: lit from above, filled with the colour, or as they are.
export type KeyLight = 'glow' | 'solid' | 'off';

export interface StageSettings {
  style: StyleId;
  effects: Effects;
  sparks: Sparks;
  // The line of light over the keyboard.
  led: boolean;
  // Notes light the keys up.
  keys: KeyLight;
  // Of the keys played and of the line of light; '' for that of the notes.
  keyColor: string;
  ledColor: string;
}

export const STYLE_NAMES: Record<StyleId, string> = { classic: 'Classique', glow: 'Lueur', glass: 'Verre', outline: 'Contour', comet: 'Traînée', plain: 'Sobre' };

const KEY = 'piano.stage.v1';
const DEFAULTS: StageSettings = { style: 'classic', effects: 'max', sparks: 'cloud', led: true, keys: 'glow', keyColor: '', ledColor: '' };
// Styles there used to be.
const OLD = ['neon', 'crystal', 'fire', 'liquid', 'galaxy'];

const HEX = /^#[0-9a-f]{6}$/i;
const color = (v: unknown, otherwise: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : otherwise);

const one = <T extends string>(value: unknown, of: readonly T[], otherwise: T): T => (of.includes(value as T) ? (value as T) : otherwise);

// The notes take the colours of the hands (those of the piece, if it has its own).
export function cleanedStage(s: Partial<Omit<StageSettings, 'keys'>> & { keys?: unknown }): StageSettings {
  return {
    style: one(s.style, STYLE_IDS, OLD.includes(s.style as string) ? 'glow' : DEFAULTS.style),
    effects: one(s.effects, ['off', 'soft', 'max'], DEFAULTS.effects),
    sparks: one(s.sparks, ['cloud', 'embers'], DEFAULTS.sparks),
    led: typeof s.led === 'boolean' ? s.led : DEFAULTS.led,
    // Once on or off.
    keys: s.keys === false ? 'off' : one(s.keys, ['glow', 'solid', 'off'], DEFAULTS.keys),
    keyColor: color(s.keyColor, ''),
    ledColor: color(s.ledColor, ''),
  };
}

export const stage = new Observable<StageSettings>(cleanedStage(readJson<Partial<StageSettings>>(KEY, {})));
stage.subscribe(() => writeJson(KEY, stage.get()));
export const setStage = (patch: Partial<StageSettings>) => stage.set((s) => ({ ...s, ...patch }));
