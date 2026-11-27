import type { Hand } from '@piano/shared';
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { BEATS_PER_BAR } from './grid';
import { inRange, rangeOf, type Range } from './gridClip';
import { breakLines, lineWidth, type Sizing } from './numberLines';
import { handLetter, stepText, type Part } from './numbers';
import { HANDS } from './score';

// A part's grid with every cell there to be filled: the hands one above the
// other, time going right.

const SIZING: Sizing = { font: 16, char: 10.5, min: 32, beat: 64, cap: 120 };
const PHONE: Sizing = { font: 15, char: 10, min: 25, beat: 50, cap: 110 };

export interface Cell {
  hand: Hand;
  step: number;
}

const LOOK: Record<Hand, { text: string; on: string; lit: string; range: string }> = {
  left: { text: 'text-hand-l-ink', on: 'ring-hand-l bg-hand-l-soft', lit: 'bg-hand-l-pale', range: 'bg-hand-l-soft' },
  right: { text: 'text-hand-r-ink', on: 'ring-hand-r bg-hand-r-soft', lit: 'bg-hand-r-pale', range: 'bg-hand-r-soft' },
};

export function EditGrid({ part, selected, range, column, small, onSelect, onRange }: {
  part: Part;
  selected: Cell | null;
  // Several cells: dragged over with the mouse, or Shift and a click.
  range: Range | null;
  // Being played; -1: none.
  column: number;
  small: boolean;
  onSelect(cell: Cell): void;
  onRange(range: Range | null): void;
}) {
  const from = useRef<Cell | null>(null);
  // The cell under the pointer, whichever line it is on.
  const under = (e: PointerEvent): Cell | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-cell]');
    const found = /^(left|right)(\d+)$/.exec(el?.dataset.cell ?? '');
    return found ? { hand: found[1] as Hand, step: Number(found[2]) } : null;
  };
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sizing = small ? PHONE : SIZING;
  const lines = useMemo(() => breakLines(part, width - 24, sizing), [part, width, sizing]);
  const texts = useMemo(() => {
    const out = new Map<string, string>();
    for (const row of part.rows) for (const s of row.steps) out.set(`${row.hand}${s.step}`, stepText(s));
    return out;
  }, [part]);
  const bar = BEATS_PER_BAR * part.division;

  return (
    <div
      ref={box}
      style={{ fontSize: sizing.font }}
      className="select-none"
      onPointerDown={(e) => {
        // Fingers scroll.
        from.current = e.pointerType === 'mouse' && e.button === 0 && !e.shiftKey ? under(e) : null;
      }}
      onPointerMove={(e) => {
        const start = from.current;
        if (!start || !(e.buttons & 1)) return;
        const now = under(e);
        if (now && (range || now.hand !== start.hand || now.step !== start.step)) onRange(rangeOf(start, now));
      }}
      onPointerUp={() => {
        from.current = null;
      }}
    >
      {lines.map((line) => (
        <div key={line.from} className="mb-3 flex">
          <div className="grid w-6 shrink-0 font-semibold" style={{ gridTemplateRows: '0.6em repeat(2, 2.3em)' }}>
            <span />
            {HANDS.map((h) => <span key={h} className={`self-center text-[0.75em] ${LOOK[h].text}`}>{handLetter(h)}</span>)}
          </div>
          <div
            className="grid min-w-0 flex-1 tabular-nums"
            style={{
              gridTemplateColumns: line.widths.map((w) => `minmax(${w}px, 1fr)`).join(' '),
              gridTemplateRows: '0.6em repeat(2, 2.3em)',
              maxWidth: lineWidth(line, part, sizing),
            }}
          >
            {line.widths.map((_, c) => {
              const at = line.from + c;
              if (at % part.division !== 0) return null;
              const now = column >= 0 && Math.floor(column / part.division) === at / part.division;
              return <span key={c} className={`mx-auto rounded-full ${now ? 'h-1.5 w-1.5 bg-neutral-900' : 'h-1 w-1 bg-neutral-200'}`} style={{ gridColumn: c + 1, gridRow: 1 }} />;
            })}
            {HANDS.map((hand, r) => line.widths.map((_, c) => {
              const step = line.from + c;
              const text = texts.get(`${hand}${step}`) ?? '';
              const on = selected?.hand === hand && selected.step === step;
              // Bars and beats show in the cells' left edge.
              const edge = step % bar === 0 ? 'border-l-neutral-400' : step % part.division === 0 ? 'border-l-neutral-200' : 'border-l-neutral-100';
              return (
                <button
                  key={`${hand}${c}`}
                  type="button"
                  data-cell={`${hand}${step}`}
                  aria-label={`${hand === 'left' ? 'Gauche' : 'Droite'}, colonne ${step + 1}${text ? ` : ${text}` : ''}`}
                  aria-pressed={on}
                  // Already picked: what is being typed keeps the focus.
                  onMouseDown={(e) => on && e.preventDefault()}
                  onClick={(e) => {
                    if (e.shiftKey && selected) return onRange(rangeOf(selected, { hand, step }));
                    onRange(null);
                    onSelect({ hand, step });
                  }}
                  className={`flex items-center justify-center whitespace-nowrap border-y border-l border-y-neutral-200 font-semibold leading-none ${edge} ${LOOK[hand].text} ${
                    on ? `relative z-10 rounded-sm ring-2 ring-inset ${LOOK[hand].on}` : inRange(range, hand, step) ? LOOK[hand].range : step === column && text ? LOOK[hand].lit : 'hover:bg-neutral-50'
                  }`}
                  style={{ gridColumn: c + 1, gridRow: r + 2 }}
                >
                  {text}
                </button>
              );
            }))}
          </div>
        </div>
      ))}
    </div>
  );
}
