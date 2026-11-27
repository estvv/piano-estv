import { useRef, useState, type PointerEvent } from 'react';

// The order parts are played in: click one to pick it, drag it elsewhere.

// Moved less than this, it was a click.
const CLICK = 6; // px

export function OrderChips({ order, selected, onPick, onMove }: {
  order: string[];
  selected: number | null;
  onPick(index: number): void;
  // Null: they stay where they are.
  onMove: ((from: number, to: number) => void) | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; x: number; y: number; moved: boolean } | null>(null);
  // As they would be once dropped.
  const shown = order.map((label, index) => ({ label, index }));
  if (drag) shown.splice(drag.to, 0, ...shown.splice(drag.from, 1));

  const move = (e: PointerEvent) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= CLICK) return;
    if (!drag.moved) box.current!.setPointerCapture(e.pointerId);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-order]');
    const to = over && box.current!.contains(over) ? Number(over.dataset.order) : drag.to;
    setDrag({ ...drag, moved: true, to });
  };
  const up = () => {
    setDrag(null);
    if (drag?.moved && drag.from !== drag.to) onMove?.(drag.from, drag.to);
  };

  return (
    <div ref={box} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} className="flex flex-wrap items-center gap-1">
      {shown.map(({ label, index }, place) => {
        const dragged = !!drag?.moved && drag.from === index;
        return (
          <button
            key={index}
            type="button"
            data-order={place}
            onPointerDown={(e) => onMove && e.button === 0 && setDrag({ from: index, to: index, x: e.clientX, y: e.clientY, moved: false })}
            onClick={() => onPick(index)}
            aria-pressed={selected === index}
            title={onMove ? 'Glisser pour changer sa place' : undefined}
            className={`h-8 min-w-8 select-none rounded-lg px-2 text-sm font-semibold ${onMove ? 'touch-none' : ''} ${dragged ? 'cursor-grabbing bg-neutral-900 text-white shadow-lg' : selected === index ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
