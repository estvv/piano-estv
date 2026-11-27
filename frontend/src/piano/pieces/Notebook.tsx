import type { Hand } from '@piano/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { compare, expectedKeys, writtenKeys, type Gap } from './anomalies';
import { TEXT } from './Numbers';
import type { Part, Step } from './numbers';
import { sequenceSaid, sequenceText } from './sequence';
import { RecentreButton, useFollow } from './useFollow';
import type { PieceSequence } from './types';
import { readJson, writeJson } from '../../lib/storage';

// Writing down each hand's keys while the piece plays beside. Above, what is
// worked out for the whole piece: the key sounding is lit, a click goes back to
// it, the part played can loop. Below, the owner's text, kept as it is typed.
// Space plays and pauses (Ctrl+Space while typing, where space is a space);
// Alt+← and Alt+→ move 2 seconds.

const HANDS: { hand: Hand; label: string }[] = [{ hand: 'right', label: 'Main droite' }, { hand: 'left', label: 'Main gauche' }];
// Kept this long after the last key typed.
const SAVE_AFTER = 700;
const STEP = 2; // seconds
const HAND_ORDER: Hand[] = ['right', 'left'];
// The text and its marks behind it: the same letters at the same places.
const FIELD = 'overflow-y-auto p-2.5 font-mono text-[15px] font-semibold leading-relaxed [overflow-wrap:break-word] whitespace-pre-wrap [scrollbar-gutter:stable]';
// The worked-out keys above the text, or not.
const REFERENCE_KEY = 'piano.notebook.reference';

export function Notebook({ parts, current, position, looped, written, onWrite, onToggle, onSeek, onLoop }: {
  parts: Part[];
  // The part being played.
  current: number;
  position: number;
  // The part being played is looped.
  looped: boolean;
  written: PieceSequence | null;
  onWrite(next: PieceSequence | null): void;
  onToggle(): void;
  onSeek(time: number): void;
  // On or off, for the part being played.
  onLoop(): void;
}) {
  const [texts, setTexts] = useState<Record<Hand, string>>(() => ({ left: written?.left ?? '', right: written?.right ?? '' }));
  const areas = useRef<Record<Hand, HTMLTextAreaElement | null>>({ left: null, right: null });
  const pending = useRef<number | null>(null);
  const latest = useRef({ texts, onWrite, position });
  latest.current = { texts, onWrite, position };

  const keep = (next: Record<Hand, string>) => {
    const out: PieceSequence = {};
    for (const { hand } of HANDS) if (next[hand].trim()) out[hand] = next[hand].replace(/\s+$/, '');
    latest.current.onWrite(out.left || out.right ? out : null);
  };
  const flush = () => {
    if (pending.current === null) return;
    clearTimeout(pending.current);
    pending.current = null;
    keep(latest.current.texts);
  };
  // Not lost when the panel closes.
  useEffect(() => flush, []);

  const change = (hand: Hand, text: string) => {
    const next = { ...texts, [hand]: text };
    setTexts(next);
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      keep(next);
    }, SAVE_AFTER);
  };

  const [reference, setReference] = useState(() => readJson<boolean>(REFERENCE_KEY, false));
  const showReference = (on: boolean) => {
    setReference(on);
    writeJson(REFERENCE_KEY, on);
  };
  const empty = !texts.left.trim() && !texts.right.trim();
  // Where each hand's text parts from what is worked out.
  const expected = useMemo(() => ({ left: expectedKeys(parts, 'left'), right: expectedKeys(parts, 'right') }), [parts]);
  const gaps = useMemo(() => ({
    left: texts.left.trim() ? compare(writtenKeys(texts.left), expected.left) : [],
    right: texts.right.trim() ? compare(writtenKeys(texts.right), expected.right) : [],
  }), [texts, expected]);
  const off = useMemo(() => ({
    left: new Set(gaps.left.flatMap((g) => (g.kind === 'extra' ? [] : [g.expected.step]))),
    right: new Set(gaps.right.flatMap((g) => (g.kind === 'extra' ? [] : [g.expected.step]))),
  }), [gaps]);
  // To a gap: the piece where it is, the text on it.
  const show = (hand: Hand, g: Gap) => {
    const step = g.kind === 'extra' ? g.near?.step : g.expected.step;
    if (step) onSeek(Math.max(0, step.time - 0.05));
    const area = areas.current[hand];
    const [from, to] = g.kind === 'missing' ? [g.at, g.at] : [g.written.from, g.written.to];
    area?.focus();
    area?.setSelectionRange(from, to);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-3 pb-3">
      {/* The whole piece, worked out: to copy from. */}
      <div className="-mb-2 flex shrink-0 justify-end">
        <button type="button" onClick={() => showReference(!reference)} className="text-[11px] text-neutral-400 underline-offset-2 hover:text-neutral-900 hover:underline">
          {reference ? 'Masquer le calcul' : 'Afficher le calcul'}
        </button>
      </div>
      {reference && <Reference parts={parts} current={current} position={position} looped={looped} off={off} onSeek={onSeek} onLoop={onLoop} />}

      {empty && (
        <button
          type="button"
          onClick={() => {
            const next = { left: sequenceText(parts, 'left'), right: sequenceText(parts, 'right') };
            setTexts(next);
            keep(next);
          }}
          className="shrink-0 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 hover:border-neutral-500 hover:text-neutral-900"
        >
          Partir du texte calculé (tout le morceau)
        </button>
      )}
      {HANDS.map(({ hand, label }) => (
        <div key={hand} className="flex min-h-0 flex-1 flex-col">
          <span className="mb-1 text-xs font-medium text-neutral-500">{label}</span>
          <div className="relative min-h-0 flex-1 rounded-lg border border-neutral-200 bg-white focus-within:border-neutral-400">
            {/* Behind the text, the same text: its gaps marked. */}
            <Marks text={texts[hand]} gaps={gaps[hand]} />
            <textarea
              ref={(el) => {
                areas.current[hand] = el;
              }}
              value={texts[hand]}
              onChange={(e) => change(hand, e.target.value)}
              onScroll={(e) => {
                const back = e.currentTarget.previousElementSibling;
                if (back) back.scrollTop = e.currentTarget.scrollTop;
              }}
              onBlur={flush}
              onKeyDown={(e) => {
                // The piano's own keys stay out of it.
                e.stopPropagation();
                if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
                  e.preventDefault();
                  onToggle();
                } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                  e.preventDefault();
                  onSeek(Math.max(0, latest.current.position + (e.key === 'ArrowLeft' ? -STEP : STEP)));
                }
              }}
              spellCheck={false}
              placeholder={'5-7-5-4\n3-7-6 3-7-6 5-3\n\n(ligne vide : partie suivante)'}
              aria-label={label}
              className={`${FIELD} relative h-full w-full resize-none bg-transparent placeholder:font-normal placeholder:text-neutral-300 focus:outline-none ${TEXT[hand]}`}
            />
          </div>
          <GapList gaps={gaps[hand]} written={!!texts[hand].trim()} onShow={(g) => show(hand, g)} />
        </div>
      ))}
    </div>
  );
}

// Every part, its letter beside it; the one played marked and kept in sight.
function Reference({ parts, current, position, looped, off, onSeek, onLoop }: {
  parts: Part[];
  // Keys the text written leaves out or writes otherwise.
  off: Record<Hand, Set<Step>>;
  current: number;
  position: number;
  looped: boolean;
  onSeek(time: number): void;
  onLoop(): void;
}) {
  const follow = useFollow<HTMLDivElement>();
  const { el, free, scrollTo } = follow;
  useEffect(() => {
    const target = free ? null : el?.querySelector(`[data-part="${current}"]`);
    if (!el || !target) return;
    const [view, at] = [el.getBoundingClientRect(), target.getBoundingClientRect()];
    if (at.top < view.top || at.bottom > view.bottom) scrollTo({ top: el.scrollTop + at.top - view.top - 6, behavior: 'smooth' });
  }, [current, el, free, scrollTo]);
  return (
    <div className="relative flex max-h-[42%] shrink-0 flex-col rounded-xl bg-neutral-100/70">
      <RecentreButton free={free} onClick={follow.recentre} className="bottom-2 right-2" />
      <div ref={follow.ref} className="min-h-0 overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin]">
        {parts.map((p, i) => (
          <section key={i} data-part={i} className={`flex gap-2 rounded-lg px-1.5 py-1.5 ${i === current ? 'bg-white/80' : ''}`}>
            <button
              type="button"
              onClick={() => onSeek(p.start)}
              title={`Aller à la partie ${p.label}`}
              className={`h-6 w-6 shrink-0 rounded text-xs font-semibold ${i === current ? 'bg-neutral-900 text-white' : 'text-neutral-400 hover:bg-neutral-200'}`}
            >
              {p.label}
            </button>
            <div className="min-w-0 flex-1">
              {HAND_ORDER.map((hand) => <Said key={hand} part={p} hand={hand} position={i === current ? position : -1} off={off[hand]} onSeek={onSeek} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// One hand's keys in the part played, the one sounding lit.
function Said({ part, hand, position, off, onSeek }: { part: Part; hand: Hand; position: number; off: Set<Step>; onSeek(time: number): void }) {
  const lines = sequenceSaid(part, hand);
  if (!lines.length) return null;
  const steps = part.rows.find((r) => r.hand === hand)?.steps ?? [];
  const started = steps.filter((s) => s.time <= position + 0.03);
  const now = started[started.length - 1];
  const lit = position >= 0 && now && (now.end > position || position - now.time < 0.15) ? now : null;
  return (
    <div className={`font-mono text-[14px] font-semibold leading-relaxed ${TEXT[hand]}`}>
      {lines.map((line, k) => (
        <div key={k} className="whitespace-pre-wrap break-words">
          {line.map((x) => (
            <span key={x.step.step}>
              {x.before}
              <button
                type="button"
                onClick={() => onSeek(Math.max(0, x.step.time - 0.05))}
                className={`rounded-sm px-px hover:underline ${x.step === lit ? (hand === 'left' ? 'bg-hand-l-pale' : 'bg-hand-r-pale') : ''} ${off.has(x.step) ? 'underline decoration-red-500 decoration-wavy decoration-2 underline-offset-4' : ''}`}
              >
                {x.text}
              </button>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// The text, unseen, its gaps coloured: under the text being typed.
function Marks({ text, gaps }: { text: string; gaps: Gap[] }) {
  const ranges = gaps.flatMap((g) => (g.kind === 'missing' ? [] : [{ from: g.written.from, to: g.written.to, kind: g.kind }])).sort((a, b) => a.from - b.from);
  const out: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach((r, k) => {
    if (r.from < at) return;
    out.push(text.slice(at, r.from));
    out.push(<mark key={k} className={`rounded-sm text-transparent ${r.kind === 'wrong' ? 'bg-red-200/80' : 'bg-amber-200/80'}`}>{text.slice(r.from, r.to)}</mark>);
    at = r.to;
  });
  out.push(text.slice(at));
  // A last empty line keeps its height.
  return <div aria-hidden className={`${FIELD} pointer-events-none absolute inset-0 text-transparent`}>{out}{'\n'}</div>;
}

// How many gaps; each click goes to the next one.
function GapList({ gaps, written, onShow }: { gaps: Gap[]; written: boolean; onShow(g: Gap): void }) {
  const next = useRef(0);
  if (!written) return null;
  if (!gaps.length) return <p className="mt-1 text-[11px] text-emerald-600">✓ Pareil que le calcul</p>;
  return (
    <button
      type="button"
      onClick={() => {
        const k = next.current % gaps.length;
        next.current = k + 1;
        onShow(gaps[k]);
      }}
      title="Aller à l’écart suivant"
      className="mt-1 self-start text-[11px] font-medium text-red-600 underline-offset-2 hover:underline"
    >
      {gaps.length} écart{gaps.length > 1 ? 's' : ''}
    </button>
  );
}
