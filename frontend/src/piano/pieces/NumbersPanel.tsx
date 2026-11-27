import { memo, useEffect, useRef } from 'react';
import { SidePanel } from '../../components/SidePanel';
import { CopyButton, litSteps, PartLetter, Small, TEXT } from './Numbers';
import { Notebook } from './Notebook';
import { compactLines, compactText, handLetter, pieceText, type Part } from './numbers';
import { RecentreButton, useFollow } from './useFollow';
import type { PieceSequence } from './types';

// The piece as one writes it down to learn it: its parts one under the other,
// each hand's numbers close together and aligned.

const LINE = 26; // characters
// Wider while writing: the text and what it is written from.
const WRITING_WIDTH = 460;

export function NumbersPanel({ title, parts, part: current, position, loop, open, over, writing, onWriting, pieceId, written, onWrite, onToggle, onSeek, onLoop, onDetail, onOwn, onOpen }: {
  title: string;
  parts: Part[];
  // Where the piece is.
  part: number;
  position: number;
  loop: [number, number] | null;
  open: boolean;
  // Over the notes (small screens) instead of beside them.
  over: boolean;
  // Writing the keys down (Notebook.tsx), or reading them.
  writing: boolean;
  onWriting(on: boolean): void;
  pieceId: number;
  written: PieceSequence | null;
  onWrite(next: PieceSequence | null, id: number): void;
  onToggle(): void;
  onSeek(time: number): void;
  // Null: stop looping.
  onLoop(part: number | null): void;
  onDetail(): void;
  // Which key each number is; left out where the numbers are the owner's already.
  onOwn?(): void;
  onOpen(open: boolean): void;
}) {
  const follow = useFollow<HTMLDivElement>();
  const latest = useRef(onSeek);
  latest.current = onSeek;
  const seek = useRef((time: number) => latest.current(time)).current;

  // The part played stays in view, unless scrolled away from by hand.
  const { el, free, scrollTo } = follow;
  useEffect(() => {
    const target = open && !free ? el?.querySelector(`[data-part="${current}"]`) : null;
    if (!el || !target) return;
    // Not scrollIntoView: it would also scroll the panel while it slides.
    const [view, at] = [el.getBoundingClientRect(), target.getBoundingClientRect()];
    if (at.top < view.top || at.bottom > view.bottom) scrollTo({ top: el.scrollTop + at.top - view.top - 8, behavior: 'smooth' });
  }, [current, open, el, free, scrollTo]);

  const body = (
    <>
      {parts.map((p, i) => {
        const looped = loop !== null && i >= loop[0] && i <= loop[1];
        return (
          <section key={i} data-part={i} className="flex gap-2 py-2.5">
            <div className="w-9 shrink-0">
              <PartLetter label={p.label} on={looped} current={i === current} onClick={() => onLoop(looped ? null : i)} />
            </div>
            <div className="min-w-0 flex-1 pt-1"><Lines part={p} lit={i === current ? litSteps(p, position) : ''} onSeek={seek} /></div>
          </section>
        );
      })}
    </>
  );
  return (
    <SidePanel label="Chiffres" open={open} over={over} onOpen={onOpen} wide={writing ? WRITING_WIDTH : undefined}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-1 px-2 py-2">
          <Small active={writing} onClick={() => onWriting(!writing)} title="Écrire l’ordre des touches de chaque main, pendant que le morceau joue">Écrire</Small>
          {!writing && <CopyButton text={() => pieceText(title, parts, compactText)} />}
          {onOwn && <Small onClick={onOwn} title="Choisir le numéro de chaque touche">Numéros</Small>}
          <Small onClick={onDetail} title="Les chiffres placés sur les temps, pour lire le rythme ou corriger les parties">Voir le rythme</Small>
        </div>
        {writing ? (
          <div className="min-h-0 flex-1"><Notebook
            key={pieceId}
            parts={parts}
            current={current}
            position={position}
            looped={loop !== null && loop[0] === current && loop[1] === current}
            written={written}
            onWrite={(next) => onWrite(next, pieceId)}
            onToggle={onToggle}
            onSeek={seek}
            onLoop={() => onLoop(loop !== null && loop[0] === current && loop[1] === current ? null : current)}
          /></div>
        ) : (
          <div className="relative min-h-0 flex-1">
            <div ref={follow.ref} className="h-full overflow-y-auto overscroll-contain px-4 pb-4 [scrollbar-width:thin]">{body}</div>
            <RecentreButton free={free} onClick={follow.recentre} />
          </div>
        )}
      </div>
    </SidePanel>
  );
}

const Lines = memo(function Lines({ part, lit, onSeek }: { part: Part; lit: string; onSeek(time: number): void }) {
  const on = lit ? lit.split(',') : [];
  if (!part.rows.length) return <p className="text-sm text-neutral-300">Silence</p>;
  return (
    <div className="space-y-3 font-mono text-[13px] leading-[1.5]">
      {compactLines(part, LINE).map((line, k) => (
        <div key={k} className="overflow-x-auto [scrollbar-width:none]">
          {part.rows.map((row, r) => (
            <div key={row.hand} className="flex whitespace-pre">
              <span className="shrink-0 text-neutral-400">{handLetter(row.hand)}  </span>
              {line.map((m) => (
                <span key={m.step} className="shrink-0" style={{ width: `${m.width}ch` }}>
                  {m.texts[r] && (
                    <button
                      type="button"
                      onClick={() => onSeek(m.time)}
                      className={`rounded-sm hover:underline ${TEXT[row.hand]} ${on.includes(`${r}:${m.step}`) ? `font-bold ${row.hand === 'left' ? 'bg-hand-l-pale' : 'bg-hand-r-pale'}` : ''}`}
                    >
                      {m.texts[r]}
                    </button>
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});
