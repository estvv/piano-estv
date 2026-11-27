import { stepsHeld, type Hand, type Score, type ScoreNote, type ScorePart } from '@piano/shared';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { ensureAudio, playNote } from '../audio';
import { keyLayout } from '../keyGeometry';
import { handLetter } from './numbers';
import { locate, offsetsOf, type Placed } from './roll';

// Where keys are laid: time goes up from the keyboard, as the notes will fall,
// all the parts one after the other.
// Click an empty place for a note, drag up to hold it; click a note to pick it.
// Shift+drag (or any drag while selecting) draws a box around several notes.
// Notes of an imported piece may be between two columns.

const BEAT = 76; // px
const BAR = 4;
const MIN_HEIGHT = 8; // px
// Moved less than this, it was a click.
const CLICK = 6;
// Drawn around what is seen, in beats.
const AROUND = 12;

const LOOK: Record<Hand, { note: string; picked: string }> = {
  left: { note: 'bg-hand-l-pale text-hand-l-ink', picked: 'bg-hand-l text-hand-l-on ring-2 ring-hand-l-ink' },
  right: { note: 'bg-hand-r-pale text-hand-r-ink', picked: 'bg-hand-r text-hand-r-on ring-2 ring-hand-r-ink' },
};

type Drag =
  | { kind: 'new'; y: number; moved: boolean; to: Placed }
  // Where a part starts, in beats from where it did.
  | { kind: 'edge'; y: number; moved: boolean; index: number; by: number }
  // A box around notes, in px within the sheet (y from the bottom).
  | { kind: 'box'; x0: number; y0: number; x: number; y: number; moved: boolean; add: boolean }
  | { kind: 'move' | 'size'; x: number; y: number; moved: boolean; from: Placed; to: Placed; held: number };

export const otherHand = (hand: Hand): Hand => (hand === 'left' ? 'right' : 'left');
const sameNote = (a: ScoreNote, b: ScoreNote) => a.hand === b.hand && a.step === b.step && a.midi === b.midi;
export const samePlace = (a: Placed | null, b: Placed) => !!a && a.index === b.index && sameNote(a.note, b.note);

export function RollEditor({ parts, division, from, to, hand, length, extend, cursor, playhead, picked, shown, selecting, selection, pasting, onSelect, onPaste, edge, onEdge, onGo, onSeen, onPick, onAdd, onChange, onRemove }: {
  // In the order they are played: the same one may come back.
  parts: ScorePart[];
  division: Score['division'];
  from: number;
  to: number;
  hand: Hand;
  // Of the notes added, in columns.
  length: number;
  // Notes can be laid after the end.
  extend: boolean;
  // Where keys played are written, from the start of the piece; null: they are not.
  cursor: number | null;
  // In columns from the start of the piece; null: not playing.
  playhead: number | null;
  picked: Placed | null;
  // A drag draws a box instead of a note.
  selecting: boolean;
  selection: Placed[];
  // Notes following the pointer, dropped where clicked; null: none.
  pasting: ((at: number) => Placed[]) | null;
  onSelect(notes: Placed[]): void;
  // Columns from the start of the piece, where the first note goes.
  onPaste(at: number): void;
  // The part to go to, every time `times` changes.
  shown: { index: number; times: number };
  // How far the start of a part can be moved, in beats; null: it cannot.
  edge(index: number): [number, number] | null;
  onEdge(index: number, by: number): void;
  // A part's letter was clicked.
  onGo(index: number): void;
  // The part just above the keyboard.
  onSeen(index: number): void;
  onPick(note: Placed | null): void;
  onAdd(note: Placed): void;
  onChange(note: Placed, by: Placed): void;
  onRemove(note: Placed): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Where pasted notes would start, in columns.
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => setHover(null), [pasting]);
  const [height, setHeight] = useState(0);
  // What is seen, in beats, every few of them.
  const [view, setView] = useState(0);
  const step = BEAT / division;
  const offsets = offsetsOf(parts, division);
  const columns = offsets[parts.length];
  // Room above, so that the last part can come down to the keyboard too.
  const last = parts[parts.length - 1];
  const blank = Math.max(BAR, Math.ceil((height / BEAT - last.beats) / BAR) * BAR) * division;
  const total = (columns + blank) * step;
  const layout = keyLayout(from, to);

  // Time starts at the bottom: what is seen stays there when the piece grows.
  const below = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current!;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const place = (px: number, behavior: ScrollBehavior = 'instant') => {
    const el = scroller.current!;
    el.scrollTo({ top: el.scrollHeight - el.clientHeight - px, behavior });
  };
  useLayoutEffect(() => place(below.current), [total, height]);
  useLayoutEffect(() => {
    below.current = offsets[Math.min(shown.index, parts.length - 1)] * step;
    place(below.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.times]);
  const onScroll = () => {
    const el = scroller.current!;
    below.current = Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
    setView(Math.floor(below.current / BEAT / BAR) * BAR);
    onSeen(locate(offsets, (below.current + CLICK) / step).index);
  };
  const follow = playhead ?? cursor;
  const followed = follow === null ? null : Math.floor(follow / division);
  useEffect(() => {
    const el = scroller.current;
    if (!el || followed === null) return;
    const bottom = followed * BEAT;
    if (bottom < below.current - 4 || bottom > below.current + el.clientHeight * 0.55) place(bottom, 'smooth');
  }, [followed]);

  const placeAt = (clientX: number, clientY: number) => {
    const r = sheet.current!.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    let midi: number | null = null;
    for (const [m, b] of layout) if (x >= b.x && x < b.x + b.width && (midi === null || b.black)) midi = m;
    return { midi, at: Math.max(0, Math.floor((r.bottom - clientY) / step)) };
  };
  const hear = (midi: number) => void ensureAudio().then(() => playNote(midi, 0.35)).catch(() => {});
  const inside = (at: number) => Math.max(0, extend ? Math.min(at, columns + blank - 1) : Math.min(at, columns - 1));

  const local = (clientX: number, clientY: number) => {
    const r = sheet.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: r.bottom - clientY };
  };
  const downEmpty = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (pasting) {
      const at = Math.max(0, placeAt(e.clientX, e.clientY).at);
      setHover(null);
      return onPaste(at);
    }
    if (selecting || e.shiftKey) {
      const { x, y } = local(e.clientX, e.clientY);
      sheet.current!.setPointerCapture(e.pointerId);
      return setDrag({ kind: 'box', x0: x, y0: y, x, y, moved: false, add: e.shiftKey || e.ctrlKey || e.metaKey });
    }
    // A click beside them lets go of the notes picked, as of the one picked.
    if (selection.length) return onSelect([]);
    const { midi, at } = placeAt(e.clientX, e.clientY);
    if (midi === null || (!extend && at >= columns)) return;
    const { index, step: s } = locate(offsets, at);
    setDrag({ kind: 'new', y: e.clientY, moved: false, to: { index, note: { hand, midi, step: s, length } } });
    // Fingers scroll: only a mouse draws.
    if (e.pointerType === 'mouse') sheet.current!.setPointerCapture(e.pointerId);
  };
  const downNote = (e: PointerEvent, at: Placed, kind: 'move' | 'size') => {
    if (e.button !== 0) return;
    if (pasting) return;
    e.stopPropagation();
    // One more or one less in the selection.
    if (kind === 'move' && (selecting || e.shiftKey || e.ctrlKey || e.metaKey)) {
      hear(at.note.midi);
      const without = selection.filter((p) => !(p.index === at.index && sameNote(p.note, at.note)));
      return onSelect(without.length < selection.length ? without : [...selection, at]);
    }
    if (selection.length) onSelect([]);
    sheet.current!.setPointerCapture(e.pointerId);
    setDrag({ kind, x: e.clientX, y: e.clientY, moved: false, from: at, to: at, held: stepsHeld(parts[at.index], division, at.note) });
  };
  const downEdge = (e: PointerEvent, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    sheet.current!.setPointerCapture(e.pointerId);
    setDrag({ kind: 'edge', y: e.clientY, moved: false, index, by: 0 });
  };
  const move = (e: PointerEvent) => {
    if (pasting && e.pointerType === 'mouse') setHover(Math.max(0, placeAt(e.clientX, e.clientY).at));
    if (!drag) return;
    if (drag.kind === 'box') {
      const { x, y } = local(e.clientX, e.clientY);
      return setDrag({ ...drag, x, y, moved: drag.moved || Math.hypot(x - drag.x0, y - drag.y0) > CLICK });
    }
    if (drag.kind === 'edge') {
      const range = edge(drag.index);
      if (!range || (!drag.moved && Math.abs(e.clientY - drag.y) <= CLICK)) return;
      return setDrag({ ...drag, moved: true, by: Math.max(range[0], Math.min(range[1], Math.round((drag.y - e.clientY) / BEAT))) });
    }
    const far = Math.abs(e.clientY - drag.y) > CLICK || (drag.kind !== 'new' && Math.abs(e.clientX - drag.x) > CLICK);
    if (!drag.moved && !far) return;
    const to = (index: number, note: ScoreNote) => setDrag({ ...drag, moved: true, to: { index, note } });
    if (drag.kind === 'new') {
      if (e.pointerType !== 'mouse') return setDrag(null);
      const { index, note } = drag.to;
      return to(index, { ...note, length: Math.max(1, placeAt(e.clientX, e.clientY).at - offsets[index] - note.step + 1) });
    }
    const by = Math.round((drag.y - e.clientY) / step);
    const { index, note } = drag.from;
    if (drag.kind === 'size') return to(index, { ...note, length: by ? Math.max(1, drag.held + by) : drag.held });
    const midi = placeAt(e.clientX, e.clientY).midi ?? note.midi;
    if (!by) return to(index, { ...note, midi, length: drag.held });
    const there = locate(offsets, inside(offsets[index] + note.step + by));
    to(there.index, { ...note, midi, step: there.step, length: drag.held });
  };
  const up = () => {
    if (!drag) return;
    setDrag(null);
    if (drag.kind === 'box') {
      if (!drag.moved) return drag.add ? undefined : onSelect([]);
      const inBox = boxed(drag);
      if (inBox.length) onPick(null);
      return onSelect(drag.add ? [...selection, ...inBox.filter((a) => !selection.some((p) => p.index === a.index && sameNote(p.note, a.note)))] : inBox);
    }
    if (drag.kind === 'edge') {
      if (!drag.moved) onGo(drag.index);
      else if (drag.by) onEdge(drag.index, drag.by);
      return;
    }
    if (drag.kind === 'new') {
      if (picked && !drag.moved) return onPick(null);
      hear(drag.to.note.midi);
      return onAdd(drag.to);
    }
    if (!drag.moved) {
      hear(drag.from.note.midi);
      return onPick(samePlace(picked, drag.from) ? null : drag.from);
    }
    if (drag.to.note.midi !== drag.from.note.midi) hear(drag.to.note.midi);
    onChange(drag.from, drag.to);
  };

  const box = ({ index, note }: Placed) => {
    const b = layout.get(note.midi);
    if (!b) return null;
    const inset = b.black ? 0.04 : 0.14;
    return {
      left: `${(b.x + b.width * inset) * 100}%`, width: `${b.width * (1 - 2 * inset) * 100}%`,
      bottom: (offsets[index] + note.step) * step + 1, height: Math.max(MIN_HEIGHT, stepsHeld(parts[index], division, note) * step - 2),
    };
  };
  // Every note the box touches, seen or not.
  const boxed = (b: Extract<Drag, { kind: 'box' }>): Placed[] => {
    const width = sheet.current!.getBoundingClientRect().width;
    const [left, right] = [Math.min(b.x0, b.x) / width, Math.max(b.x0, b.x) / width];
    const [bottom, top] = [Math.min(b.y0, b.y), Math.max(b.y0, b.y)];
    return parts.flatMap((p, index) => p.notes.flatMap((note) => {
      const k = layout.get(note.midi);
      if (!k) return [];
      const start = (offsets[index] + note.step) * step;
      const end = start + Math.max(MIN_HEIGHT, stepsHeld(p, division, note) * step);
      return k.x < right && k.x + k.width > left && start < top && end > bottom ? [{ index, note }] : [];
    }));
  };
  const selected = (at: Placed) => selection.some((p) => p.index === at.index && sameNote(p.note, at.note));
  const ghosts = pasting && hover !== null ? pasting(hover) : [];
  const number = ({ index, note }: Placed) => parts[index].keys.find((k) => k.hand === note.hand && k.midi === note.midi)?.number;

  const low = Math.max(0, view - AROUND) * division;
  const high = Math.min(columns + blank, (view + Math.ceil(height / BEAT) + AROUND) * division);
  const lines: { at: number; local: number; after: boolean }[] = [];
  for (let at = low; at < high; at++) {
    const there = locate(offsets, at);
    lines.push({ at, local: there.step, after: at >= columns });
  }
  const notes = parts.flatMap((p, index) => (offsets[index] >= high ? [] : p.notes.flatMap((note, i) => {
    const place: Placed = { index, note };
    const to = drag && (drag.kind === 'move' || drag.kind === 'size') && samePlace(drag.from, place) ? drag.to : place;
    const start = offsets[to.index] + to.note.step;
    const seen = start < high && start + stepsHeld(parts[to.index], division, to.note) > low;
    return seen || to !== place || samePlace(picked, place) ? [{ id: `${index}-${i}`, place, to }] : [];
  })));
  const draft = drag?.kind === 'new' ? box(drag.to) : null;

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-white [overflow-anchor:none] [scrollbar-width:none]">
      <div
        ref={sheet}
        onPointerDown={downEmpty}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
        className={`relative w-full shrink-0 select-none overflow-hidden ${pasting ? 'cursor-copy' : 'cursor-crosshair'} ${selecting || pasting ? 'touch-none' : 'touch-pan-y'}`}
        style={{ height: total }}
      >
        {[...layout].filter(([, b]) => b.black).map(([m, b]) => (
          <div key={m} className="pointer-events-none absolute inset-y-0 bg-neutral-50" style={{ left: `${b.x * 100}%`, width: `${b.width * 100}%` }} />
        ))}
        {[...layout].filter(([m]) => m % 12 === 0).map(([m, b]) => (
          <div key={m} className="pointer-events-none absolute inset-y-0 w-px bg-neutral-200" style={{ left: `${b.x * 100}%` }} />
        ))}
        {lines.map(({ at, local, after }) => (
          <div
            key={at}
            className={`pointer-events-none absolute inset-x-0 border-t ${local % (BAR * division) === 0 ? 'border-neutral-400' : local % division === 0 ? 'border-neutral-200' : 'border-neutral-100'}`}
            style={{ bottom: at * step - 1 }}
          >
            {local % division === 0 && <span className="absolute -top-4 left-1 text-[10px] tabular-nums text-neutral-400">{((local / division) % BAR) + 1}</span>}
            {after && at === columns && <span className="absolute -top-5 left-6 text-[11px] text-neutral-400">Fin</span>}
          </div>
        ))}
        <div className="pointer-events-none absolute inset-x-0 bg-neutral-100/60" style={{ bottom: columns * step, height: blank * step }} />
        {cursor !== null && <div className="pointer-events-none absolute inset-x-0 bg-neutral-900/10" style={{ bottom: cursor * step, height: step }} />}

        {notes.map(({ id, place: at, to: drawn }) => {
          const b = box(drawn);
          if (!b) return null;
          const on = samePlace(picked, at);
          const chosen = !on && selected(at);
          const { hand: own } = at.note;
          const other = otherHand(own);
          const toOther = `Passer à la main ${other === 'left' ? 'gauche' : 'droite'}`;
          return (
            <div
              key={id}
              onPointerDown={(e) => downNote(e, at, 'move')}
              className={`absolute flex touch-none items-end justify-center rounded-md pb-0.5 text-sm font-bold leading-none ${on ? `z-10 ${LOOK[own].picked}` : chosen ? `z-10 ${LOOK[own].picked} ring-neutral-900` : LOOK[own].note}`}
              style={b}
            >
              {number(drawn)}
              {on && (
                <>
                  <span
                    onPointerDown={(e) => downNote(e, at, 'size')}
                    title="Tirer pour tenir la note plus ou moins longtemps"
                    className="absolute -top-2 left-1/2 h-4 w-8 -translate-x-1/2 cursor-ns-resize touch-none rounded-full border-2 border-white bg-neutral-900"
                  />
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onRemove(at)}
                    title="Supprimer (Suppr)"
                    aria-label="Supprimer la note"
                    className="absolute -right-9 bottom-0 flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm text-red-600 shadow ring-1 ring-neutral-200 hover:bg-red-50"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onChange(at, { index: at.index, note: { ...at.note, hand: other } })}
                    title={`${toOther} (H)`}
                    aria-label={toOther}
                    className="absolute -left-9 bottom-0 flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm text-neutral-700 shadow ring-1 ring-neutral-200 hover:bg-neutral-100"
                  >
                    {handLetter(other)}
                  </button>
                </>
              )}
            </div>
          );
        })}
        {/* Where parts start. */}
        {parts.map((p, index) => {
          const dragged = drag?.kind === 'edge' && drag.index === index;
          const at = offsets[index] + (dragged ? drag.by * division : 0);
          if (!dragged && (at < low || at >= high)) return null;
          const movable = edge(index) !== null;
          return (
            <div key={index} className={`pointer-events-none absolute inset-x-0 z-10 border-t-2 ${dragged ? 'border-neutral-900' : 'border-neutral-500'}`} style={{ bottom: at * step - 1 }}>
              <button
                type="button"
                onPointerDown={(e) => downEdge(e, index)}
                onClick={(e) => e.detail === 0 && onGo(index)}
                title={movable ? `Glisser pour changer le début de la partie ${p.label}` : `Partie ${p.label}`}
                className={`pointer-events-auto absolute -top-9 right-2 flex h-8 min-w-8 touch-none items-center justify-center gap-1 rounded-lg px-2 text-sm font-bold shadow-sm ring-1 ${movable ? 'cursor-ns-resize' : 'cursor-pointer'} ${dragged ? 'bg-neutral-900 text-white ring-neutral-900' : 'bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-100'}`}
              >
                {p.label}
                {movable && <span aria-hidden className="text-xs font-normal opacity-50">↕</span>}
              </button>
            </div>
          );
        })}
        {drag?.kind === 'box' && drag.moved && (
          <div
            className="pointer-events-none absolute z-30 rounded-sm border border-neutral-900/60 bg-neutral-900/10"
            style={{ left: Math.min(drag.x0, drag.x), width: Math.abs(drag.x - drag.x0), bottom: Math.min(drag.y0, drag.y), height: Math.abs(drag.y - drag.y0) }}
          />
        )}
        {ghosts.map((g, i) => {
          const b = box(g);
          return b && <div key={i} className={`pointer-events-none absolute z-20 rounded-md opacity-60 ring-2 ring-neutral-900 ${LOOK[g.note.hand].note}`} style={b} />;
        })}
        {draft && <div className={`pointer-events-none absolute rounded-md opacity-70 ${LOOK[hand].note}`} style={draft} />}
        {playhead !== null && <div className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-neutral-900" style={{ bottom: playhead * step }} />}
      </div>
    </div>
  );
}
