import { Observable } from '../../lib/store';

// Every note source (virtual keyboard, MIDI, microphone)
// emits the same events; activities never know where a note came from.

export type SourceId = 'virtual' | 'midi' | 'mic';

export interface NoteEvent {
  type: 'on' | 'off';
  midi: number;
  velocity: number; // 0..1
  source: SourceId;
  time: number; // performance.now()
}

export interface SourceCapabilities {
  polyphonic: boolean;
  velocity: boolean;
}

export const capabilities: Record<SourceId, SourceCapabilities> = {
  virtual: { polyphonic: true, velocity: false },
  midi: { polyphonic: true, velocity: true },
  mic: { polyphonic: false, velocity: false },
};

export const sourceLabels: Record<SourceId, string> = {
  virtual: 'Clavier à l’écran',
  midi: 'Clavier MIDI',
  mic: 'Micro',
};

// What an activity needs from note inputs.
export interface NoteRequirement {
  polyphonic?: boolean;
}

export function sourceSatisfies(source: SourceId, req: NoteRequirement | undefined): boolean {
  return !req?.polyphonic || capabilities[source].polyphonic;
}

type Listener = (e: NoteEvent) => void;

class InputBus {
  private listeners = new Set<Listener>();
  // midi -> sources currently holding it
  private holders = new Map<number, Set<SourceId>>();
  readonly held = new Observable<ReadonlySet<number>>(new Set());
  // How many components ask for note input: the sounds load with the first one.
  readonly demand = new Observable(0);

  emit(e: NoteEvent) {
    const set = this.holders.get(e.midi) ?? new Set<SourceId>();
    const wasHeld = set.size > 0;
    if (e.type === 'on') set.add(e.source);
    else set.delete(e.source);
    if (set.size) this.holders.set(e.midi, set);
    else this.holders.delete(e.midi);
    if (wasHeld !== set.size > 0) this.held.set(new Set(this.holders.keys()));
    for (const l of this.listeners) l(e);
  }

  noteOn(midi: number, source: SourceId, velocity = 0.8) {
    this.emit({ type: 'on', midi, velocity, source, time: performance.now() });
  }

  noteOff(midi: number, source: SourceId) {
    this.emit({ type: 'off', midi, velocity: 0, source, time: performance.now() });
  }

  // Releases everything a source holds (device unplugged, source disabled).
  releaseAll(source: SourceId) {
    for (const [midi, set] of [...this.holders]) if (set.has(source)) this.noteOff(midi, source);
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  acquire() {
    this.demand.set((d) => d + 1);
    return () => this.demand.set((d) => d - 1);
  }
}

export const inputBus = new InputBus();
