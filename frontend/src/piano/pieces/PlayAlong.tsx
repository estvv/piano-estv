import { isBlack, pieceDuration, type PieceNumbering, type Hand, type PieceLevel, type PieceSection } from '@piano/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RepeatIcon, ShuffleIcon } from '../../components/icons';
import { readJson, writeJson } from '../../lib/storage';
import { useObservable } from '../../lib/store';
import { COMPACT, PHONE, SHORT, TOUCH, useMedia } from '../../lib/useMedia';
import { useWakeLock } from '../../lib/useWakeLock';
import { useNoteInput } from '../input/hooks';
import { PianoKeyboard, type KeyLabels, type KeyMark, type Sticker } from '../PianoKeyboard';
import { stage } from '../stage/settings';
import { KeyLight } from '../stage/StageFields';
import { piecesApi } from './api';
import { layoutOf, levelNames, levelNotes, levelOf, playedSpan } from './derive';
import { FallingNotes } from './FallingNotes';
import { LyricsBanner } from './LyricsBanner';
import { LyricsModal } from './LyricsModal';
import { downloadMidi } from './midiExport';
import { TakeCard } from './TakeCard';
import { useTakes } from './useTakes';
import { nextRate, progressive } from './progressive';
import { usePracticeClock } from './usePracticeClock';
import { CoachModal } from './CoachModal';
import { WaitChoice, type WaitInput } from './WaitChoice';
import { disableMic, enableMic, micState } from '../input/mic';
import { PartNumbers } from './PartNumbers';
import { VideoModal } from './video/VideoModal';
import { contextOf } from './coach';
import { useMediaSession } from './useMediaSession';
import { useVoice, useVoicePlayer } from './voice/useVoice';
import { VoiceModal } from './voice/VoiceModal';
import { FullscreenControls, FullscreenIcon } from './FullscreenControls';
import { FINGER_KEY, scrollToKeys } from './keyScroll';
import { RecentreButton, useFollow } from './useFollow';
import { numberPiece, partAt } from './numbers';
import { Numbers } from './Numbers';
import { NumbersPanel } from './NumbersPanel';
import { cutAt, joinPrevious, moveStart, rename, toSaved } from './parts';
import { Cover } from './pieceFields';
import { PieceOptions, RATES, type HandChoice, type NumbersShown } from './PieceOptions';
import { PiecePlayer, pieceRange, type PlayMode } from './player';
import { clock, ControlButton, controlIcon, PlayButton, SkipButton, SlidersIcon, Timeline } from './PlayerControls';
import { handOf } from './simplify';
import type { PieceSequence, StoredPiece } from './types';

// From a piece to another: down the list, or in a random order (shuffle.ts).
export interface PieceNav {
  // `playing`: the other piece starts by itself.
  next(playing: boolean): void;
  previous(playing: boolean): void;
  shuffle: boolean;
  onShuffle(on: boolean): void;
}

// Before that, "previous" goes to the piece before; after, back to the start.
const RESTART_AFTER = 3;

// Keys thinner than this have no room for a name.
const NAMED_KEY = 18;

// Numbers on or off: kept on this device.
const NUMBERS_KEY = 'piano.numbers.v1';
const LYRICS_KEY = 'piano.lyrics.v1';
const WAIT_KEY = 'piano.wait-input.v1';
const PANEL_KEY = 'piano.numbers-panel.v1';
// The side panel writes the keys down instead of showing them (Notebook.tsx).
const WRITING_KEY = 'piano.numbers.writing';

// A piece with falling notes above the keyboard: listen to it, or let it wait
// for the right notes, with the piece as numbers above (see numbers.ts).
//
// The title and the player on top, the rest in "Réglages".
export function PlayAlong({ piece, labels, nav, autoPlay, fullscreen, onEdit, onExtract, onChange }: {
  piece: StoredPiece;
  labels: KeyLabels;
  nav: PieceNav;
  // Starts as soon as it is there.
  autoPlay: boolean;
  // The piece is changed on a page of its own.
  onEdit(what?: 'cells' | 'numbers' | 'notes'): void;
  // Only the lyrics, the notes and the keyboard.
  fullscreen: { full: boolean; enter(): void; exit(): void };
  // A new piece from parts of this one.
  onExtract(): void;
  // Already saved, or being saved.
  onChange(change: Partial<StoredPiece>): void;
}) {
  // Everything shown comes from the piece, step by step (see derive.ts): its
  // tracks and level, the changes made to it, then its numbers.
  const score = piece.score ?? null;
  const level = levelOf(piece);
  const enabled = useMemo(() => piece.tracks?.map((t) => t.enabled) ?? [], [piece.tracks]);
  const layout = useMemo(() => layoutOf(piece), [piece]);
  const notes = useMemo(() => levelNotes(piece), [piece]);
  const { grid, sections, given, duration } = layout;
  const player = useMemo(() => new PiecePlayer(piece.notes, pieceDuration(piece.notes)), [piece.notes]);
  useEffect(() => () => player.dispose(), [player]);
  // One hand at a time: the other is neither heard nor shown.
  const [handChoice, setHand] = useState<HandChoice>('both');
  const bothHands = useMemo(() => notes.some((n) => handOf(n) === 'left') && notes.some((n) => handOf(n) === 'right'), [notes]);
  const hand = bothHands ? handChoice : 'both';
  const heard = useMemo(() => (hand === 'both' ? notes : notes.filter((n) => handOf(n) === hand)), [notes, hand]);
  // The silences around are skipped.
  const [start, end] = useMemo(() => playedSpan(piece, notes, duration), [piece, notes, duration]);
  useEffect(() => player.setNotes(heard, end, start), [player, heard, end, start]);
  const state = useObservable(player.state);
  const [mode, setMode] = useState<PlayMode>('listen');
  const [rate, setRate] = useState(1);
  const [, setFrame] = useState(0);
  const compact = useMedia(COMPACT);
  const short = useMedia(SHORT);
  // No room for the numbers' panel on a phone.
  const phone = useMedia(PHONE);
  const touch = useMedia(TOUCH);
  const [options, setOptions] = useState(false);
  const closeOptions = useCallback(() => setOptions(false), []);
  useWakeLock(state.playing);
  usePracticeClock(player, piece.id);
  // The coach: what it is told is written as it opens.
  // Filming a video, and how the piece was before.
  const [video, setVideo] = useState(false);
  // The numbers of the part being played, large.
  const [partShown, setPartShown] = useState(false);
  const filmed = useRef<{ mode: PlayMode; loop: [number, number] | null } | null>(null);
  const [coach, setCoach] = useState<{ context: string; part: string; take: boolean; ask: boolean } | null>(null);
  const openCoach = (ask: boolean) => {
    player.pause();
    setOptions(false);
    takes.dismiss();
    const i = sectionAt(player.position);
    const part = range.part
      ? { name: `la partie ${range.part}`, start: range.start, end: range.end }
      : sections[i]
        ? { name: `la partie ${sections[i].label}`, start: sections[i].start, end: sections[i].end }
        : { name: 'le morceau', start, end };
    const take = takes.last;
    setCoach({
      context: contextOf({ title: piece.title, artist: piece.artist ?? null, level: levelNames[level], bpm: piece.score?.bpm ?? piece.bpm, rate, grid, part, notes: heard }, take),
      part: part.name,
      take: !!take,
      ask,
    });
  };
  useMediaSession(player, { title: piece.title, artist: piece.artist ?? null, cover: piece.cover ?? null }, { next: () => nav.next(true), previous: () => nav.previous(true) });
  const styled = useObservable(stage).style !== 'classic';
  const keyLight = useRef<HTMLCanvasElement>(null);
  const [from, to] = useMemo(() => pieceRange(notes.length ? notes : piece.notes), [notes, piece.notes]);
  const [partsError, setPartsError] = useState('');

  // Where numbers are written: on the notes, on the keys (once one switch for both).
  const [numbersShown, setNumbersShown] = useState<NumbersShown>(() => {
    const saved = readJson<{ on?: boolean; notes?: boolean; keys?: boolean; names?: boolean }>(NUMBERS_KEY, {});
    const on = saved.on ?? true;
    return { notes: saved.notes ?? on, keys: saved.keys ?? on, names: saved.names ?? true };
  });
  const numbersOn = numbersShown.notes;
  const [lyricsOn, setLyricsOn] = useState(() => readJson(LYRICS_KEY, { on: true }).on);
  const lyrics = piece.lyrics?.some((l) => l.time !== null) ? piece.lyrics : null;
  const [karaoke, setKaraoke] = useState(false);
  // A recording heard along, not while the piece waits for the notes.
  const { voice, save: saveVoice, tweak: tweakVoice } = useVoice(piece.id);
  const [voicing, setVoicing] = useState(false);
  useVoicePlayer(voice, player, !!voice?.on && mode === 'listen');
  // Beside the notes on a computer, over them on a smaller screen.
  const [panel, setPanel] = useState(() => !compact && readJson(PANEL_KEY, { open: true }).open);
  const [writing, setWritingShown] = useState(() => readJson<boolean>(WRITING_KEY, false));
  const setWriting = (on: boolean) => {
    setWritingShown(on);
    writeJson(WRITING_KEY, on);
  };
  const [big, setBig] = useState(false);
  const numbering = piece.numbering ?? 'order';
  const whole = !!piece.whole;
  const numbered = useMemo(() => numberPiece(notes, sections, grid, { ...given, numbering, whole }), [notes, sections, grid, given, numbering, whole]);
  const shownParts = useMemo(() => {
    const own = <T extends { hand: Hand }>(list: T[]) => (hand === 'both' ? list : list.filter((x) => x.hand === hand));
    return numbered.parts.map((p) => ({ ...p, rows: own(p.rows), keys: own(p.keys) }));
  }, [numbered, hand]);
  // Looped sections, first and last index (inclusive).
  const [loop, setLoop] = useState<[number, number] | null>(null);
  // Takes in wait mode: the loop, or the whole piece.
  const range = loop && sections[loop[0]] && sections[loop[1]]
    ? { start: sections[loop[0]].start, end: Math.min(end, sections[loop[1]].end), part: sections.slice(loop[0], loop[1] + 1).map((s) => s.label).join(' ') }
    : { start, end, part: '' };
  // A loop in wait mode, a little faster after each good take.
  const faster = useObservable(progressive);
  const climbing = faster.on && !!loop && mode === 'wait';
  const takes = useTakes(player, piece.id, level, range, (score) => {
    if (!climbing) return null;
    const next = nextRate(player.rate, score, faster);
    if (next !== player.rate) pickRate(next);
    return next;
  });
  // From its slow start, as it begins.
  const restart = climbing ? `${faster.from}|${loop?.join("-")}` : null;
  useEffect(() => {
    if (restart !== null) pickRate(faster.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restart]);

  const applyLoop = (next: [number, number] | null) => {
    setLoop(next);
    player.setLoop(next ? { start: sections[next[0]].start, end: Math.min(end, sections[next[1]].end) } : null);
    setFrame((f) => f + 1);
  };
  useNoteInput();

  // Once, when the piece arrives.
  useEffect(() => {
    if (autoPlay) void player.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Shuffled: one piece after the other.
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    if (state.finished && navRef.current.shuffle) navRef.current.next(true);
  }, [state.finished]);

  // Coarse UI refresh (time, sounding keys) ~20 times a second while playing.
  useEffect(() => {
    if (!state.playing) return;
    const id = setInterval(() => setFrame((f) => f + 1), 50);
    return () => clearInterval(id);
  }, [state.playing]);

  const { full } = fullscreen;
  const enterFull = () => {
    setOptions(false);
    setBig(false);
    fullscreen.enter();
  };
  const toggleFull = useRef(() => {});
  // Not under the windows opened over the piece.
  toggleFull.current = () => {
    if (full) fullscreen.exit();
    else if (!document.querySelector('[aria-modal="true"]')) enterFull();
  };

  // Space bar: play / pause. F: full screen. Escape: stop looping.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        player.toggle();
      } else if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey && !['TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        toggleFull.current();
      } else if (e.key === 'Escape' && player.loop) {
        setLoop(null);
        player.setLoop(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  const current = partAt(shownParts, player.position);
  const part = shownParts[current];
  const column = part ? Math.floor((grid.toBeats(player.position) - part.beat) * part.division + 0.3) : 0;
  const stickers = useMemo(() => {
    const out = new Map<number, Sticker[]>();
    for (const k of part?.keys ?? []) out.set(k.midi, [...(out.get(k.midi) ?? []), k]);
    return out;
  }, [part]);

  const marks = new Map<number, KeyMark>();
  if (mode === 'listen') {
    for (const n of player.sounding()) marks.set(n.midi, n.hand === 'left' ? 'hint' : 'target');
  } else {
    for (const n of state.expected) marks.set(n.midi, state.played.includes(n.midi) ? 'correct' : n.hand === 'left' ? 'hint' : 'target');
  }
  if (state.wrong !== null) marks.set(state.wrong, 'wrong');

  // Seeking out of the loop ends it.
  const seek = (t: number) => {
    if (loop && (!sections[loop[1]] || t < sections[loop[0]].start - 0.05 || t >= sections[loop[1]].end)) applyLoop(null);
    player.seek(t);
    setFrame((f) => f + 1);
  };
  const sectionAt = (t: number) => {
    let i = 0;
    while (i + 1 < sections.length && sections[i + 1].start <= t + 0.05) i++;
    return i;
  };

  // Waiting for notes played on the screen: keys as wide as a finger, on a
  // keyboard that follows the notes.
  const [bigKeys, setBigKeys] = useState(true);
  const fingers = touch && mode === 'wait' && bigKeys;
  const whites = useMemo(() => {
    let n = 0;
    for (let m = from; m <= to; m++) if (!isBlack(m)) n++;
    return n;
  }, [from, to]);
  // Scrolled by hand, it stays put until recentred.
  const scroller = useFollow<HTMLDivElement>();
  const { el: scrolled, free: scrolledFree, scrollTo: scrollKeys } = scroller;
  useEffect(() => {
    const el = scrolled;
    if (!fingers || !el || scrolledFree) return;
    const left = state.expected.map((n) => n.midi).filter((m) => !state.played.includes(m));
    const coming = player.notes.find((n) => n.time > player.position + 0.05);
    const target = scrollToKeys(left.length ? left : coming ? [coming.midi] : [], from, to, el);
    if (target !== null) scrollKeys({ left: target, behavior: 'smooth' });
  }, [fingers, state.expected, state.played, from, to, player, scrolled, scrolledFree, scrollKeys]);
  const named = fingers || !compact || window.innerWidth / whites >= NAMED_KEY;
  const keyboardHeight = !compact ? 'clamp(130px, 20dvh, 260px)' : fingers ? 'clamp(110px, 26dvh, 260px)' : 'clamp(80px, 17dvh, 200px)';

  const pickMode = (m: PlayMode) => {
    setMode(m);
    player.setMode(m);
    if (m === 'listen') applyInput('keys');
  };
  // Waiting: for which notes, asked each time.
  const [asking, setAsking] = useState(false);
  const [input, setInput] = useState<WaitInput>(() => readJson(WAIT_KEY, { input: 'keys' as WaitInput }).input);
  const mic = useObservable(micState).status;
  const micOn = mic === 'on';
  const listening = mode === 'wait' && input === 'mic';
  const ownMic = useRef(false);
  const applyInput = (next: WaitInput) => {
    player.lenient = next === 'mic';
    if (next === 'mic' && !micOn) {
      ownMic.current = true;
      void enableMic();
    }
    // Only the microphone opened here is closed here.
    if (next === 'keys' && ownMic.current) {
      ownMic.current = false;
      disableMic();
    }
  };
  useEffect(() => () => {
    if (ownMic.current) disableMic();
  }, []);
  const chooseMode = (m: PlayMode) => {
    if (m === 'wait') {
      setOptions(false);
      setAsking(true);
    } else pickMode(m);
  };
  const pickRate = (r: number) => {
    setRate(r);
    player.rate = r;
  };
  // Other notes, other sections: a running loop would no longer fit.
  const pickLevel = (next: PieceLevel) => {
    applyLoop(null);
    onChange({ level: next });
    void piecesApi.update(piece.id, { level: next }).catch(() => {});
  };
  const pickNumbers = (change: { numbering?: PieceNumbering; whole?: boolean }) => {
    onChange(change);
    void piecesApi.update(piece.id, change).catch(() => {});
  };
  // The keys written down by hand (Notebook.tsx), kept with the piece.
  // `id`: of the piece it was written for, which may no longer be the one open.
  const shownId = useRef(piece.id);
  shownId.current = piece.id;
  const writeSequence = (sequence: PieceSequence | null, id = piece.id) => {
    if (id === shownId.current) onChange({ sequence });
    void piecesApi.update(id, { sequence }).catch(() => {});
  };
  const pickTracks = (next: boolean[]) => {
    applyLoop(null);
    onChange({ tracks: piece.tracks?.map((t, i) => ({ ...t, enabled: next[i] })) });
    void piecesApi.update(piece.id, { tracks_enabled: next }).catch(() => {});
  };
  // Remembered on a computer; on a smaller screen it opens when asked for.
  const togglePanel = (open: boolean) => {
    setPanel(open);
    if (!compact) writeJson(PANEL_KEY, { open });
  };
  const toggleNumbers = (patch: Partial<NumbersShown>) => {
    const next = { ...numbersShown, ...patch };
    setNumbersShown(next);
    writeJson(NUMBERS_KEY, next);
  };
  const saveParts = (next: PieceSection[] | null) => {
    applyLoop(null);
    onChange({ sections: next });
    setPartsError('');
    piecesApi.update(piece.id, { sections: next }).catch((e: Error) => setPartsError(`Parties non enregistrées : ${e.message}`));
  };
  const changeParts = (change: (parts: PieceSection[]) => PieceSection[]) => {
    const before = toSaved(sections);
    const after = change(before);
    if (after !== before) saveParts(after);
  };

  // --- Toolbar parts ----------------------------------------------------------------
  const heading = (
    <div className="flex min-w-0 items-center gap-2.5" title={[piece.title, piece.artist, piece.description].filter(Boolean).join(' — ')}>
      {!short && <Cover key={piece.cover} src={piece.cover} size="sm" />}
      <div className="min-w-0 leading-tight">
        <div className="truncate font-semibold text-neutral-900">{piece.title}</div>
        {(piece.artist || piece.description) && (
          <div className="truncate text-xs text-neutral-500">
            {piece.artist}
            {piece.description && <span className="text-neutral-400">{piece.artist ? ' · ' : ''}{piece.description}</span>}
          </div>
        )}
      </div>
    </div>
  );
  const shuffleButton = (
    <ControlButton active={nav.shuffle} pressed={nav.shuffle} title={nav.shuffle ? 'Lecture aléatoire : arrêter' : 'Lecture aléatoire'} onClick={() => nav.onShuffle(!nav.shuffle)}>
      <ShuffleIcon className={controlIcon} />
    </ControlButton>
  );
  const transport = (
    <>
      <SkipButton title="Morceau précédent" flip onClick={() => (player.position > start + RESTART_AFTER ? seek(0) : nav.previous(state.playing))} />
      <PlayButton playing={state.playing} onClick={() => player.toggle()} />
      <SkipButton title="Morceau suivant" onClick={() => nav.next(state.playing)} />
    </>
  );
  const loopButton = sections.length > 0 && (
    <ControlButton
      active={!!loop}
      pressed={!!loop}
      title={loop ? 'Arrêter la boucle (Échap)' : 'Répéter la partie en cours\nAstuce : double-clic sur une partie pour la boucler, Maj+clic pour étendre la boucle'}
      onClick={() => (loop ? applyLoop(null) : applyLoop([sectionAt(player.position), sectionAt(player.position)]))}
    >
      <RepeatIcon className={controlIcon} />
    </ControlButton>
  );
  const optionsButton = (
    <button
      type="button"
      onClick={() => setOptions(true)}
      aria-expanded={options}
      title="Réglages"
      aria-label="Réglages"
      className={`flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors phone:px-2.5 ${options ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'}`}
    >
      <SlidersIcon className="h-4 w-4" /><span className="phone:hidden">Réglages</span>
    </button>
  );
  const timeline = (
    <Timeline
      sections={sections}
      start={start}
      end={end}
      position={player.position}
      loop={loop}
      onSeek={seek}
      onLoop={(i, extend) => applyLoop(extend && loop ? [Math.min(loop[0], i), Math.max(loop[1], i)] : [i, i])}
      sectionAt={sectionAt}
    />
  );

  const bar = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {shuffleButton}
      {transport}
      <span className={`w-9 shrink-0 text-right text-xs tabular-nums text-neutral-500 ${compact ? 'phone:hidden' : ''}`}>{clock(Math.max(0, player.position - start))}</span>
      {timeline}
      <span className={`w-9 shrink-0 text-xs tabular-nums text-neutral-400 ${compact ? 'phone:hidden' : ''}`}>{clock(end - start)}</span>
      {loopButton}
      {numbered.parts[current] && <ControlButton title="Chiffres de la partie" onClick={() => { player.pause(); setPartShown(true); }}><NumbersIcon /></ControlButton>}
      <ControlButton title="Plein écran (F)" onClick={enterFull}><FullscreenIcon /></ControlButton>
    </div>
  );

  // The top bar leaves room for the page's "back" and "Morceaux" buttons,
  // drawn over it. What plays the piece is in it, or just under it when the
  // screen is narrow.
  const inline = short || !compact;
  return (
    <div className="relative flex h-full flex-col">
      {full && <FullscreenControls playing={state.playing} onToggle={() => player.toggle()} onExit={fullscreen.exit} />}
      {!full && <div className="flex h-17 shrink-0 items-center gap-4 pl-16 pr-36 text-sm phone:h-15 phone:gap-2 phone:pl-14 phone:pr-14 short:h-13">
        <div className={short ? 'w-28 shrink-0 md:w-40' : inline ? 'w-56 shrink-0' : 'min-w-0 flex-1'}>{heading}</div>
        {inline && <div className={`flex min-w-0 flex-1 ${short ? '' : 'mx-auto max-w-4xl'}`}>{bar}</div>}
        {optionsButton}
      </div>}
      {!full && !inline && <div className="flex shrink-0 px-3 pb-2.5 sm:px-5">{bar}</div>}

      {options && (
        <PieceOptions
          mode={mode}
          level={level}
          rate={rate}
          hand={hand}
          bothHands={bothHands}
          numbered={numbersShown}
          tracks={piece.tracks ?? []}
          notes={piece.notes}
          enabled={enabled}
          bigKeys={touch ? bigKeys : null}
          onMode={chooseMode}
          onLevel={pickLevel}
          numbering={numbering}
          whole={whole}
          pieceId={piece.id}
          onNumbering={pickNumbers}
          onRate={pickRate}
          climbing={climbing}
          onHand={setHand}
          onNumbered={toggleNumbers}
          onTracks={pickTracks}
          onBigKeys={setBigKeys}
          onEdit={score ? undefined : () => onEdit('notes')}
          onEditNumbers={() => onEdit()}
          lyrics={lyrics && lyricsOn}
          onLyrics={(on) => {
            setLyricsOn(on);
            writeJson(LYRICS_KEY, { on });
          }}
          voice={voice && { on: voice.on, volume: voice.volume }}
          onVoice={tweakVoice}
          onMidi={() => downloadMidi(piece)}
          onCoach={() => openCoach(false)}
          onVideo={() => {
            setOptions(false);
            player.pause();
            setVideo(true);
          }}
          onVoiceFile={() => {
            setOptions(false);
            player.pause();
            setVoicing(true);
          }}
          onKaraoke={() => {
            setOptions(false);
            player.pause();
            setKaraoke(true);
          }}
          onExtract={() => {
            setOptions(false);
            player.pause();
            onExtract();
          }}
          onClose={closeOptions}
        />
      )}

      {voicing && <VoiceModal piece={piece} voice={voice} onSave={saveVoice} onClose={() => setVoicing(false)} />}
      {karaoke && (
        <LyricsModal
          piece={piece}
          onSaved={(next) => {
            setKaraoke(false);
            if (next) setLyricsOn(true);
            onChange({ lyrics: next });
          }}
          onClose={() => setKaraoke(false)}
        />
      )}
      {lyrics && lyricsOn && <LyricsBanner lines={lyrics} player={player} short={short} />}

      {partShown && numbered.parts[current] && <PartNumbers
          parts={numbered.parts}
          start={current}
          written={piece.sequence ?? null}
          onWrite={writeSequence}
          onWriteBeside={phone || full ? undefined : () => {
            setPartShown(false);
            setBig(false);
            setWriting(true);
            togglePanel(true);
          }}
          onClose={() => setPartShown(false)}
        />}
      {asking && (
        <WaitChoice
          current={input}
          onClose={() => setAsking(false)}
          onPick={(next) => {
            setAsking(false);
            setInput(next);
            writeJson(WAIT_KEY, { input: next });
            pickMode('wait');
            applyInput(next);
          }}
        />
      )}
      {video && (
        <VideoModal
          player={player}
          voice={voice?.on ? voice : null}
          cover={piece.cover ?? null}
          base={{ from, to, title: piece.title, artist: piece.artist ?? null, lyrics: lyrics && lyricsOn ? lyrics : null, numbers: numbered.numbers }}
          range={range.part ? { start: range.start, end: range.end, name: range.part } : { start, end, name: '' }}
          onBefore={() => {
            filmed.current = { mode, loop };
            pickMode('listen');
            applyLoop(null);
          }}
          onAfter={() => {
            const was = filmed.current;
            if (!was) return;
            pickMode(was.mode);
            applyLoop(was.loop);
          }}
          onClose={() => setVideo(false)}
        />
      )}
      {takes.done && <TakeCard done={takes.done} onClose={takes.dismiss} onCoach={() => openCoach(true)} />}
      {coach && (
        <CoachModal
          context={coach.context}
          part={coach.part}
          hasTake={coach.take}
          startWith={coach.ask ? 'Qu’est-ce qui coince dans ma dernière prise, et comment le travailler ?' : undefined}
          onClose={() => setCoach(null)}
        />
      )}
      {listening && mic !== 'on' ? (
        <div className="pb-2 text-center text-xs text-red-600">{mic === 'denied' ? 'Micro refusé par le navigateur : autorise-le dans la barre d’adresse, ou passe en mode Clavier.' : 'Ouverture du micro…'}</div>
      ) : mode === 'wait' && state.expected.length > 0 && (
        <div className="pb-2 text-center text-xs text-neutral-500">{listening ? 'Micro : ' : ''}Joue {state.expected.length > 1 ? (listening ? 'une des notes en surbrillance' : 'les notes en surbrillance') : 'la note en surbrillance'} pour continuer</div>
      )}

      {big && part && (
        <Numbers
          title={piece.title}
          parts={shownParts}
          part={current}
          column={column}
          position={player.position}
          loop={loop}
          compact={compact}
          onEdit={() => onEdit()}
          editing={score ? null : {
            onCut: (i, beat) => changeParts((p) => cutAt(p, grid.toTime(shownParts[i].beat + beat))),
            onMove: (i, by) => changeParts((p) => moveStart(p, i, grid.toTime(shownParts[i].beat + by))),
            onJoin: (i) => changeParts((p) => joinPrevious(p, i)),
            onRename: (i, label) => changeParts((p) => rename(p, i, label)),
            onReset: piece.sections ? () => saveParts(null) : null,
            error: partsError,
          }}
          onSeek={seek}
          onLoop={(i) => applyLoop(i === null ? null : [i, i])}
          onClose={() => setBig(false)}
        />
      )}

      <div className={`relative flex overflow-hidden ${big ? 'shrink-0' : 'min-h-0 flex-1'}`}>
        {fingers && <RecentreButton free={scroller.free} onClick={scroller.recentre} className="right-3 top-3" />}
        <div ref={scroller.ref} className={`min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-contain ${styled ? 'bg-black' : 'bg-white'} ${big || styled ? '' : 'border-t border-neutral-100'}`}>
          <div className="flex h-full flex-col" style={{ minWidth: fingers ? whites * FINGER_KEY : undefined }}>
            {!big && <div className="relative min-h-0 flex-1 px-2 sm:px-4">
              <FallingNotes
                player={player}
                keyLight={keyLight}
                from={from}
                to={to}
                numbers={numbersOn ? numbered.numbers : undefined}
                parts={numbersOn ? sections : undefined}
              />
            </div>}
            <div className={`px-2 sm:px-4 ${big ? 'border-t border-neutral-100 pt-2' : ''} ${short ? 'pb-2' : ''}`}>
              <div className="relative">
                <PianoKeyboard from={from} to={to} labels={named && numbersShown.names && !numbersShown.keys ? labels : 'none'} marks={marks} stickers={numbersShown.keys ? stickers : undefined} height={keyboardHeight} />
                {!big && <KeyLight canvas={keyLight} />}
              </div>
            </div>
          </div>
        </div>
        {part && !big && !full && !phone && (
          <NumbersPanel
            title={piece.title}
            writing={writing}
            onWriting={setWriting}
            pieceId={piece.id}
            written={piece.sequence ?? null}
            onWrite={writeSequence}
            onToggle={() => player.toggle()}
            parts={shownParts}
            part={current}
            position={player.position}
            loop={loop}
            open={panel}
            over={compact}
            onSeek={seek}
            onLoop={(i) => applyLoop(i === null ? null : [i, i])}
            onOwn={() => onEdit('numbers')}
            onDetail={() => {
              if (compact) setPanel(false);
              setBig(true);
            }}
            onOpen={togglePanel}
          />
        )}
      </div>
    </div>
  );
}

const NumbersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7.5 9.5 9 8.5v7M12.5 9a1.5 1.5 0 1 1 2.6 1L12.5 15.5h3" />
  </svg>
);
