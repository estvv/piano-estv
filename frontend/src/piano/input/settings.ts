import { readJson, writeJson } from '../../lib/storage';
import { Observable } from '../../lib/store';
import type { SourceId } from './bus';

// Per-device settings: they depend on this machine (MIDI device,
// microphone), so they live in localStorage, not in the account.

export interface InputSettings {
  midi: { enabled: boolean };
  mic: { threshold: number };
  // Play the piano sound for notes from this source.
  monitor: Record<SourceId, boolean>;
  volume: number; // 0..1
}

const KEY = 'piano.input.v1';

const defaults: InputSettings = {
  midi: { enabled: false },
  mic: { threshold: 0.01 },
  monitor: { virtual: true, midi: true, mic: false },
  volume: 0.8,
};

export const inputSettings = new Observable<InputSettings>(readJson(KEY, defaults));
inputSettings.subscribe(() => writeJson(KEY, inputSettings.get()));

export function updateSettings(patch: (s: InputSettings) => InputSettings) {
  inputSettings.set(patch);
}
