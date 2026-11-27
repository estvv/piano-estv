import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Field } from '../../../components/Field';
import { Modal } from '../../../components/Modal';
import { ErrorText, primaryButton, secondaryButton } from '../../../components/ui';
import { layoutOf, levelNotes } from '../derive';
import { Small } from '../Numbers';
import { clock } from '../PlayerControls';
import type { StoredPiece } from '../types';
import { usePreview } from '../usePreview';
import { decode } from './decode';
import { MAX_SIZE, type Voice } from './store';
import { conflict, syncOf, type SyncPoint } from './sync';
import { useVoicePlayer } from './useVoice';

// A recording heard along with the piece: chosen, then put in its place with two
// moments found in both, near the start and near the end.
export function VoiceModal({ piece, voice, onSave, onClose }: {
  piece: StoredPiece;
  voice: Voice | null;
  onSave(voice: Voice | null): Promise<void>;
  onClose(): void;
}) {
  const [file, setFile] = useState<Pick<Voice, 'file' | 'name'> | null>(voice);
  return (
    <Modal title="Voix ou chanson" subtitle={piece.title} onClose={onClose} width="lg">
      {file
        ? <Place key={file.name} piece={piece} file={file} old={file.file === voice?.file ? voice : null} onSave={onSave} onClose={onClose} onOther={() => setFile(null)} />
        : <Choose onChosen={setFile} onBack={voice ? () => setFile(voice) : null} />}
    </Modal>
  );
}

function Choose({ onChosen, onBack }: { onChosen(file: Pick<Voice, 'file' | 'name'>): void; onBack: (() => void) | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (file.size > MAX_SIZE) return setError('Fichier trop lourd (80 Mo maximum).');
    setReading(true);
    try {
      await decode(file);
      onChosen({ file, name: file.name });
    } catch (e) {
      setError((e as Error).message);
      setReading(false);
    }
  };
  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={reading}
        onClick={() => input.current?.click()}
        onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          void choose(e.dataTransfer.files[0]);
        }}
        className={`w-full rounded-xl border-2 border-dashed px-4 py-9 text-center text-sm transition-colors ${over ? 'border-neutral-900 bg-neutral-50 text-neutral-900' : 'border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-900'}`}
      >
        <span className="font-medium text-neutral-900">{reading ? 'Lecture…' : 'Dépose ou choisis un fichier son'}</span>
        <span className="mt-1.5 block text-xs text-neutral-400">mp3, m4a, wav, ogg, flac · la voix seule, ou la chanson entière</span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,audio/*"
        className="hidden"
        onChange={(e) => {
          const [picked] = e.target.files ?? [];
          e.target.value = '';
          void choose(picked);
        }}
      />
      <p className="text-xs text-neutral-400">Le fichier reste dans ce navigateur : il n’est ni envoyé au serveur, ni copié avec le morceau.</p>
      <ErrorText>{error}</ErrorText>
      {onBack && <div className="flex justify-end"><button type="button" onClick={onBack} className={secondaryButton}>Garder l’actuel</button></div>}
    </div>
  );
}

interface Moment { time: number; label: string }

function Place({ piece, file, old, onSave, onClose, onOther }: {
  piece: StoredPiece;
  file: Pick<Voice, 'file' | 'name'>;
  old: Voice | null;
  onSave(voice: Voice | null): Promise<void>;
  onClose(): void;
  onOther(): void;
}) {
  const notes = useMemo(() => levelNotes(piece), [piece]);
  const { duration } = useMemo(() => layoutOf(piece), [piece]);
  // Moments easy to hear: the lines sung, or the first and last notes.
  const moments = useMemo((): Moment[] => {
    const lines = (piece.lyrics ?? []).flatMap((l) => (l.time !== null && l.text ? [{ time: l.time, label: l.text }] : [])).sort((a, b) => a.time - b.time);
    const all = [...lines];
    if (notes.length) {
      all.unshift({ time: notes[0].time, label: 'Première note du morceau' });
      all.push({ time: notes[notes.length - 1].time, label: 'Dernière note du morceau' });
    }
    return all;
  }, [piece, notes]);
  const lined = moments.length > 2;

  // For each of the two: where in the piece, and where in the recording.
  const [spots, setSpots] = useState<{ moment: number; audio: number | null }[]>(() => {
    const ends = [lined ? 1 : 0, Math.max(0, moments.length - (lined ? 2 : 1))];
    const own = [...(old?.points ?? [])].sort((a, b) => a.piece - b.piece);
    const nearest = (time: number) => moments.reduce((best, m, i) => (Math.abs(m.time - time) < Math.abs(moments[best].time - time) ? i : best), 0);
    return ends.map((moment, i) => {
      const p = own[i];
      if (!p || !moments.length) return { moment, audio: null };
      const at = nearest(p.piece);
      // Lyrics may have moved since: the same place, told from there.
      return { moment: at, audio: p.audio + (moments[at].time - p.piece) * syncOf(own).speed };
    });
  });
  const points = useMemo((): SyncPoint[] => {
    const known = spots.flatMap((s) => (s.audio === null || !moments[s.moment] ? [] : [{ piece: moments[s.moment].time, audio: s.audio }]));
    return known.length === 2 && known[0].piece === known[1].piece ? known.slice(0, 1) : known;
  }, [spots, moments]);
  const [volume, setVolume] = useState(old?.volume ?? 0.8);
  const [changed, setChanged] = useState(!old);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // --- Both together -----------------------------------------------------------------
  const preview = usePreview(notes, duration);
  const draft = useMemo((): Voice => ({ ...file, points, volume, on: true }), [file, points, volume]);
  useVoicePlayer(draft, preview.player, true);
  const together = (moment: number) => {
    alone.current?.pause();
    if (preview.playing) return preview.stop();
    preview.play(Math.max(0, (moments[moment]?.time ?? 0) - 3));
  };

  // --- The recording alone ------------------------------------------------------------
  const alone = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(file.file);
    setUrl(u);
    const el = alone.current;
    return () => {
      // Taken off the page, it would go on.
      el?.pause();
      URL.revokeObjectURL(u);
    };
  }, [file]);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Smoother than the events of the element.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTime(alone.current?.currentTime ?? 0), 50);
    return () => clearInterval(id);
  }, [playing]);
  const listen = () => {
    const el = alone.current;
    if (!el) return;
    preview.stop();
    if (el.paused) void el.play().catch(() => setError('Lecture impossible.'));
    else el.pause();
  };
  // Space: the recording, not the piece behind.
  const onSpace = useRef<(e: KeyboardEvent) => void>(() => {});
  onSpace.current = (e) => {
    if (e.code !== 'Space') return;
    e.stopImmediatePropagation();
    if (['BUTTON', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
    e.preventDefault();
    if (!e.repeat) listen();
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => onSpace.current(e);
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, []);
  const seek = (t: number) => {
    if (alone.current) alone.current.currentTime = t;
    setTime(t);
  };

  const change = (i: number, patch: Partial<{ moment: number; audio: number | null }>) => {
    setChanged(true);
    setError('');
    setSpots((all) => all.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  };
  const here = (i: number) => change(i, { audio: alone.current?.currentTime ?? 0 });
  const nudge = (i: number, by: number) => {
    const { audio } = spots[i];
    if (audio !== null) change(i, { audio: audio + by });
  };

  const { speed } = syncOf(points);
  const percent = Math.abs(speed - 1) * 100;

  const save = async (next: Voice | null) => {
    preview.stop();
    setSaving(true);
    setError('');
    try {
      await onSave(next);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    // Keep typing out of the piano shortcuts.
    <div className="space-y-5" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <div className="rounded-xl border border-neutral-200 p-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">{file.name}</span>
          <Small onClick={onOther}>Changer</Small>
        </div>
        <audio
          ref={alone}
          src={url || undefined}
          preload="auto"
          onLoadedMetadata={(e) => setLength(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="hidden"
        />
        <div className="flex items-center gap-3">
          <button type="button" onClick={listen} className={secondaryButton}>{playing ? 'Pause' : 'Écouter'}</button>
          <span className="w-10 text-right text-xs tabular-nums text-neutral-500">{clock(time)}</span>
          <input type="range" min={0} max={length || 1} step={0.01} value={Math.min(time, length || 1)} onChange={(e) => seek(Number(e.target.value))} aria-label="Place dans l’enregistrement" className="min-w-0 flex-1 accent-neutral-900" />
          <span className="w-10 text-xs tabular-nums text-neutral-400">{clock(length)}</span>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm text-neutral-600">
          Écoute l’enregistrement, et clique <b>Ici</b> quand tu entends le moment choisi. Le deuxième repère sert à régler la vitesse : il n’est utile que si la fin se décale.
        </p>
        <div className="space-y-2">
          {spots.map((s, i) => (
            <div key={i} className="rounded-xl border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-14 text-sm font-semibold text-neutral-900">{i ? 'Fin' : 'Début'}</span>
                <select
                  value={s.moment}
                  onChange={(e) => change(i, { moment: Number(e.target.value), audio: null })}
                  aria-label={`Moment, ${i ? 'fin' : 'début'}`}
                  className="min-w-0 flex-1 truncate rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900"
                >
                  {moments.map((m, k) => <option key={k} value={k}>{clock(m.time)} · {m.label}</option>)}
                </select>
                <button type="button" onClick={() => here(i)} className={primaryButton}>Ici</button>
              </div>
              {s.audio !== null && (
                <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-neutral-500">
                  <span className="mr-2 tabular-nums">à {s.audio < 0 ? '−' : ''}{clock(Math.abs(s.audio))},{String(Math.floor((Math.abs(s.audio) % 1) * 100)).padStart(2, '0')} dans l’enregistrement</span>
                  <Small active={preview.playing} onClick={() => together(s.moment)}>{preview.playing ? 'Arrêter' : 'Écouter ensemble'}</Small>
                  <span className="flex-1" />
                  <Small onClick={() => nudge(i, 0.1)} title="La voix vient plus tôt de 0,1 s">Voix plus tôt</Small>
                  <Small onClick={() => nudge(i, 0.02)} title="De 0,02 s">+</Small>
                  <Small onClick={() => nudge(i, -0.02)} title="De 0,02 s">−</Small>
                  <Small onClick={() => nudge(i, -0.1)} title="La voix vient plus tard de 0,1 s">Voix plus tard</Small>
                  <Small onClick={() => change(i, { audio: null })} title="Enlever ce repère">✕</Small>
                </div>
              )}
            </div>
          ))}
        </div>
        {conflict(points) ? (
          <p className="mt-2 text-xs text-red-600">Les deux repères ne vont pas ensemble : l’un des deux est sans doute mal placé. Seul le premier est suivi.</p>
        ) : percent >= 0.05 && (
          <p className="mt-2 text-xs text-neutral-400">L’enregistrement est joué {percent.toFixed(1).replace('.', ',')} % plus {speed > 1 ? 'vite' : 'lentement'}, sans changer sa hauteur.</p>
        )}
      </div>

      <Field label="Volume">
        <input
          type="range" min={0} max={1} step={0.02} value={volume}
          onChange={(e) => {
            setChanged(true);
            setVolume(Number(e.target.value));
          }}
          className="w-full accent-neutral-900"
        />
      </Field>
      <p className="text-xs text-neutral-400">La voix se tait en mode Attente. Si elle sonne faux, le morceau n’est pas dans la même tonalité que l’enregistrement.</p>
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap justify-end gap-2">
        {old && <button type="button" onClick={() => void save(null)} className={secondaryButton}>Enlever</button>}
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
        <button type="button" onClick={() => void save({ ...draft, on: true })} disabled={saving || !changed} className={primaryButton}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </div>
  );
}
