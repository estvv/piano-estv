import type { Hand } from '@piano/shared';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { PHONE, useMedia } from '../../lib/useMedia';
import { TEXT } from './Numbers';
import { compactLines, handLetter, type Part } from './numbers';
import { sequenceLines, sequenceText } from './sequence';
import type { PieceSequence } from './types';

// The numbers of one part, large: a hand, or both, one view at a time. The
// parts follow each other with the arrows.

type View = Hand | 'both';
const VIEWS: { value: View; label: string }[] = [{ value: 'left', label: 'Main gauche' }, { value: 'both', label: 'Les deux' }, { value: 'right', label: 'Main droite' }];
// Opened again on the view last chosen.
let last: View = 'both';
// One part with its beats, or the whole piece as a list of keys.
let lastWhole = false;

export function PartNumbers({ parts, start, written, onWrite, onWriteBeside, onClose }: {
  parts: Part[];
  start: number;
  // The order of the keys as the owner wrote it, over the one worked out.
  written: PieceSequence | null;
  onWrite(next: PieceSequence | null): void;
  // To write beside the piece playing instead (the side panel), where there is one.
  onWriteBeside?(): void;
  onClose(): void;
}) {
  const [index, setIndex] = useState(start);
  const part = parts[index] ?? parts[0];
  const go = (by: number) => setIndex((i) => Math.max(0, Math.min(parts.length - 1, i + by)));
  // ← and → too.
  const keys = useRef(go);
  keys.current = go;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Not while text is being written.
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        keys.current(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, []);
  const [view, setView] = useState<View>(last);
  const [whole, setWholeShown] = useState(lastWhole);
  const setWhole = (w: boolean) => {
    lastWhole = w;
    setWholeShown(w);
  };
  const phone = useMedia(PHONE);
  const show = (v: View) => {
    last = v;
    setView(v);
  };
  const of = (p: Part, v: View): Part => (v === 'both' ? p : { ...p, rows: p.rows.filter((r) => r.hand === v) });
  const width = phone ? 22 : 40;

  return (
    <Modal
      title={whole ? '' : (
        <span className="flex items-center gap-1">
          <Arrow label="Partie précédente (←)" disabled={index === 0} onClick={() => go(-1)}>‹</Arrow>
          {/* As in the timeline of the player. */}
          <span title={`Partie ${part.label}`} className="flex h-8 min-w-24 items-center justify-center rounded bg-neutral-100 px-3 text-sm font-semibold text-neutral-500">{part.label}</span>
          <Arrow label="Partie suivante (→)" disabled={index === parts.length - 1} onClick={() => go(1)}>›</Arrow>
        </span>
      )}
      onClose={onClose}
      width="lg"
      centered
    >
      <div role="tablist" className="-mt-1 mb-5 flex border-b border-neutral-200">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            onClick={() => show(v.value)}
            className={`-mb-px flex-1 border-b-2 px-2 py-2 text-sm font-medium transition-colors ${view === v.value ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-400 hover:text-neutral-700'}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="-mt-3 mb-4 flex justify-end">
        <button type="button" onClick={() => setWhole(!whole)} className="text-xs text-neutral-400 underline-offset-2 hover:text-neutral-900 hover:underline">
          {whole ? 'Voir par partie, avec les temps' : 'Voir tout le morceau, juste l’ordre'}
        </button>
      </div>
      {whole ? <Sequence parts={parts} view={view} written={written} onWrite={onWrite} onWriteBeside={onWriteBeside} /> : (
      /* Every part and every view in the same place, only one seen: the window is
         as big as the biggest, and does not move from a part to the next. */
      <div className="grid">
        {parts.flatMap((p, i) => VIEWS.map((v) => {
          const seen = i === index && v.value === view;
          return (
            <div key={`${i}-${v.value}`} className={`[grid-area:1/1] ${seen ? '' : 'invisible'}`} aria-hidden={!seen}>
              <Lines part={of(p, v.value)} both={v.value === 'both'} width={width} empty={v.value === 'both' ? 'Rien à jouer dans cette partie.' : 'Cette main ne joue pas dans cette partie.'} />
            </div>
          );
        }))}
      </div>
      )}
    </Modal>
  );
}

function Arrow({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick(): void; children: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-lg text-xl text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-25 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

function Lines({ part, both, width, empty }: { part: Part; both: boolean; width: number; empty: string }) {
  if (!part.rows.length) return <p className="py-6 text-center text-sm text-neutral-400">{empty}</p>;
  return (
    <div className="space-y-5 font-mono text-lg leading-relaxed phone:text-base">
      {compactLines(part, width).map((line, k) => (
        <div key={k} className="overflow-x-auto [scrollbar-width:none]">
          {part.rows.map((row, r) => (
            <div key={row.hand} className="flex whitespace-pre">
              {both && <span className="shrink-0 text-neutral-300">{handLetter(row.hand)}  </span>}
              {line.map((m) => (
                <span key={m.step} className={`shrink-0 font-semibold ${TEXT[row.hand]}`} style={{ width: `${m.width}ch` }}>{m.texts[r]}</span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// The whole piece, hand by hand, as written by hand: parts one after the other.
// Each hand's text can be rewritten (lines cut, parts put apart) and is kept.
function Sequence({ parts, view, written, onWrite, onWriteBeside }: { parts: Part[]; view: View; written: PieceSequence | null; onWrite(next: PieceSequence | null): void; onWriteBeside?(): void }) {
  const hands: Hand[] = view === 'both' ? ['left', 'right'] : [view];
  const worked = (hand: Hand) => sequenceText(parts, hand);
  const textOf = (hand: Hand) => written?.[hand] ?? worked(hand);
  const [editing, setEditing] = useState<Partial<Record<Hand, string>> | null>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = hands.map((h) => `${hands.length > 1 ? `${h === 'left' ? 'Gauche' : 'Droite'}\n\n` : ''}${textOf(h)}`).join('\n\n');
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const save = (next: Partial<Record<Hand, string | undefined>>) => {
    const out: PieceSequence = { ...written };
    for (const hand of hands) {
      const text = next[hand]?.replace(/\s+$/, '');
      // As worked out: nothing to keep.
      if (text === undefined || !text.trim() || text === worked(hand)) delete out[hand];
      else out[hand] = text;
    }
    onWrite(out.left || out.right ? out : null);
    setEditing(null);
  };
  const own = hands.some((h) => written?.[h] !== undefined);
  const link = 'text-xs text-neutral-400 underline-offset-2 hover:text-neutral-900 hover:underline';

  // Each view drawn in the same place, only one seen: the popup is as big as the
  // biggest of them (both hands), whichever is shown.
  const columns = (v: View) => {
    const shownHands: Hand[] = v === 'both' ? ['left', 'right'] : [v];
    const active = v === view;
    return (
      <div key={v} className={`[grid-area:1/1] grid content-start gap-6 ${shownHands.length > 1 ? 'sm:grid-cols-2' : ''} ${active ? '' : 'invisible'}`} aria-hidden={!active}>
        {shownHands.map((hand) => {
            const mine = written?.[hand];
            const blocks = mine !== undefined
              ? mine.split(/\n\s*\n/).map((b) => ({ label: '', lines: b.split('\n') }))
              : parts.map((p) => ({ label: p.label, lines: sequenceLines(p, hand) })).filter((b) => b.lines.length);
            return (
              <div key={hand} className="min-w-0">
                {shownHands.length > 1 && <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">{hand === 'left' ? 'Main gauche' : 'Main droite'}</p>}
                {editing && active ? (
                  <textarea
                    value={editing[hand] ?? ''}
                    onChange={(e) => setEditing({ ...editing, [hand]: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                    spellCheck={false}
                    aria-label={hand === 'left' ? 'Main gauche' : 'Main droite'}
                    className={`h-[50vh] w-full resize-none rounded-lg border border-neutral-200 p-3 font-mono text-base font-semibold leading-relaxed focus:border-neutral-400 focus:outline-none ${TEXT[hand]}`}
                  />
                ) : blocks.length ? (
                  <div className="space-y-4">
                    {blocks.map((b, k) => (
                      <div key={k} className="flex gap-3">
                        <span className="w-4 shrink-0 pt-1 text-xs font-semibold text-neutral-300">{b.label}</span>
                        <div className={`min-w-0 font-mono text-lg font-semibold leading-relaxed phone:text-base ${TEXT[hand]}`}>
                          {b.lines.map((l, i) => <div key={i} className="min-h-[1lh] whitespace-pre-wrap break-words">{l}</div>)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="py-6 text-sm text-neutral-400">Cette main ne joue pas.</p>}
              </div>
            );
          })}
      </div>
    );
  };

  return (
    <div>
      <div className="grid max-h-[60vh] overflow-y-auto overscroll-contain">
        {VIEWS.map((v) => columns(v.value))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-4">
        {editing ? (
          <>
            <button type="button" onClick={() => setEditing(Object.fromEntries(hands.map((h) => [h, worked(h)])))} className={`${link} mr-auto`}>Repartir du texte calculé</button>
            <button type="button" onClick={() => setEditing(null)} className={link}>Annuler</button>
            <button type="button" onClick={() => save(editing)} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700">Enregistrer</button>
          </>
        ) : (
          <>
            {own && <span className="mr-auto text-xs text-neutral-400">Texte modifié à la main : il ne suit plus les changements de notes.</span>}
            <button type="button" onClick={copy} className={link}>{copied ? 'Copié' : 'Copier le texte'}</button>
            <button type="button" onClick={() => (onWriteBeside ? onWriteBeside() : setEditing(Object.fromEntries(hands.map((h) => [h, textOf(h)]))))} className={link} title={onWriteBeside ? 'Dans le panneau à côté, pendant que le morceau joue' : undefined}>Modifier le texte</button>
          </>
        )}
      </div>
    </div>
  );
}
