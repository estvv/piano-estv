import type { PieceTrack } from '@piano/shared';
import { useMemo, useRef, type ReactNode } from 'react';
import type { Section } from './sections';

// The pieces of the player's toolbar, laid out by PlayAlong: one row on a
// computer, spread around the screen on a phone.

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const controlIcon = 'h-4 w-4';

export function ControlButton({ title, active, pressed, onClick, children }: {
  title: string;
  active?: boolean;
  // For the buttons that stay on or off.
  pressed?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      className={`flex shrink-0 items-center justify-center rounded-lg transition-colors h-8 w-8 compact:h-10 compact:w-10 ${
        active ? 'bg-sky-100 text-sky-700 hover:bg-sky-200' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
      }`}
    >
      {children}
    </button>
  );
}

export function PlayButton({ playing, onClick }: { playing: boolean; onClick(): void }) {
  const title = playing ? 'Pause (Espace)' : 'Lecture (Espace)';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-800 h-9 w-9 compact:h-10 compact:w-10`}
    >
      {playing
        ? <svg viewBox="0 0 24 24" className={controlIcon} fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        : <svg viewBox="0 0 24 24" className={`ml-0.5 ${controlIcon}`} fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>}
    </button>
  );
}

export function SkipButton({ title, flip, onClick }: { title: string; flip?: boolean; onClick(): void }) {
  return (
    <ControlButton title={title} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="currentColor" className={`${controlIcon} ${flip ? '-scale-x-100' : ''}`} aria-hidden><path d="M5 5.3v13.4a.8.8 0 0 0 1.2.7l10.3-6.7a.8.8 0 0 0 0-1.4L6.2 4.6a.8.8 0 0 0-1.2.7Z" /><rect x="17" y="4.5" width="2.5" height="15" rx="1" /></svg>
    </ControlButton>
  );
}

// Three sliders.
export const SlidersIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className={className} aria-hidden>
    <path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="1.6" fill="currentColor" /><circle cx="15" cy="12" r="1.6" fill="currentColor" /><circle cx="7" cy="18" r="1.6" fill="currentColor" />
  </svg>
);

// Progress bar cut into the piece's sections (A B A C…): click or drag to
// move, double-click a section to loop it, Shift+click to extend the loop.
export function Timeline({ sections, start, end, position, loop, onSeek, onLoop, sectionAt }: {
  sections: Section[];
  // Played part of the piece, in seconds.
  start: number;
  end: number;
  position: number;
  loop: [number, number] | null;
  onSeek(t: number): void;
  onLoop(index: number, extend: boolean): void;
  sectionAt(t: number): number;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const segments = sections.length > 1 ? sections : [{ start, end, label: '' }];
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (end - start) + start;
  };
  const progress = end > start ? Math.min(100, Math.max(0, ((position - start) / (end - start)) * 100)) : 0;

  return (
    <div
      ref={bar}
      className="relative flex h-7 min-w-0 flex-1 cursor-pointer touch-none select-none gap-0.5 compact:h-8"
      onPointerDown={(e) => {
        if (e.shiftKey && sections.length > 1) return onLoop(sectionAt(at(e.clientX)), true);
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onSeek(at(e.clientX));
      }}
      onPointerMove={(e) => dragging.current && onSeek(at(e.clientX))}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onDoubleClick={(e) => sections.length > 1 && onLoop(sectionAt(at(e.clientX)), false)}
    >
      {segments.map((s, i) => {
        const length = Math.min(end, s.end) - Math.max(start, s.start);
        if (length <= 0) return null;
        const looped = loop !== null && i >= loop[0] && i <= loop[1];
        return (
          <div
            key={i}
            title={s.label ? `Partie ${s.label} · ${clock(Math.max(0, s.start - start))} – ${clock(Math.min(end, s.end) - start)}` : undefined}
            style={{ flexGrow: length, flexBasis: 0 }}
            className={`flex min-w-0 items-center justify-center overflow-hidden rounded text-[10px] font-semibold ${
              looped ? 'bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-300' : 'bg-neutral-100 text-neutral-400'
            }`}
          >
            {s.label}
          </div>
        );
      })}
      {/* Played part, then the playhead. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l bg-neutral-900/10" style={{ width: `${progress}%` }} />
      <div className="pointer-events-none absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded bg-neutral-900" style={{ left: `${progress}%` }} />
    </div>
  );
}

interface TracksProps {
  tracks: PieceTrack[];
  notes: { track?: number }[];
  enabled: boolean[];
  onChange(enabled: boolean[]): void;
}

// The instruments of a multi-track file, each one on or off (at least one on).
export function TrackList({ tracks, notes, enabled, onChange }: TracksProps) {
  const counts = useMemo(() => {
    const c = tracks.map(() => 0);
    for (const n of notes) if (n.track !== undefined && n.track < c.length) c[n.track]++;
    return c;
  }, [tracks, notes]);
  const on = enabled.filter(Boolean).length;

  return (
    <>
      {tracks.map((t, i) => {
        const last = enabled[i] && on === 1;
        return (
          <label
            key={i}
            title={last ? 'Il faut garder au moins une piste' : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 compact:py-2.5 ${last ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-neutral-50'}`}
          >
            <input
              type="checkbox"
              checked={enabled[i]}
              disabled={last}
              onChange={() => onChange(enabled.map((e, k) => (k === i ? !e : e)))}
              className="h-4 w-4 shrink-0 accent-neutral-900"
            />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${enabled[i] ? 'font-medium text-neutral-900' : 'text-neutral-400'}`}>{t.name}</span>
              {t.instrument && t.instrument.toLowerCase() !== t.name.toLowerCase() && (
                <span className="block truncate text-xs text-neutral-400">{t.instrument}</span>
              )}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-neutral-400">{counts[i]} notes</span>
          </label>
        );
      })}
    </>
  );
}
