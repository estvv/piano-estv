import { Observable } from '../../lib/store';
import { inputBus } from './bus';
import { inputSettings, updateSettings } from './settings';

// Web MIDI (Chrome/Edge). Every connected input is listened to.

export interface MidiState {
  supported: boolean;
  status: 'off' | 'pending' | 'on' | 'denied';
  devices: string[];
}

export const midiState = new Observable<MidiState>({
  supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  status: 'off',
  devices: [],
});

let access: MIDIAccess | null = null;

function onMessage(e: MIDIMessageEvent) {
  const data = e.data;
  if (!data || data.length < 3) return;
  const command = data[0] & 0xf0;
  const note = data[1];
  const velocity = data[2];
  if (command === 0x90 && velocity > 0) inputBus.noteOn(note, 'midi', velocity / 127);
  else if (command === 0x80 || (command === 0x90 && velocity === 0)) inputBus.noteOff(note, 'midi');
}

function bindInputs() {
  if (!access) return;
  const devices: string[] = [];
  access.inputs.forEach((input) => {
    input.onmidimessage = onMessage;
    if (input.state === 'connected') devices.push(input.name ?? 'MIDI');
  });
  midiState.set((s) => ({ ...s, devices }));
}

export async function enableMidi() {
  if (!midiState.get().supported) return;
  midiState.set((s) => ({ ...s, status: 'pending' }));
  try {
    access = await navigator.requestMIDIAccess();
    access.onstatechange = () => {
      bindInputs();
      if (midiState.get().devices.length === 0) inputBus.releaseAll('midi');
    };
    bindInputs();
    midiState.set((s) => ({ ...s, status: 'on' }));
    updateSettings((st) => ({ ...st, midi: { enabled: true } }));
  } catch {
    midiState.set((s) => ({ ...s, status: 'denied' }));
  }
}

export function disableMidi() {
  access?.inputs.forEach((input) => {
    input.onmidimessage = null;
  });
  access = null;
  inputBus.releaseAll('midi');
  midiState.set((s) => ({ ...s, status: 'off', devices: [] }));
  updateSettings((st) => ({ ...st, midi: { enabled: false } }));
}

// Reconnect on load when it was enabled on this machine.
export function initMidi() {
  if (inputSettings.get().midi.enabled && midiState.get().supported) void enableMidi();
}
