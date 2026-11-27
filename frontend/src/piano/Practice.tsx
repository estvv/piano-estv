import { frenchName, MIDI_MAX, MIDI_MIN, noteName } from '@piano/shared';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../app/auth';
import { Segmented } from '../components/Segmented';
import { forceNight, shownPiece } from '../lib/appearance';
import { useObservable } from '../lib/store';
import { useFullscreen } from '../lib/useFullscreen';
import { PHONE, useMedia } from '../lib/useMedia';
import { NoteText } from './Accidentals';
import { audioState, ensureAudio } from './audio';
import { sourceLabels, type SourceId } from './input/bus';
import { useHeldNotes, useNoteInput } from './input/hooks';
import { PianoKeyboard, type KeyLabels } from './PianoKeyboard';
import { foldersApi, piecesApi } from './pieces/api';
import { ExtractModal } from './pieces/ExtractModal';
import { listOrder, neighbour } from './pieces/folderPath';
import { NotesEditor } from './pieces/NotesEditor';
import { PiecesPanel } from './pieces/PiecesPanel';
import { PlayAlong } from './pieces/PlayAlong';
import { ScoreEditor, type ScoreDraft } from './pieces/ScoreEditor';
import { currentOf, drop, next, previous, queueFrom, startQueue, type Queue } from './pieces/shuffle';
import type { StoredPiece } from './pieces/types';
import { stage } from './stage/settings';

type Span = '1' | '2' | '4' | 'full';

// The piano: free play, or one of the account's
// imported pieces (?morceau=<id>) with falling notes, or all of them one after
// the other in a random order.
export function PianoPage() {
  const [params, setParams] = useSearchParams();
  const [queue, setQueue] = useState<Queue | null>(null);
  const pieceId = queue ? currentOf(queue) : Number(params.get('morceau')) || null;
  // Kept when the listening stops, so that the piece goes on.
  const turn = useRef(0);
  if (queue) turn.current = queue.turn;
  const [piece, setPiece] = useState<StoredPiece | null>(null);
  // Writing a piece: a new one (?nouveau) or this one (?modifier).
  const creating = params.has('nouveau');
  // Read on a picture: where the new one starts from.
  const [draft, setDraft] = useState<ScoreDraft | null>(null);
  const changing = !!pieceId && !queue && params.has('modifier');
  // Read again once changed.
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState(false);
  // Kept from a piece to the next.
  const fullscreen = useFullscreen();
  const { full, exit } = fullscreen;
  const played = !!pieceId && !error && !creating && !changing;
  useEffect(() => {
    if (full && !played) exit();
  }, [full, played, exit]);
  // Styles other than the classic one are seen in the dark.
  const dark = useObservable(stage).style !== 'classic' && played;
  useEffect(() => {
    forceNight(dark);
    return () => forceNight(false);
  }, [dark]);
  // The hands take the colours of the piece open, played or changed.
  const opened = !creating && pieceId ? pieceId : null;
  useEffect(() => {
    shownPiece.set(opened);
    return () => shownPiece.set(null);
  }, [opened]);
  // A new piece from parts of this one.
  const [extracting, setExtracting] = useState<number | null>(null);
  const [labels, setLabels] = useState<KeyLabels>('names');

  // The pieces in the order of the list; read again when the list closes.
  const { user } = useAuth();
  const [order, setOrder] = useState<number[]>([]);
  useEffect(() => {
    if (!user || panel) return;
    let stale = false;
    Promise.all([piecesApi.list(), foldersApi.list()])
      .then(([p, f]) => !stale && setOrder(listOrder(p, f)), () => {});
    return () => {
      stale = true;
    };
  }, [user, panel]);
  // Whether the piece arriving starts by itself; grows when the same one comes back.
  const autoPlay = useRef(false);
  const [again, setAgain] = useState(0);
  const go = (by: 1 | -1, playing: boolean) => {
    autoPlay.current = playing;
    if (queue) return setQueue(by > 0 ? next(queue) : previous(queue));
    const id = pieceId && neighbour(order, pieceId, by);
    if (id && id !== pieceId) setParams({ morceau: String(id) });
    else setAgain((n) => n + 1);
  };

  useEffect(() => {
    setPiece(null);
    setError('');
    if (!pieceId) return;
    let stale = false;
    piecesApi.get(pieceId).then((p) => !stale && setPiece(p), (e: Error) => {
      if (stale) return;
      setError(e.message);
      setQueue((q) => q && drop(q, pieceId));
    });
    return () => {
      stale = true;
    };
  }, [pieceId, version]);

  // Listening: the address follows the piece being played.
  const queued = queue && pieceId;
  useEffect(() => {
    if (queued) setParams({ morceau: String(queued) }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued]);

  if (creating) {
    return (
      <ScoreEditor
        piece={null}
        from={draft ?? undefined}
        onSaved={(id) => setParams({ morceau: String(id) }, { replace: true })}
        onClose={() => setParams({}, { replace: true })}
      />
    );
  }
  if (changing && piece && piece.id === pieceId) {
    const back = () => setParams({ morceau: String(pieceId) }, { replace: true });
    const saved = () => {
      setVersion((v) => v + 1);
      back();
    };
    const how = params.get('modifier');
    const step = how === 'numeros' ? 'numbers' as const : undefined;
    return piece.score || how === 'notes'
      ? <ScoreEditor key={piece.id} piece={piece} firstStep={how === 'notes' ? 'piece' : step} onSaved={saved} onClose={back} />
      : <NotesEditor key={piece.id} piece={piece} firstStep={step} onSaved={saved} onClose={back} />;
  }

  return (
    <div className={full ? 'fixed inset-0 z-40 bg-page' : 'h-full'}>
      {!full && <button
        type="button"
        onClick={() => setPanel(true)}
        aria-label="Morceaux"
        className="absolute right-4 top-4 z-10 phone:right-2.5 phone:top-2.5 phone:p-2.5 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-neutral-700 ring-1 ring-neutral-200 transition-colors hover:text-neutral-900"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <path d="M9 18V5.5l11-2V16" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" />
        </svg>
        <span className="phone:hidden">Morceaux</span>
      </button>}

      {pieceId ? (
        piece && piece.id === pieceId ? (
          <PlayAlong
            key={`${piece.id}-${turn.current}-${again}`}
            piece={piece}
            labels={labels}
            autoPlay={autoPlay.current}
            fullscreen={fullscreen}
            nav={{
              next: (playing) => go(1, playing),
              previous: (playing) => go(-1, playing),
              shuffle: queue !== null,
              // The piece goes on; the ones after it change.
              onShuffle: (on) => setQueue(on ? queueFrom(order, piece.id, turn.current) : null),
            }}
            onEdit={(what = 'cells') => {
              setQueue(null);
              setParams({ morceau: String(pieceId), modifier: { cells: '1', numbers: 'numeros', notes: 'notes' }[what] });
            }}
            onExtract={() => setExtracting(piece.id)}
            onChange={(change) => setPiece((p) => (p && p.id === piece.id ? { ...p, ...change } : p))}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">{error || 'Chargement du morceau…'}</div>
        )
      ) : (
        <FreePlay labels={labels} setLabels={setLabels} />
      )}

      {extracting !== null && (
        <ExtractModal
          id={extracting}
            onClose={() => setExtracting(null)}
          onSaved={(id) => {
            setExtracting(null);
            autoPlay.current = false;
            setQueue(null);
            setParams({ morceau: String(id) });
          }}
        />
      )}
      {panel && (
        <PiecesPanel
            current={pieceId}
          listening={queue !== null}
          onShuffle={(ids) => {
            // Browsers only start the sound from a click.
            void ensureAudio().catch(() => {});
            setPanel(false);
            autoPlay.current = true;
            const started = startQueue(ids);
            setQueue(started && { ...started, turn: turn.current + 1 });
          }}
          onCreate={(from) => {
            setDraft(from ?? null);
            setPanel(false);
            setQueue(null);
            setParams({ nouveau: '1' });
          }}
          onPick={(id) => {
            setPanel(false);
            autoPlay.current = false;
            setQueue(null);
            setParams(id ? { morceau: String(id) } : {});
          }}
          onUpdated={(id, meta) => setPiece((p) => (p && p.id === id ? { ...p, ...meta } : p))}
          onClose={() => setPanel(false)}
        />
      )}
    </div>
  );
}

// Free play: every input source, nothing graded.
function FreePlay({ labels, setLabels }: { labels: KeyLabels; setLabels(l: KeyLabels): void }) {
  const audio = useObservable(audioState);
  const held = useHeldNotes();
  const phone = useMedia(PHONE);
  // Upright, four octaves leave keys too thin for fingers.
  const [span, setSpan] = useState<Span>(() => (phone && window.innerWidth < 640 ? '2' : '4'));
  const [lastSource, setLastSource] = useState<SourceId | null>(null);
  useNoteInput((e) => e.type === 'on' && setLastSource(e.source));

  const [octave, setOctave] = useState(4);
  const base = (octave + 1) * 12;
  const [from, to] = span === 'full' ? [MIDI_MIN, MIDI_MAX] : span === '2' ? [base, base + 23] : span === '1' ? [base, base + 11] : [base - 12, base + 35];
  const heldList = [...held].sort((a, b) => a - b);
  const shiftOctave = (d: number) => setOctave((o) => Math.min(6, Math.max(2, o + d)));

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 text-center">
        <div className="flex min-h-[12rem] short:min-h-0 flex-wrap items-center justify-center gap-4">
          {heldList.length === 0 && <span className="text-3xl font-semibold text-neutral-300 md:text-4xl">Joue une note</span>}
          {heldList.map((m) => <NoteCard key={m} midi={m} />)}
        </div>
        <div className="mt-3 h-5 text-sm text-neutral-400">
          {audio === 'loading' ? 'Chargement des sons…' : lastSource ? `via ${sourceLabels[lastSource]}` : ''}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 px-4 pb-4 text-sm text-neutral-600 phone:gap-2 phone:pb-3">
        <Segmented<Span> value={span} onChange={setSpan} options={[...(phone ? [{ value: '1' as const, label: '1 octave' }] : []), { value: '2', label: '2 octaves' }, { value: '4', label: '4 octaves' }, ...(phone ? [] : [{ value: 'full' as const, label: '88 touches' }])]} />
        <Segmented<KeyLabels> value={labels} onChange={setLabels} options={[{ value: 'names', label: 'Notes' }, { value: 'scientific', label: 'C D E' }, { value: 'none', label: 'Aucun' }]} />
        <div className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-0.5">
          <button type="button" onClick={() => shiftOctave(-1)} className="rounded-md px-2.5 py-1.5 font-medium hover:bg-neutral-50" title="Octave plus grave" aria-label="Octave plus grave">−</button>
          <span className="px-1 tabular-nums">Octave {octave}</span>
          <button type="button" onClick={() => shiftOctave(1)} className="rounded-md px-2.5 py-1.5 font-medium hover:bg-neutral-50" title="Octave plus aiguë" aria-label="Octave plus aiguë">+</button>
        </div>
      </div>

      <div className="border-t border-neutral-200 bg-white px-2 pb-3 pt-3 sm:px-4">
        <PianoKeyboard from={from} to={to} labels={labels} height="clamp(130px, 38dvh, 320px)" />
      </div>
    </div>
  );
}

const english = (midi: number, flat = false) => noteName(midi, flat).replace('#', '♯').replace(/^([A-G])b/, '$1♭');

// One card per held note, always the same size.
function NoteCard({ midi }: { midi: number }) {
  return (
    <div className="w-28 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-center shadow-sm">
      <div className="text-3xl font-bold text-neutral-900"><NoteText text={frenchName(midi)} /></div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-500"><NoteText text={english(midi)} /></div>
    </div>
  );
}
