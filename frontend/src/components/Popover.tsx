import { useEffect, useRef, useState, type ReactNode } from 'react';

// A button and the small panel it opens under itself.
export function Popover({ label, title, className, align = 'right', width = 'w-72', children }: {
  label: ReactNode;
  title?: string;
  // Of the button.
  className: string;
  align?: 'left' | 'right';
  width?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} title={title} aria-label={title} className={className}>{label}</button>
      {open && (
        <div
          className={`absolute top-full z-20 mt-2 max-h-[75dvh] max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-xl ${width} ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
