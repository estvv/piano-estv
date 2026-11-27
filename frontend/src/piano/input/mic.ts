import { frequencyToMidi, MIDI_MAX, MIDI_MIN } from '@piano/shared';
import { PitchDetector } from 'pitchy';
import { Observable } from '../../lib/store';
import { inputBus } from './bus';
import { inputSettings } from './settings';

// Monophonic pitch detection (McLeod method). Reliable for one note at a
// time; chords are not detected, so activities needing them refuse this source.

export interface MicState {
  status: 'off' | 'pending' | 'on' | 'denied';
  level: number; // RMS 0..1
  pitch: number | null; // fractional midi currently heard
  clarity: number;
}

export const micState = new Observable<MicState>({ status: 'off', level: 0, pitch: null, clarity: 0 });

const FRAME = 2048;
const MIN_CLARITY = 0.9;
const STABLE_FRAMES = 3; // ~3 animation frames on the same note before noteOn
const SILENT_FRAMES = 4;

let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let raf = 0;

export async function enableMic() {
  if (micState.get().status === 'on') return;
  micState.set((s) => ({ ...s, status: 'pending' }));
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    micState.set((s) => ({ ...s, status: 'denied' }));
    return;
  }
  ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FRAME;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const detector = PitchDetector.forFloat32Array(FRAME);
  const buffer = new Float32Array(FRAME);

  let current: number | null = null; // note currently "on"
  let candidate: number | null = null;
  let candidateFrames = 0;
  let silentFrames = 0;

  const tick = () => {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (const v of buffer) sum += v * v;
    const level = Math.sqrt(sum / buffer.length);
    const [freq, clarity] = detector.findPitch(buffer, ctx!.sampleRate);
    const pitch = frequencyToMidi(freq);
    const voiced = level >= inputSettings.get().mic.threshold && clarity >= MIN_CLARITY
      && pitch >= MIDI_MIN - 0.5 && pitch <= MIDI_MAX + 0.5;
    micState.set((s) => ({ ...s, level, pitch: voiced ? pitch : null, clarity }));

    if (voiced) {
      silentFrames = 0;
      const note = Math.round(pitch);
      if (note === candidate) candidateFrames++;
      else {
        candidate = note;
        candidateFrames = 1;
      }
      if (candidateFrames >= STABLE_FRAMES && note !== current) {
        if (current !== null) inputBus.noteOff(current, 'mic');
        current = note;
        inputBus.noteOn(note, 'mic');
      }
    } else if (++silentFrames >= SILENT_FRAMES) {
      candidate = null;
      candidateFrames = 0;
      if (current !== null) {
        inputBus.noteOff(current, 'mic');
        current = null;
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  micState.set((s) => ({ ...s, status: 'on' }));
}

export function disableMic() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  void ctx?.close();
  stream = null;
  ctx = null;
  inputBus.releaseAll('mic');
  micState.set({ status: 'off', level: 0, pitch: null, clarity: 0 });
}
