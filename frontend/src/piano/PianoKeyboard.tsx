import { frenchName, isBlack, noteName, type Hand } from '@piano/shared';
import { useMemo, useRef, type PointerEvent } from 'react';
import { inputBus } from './input/bus';
import { keyLayout } from './keyGeometry';
import { useHeldNotes, useNoteInput } from './input/hooks';

export type KeyMark = 'target' | 'correct' | 'wrong' | 'hint';
export type KeyLabels = 'none' | 'names' | 'c' | 'scientific';

// A number stuck on a key (see pieces/numbers.ts).
export interface Sticker {
  number: number;
  hand: Hand;
}

interface Props {
  from: number;
  to: number;
  marks?: ReadonlyMap<number, KeyMark>;
  labels?: KeyLabels;
  stickers?: ReadonlyMap<number, Sticker[]>;
  // Clickable keys emitting notes on the input bus (default true).
  interactive?: boolean;
  // Pixels, or any CSS height.
  height?: number | string;
}

// The keyboard looks the same in every theme. A wrong key is hatched: whatever
// the colours of the hands, it is none of them.
const HATCHED = 'bg-[repeating-linear-gradient(45deg,#f59e0b_0_5px,#fef3c7_5px_10px)]';
const markClass: Record<KeyMark, { white: string; black: string }> = {
  target: { white: 'bg-hand-r-key', black: 'bg-hand-r' },
  hint: { white: 'bg-hand-l-key', black: 'bg-hand-l' },
  correct: { white: 'bg-[#a7f3d0]', black: 'bg-[#10b981]' },
  wrong: { white: HATCHED, black: HATCHED },
};


export function PianoKeyboard({ from, to, marks, labels = 'none', stickers, interactive = true, height = 150 }: Props) {
  const layout = useMemo(() => keyLayout(from, to), [from, to]);
  const held = useHeldNotes();
  useNoteInput(undefined, interactive);
  const pointerNote = useRef(new Map<number, number>()); // pointerId -> midi

  const keys = [...layout.entries()];

  const press = (e: PointerEvent, midi: number) => {
    if (!interactive) return;
    e.preventDefault();
    // Without capture, sliding across keys fires pointerenter on each (glissando).
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    const prev = pointerNote.current.get(e.pointerId);
    if (prev === midi) return;
    if (prev !== undefined) inputBus.noteOff(prev, 'virtual');
    pointerNote.current.set(e.pointerId, midi);
    inputBus.noteOn(midi, 'virtual');
  };
  const enter = (e: PointerEvent, midi: number) => {
    if (e.buttons & 1 && pointerNote.current.has(e.pointerId)) press(e, midi);
  };
  const lift = (e: PointerEvent) => {
    const prev = pointerNote.current.get(e.pointerId);
    if (prev === undefined) return;
    pointerNote.current.delete(e.pointerId);
    inputBus.noteOff(prev, 'virtual');
  };

  const label = (midi: number): string | null => {
    switch (labels) {
      case 'names': return isBlack(midi) ? null : frenchName(midi);
      case 'c': return midi % 12 === 0 ? noteName(midi) : null;
      case 'scientific': return isBlack(midi) ? null : noteName(midi);
      default: return null;
    }
  };

  // Names shrink with the keys rather than run into each other.
  const whites = keys.filter(([, k]) => !k.black).length;
  const fontSize = `min(11px, ${(50 / whites).toFixed(2)}cqw)`;

  const stickerSize = `clamp(7px, ${(58 / whites).toFixed(2)}cqw, 17px)`;
  const stuck = (midi: number, black: boolean) => stickers?.get(midi)?.map((s) => (
    <span
      key={s.hand}
      className={`font-bold leading-tight ${s.hand === 'left' ? (black ? 'text-hand-l-bright' : 'text-hand-l-key-ink') : black ? 'text-hand-r-bright' : 'text-hand-r-key-ink'}`}
      style={{ fontSize: stickerSize }}
    >
      {s.number}
    </span>
  ));

  const pct = (v: number) => `${v * 100}%`;
  return (
    <div
      className="relative w-full select-none touch-none [-webkit-touch-callout:none]"
      style={{ height, containerType: 'inline-size' }}
      onPointerUp={lift}
      onPointerCancel={lift}
      onPointerLeave={lift}
      role="group"
      aria-label="Clavier de piano"
    >
      {keys.filter(([, k]) => !k.black).map(([m, k]) => {
        const mark = marks?.get(m);
        const down = held.has(m);
        return (
          <div
            key={m}
            onPointerDown={(e) => press(e, m)}
            onPointerEnter={(e) => enter(e, m)}
            className={`absolute top-0 bottom-0 flex flex-col items-center justify-end gap-0.5 rounded-b-md border border-key-line pb-2 font-medium text-key-name transition-colors ${
              mark ? markClass[mark].white : down ? 'bg-key-down' : 'bg-key-white'
            } ${interactive ? 'cursor-pointer' : ''}`}
            style={{ left: pct(k.x), width: pct(k.width), fontSize }}
            title={noteName(m)}
          >
            {stuck(m, false)}
            {label(m)}
          </div>
        );
      })}
      {keys.filter(([, k]) => k.black).map(([m, k]) => {
        const mark = marks?.get(m);
        const down = held.has(m);
        return (
          <div
            key={m}
            onPointerDown={(e) => press(e, m)}
            onPointerEnter={(e) => enter(e, m)}
            className={`absolute top-0 z-10 flex flex-col items-center justify-end gap-0.5 rounded-b-md pb-1.5 font-medium text-[#fff] transition-colors ${
              mark ? markClass[mark].black : down ? 'bg-[#525252]' : 'bg-key-black'
            } ${interactive ? 'cursor-pointer' : ''}`}
            style={{ left: pct(k.x), width: pct(k.width), height: '62%', fontSize }}
            title={noteName(m)}
          >
            {stuck(m, true)}
            {label(m)}
          </div>
        );
      })}
    </div>
  );
}
