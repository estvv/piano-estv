import { initAudio } from './audio';
import { initMidi } from './input/midi';

// Sound and MIDI listen from the start: a keyboard plugged in plays at once.
export function initPiano() {
  initAudio();
  initMidi();
}
