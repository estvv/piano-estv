import { useRef, useState, type ReactNode } from 'react';

const WIDTH = 336;
// Moved less than this, the handle was clicked.
const CLICK = 5;

// A panel on the right that slides in and out: drag its handle, or click it.
export function SidePanel({ label, open, over, onOpen, children, wide = WIDTH }: {
  label: string;
  // Px, when open.
  wide?: number;
  open: boolean;
  // Over what is beside it (small screens) instead of pushing it.
  over: boolean;
  onOpen(open: boolean): void;
  children: ReactNode;
}) {
  // While dragged: how much of it shows, px.
  const [dragged, setDragged] = useState<number | null>(null);
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);

  const full = () => Math.min(wide, window.innerWidth - 48);
  const width = dragged !== null ? `${dragged}px` : open ? `min(${wide}px, 100vw - 48px)` : '0px';
  const title = open ? `Fermer : ${label.toLowerCase()}` : `Ouvrir : ${label.toLowerCase()}`;

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragged(null);
    if (!d?.moved) return;
    skipClick.current = true;
    const shown = Math.min(full(), Math.max(0, d.width - (e.clientX - d.x)));
    // A short pull is enough, the way it was going.
    const pull = shown - d.width;
    onOpen(Math.abs(pull) > 40 ? pull > 0 : open);
  };

  return (
    <aside
      aria-label={label}
      className={`z-10 shrink-0 ${over ? 'absolute inset-y-0 right-0' : 'relative'} ${dragged === null ? 'transition-[width] duration-300 ease-out' : ''}`}
      style={{ width }}
    >
      <button
        type="button"
        aria-expanded={open}
        title={title}
        aria-label={title}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          skipClick.current = false;
          drag.current = { x: e.clientX, width: open ? full() : 0, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const by = e.clientX - d.x;
          if (!d.moved && Math.abs(by) < CLICK) return;
          d.moved = true;
          setDragged(Math.min(full(), Math.max(0, d.width - by)));
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          drag.current = null;
          setDragged(null);
        }}
        onClick={() => {
          if (skipClick.current) skipClick.current = false;
          else onOpen(!open);
        }}
        className={`absolute right-full top-1/3 flex w-7 -translate-y-1/2 cursor-grab touch-none select-none flex-col items-center justify-center gap-2 rounded-l-xl border border-r-0 border-neutral-200 bg-white text-neutral-500 transition-colors hover:text-neutral-900 active:cursor-grabbing ${open ? 'h-16' : 'h-32'}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} aria-hidden><path d="m15 6-6 6 6 6" /></svg>
        {!open && <span className="rotate-180 text-xs font-medium [writing-mode:vertical-rl]">{label}</span>}
      </button>
      <div className={`h-full overflow-hidden bg-white ${open || dragged !== null ? 'border-l border-neutral-200' : ''} ${over && open ? 'shadow-xl' : ''}`}>
        {/* Its own width: the content does not reflow while sliding. */}
        <div inert={!open} className="h-full" style={{ width: `min(${wide}px, 100vw - 48px)` }}>{children}</div>
      </div>
    </aside>
  );
}
