import type { LyricLine } from '@piano/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { filled, sungAt, sungLines, type SungLine } from './lyrics';
import type { PiecePlayer } from './player';

// The line sung now, filled word after word, and the next one, which comes up in
// its place. Above the notes.

// The words not sung yet, then those that are.
const FILL = 'linear-gradient(90deg, var(--color-sky-600) var(--sung, 0%), var(--color-neutral-800) var(--sung, 0%))';
// A wait this long before a line is counted down (seconds).
const WAIT = 4;
const COUNT = 3;
// The last line stays a little (seconds).
const LINGER = 1.5;
const lastWord = (lines: SungLine[]) => lines.reduce((end, l) => (l.words.length ? Math.max(end, l.end) : end), 0);

type Place = 'gone' | 'now' | 'next' | 'later';
const PLACES: Record<Place, string> = {
  gone: '-translate-y-full scale-95 opacity-0',
  now: 'translate-y-0 scale-100 opacity-100',
  next: 'translate-y-8 scale-[.68] opacity-45',
  later: 'translate-y-14 scale-[.6] opacity-0',
};
// Only room for one.
const SHORT: Record<Place, string> = { ...PLACES, next: 'translate-y-full scale-95 opacity-0' };

export function LyricsBanner({ lines, player, short }: { lines: LyricLine[]; player: PiecePlayer; short: boolean }) {
  const sung = useMemo(() => sungLines(lines), [lines]);
  const [now, setNow] = useState(() => sungAt(sung, player.position));
  // Seconds before the next line, after a rest; dots are shown instead of the
  // line that is over.
  const [count, setCount] = useState(0);
  // No more words: no more banner.
  const [over, setOver] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Every picture: smoother than the rest of the page.
  useEffect(() => {
    let raf = 0;
    const end = lastWord(sung) + LINGER;
    const draw = () => {
      const time = player.position;
      const at = sungAt(sung, time);
      setNow(at);
      setOver(time > end);
      const next = sung[at + 1];
      const rest = sung[at]?.text ? sung[at].end : at < 0 ? 0 : sung[at].time;
      const left = next ? next.time - time : Infinity;
      setCount(next?.text && next.time - rest >= WAIT && left <= COUNT ? Math.ceil(left) : 0);
      const words = box.current?.querySelectorAll<HTMLElement>(`[data-line="${at}"] [data-word]`);
      words?.forEach((el, i) => el.style.setProperty('--sung', `${(filled(sung[at].words[i], time) * 100).toFixed(1)}%`));
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [player, sung]);

  const places = short ? SHORT : PLACES;
  const shown: [number, Place][] = [[now - 1, 'gone'], [now, 'now'], [now + 1, 'next'], [now + 2, 'later']];
  return (
    <div className={`relative shrink-0 overflow-hidden bg-white px-4 transition-[height,opacity] duration-500 motion-reduce:transition-none ${over ? 'h-0 opacity-0' : `border-t border-neutral-100 ${short ? 'h-9' : 'h-19'}`}`}>
      <div ref={box} className={`relative h-full ${short ? 'pt-0.5' : 'pt-2'}`}>
        {shown.map(([i, place]) => sung[i] && (
          <div
            key={i}
            data-line={i}
            aria-hidden={place !== 'now' && place !== 'next'}
            className={`absolute inset-x-0 origin-top transition-[transform,opacity,translate,scale] duration-300 ease-out motion-reduce:transition-none ${places[place === 'now' && count > 0 ? 'gone' : place]}`}
          >
            <Line line={sung[i]} now={place === 'now' || place === 'gone'} short={short} />
          </div>
        ))}
      </div>
      {count > 0 && (
        <div className={`pointer-events-none absolute inset-x-0 flex justify-center gap-1.5 ${short ? 'top-3.5' : 'top-5'}`} aria-hidden>
          {Array.from({ length: COUNT }, (_, i) => (
            <span key={i} className={`h-2 w-2 rounded-full transition-colors ${i < COUNT - count + 1 ? 'bg-sky-600' : 'bg-neutral-200'}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// On one row, whatever its length.
function Line({ line, now, short }: { line: SungLine; now: boolean; short: boolean }) {
  const row = useRef<HTMLParagraphElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = row.current!;
    const measure = () => setScale(Math.min(1, el.parentElement!.clientWidth / Math.max(1, el.scrollWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el.parentElement!);
    return () => observer.disconnect();
  }, [line, short]);
  return (
    <div className="flex justify-center">
      <p ref={row} style={{ transform: `scale(${scale})` }} className={`shrink-0 origin-center whitespace-pre font-semibold ${short ? 'text-lg leading-8' : 'text-2xl leading-9'}`}>
        {line.words.length ? line.words.map((w, i) => (
          <span key={i}>
            {i > 0 && ' '}
            {/* Only the line being sung is filled. */}
            <span data-word style={now ? { backgroundImage: FILL, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' } : { color: 'var(--color-neutral-800)' }}>{w.text}</span>
          </span>
        )) : '\u00a0'}
      </p>
    </div>
  );
}
