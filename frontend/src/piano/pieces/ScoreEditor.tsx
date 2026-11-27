import { frenchName, scoreSchema, type Hand, type PieceDifficulty, type Score } from '@piano/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Field, inputClass } from '../../components/Field';
import { PlusIcon } from '../../components/icons';
import { ConfirmModal, Modal } from '../../components/Modal';
import { Popover } from '../../components/Popover';
import { Segmented } from '../../components/Segmented';
import { Switch } from '../../components/Switch';
import { ErrorText, primaryButton, secondaryButton } from '../../components/ui';
import { readJson, writeJson } from '../../lib/storage';
import { PHONE, useMedia } from '../../lib/useMedia';
import { NoteText } from '../Accidentals';
import { useNoteInput } from '../input/hooks';
import { PianoKeyboard, type Sticker } from '../PianoKeyboard';
import { foldersApi, piecesApi } from './api';
import { playKey } from './CellPad';
import { commit, redo, startHistory, undo, type History } from './edit';
import { levelNames, levelOf } from './derive';
import { changeFrom, openPiece, renderImported, renderPlain, sameLengths, shareKeys } from './importedScore';
import { ImportModal } from './ImportModal';
import { LabelInput, Small } from './Numbers';
import { handName } from './numbers';
import { movedLyrics } from './lyrics';
import { DifficultyPicker, FolderSelect } from './pieceFields';
import { clipPlaces, copyNotes, edgeRange, locate, moveEdge, moveNote, offsetsOf, pasteNotes, removeNotes, sheetOf, spill, stillThere, type Clip, type Placed } from './roll';
import { OrderChips } from './OrderChips';
import { otherHand, RollEditor, samePlace } from './RollEditor';
import { RunPanel } from './RunPanel';
import {
  addFree, addNotes, addPart, addRecorded, addToOrder, assignKey, emptyScore, HANDS, MAX_BEATS, midiOf, moveInOrder, numberKey, partOf, placeInOrder, placeRun, placeTaps,
  removeFromOrder, removeKey, removeNote, removePart, renamePart, runText, setBeats, setDivision, shiftHand, tappedBpm, unknownNumbers,
} from './score';
import { pieceRange } from './player';
import { offGrid, snapScore } from './snap';
import type { PieceFolder, StoredPiece } from './types';
import { usePreview } from './usePreview';
import { useRecorder } from './useRecorder';

// Writes a piece by hand, in two steps: which key each number is, then the
// keys one after the other, laid above the keyboard or recorded while playing.
// What is not saved yet is kept on this device. An imported piece is changed the
// same way (see importedScore.ts).

const draftKey = (id: number | null) => `piano.score.${id ?? 'new'}`;
// A draft only goes with the piece it was started from.
function mark(score: Score): string {
  let sum = 0;
  for (const c of JSON.stringify(score)) sum = (Math.imul(sum, 31) + c.charCodeAt(0)) | 0;
  return String(sum);
}
const DIVISIONS: { value: Score['division']; label: string }[] = [
  { value: 2, label: '½ temps' }, { value: 3, label: '⅓ temps' }, { value: 4, label: '¼ temps' },
];

// Numbers waiting for their key to be clicked.
interface Placing {
  hand: Hand;
  numbers: number[];
  // The run being written.
  run: string | null;
  // Numbers read on a picture: the same key in every part, then the other hand's.
  everywhere?: { later: { hand: Hand; numbers: number[] }[] };
}

// A score to start from, with numbers whose keys are not known yet.
export interface ScoreDraft {
  title: string;
  score: Score;
  toPlace: { hand: Hand; numbers: number[] }[];
}

const placingOf = ([first, ...later]: ScoreDraft['toPlace'] = []): Placing | null =>
  (first ? { ...first, run: null, everywhere: { later } } : null);

export function ScoreEditor({ piece, from: given, firstStep, onSaved, onClose }: {
  // Null: a new piece.
  piece: StoredPiece | null;
  from?: ScoreDraft;
  firstStep?: 'numbers' | 'piece';
  onSaved(id: number): void;
  onClose(): void;
}) {
  const key = draftKey(piece?.id ?? null);
  const [source] = useState(() => (piece && !piece.score ? openPiece(piece) : null));
  // An easier level only has notes of its own: parts and tempo are the piece's.
  const structure = !source || levelOf(source.piece) === 'original';
  const [saved] = useState<Score>(() => source?.score ?? piece?.score ?? emptyScore());
  const [started] = useState(() => (source ? mark(saved) : undefined));
  const [draft] = useState(() => {
    if (given) return null;
    const found = readJson<{ score: Score | null; from?: string }>(key, { score: null });
    return found.from === started ? found.score : null;
  });
  const [history, setHistory] = useState<History<Score>>(() => {
    if (given) return { ...startHistory(saved), past: [saved], present: given.score };
    return draft?.parts?.length ? { ...startHistory(saved), past: [saved], present: draft } : startHistory(saved);
  });
  const score = history.present;
  const changed = history.past.length > 0;
  useEffect(() => {
    if (changed) writeJson(key, { score, from: started });
  }, [key, score, changed, started]);

  const [step, setStep] = useState<'numbers' | 'piece'>(() => firstStep ?? (given || !score.parts.some((p) => p.notes.length) ? 'numbers' : 'piece'));
  const [label, setLabel] = useState(score.parts[0].label);
  // All the parts one after the other: the one just above the keyboard, and
  // the one to go to.
  const sheet = useMemo(() => sheetOf(score), [score]);
  const offsets = useMemo(() => offsetsOf(sheet, score.division), [sheet, score.division]);
  const [seen, setSeen] = useState(0);
  const [shown, setShown] = useState({ index: 0, times: 0 });
  const part = partOf(score, label);
  const [hand, setHand] = useState<Hand>('right');
  // What playing a key does, besides being heard.
  const [assign, setAssign] = useState(false);
  const [fill, setFill] = useState(false);
  const [cursor, setCursor] = useState(0);
  // Of the notes added, in beats.
  const [held, setHeld] = useState(1);
  const [metronome, setMetronome] = useState(true);
  const [picked, setPicked] = useState<Placed | null>(null);
  // Several notes: picked with a box, copied, and being pasted.
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<Placed[]>([]);
  const [clip, setClip] = useState<Clip | null>(null);
  const [pasting, setPasting] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(() => placingOf(given?.toPlace));
  const [importing, setImporting] = useState(false);
  const [title, setTitle] = useState(given?.title ?? '');
  const [folders, setFolders] = useState<PieceFolder[]>([]);
  useEffect(() => {
    if (importing) foldersApi.list().then(setFolders, () => {});
  }, [importing]);
  const [writing, setWriting] = useState<{ hand: Hand; text?: string } | null>(null);
  const [orderAt, setOrderAt] = useState<number | null>(null);
  const [dialog, setDialog] = useState<'save' | 'leave' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const phone = useMedia(PHONE);

  const edit = (change: (s: Score) => Score) => {
    setError('');
    setHistory((h) => {
      const next = change(h.present);
      if (!source || next === h.present) return commit(h, next);
      const shared = shareKeys(h.present, next);
      return commit(h, structure ? shared : sameLengths(h.present, shared));
    });
  };
  const length = Math.max(1, Math.round(held * score.division));

  // --- Listening ---------------------------------------------------------------------
  const rendered = useMemo(() => (source ? renderImported(source, score) : renderPlain(score)), [source, score]);
  const preview = usePreview(rendered.notes, rendered.duration);
  // Where the part shown is played.
  const span = rendered.spans[seen]?.label === part.label ? rendered.spans[seen] : rendered.spans.find((s) => s.label === part.label) ?? null;
  const partStart = span && Math.max(0, span.start);
  const partEnd = span?.end ?? 0;
  const playhead = useMemo(() => {
    if (!preview.playing) return null;
    for (const [i, s] of rendered.spans.entries()) {
      const at = preview.position - s.start;
      if (at >= -0.03 && preview.position < s.end) return offsets[i] + Math.max(0, s.beats(at) * score.division);
    }
    return null;
  }, [preview.playing, preview.position, rendered, score.division, offsets]);
  const listen = () => {
    if (preview.playing) return preview.stop();
    if (partStart === null) return setError(`Ajoute ${part.label} à l’ordre du morceau pour l’écouter.`);
    preview.play(partStart, { start: partStart, end: partEnd });
  };

  // --- Recording ---------------------------------------------------------------------
  // Where it started: the part shown follows the music.
  const take = useRef<{ index: number; label: string; beats?(t: number): number }>({ index: 0, label });
  const recorder = useRecorder({
    // A played piece has no steady tempo: the part's own.
    bpm: source && span ? (60 * part.beats) / (span.end - span.start) : score.bpm,
    metronome,
    onStart: () => {
      if (partStart !== null) preview.play(partStart);
    },
    onDone: ({ played, start }) => {
      preview.stop();
      if (!played.length) return setError('Aucune touche jouée pendant l’enregistrement.');
      const { index, label: into, beats } = take.current;
      edit((s) => spill(s, start === null ? addFree(s, into, hand, played) : addRecorded(s, into, hand, played, start, beats), index));
    },
  });
  const recording = recorder.state !== null;

  // --- Keys played ---------------------------------------------------------------------
  const onKey = useRef<(midi: number) => void>(() => {});
  onKey.current = (midi) => {
    if (writing || dialog || importing || recording) return;
    if (placing) {
      const [number, ...rest] = placing.numbers;
      const { hand: of, run, everywhere } = placing;
      edit((s) => (everywhere ? s.parts.reduce((all, p) => assignKey(all, p.label, of, number, midi), s) : assignKey(s, part.label, of, number, midi)));
      if (rest.length) return setPlacing({ ...placing, numbers: rest });
      const [following, ...later] = everywhere?.later ?? [];
      setPlacing(following ? { ...following, run: null, everywhere: { later } } : null);
      if (run !== null) setWriting({ hand: of, text: run });
      return;
    }
    if (preview.playing) return;
    if (step === 'numbers') {
      if (assign) edit((s) => numberKey(s, part.label, hand, midi));
      return;
    }
    if (!fill) return;
    const { index, step: at } = locate(offsets, cursor);
    edit((s) => addNotes(s, sheet[index].label, [{ hand, step: at, midi, length }]));
    // Keys pressed together are written together.
    clearTimeout(chordTimer.current);
    chordTimer.current = setTimeout(() => setCursor((c) => c + length), 130);
  };
  const chordTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(chordTimer.current), []);
  // Not the microphone: it would hear the preview.
  useNoteInput((e) => e.type === 'on' && e.source !== 'mic' && onKey.current(e.midi));
  const moveCursor = (by: number) => setCursor((c) => Math.max(0, c + by));

  const changeNote = (note: Placed, by: Placed) => {
    edit((s) => moveNote(s, note, by));
    if (samePlace(picked, note)) setPicked(by);
  };
  const deleteNote = ({ index, note }: Placed) => {
    setPicked(null);
    if (sheet[index]) edit((s) => removeNote(s, sheet[index].label, note));
  };

  const selection = useMemo(() => stillThere(score, chosen), [score, chosen]);
  const copySelection = () => {
    const c = copyNotes(score, selection);
    if (c) setClip(c);
  };
  const removeSelection = () => {
    if (!selection.length) return;
    edit((s) => removeNotes(s, selection));
    setChosen([]);
  };
  const startPaste = () => {
    if (!clip) return;
    preview.stop();
    setPicked(null);
    setPasting(true);
  };
  const pasteAt = (at: number) => {
    if (!clip) return;
    const places = clipPlaces(score, clip, at, structure);
    setPasting(false);
    if (!places.length) return setError('Rien à coller ici : c’est après la fin du morceau.');
    edit((s) => pasteNotes(s, places));
    // Kept picked: easy to take back or move again.
    setChosen(places);
  };
  const selectAll = () => {
    setPicked(null);
    setChosen(sheet.flatMap((p, index) => p.notes.map((note) => ({ index, note }))));
  };

  // Delete: the note picked. H: its other hand. Escape: no note picked, or stop recording.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || dialog || writing || importing) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const several = step === 'piece';
      if (mod && k === 'z') setHistory(e.shiftKey ? redo : undo);
      else if (several && mod && k === 'c' && selection.length) copySelection();
      else if (several && mod && k === 'x' && selection.length) {
        copySelection();
        removeSelection();
      } else if (several && mod && k === 'v' && clip) startPaste();
      else if (several && mod && k === 'a') selectAll();
      else if (several && (e.key === 'Delete' || e.key === 'Backspace') && selection.length) removeSelection();
      else if (e.key === 'Escape' && (pasting || selection.length)) {
        if (pasting) setPasting(false);
        else setChosen([]);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && picked) {
        deleteNote(picked);
      } else if (!mod && e.code === 'KeyH' && picked && sheet[picked.index]) changeNote(picked, { ...picked, note: { ...picked.note, hand: otherHand(picked.note.hand) } });
      else if (e.key === 'Escape') {
        if (recording) recorder.stop();
        setPicked(null);
      } else if (e.code === 'Space') {
        if (recording) recorder.stop();
        else listen();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  });

  // --- Keyboard ---------------------------------------------------------------------------
  // Every key of an imported piece, when there is room for them.
  const [bounds] = useState<[number, number]>(() => (source?.heard.length ? pieceRange(source.heard) : [36, 95]));
  const lowest = Math.min(2, Math.floor(bounds[0] / 12));
  const [octave, setOctave] = useState(() => (phone && source?.heard.length
    ? Math.min(6, Math.max(lowest, Math.floor(source.heard[0].midi / 12) - 1))
    : Math.min(3, Math.floor(bounds[0] / 12))));
  const low = phone ? (octave + 1) * 12 : octave * 12;
  const [from, to] = phone ? [low, Math.min(108, low + 23)] : [Math.max(21, low), Math.min(108, low + Math.max(59, bounds[1] - Math.min(3, Math.floor(bounds[0] / 12)) * 12))];
  const stickers = useMemo(() => {
    const out = new Map<number, Sticker[]>();
    for (const k of part.keys) out.set(k.midi, [...(out.get(k.midi) ?? []), k]);
    return out;
  }, [part.keys]);

  // Goes to a part; the `index`-th one played when it comes back.
  const showPart = (l: string, after = score, index = sheetOf(after).findIndex((p) => p.label === l)) => {
    preview.stop();
    setLabel(l);
    setSeen(index);
    setShown((s) => ({ index, times: s.times + 1 }));
    setPlacing(null);
    setPicked(null);
    setCursor(offsetsOf(sheetOf(after), after.division)[index] ?? 0);
  };
  const onSeen = (index: number) => {
    if (placing || writing || dialog || index === seen || !sheet[index]) return;
    setSeen(index);
    setLabel(sheet[index].label);
  };

  // --- Saving ----------------------------------------------------------------------------
  const done = (id: number) => {
    writeJson(key, { score: null });
    onSaved(id);
  };
  const saveImported = async () => {
    if (!rendered.notes.length) return setError('Il faut garder au moins une note.');
    setSaving(true);
    setError('');
    try {
      const { notes, numbers } = changeFrom(source!, score);
      if (notes) await piecesApi.saveChange(source!.piece.id, notes);
      if (numbers) await piecesApi.update(source!.piece.id, { numbers });
      done(source!.piece.id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };
  const save = async () => {
    if (source) return saveImported();
    const valid = scoreSchema.safeParse(score);
    if (!valid.success) {
      const wrong = valid.error.issues[0].message;
      return setError(wrong === 'Aucune note' ? 'Il faut au moins une note dans l’ordre du morceau.' : wrong);
    }
    if (!piece) return setDialog('save');
    setSaving(true);
    try {
      await piecesApi.saveScore(piece.id, score);
      // Lyrics follow the parts they are sung in.
      if (piece.lyrics?.length && piece.score) {
        const lyrics = movedLyrics(piece.lyrics, renderPlain(piece.score).spans, renderPlain(score).spans, piece.score.bpm / score.bpm);
        await piecesApi.update(piece.id, { lyrics });
      }
      done(piece.id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const keys = part.keys.filter((k) => k.hand === hand).sort((a, b) => a.number - b.number);
  const empty = !piece && score.parts.length === 1 && !part.notes.length && !part.keys.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-17 shrink-0 items-center gap-1 pl-16 pr-3 phone:h-15 phone:pl-14 sm:pr-5">
        <div className="min-w-0 flex-1 truncate font-semibold text-neutral-900 phone:hidden">{piece ? piece.title : 'Nouveau morceau'}{!structure && <span className="ml-2 text-xs font-normal text-neutral-400">Niveau {levelNames[levelOf(source!.piece)]}</span>}</div>
        <Segmented<'numbers' | 'piece'>
          value={step}
          onChange={(s) => {
            preview.stop();
            setShown((was) => ({ index: seen, times: was.times + 1 }));
            setStep(s);
          }}
          options={[{ value: 'numbers', label: '1. Numéros' }, { value: 'piece', label: '2. Morceau' }]}
        />
        <div className="flex flex-1 items-center justify-end gap-1">
          <Small onClick={() => setHistory(undo)} title="Annuler le dernier changement (Ctrl+Z)">↶</Small>
          <span className="phone:hidden"><Small onClick={() => setHistory(redo)} title="Rétablir">↷</Small></span>
          <Small onClick={() => (changed ? setDialog('leave') : onClose())}>Quitter</Small>
          <button type="button" onClick={() => void save()} disabled={saving} className={`${primaryButton} ml-1 phone:px-3`}>{saving ? '…' : 'Enregistrer'}</button>
        </div>
      </div>

      {/* Hand and part, the same in both steps; then what this step needs. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-200 bg-white px-3 py-2 sm:px-5">
        <Segmented<Hand> value={hand} onChange={setHand} options={[{ value: 'left', label: 'Gauche' }, { value: 'right', label: 'Droite' }]} />
        <div className="flex items-center gap-0.5">
          {score.parts.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => showPart(p.label)}
              aria-current={p.label === part.label}
              title={`Partie ${p.label}`}
              className={`h-9 min-w-9 rounded-lg px-2.5 text-sm font-semibold transition-colors ${p.label === part.label ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900'}`}
            >
              {p.label}
            </button>
          ))}
          {structure && <button
            type="button"
            title="Nouvelle partie"
            aria-label="Nouvelle partie"
            onClick={() => {
              const added = addPart(score, part.label, false);
              edit(() => added.score);
              showPart(added.label, added.score);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <PlusIcon className="h-4 w-4" />
          </button>}
        </div>

        {step === 'numbers' ? (
          <Switch on={assign} label="Assigner" title="Éteint : on écoute. Allumé : chaque nouvelle touche jouée reçoit un numéro." onChange={setAssign} />
        ) : (
          <>
            <Small active={preview.playing && !recording} onClick={listen} title="Espace">{preview.playing && !recording ? 'Arrêter' : 'Écouter'}</Small>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                if (recording) recorder.stop();
                else {
                  preview.stop();
                  const index = sheet[seen]?.label === part.label ? seen : sheet.findIndex((p) => p.label === part.label);
                  take.current = { index, label: part.label, beats: source ? span?.beats : undefined };
                  void recorder.start();
                }
              }}
              title={recording ? 'Arrêter (Espace)' : 'Joue au clavier, tes touches s’écrivent au bon moment'}
              className={`flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${recording ? 'bg-red-600 text-white' : 'text-red-600 hover:bg-red-50'}`}
            >
              <span className={`h-2.5 w-2.5 ${recording ? 'rounded-sm bg-white' : 'rounded-full bg-red-600'}`} />
              {!recorder.state ? 'S’enregistrer' : recorder.state.phase === 'count' ? `Dans ${recorder.state.left}…` : 'Arrêter'}
            </button>
            <Switch on={metronome} label="Métronome" title="Éteint : joue librement, le tempo de ta première prise est trouvé tout seul." onChange={setMetronome} />
            <Switch on={fill} label="Touche par touche" title="Chaque touche jouée s’écrit à la ligne grise, qui avance ensuite." onChange={(on) => {
              setFill(on);
              if (on && locate(offsets, cursor).index !== seen) setCursor(offsets[seen] ?? 0);
            }} />
            {fill && (
              <span className="flex items-center">
                <Small onClick={() => moveCursor(-length)} title="Reculer la ligne">↓</Small>
                <Small onClick={() => moveCursor(length)} title="Avancer la ligne : un silence">↑ Silence</Small>
              </span>
            )}
            <Switch on={selecting} label="Sélection" title="Glisser pour entourer des notes, puis les copier, couper ou supprimer. Maj+glisser marche aussi sans l’allumer." onChange={(on) => {
              setSelecting(on);
              if (!on) setChosen([]);
            }} />
            <label className="flex items-center gap-1.5 text-xs text-neutral-500" title="Durée des notes ajoutées">
              Durée
              <select value={held} onChange={(e) => setHeld(Number(e.target.value))} className="rounded-lg bg-transparent py-1.5 text-neutral-900 focus:outline-none">
                {[0.25, 0.5, 1, 2, 4].filter((d) => d * score.division >= 0.99).map((d) => <option key={d} value={d}>{{ 0.25: '¼ temps', 0.5: '½ temps', 1: '1 temps', 2: '2 temps', 4: '4 temps' }[d]}</option>)}
                {score.division === 3 && <option value={1 / 3}>⅓ temps</option>}
              </select>
            </label>
            {source && structure && offGrid(score) && (
              <Small
                title="Met toutes les notes du morceau dans les cases, à un tempo régulier. ↶ pour revenir en arrière."
                onClick={() => {
                  preview.stop();
                  setPicked(null);
                  edit(snapScore);
                }}
              >
                Tout caler
              </Small>
            )}
            {structure && <Tempo bpm={score.bpm} onChange={(bpm) => edit((s) => ({ ...s, bpm }))} />}
          </>
        )}
        <span className="flex-1" />
        <Popover label="•••" title="Plus" className="flex h-9 w-9 items-center justify-center rounded-lg text-xs text-neutral-600 hover:bg-neutral-100">
          {(close) => (
            <div className="space-y-4">
              {structure && <Field label={`Nom de la partie ${part.label}`}>
                <LabelInput
                  key={part.label}
                  label={part.label}
                  onRename={(to) => {
                    const next = renamePart(score, part.label, to);
                    if (next === score) return setError('Une autre partie a déjà ce nom.');
                    edit(() => next);
                    setLabel(to.trim().slice(0, 12));
                  }}
                />
              </Field>}
              {structure && <NumberField label="Durée de la partie" unit="temps" value={part.beats} min={1} max={Math.max(MAX_BEATS, part.beats)} onChange={(b) => edit((s) => setBeats(s, part.label, b))} />}
              <Field label="Une case vaut">
                <Segmented<Score['division']> full value={score.division} onChange={(d) => edit((s) => setDivision(s, d, !!source))} options={DIVISIONS} />
              </Field>
              <div>
                <div className="mb-1.5 text-sm font-semibold text-neutral-900">Décaler une main</div>
                {HANDS.map((h) => (
                  <div key={h} className="flex items-center text-sm text-neutral-600">
                    <span className="flex-1">{handName(h)}</span>
                    <Small onClick={() => edit((s) => shiftHand(s, part.label, h, -1))} title="Une case plus tôt">↓</Small>
                    <Small onClick={() => edit((s) => shiftHand(s, part.label, h, 1))} title="Une case plus tard">↑</Small>
                  </div>
                ))}
              </div>
              <div className="-mx-2 flex flex-col items-start">
                {structure && <Small
                  onClick={() => {
                    const added = addPart(score, part.label, true);
                    edit(() => added.score);
                    showPart(added.label, added.score);
                    close();
                  }}
                >
                  Dupliquer la partie
                </Small>}
                {structure && score.parts.length > 1 && <Small onClick={() => { close(); setDialog('remove'); }}>Supprimer la partie</Small>}
                <Small onClick={() => { close(); preview.stop(); setWriting({ hand }); }}>Écrire une suite de numéros</Small>
                {!piece && <Small onClick={() => { close(); preview.stop(); setImporting(true); }}>Partir d’un fichier</Small>}
              </div>
            </div>
          )}
        </Popover>
      </div>

      {error && <div className="shrink-0 bg-white px-3 pb-2 sm:px-5"><ErrorText>{error}</ErrorText></div>}
      {placing && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-neutral-100 bg-white px-3 py-2 text-sm text-neutral-900 sm:px-5">
          <span>
            Où est le <b className="text-lg tabular-nums">{placing.numbers[0]}</b> de la main {placing.hand === 'left' ? 'gauche' : 'droite'} ? Clique sa touche.
            {placing.everywhere && <span className="text-xs text-neutral-500"> Encore {placing.numbers.length + placing.everywhere.later.reduce((n, l) => n + l.numbers.length, 0)}.</span>}
          </span>
          <button type="button" onClick={() => setPlacing(null)} className="text-xs text-neutral-500 underline">{placing.everywhere ? 'Plus tard' : 'Annuler'}</button>
        </div>
      )}

      {step === 'numbers' ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-neutral-100 bg-white px-3 py-5 sm:px-5">
          <p className="mb-4 text-sm text-neutral-500">
            {assign ? `Joue les touches de la main ${hand === 'left' ? 'gauche' : 'droite'} dans l’ordre : 1, 2, 3…` : 'Joue pour écouter. Allume Assigner pour donner un numéro aux touches.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {keys.map((k) => (
              <span key={k.number} className={`flex h-12 items-center rounded-xl ${hand === 'left' ? 'bg-hand-l-soft text-hand-l-ink' : 'bg-hand-r-soft text-hand-r-ink'}`}>
                <button type="button" onClick={() => playKey(k.midi)} title="Écouter" className="flex h-12 items-center gap-2 pl-4 pr-2">
                  <b className="text-xl tabular-nums">{k.number}</b>
                  <span className="text-sm opacity-75"><NoteText text={frenchName(k.midi)} /></span>
                </button>
                <button type="button" onClick={() => setPlacing({ hand, numbers: [k.number], run: null })} title="Mettre ce numéro sur une autre touche" className="h-12 px-1.5 text-xs opacity-50 hover:opacity-100">Déplacer</button>
                <button type="button" onClick={() => edit((s) => removeKey(s, part.label, hand, k.number))} title="Supprimer le numéro et ses notes" aria-label={`Supprimer le ${k.number}`} className="h-12 pl-1.5 pr-3 opacity-50 hover:text-red-600 hover:opacity-100">✕</button>
              </span>
            ))}
            {!keys.length && !empty && <span className="text-sm text-neutral-400">Aucun numéro à la main {hand === 'left' ? 'gauche' : 'droite'}.</span>}
          </div>
          {empty && (
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="mt-2 w-full max-w-xl rounded-xl border-2 border-dashed border-neutral-200 px-4 py-5 text-center text-sm text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-900"
            >
              <span className="block font-medium text-neutral-900">Partir d’un fichier</span>
              <span className="mt-1 block text-xs text-neutral-400">Image de numéros ou de partition (lue par l’IA) · partition PDF · vidéo · son</span>
            </button>
          )}
          {draft && changed && (
            <p className="mt-6 text-xs text-neutral-400">
              Brouillon repris sur cet appareil.
              <button
                type="button"
                className="ml-2 underline hover:text-neutral-900"
                onClick={() => {
                  edit(() => saved);
                  showPart(saved.parts[0].label, saved);
                }}
              >
                {piece ? 'Version enregistrée' : 'Repartir de zéro'}
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col border-t border-neutral-100 bg-white pl-11 pr-11">
          {(selection.length > 0 || clip || pasting) && (
            <div className="absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl bg-white px-1.5 py-1 text-xs shadow-lg ring-1 ring-neutral-200">
              {pasting ? (
                <>
                  <span className="px-2 text-neutral-500">Clique où coller {clip!.notes.length} note{clip!.notes.length > 1 ? 's' : ''}</span>
                  <Small onClick={() => setPasting(false)} title="Échap">Annuler</Small>
                </>
              ) : (
                <>
                  {selection.length > 0 && (
                    <>
                      <span className="px-2 font-semibold text-neutral-900">{selection.length} note{selection.length > 1 ? 's' : ''}</span>
                      <Small onClick={copySelection} title="Ctrl+C">Copier</Small>
                      <Small onClick={() => { copySelection(); removeSelection(); }} title="Ctrl+X">Couper</Small>
                      <Small onClick={removeSelection} title="Suppr">Supprimer</Small>
                    </>
                  )}
                  {clip && <Small onClick={startPaste} title={`Ctrl+V : ${clip.notes.length} note${clip.notes.length > 1 ? 's' : ''}`}>Coller</Small>}
                  {selection.length > 0 && <Small onClick={() => setChosen([])} title="Échap">✕</Small>}
                </>
              )}
            </div>
          )}
          <RollEditor
            parts={sheet}
            division={score.division}
            from={from}
            to={to}
            hand={hand}
            length={length}
            extend={structure}
            cursor={fill ? (structure ? cursor : Math.min(cursor, offsets[sheet.length] - 1)) : null}
            playhead={playhead}
            picked={picked}
            shown={shown}
            selecting={selecting}
            selection={selection}
            pasting={pasting && clip ? (at) => clipPlaces(score, clip, at, structure) : null}
            onSelect={(notes) => {
              if (notes.length) setPicked(null);
              setChosen(notes);
            }}
            onPaste={pasteAt}
            edge={(index) => (structure ? edgeRange(score, index) : null)}
            onEdge={(index, by) => {
              preview.stop();
              setPicked(null);
              const next = moveEdge(score, index, by);
              if (fill) setCursor(offsetsOf(sheetOf(next), next.division)[seen] ?? 0);
              edit((s) => moveEdge(s, index, by));
            }}
            onGo={(index) => sheet[index] && showPart(sheet[index].label, score, index)}
            onSeen={onSeen}
            onPick={setPicked}
            onAdd={({ index, note }) => {
              setPicked(null);
              edit((s) => addNotes(s, sheet[index].label, [note]));
            }}
            onChange={changeNote}
            onRemove={deleteNote}
          />
        </div>
      )}

      <div className="flex shrink-0 items-stretch gap-1 border-t border-neutral-200 bg-white px-1">
        <OctaveButton label="Octave plus grave" onClick={() => setOctave((o) => Math.max(lowest, o - 1))}>‹</OctaveButton>
        <div className="min-w-0 flex-1 px-1">
          <PianoKeyboard from={from} to={to} labels="names" stickers={stickers} height="clamp(90px, 20dvh, 200px)" />
        </div>
        <OctaveButton label="Octave plus aiguë" onClick={() => setOctave((o) => Math.min(phone ? 6 : 4, o + 1))}>›</OctaveButton>
      </div>

      {/* Order the parts are played in. */}
      {step === 'piece' && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-neutral-200 bg-white px-3 py-2 sm:px-5">
          <span className="mr-2 text-xs text-neutral-500">Ordre</span>
          <OrderChips
            order={score.order}
            selected={orderAt}
            onPick={(i) => {
              showPart(score.order[i], score, i);
              if (structure) setOrderAt(orderAt === i ? null : i);
            }}
            onMove={structure ? (a, b) => {
              const next = placeInOrder(score, a, b);
              edit(() => next);
              setOrderAt(b);
              showPart(next.order[b], next, b);
            } : null}
          />
          {orderAt !== null && orderAt < score.order.length ? (
            <>
              <Small onClick={() => { edit((s) => moveInOrder(s, orderAt, -1)); setOrderAt(Math.max(0, orderAt - 1)); }} title="Plus tôt">←</Small>
              <Small onClick={() => { edit((s) => moveInOrder(s, orderAt, 1)); setOrderAt(Math.min(score.order.length - 1, orderAt + 1)); }} title="Plus tard">→</Small>
              <Small onClick={() => { edit((s) => removeFromOrder(s, orderAt)); setOrderAt(null); }}>Retirer</Small>
            </>
          ) : (
            <>
              {structure && <Small onClick={() => edit((s) => addToOrder(s, part.label))} title={`Jouer ${part.label} à la fin`}>+ {part.label}</Small>}
              <span className="flex-1" />
              <Small onClick={() => (preview.playing ? preview.stop() : preview.play(0))}>Écouter tout</Small>
            </>
          )}
        </div>
      )}

      {writing && (
        <RunPanel
          key={`${part.label}${writing.text ?? ''}`}
          hand={writing.hand}
          textOf={(h) => (writing.text !== undefined && h === writing.hand ? writing.text : runText(part, h))}
          unknown={(h, run) => unknownNumbers(part, h, run)}
          midiOf={(h, n) => midiOf(part, h, n)}
          onPlaceKeys={(h, numbers, text) => {
            setWriting(null);
            setPlacing({ hand: h, numbers, run: text });
          }}
          onPlace={(h, run, taps) => {
            edit((s) => (taps ? placeTaps(s, part.label, h, run, taps) : placeRun(s, part.label, h, run, run.map((_, i) => i))));
            setWriting(null);
            setStep('piece');
          }}
          onClose={() => setWriting(null)}
        />
      )}
      {importing && (
        <ImportModal
          folders={folders}
          onClose={() => setImporting(false)}
          onSaved={onSaved}
          onNumbers={(read) => {
            setImporting(false);
            edit(() => read.score);
            showPart(read.score.parts[0].label, read.score);
            setTitle(read.title);
            setStep('numbers');
            setPlacing(placingOf(read.toPlace));
          }}
        />
      )}
      {dialog === 'remove' && (
        <ConfirmModal
          title={`Supprimer la partie ${part.label} ?`}
          message="Elle disparaît aussi de l’ordre du morceau. ↶ pour revenir en arrière."
          confirmLabel="Supprimer"
          danger
          onConfirm={() => {
            const next = removePart(score, part.label);
            edit(() => next);
            showPart(next.parts[0].label, next);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'leave' && (
        <ConfirmModal
          title="Abandonner les changements ?"
          message="Ce qui n’est pas enregistré sera perdu."
          confirmLabel="Abandonner"
          danger
          onConfirm={() => {
            writeJson(key, { score: null });
            onClose();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'save' && <SaveModal title={title} score={score} onClose={() => setDialog(null)} onSaved={done} />}
    </div>
  );
}

// Typed, or tapped along with the music.
function Tempo({ bpm, onChange }: { bpm: number; onChange(bpm: number): void }) {
  const taps = useRef<number[]>([]);
  return (
    <span className="flex items-center gap-1 text-xs text-neutral-500">
      <NumberField label="Tempo" unit="" value={bpm} min={20} max={300} onChange={onChange} />
      <Small
        title="Tape plusieurs fois en rythme avec la musique"
        onClick={() => {
          const now = performance.now() / 1000;
          const last = taps.current[taps.current.length - 1];
          if (last !== undefined && now - last > 2.5) taps.current = [];
          taps.current = [...taps.current, now].slice(-9);
          const heard = tappedBpm(taps.current);
          if (heard && heard !== bpm) onChange(heard);
        }}
      >
        Taper
      </Small>
    </span>
  );
}

export function OctaveButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="w-8 shrink-0 rounded-lg text-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900">{children}</button>
  );
}

// A number typed freely, taken when it makes sense.
function NumberField({ label, unit, value, min, max, onChange }: { label: string; unit: string; value: number; min: number; max: number; onChange(v: number): void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const save = () => {
    const n = Math.round(Number(text));
    if (!text.trim() || !Number.isFinite(n)) return setText(String(value));
    const ok = Math.min(max, Math.max(min, n));
    setText(String(ok));
    if (ok !== value) onChange(ok);
  };
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-500">
      <span className="flex-1">{label}</span>
      <input
        value={text}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="w-14 rounded-lg border border-neutral-200 px-2 py-1.5 text-center tabular-nums text-neutral-900 focus:border-neutral-500 focus:outline-none"
      />
      {unit}
    </label>
  );
}

function SaveModal({ title: named, score, onClose, onSaved }: { title: string; score: Score; onClose(): void; onSaved(id: number): void }) {
  const [title, setTitle] = useState(named);
  const [artist, setArtist] = useState('');
  const [folder, setFolder] = useState<number | null>(null);
  const [folders, setFolders] = useState<PieceFolder[]>([]);
  const [difficulty, setDifficulty] = useState<PieceDifficulty | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    foldersApi.list().then(setFolders, () => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { id } = await piecesApi.createScore({ title: title.trim(), artist: artist.trim() || null }, score, { folder_id: folder, difficulty });
      onSaved(id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal title="Enregistrer le morceau" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Titre"><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={inputClass} autoFocus /></Field>
        <Field label="Artiste"><input value={artist} maxLength={120} placeholder="Facultatif" onChange={(e) => setArtist(e.target.value)} className={inputClass} /></Field>
        {folders.length > 0 && <Field label="Dossier"><FolderSelect folders={folders} value={folder} onChange={setFolder} /></Field>}
        <Field label="Difficulté"><DifficultyPicker value={difficulty} onChange={setDifficulty} /></Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
          <button type="submit" disabled={!title.trim() || saving} className={primaryButton}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}
