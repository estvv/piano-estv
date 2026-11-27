import { pieceDuration, type Hand, type PieceNote, type PieceNumber } from '@piano/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmModal } from '../../components/Modal';
import { Segmented } from '../../components/Segmented';
import { Switch } from '../../components/Switch';
import { ErrorText, primaryButton } from '../../components/ui';
import { PHONE, TOUCH, useMedia } from '../../lib/useMedia';
import { useNoteInput } from '../input/hooks';
import { PianoKeyboard, type Sticker } from '../PianoKeyboard';
import { piecesApi } from './api';
import { CellPad, playKey } from './CellPad';
import { commit, redo, startHistory, undo, type History } from './edit';
import { EditGrid, type Cell } from './EditGrid';
import { changeOf, editable, layoutOf, levelNames, levelNotes, levelOf, numbersAt, numbersOf, untouched, visible, withNumbers } from './derive';
import { clearRange, copyRange, pasteClip, targetOf, type Clip, type Range } from './gridClip';
import { setStep } from './numberEdit';
import { Small } from './Numbers';
import { FIXED_FROM, givenByOwner, partAt, stepText, type Key, type Part } from './numbers';
import { isOwn, keysOf, orderNumbers, resetNumbers, setNumber } from './ownNumbers';
import { OwnNumbers } from './OwnNumbers';
import { pieceRange } from './player';
import { parseRun } from './score';
import { OctaveButton } from './ScoreEditor';
import type { StoredPiece } from './types';
import { usePreview } from './usePreview';

const NUMBERING_NAMES = { order: 'Ordre', hand: 'Position (par main)', fixed: 'Position fixe' } as const;

interface Edited {
  notes: PieceNote[];
  numbers: PieceNumber[];
}

// Changes an imported piece, at its level, in the same two steps as writing
// one: which key each number is, then what each hand plays in each column.
export function NotesEditor({ piece, firstStep = 'piece', onSaved, onClose }: {
  piece: StoredPiece;
  firstStep?: 'numbers' | 'piece';
  onSaved(id: number): void;
  onClose(): void;
}) {
  const [history, setHistory] = useState<History<Edited>>(() => startHistory({ notes: editable(piece), numbers: numbersAt(piece) }));
  const { notes, numbers } = history.present;
  const editNotes = (change: (notes: PieceNote[]) => PieceNote[]) => {
    setError('');
    setHistory((h) => {
      const next = change(h.present.notes);
      return next === h.present.notes ? h : commit(h, { ...h.present, notes: next });
    });
  };
  const editNumbers = (next: PieceNumber[]) => {
    setError('');
    setHistory((h) => commit(h, { ...h.present, numbers: next }));
  };
  const [step, setStepShown] = useState(firstStep);
  const changed = history.past.length > 0;
  const level = levelOf(piece);
  const heard = useMemo(() => visible(piece, notes), [piece, notes]);

  // Beats and parts stay put; numbers follow every change.
  const layout = useMemo(() => layoutOf(piece), [piece]);
  const [division, setDivision] = useState(() => {
    const { parts } = numbersOf(levelNotes(piece), layout);
    return parts.some((p) => p.division >= 4 && p.division % 3) ? 4 : parts.some((p) => p.division % 3 === 0) ? 3 : 2;
  });
  // The owner's numbers, which step 1 changes; they are the player's only in
  // « Ordre » with parts.
  const ownParts = useMemo(() => numbersOf(heard, { ...layout, given: givenByOwner(numbers) }, division).parts, [heard, layout, numbers, division]);
  const numbering = piece.numbering ?? 'order';
  const whole = !!piece.whole;
  const ownUsed = numbering === 'order' && !whole;
  // As the player numbers keys: what step 2 shows and reads.
  const parts = useMemo(
    () => (ownUsed ? ownParts : numbersOf(heard, { ...layout, given: { ...givenByOwner(numbers), numbering, whole } }, division).parts),
    [ownUsed, ownParts, heard, layout, numbers, numbering, whole, division],
  );
  const [index, setIndex] = useState(0);
  const part: Part = parts[index] ?? parts[0];
  const [cell, setCell] = useState<Cell | null>(null);
  // Several cells, and what was cut or copied.
  const [range, setRange] = useState<Range | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [chord, setChord] = useState(false);
  // Off: keys played are only heard.
  const [fill, setFill] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const phone = useMedia(PHONE);
  const touch = useMedia(TOUCH);

  const duration = useMemo(() => Math.max(layout.duration, pieceDuration(notes)), [layout, notes]);
  const preview = usePreview(heard, duration);
  const playingPart = partAt(parts, preview.position);
  const column = preview.playing && playingPart === index
    ? Math.floor((layout.grid.toBeats(preview.position) - part.beat) * part.division + 0.3)
    : -1;

  // The numbers of the whole letter (of the whole piece when counted across
  // parts), not only those this part plays.
  const shown = step === 'numbers' ? ownParts : parts;
  const keys = useMemo(() => {
    const labels = whole && step === 'piece' ? [...new Set(shown.map((p) => p.label))] : [part.label];
    const out: Key[] = [];
    for (const hand of ['left', 'right'] as const) {
      for (const label of labels) for (const k of keysOf(shown, label, hand)) if (!out.some((o) => o.hand === hand && o.midi === k.midi)) out.push(k);
    }
    return out;
  }, [shown, whole, step, part.label]);
  const stickers = useMemo(() => {
    const out = new Map<number, Sticker[]>();
    for (const k of keys) out.set(k.midi, [...(out.get(k.midi) ?? []), k]);
    return out;
  }, [keys]);

  const current = cell && cell.step < part.columns ? cell : null;
  const stepAt = (c: Cell) => part.rows.find((r) => r.hand === c.hand)?.steps.find((s) => s.step === c.step);
  const currentStep = current ? stepAt(current) : undefined;

  // New notes go to the first track that is on.
  const track = piece.tracks ? Math.max(0, piece.tracks.findIndex((t) => t.enabled)) : undefined;
  const put = (c: Cell, midis: number[]) => {
    editNotes((n) => setStep(n, part, layout.grid, c.hand, c.step, midis, track));
  };
  const move = (to: 'previous' | 'next' | 'hand') => setCell((c) => {
    if (!c) return c;
    if (to === 'hand') return { ...c, hand: c.hand === 'left' ? 'right' : 'left' };
    return { ...c, step: Math.min(part.columns - 1, Math.max(0, c.step + (to === 'next' ? 1 : -1))) };
  });
  const write = (c: Cell, text: string): boolean => {
    const run = parseRun(text.replace(/\s+/g, '+'));
    if (!run || run.length > 1) return setError('Une case : un numéro, ou plusieurs avec + (1+3).'), false;
    const midis: number[] = [];
    for (const n of run[0] ?? []) {
      const key = keys.find((k) => k.hand === c.hand && k.number === n)
        ?? (numbering === 'fixed' && n + FIXED_FROM >= 21 && n + FIXED_FROM <= 108 ? { midi: n + FIXED_FROM } : undefined);
      if (!key) return setError(`Pas de touche n° ${n} ici : joue une touche du clavier pour en ajouter une.`), false;
      midis.push(key.midi);
    }
    put(c, midis);
    return true;
  };

  // --- Numbers ----------------------------------------------------------------------
  const [hand, setHand] = useState<Hand>(() => (keysOf(ownParts, part.label, 'right').length ? 'right' : 'left'));
  const [assign, setAssign] = useState(false);
  const [everywhere, setEverywhere] = useState(false);
  // While assigning: the keys played, in order. Another place starts again at 1.
  const [pressed, setPressed] = useState<number[]>([]);
  const at = { label: part.label, hand, everywhere };
  useEffect(() => setPressed([]), [part.label, hand, everywhere, assign, step]);
  const assignKey = (midi: number) => {
    if (!assign || pressed.includes(midi)) return;
    if (!keysOf(ownParts, part.label, hand).some((k) => k.midi === midi)) {
      return setError(`Cette touche n’est pas jouée par la main ${hand === 'left' ? 'gauche' : 'droite'} dans la partie ${part.label}.`);
    }
    const next = [...pressed, midi];
    setPressed(next);
    editNumbers(orderNumbers(numbers, ownParts, at, next));
  };
  const showPart = (i: number) => {
    preview.stop();
    setIndex(i);
    setCell(null);
    setRange(null);
    setError('');
  };

  // --- Several cells ----------------------------------------------------------------
  // What cutting and copying take: the cells picked, or the only one.
  const area: Range | null = range ?? (current && { from: current.step, to: current.step, hands: [current.hand] });
  const copy = () => area && setClip(copyRange(part, layout.grid, area));
  const clear = () => {
    if (area) editNotes((n) => clearRange(n, part, area));
  };
  const cutOut = () => {
    copy();
    clear();
  };
  const paste = () => {
    if (!clip) return;
    const at = range ? { hand: range.hands[0], step: range.from } : current;
    if (!at) return setError('Choisis la case où coller.');
    editNotes((n) => pasteClip(n, part, layout.grid, clip, at, track));
    const target = targetOf(clip, part, at);
    setRange(target);
    setCell({ hand: at.hand, step: target.from });
  };
  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcuts.current = (e) => {
    if (leaving) return;
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (step === 'numbers') {
      if (!mod || (key !== 'z' && key !== 'y')) return;
      setHistory(key === 'y' || e.shiftKey ? redo : undo);
    } else if (mod && key === 'c' && area) copy();
    else if (mod && key === 'x' && area) cutOut();
    else if (mod && key === 'v' && clip) paste();
    else if (mod && key === 'a') setRange({ from: 0, to: part.columns - 1, hands: ['left', 'right'] });
    else if (mod && key === 'z') setHistory(e.shiftKey ? redo : undo);
    else if (mod && key === 'y') setHistory(redo);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && range) clear();
    else if (e.key === 'Escape' && range) setRange(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  // Before the field of the cell, which has the focus.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => shortcuts.current(e);
    window.addEventListener('keydown', onDown, true);
    return () => window.removeEventListener('keydown', onDown, true);
  }, []);

  const onKey = useRef<(midi: number) => void>(() => {});
  onKey.current = (midi) => {
    if (leaving || preview.playing) return;
    if (step === 'numbers') return assignKey(midi);
    if (!current || !fill) return;
    const now = stepAt(current)?.notes.map((n) => n.midi) ?? [];
    put(current, !chord ? [midi] : now.includes(midi) ? now.filter((m) => m !== midi) : [...now, midi]);
    if (!chord) move('next');
  };
  useNoteInput((e) => e.type === 'on' && e.source !== 'mic' && onKey.current(e.midi));

  const [low, high] = useMemo(() => pieceRange(piece.notes), [piece.notes]);
  const [octave, setOctave] = useState(4);
  const from = phone ? (octave + 1) * 12 : low;
  const to = phone ? from + 23 : high;

  const save = async () => {
    if (!notes.length) return setError('Il faut garder au moins une note.');
    setSaving(true);
    setError('');
    try {
      const before = history.past[0] ?? history.present;
      if (notes !== before.notes) await piecesApi.saveChange(piece.id, changeOf(piece, notes));
      if (numbers !== before.numbers) await piecesApi.update(piece.id, { numbers: withNumbers(piece, numbers) });
      onSaved(piece.id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-17 shrink-0 items-center gap-1 pl-16 pr-3 phone:h-15 phone:pl-14 sm:pr-5">
        <div className="min-w-0 flex-1 truncate font-semibold text-neutral-900 phone:hidden">{piece.title}</div>
        <Segmented<'numbers' | 'piece'>
          value={step}
          onChange={(s) => {
            preview.stop();
            setError('');
            setStepShown(s);
          }}
          options={[{ value: 'numbers', label: '1. Numéros' }, { value: 'piece', label: '2. Morceau' }]}
        />
        <div className="flex flex-1 items-center justify-end gap-1">
          <Small onClick={() => setHistory(undo)} title="Annuler le dernier changement (Ctrl+Z)">↶</Small>
          <span className="phone:hidden"><Small onClick={() => setHistory(redo)} title="Rétablir">↷</Small></span>
          <Small
            active={preview.playing}
            onClick={() => (preview.playing ? preview.stop() : preview.play(part.start, { start: part.start, end: part.end }))}
          >
            {preview.playing ? 'Arrêter' : 'Écouter'}
          </Small>
          <Small onClick={() => (changed ? setLeaving(true) : onClose())}>Quitter</Small>
          <button type="button" onClick={() => void save()} disabled={saving || !changed} className={`${primaryButton} ml-1 phone:px-3`}>{saving ? '…' : 'Enregistrer'}</button>
        </div>
      </div>

      {step === 'numbers' && (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-200 bg-white px-3 py-2 sm:px-5">
            <Segmented<Hand> value={hand} onChange={setHand} options={[{ value: 'left', label: 'Gauche' }, { value: 'right', label: 'Droite' }]} />
            <div className="flex flex-wrap items-center gap-0.5">
              {/* Parts with the same letter have the same numbers: once each. */}
              {[...new Set(parts.map((p) => p.label))].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => showPart(parts.findIndex((p) => p.label === l))}
                  aria-current={l === part.label}
                  title={`Partie ${l}`}
                  className={`h-9 min-w-9 rounded-lg px-2.5 text-sm font-semibold transition-colors ${l === part.label ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <Switch on={assign} label="Assigner" title="Éteint : on écoute. Allumé : joue les touches dans l’ordre, elles deviennent 1, 2, 3…" onChange={setAssign} />
            <Switch on={everywhere} label="Toutes les parties" title="Changer ces touches dans tout le morceau" onChange={setEverywhere} />
            {isOwn(numbers, part.label, hand) && (
              <Small
                title="Dans l’ordre où les touches sont jouées"
                onClick={() => {
                  setPressed([]);
                  editNumbers(resetNumbers(numbers, ownParts, at));
                }}
              >
                Automatique
              </Small>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-neutral-100 bg-white px-3 py-5 sm:px-5">
            {!ownUsed && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Ce morceau est réglé en « {NUMBERING_NAMES[numbering]}{whole ? ', sans parties' : ''} » : ces numéros ne servent qu’en « Ordre » avec les parties. L’étape 2 montre ceux du lecteur.
              </p>
            )}
            <OwnNumbers
              hand={hand}
              keys={keysOf(ownParts, part.label, hand)}
              assign={assign}
              onNumber={(midi, number) => editNumbers(setNumber(numbers, ownParts, at, midi, number))}
              onHear={playKey}
            />
            <div className="mt-3"><ErrorText>{error}</ErrorText></div>
          </div>
        </>
      )}
      {step === 'piece' && <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-neutral-200 bg-white px-3 py-4 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center gap-1">
          {parts.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => showPart(i)}
              aria-current={i === index}
              className={`h-9 min-w-9 rounded-lg px-2.5 text-sm font-semibold ${i === index ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'}`}
            >
              {p.label}
            </button>
          ))}
          <span className="flex-1" />
          {(range || clip) && (
            <span className="flex items-center">
              {range && <Small onClick={copy} title="Ctrl+C">Copier</Small>}
              {range && <Small onClick={cutOut} title="Ctrl+X">Couper</Small>}
              {clip && <Small onClick={paste} title="Ctrl+V">Coller</Small>}
              {range && <Small onClick={clear} title="Suppr">Effacer</Small>}
            </span>
          )}
          <span className="px-2 text-xs text-neutral-400">Niveau {levelNames[level]}</span>
          {level !== 'original' && piece.edits?.[level] && (
            <Small onClick={() => editNotes(() => untouched(piece))} title="Oublier les changements faits à ce niveau">Version automatique</Small>
          )}
          <select
            value={division}
            title="Durée d’une case"
            aria-label="Durée d’une case"
            onChange={(e) => {
              setDivision(Number(e.target.value));
              setCell(null);
              setRange(null);
            }}
            className="rounded-lg bg-transparent py-1.5 text-xs text-neutral-600 focus:outline-none"
          >
            <option value={1}>Case = 1 temps</option>
            <option value={2}>Case = ½ temps</option>
            <option value={3}>Case = ⅓ temps</option>
            <option value={4}>Case = ¼ temps</option>
          </select>
        </div>
        <EditGrid part={part} selected={current} column={column} small={phone} range={range} onSelect={setCell} onRange={setRange} />
        <ErrorText>{error}</ErrorText>
      </div>}

      <div className="shrink-0 border-t border-neutral-200 bg-white px-3 pb-3 pt-2 sm:px-5">
        {step === 'piece' && <div className="mb-2 min-h-9">
          {current ? (
            <CellPad
              id={`${index}-${current.hand}-${current.step}`}
              hand={current.hand}
              text={currentStep ? stepText(currentStep) : ''}
              keys={keys.filter((k) => k.hand === (current.hand as Hand))}
              fill={fill}
              chord={chord}
              focus={!touch && !leaving}
              onFill={setFill}
              onChord={setChord}
              onText={(text) => write(current, text)}
              onMove={move}
            />
          ) : (
            <span className="text-xs text-neutral-400">Choisis une case, vide ou non.</span>
          )}
        </div>}
        <div className="flex items-stretch gap-1">
          {phone && <OctaveButton label="Octave plus grave" onClick={() => setOctave((o) => Math.max(1, o - 1))}>‹</OctaveButton>}
          <div className="min-w-0 flex-1">
            <PianoKeyboard from={from} to={to} labels="names" stickers={stickers} height="clamp(80px, 18dvh, 170px)" />
          </div>
          {phone && <OctaveButton label="Octave plus aiguë" onClick={() => setOctave((o) => Math.min(6, o + 1))}>›</OctaveButton>}
        </div>
      </div>

      {leaving && (
        <ConfirmModal
          title="Abandonner les changements ?"
          message="Ce qui n’est pas enregistré sera perdu."
          confirmLabel="Abandonner"
          danger
          onConfirm={onClose}
          onClose={() => setLeaving(false)}
        />
      )}
    </div>
  );
}
