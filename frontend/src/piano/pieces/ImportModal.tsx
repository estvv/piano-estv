import type { PieceDifficulty } from '@piano/shared';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Switch } from '../../components/Switch';
import { ErrorText, primaryButton, secondaryButton } from '../../components/ui';
import { numbersToPlace, readPictures } from './aiImport';
import { ACCEPT, fileKind, piecesApi, type FileKind } from './api';
import { canCapture, captureScreen, type Capture } from './captureScreen';
import { importAudio } from './importAudio';
import { importMidi } from './importMidi';
import { importMusicXml } from './importMusicXml';
import { importPdf, NotAScore, pdfPictures } from './importPdf';
import { importVideo, NoKeyboard } from './importVideo';
import { guessNames } from './names';
import { snapPiece } from './snap';
import { videoLink } from './youtube';
import { DifficultyPicker, FolderSelect } from './pieceFields';
import type { ScoreDraft } from './ScoreEditor';
import { sourceLabels, type ImportResult, type PieceFolder } from './types';

const STAGES = { decode: 'Lecture du son…', model: 'Chargement du modèle de transcription…', transcribe: 'Transcription' } as const;
const MAX_PICTURES = 4;

const formatDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// Give it anything: the file says how it is read. What comes out is named,
// saved, then changed by hand like any other piece.
export function ImportModal({ folders, onClose, onSaved, onNumbers }: {
  folders: PieceFolder[];
  onClose(): void;
  onSaved(id: number): void;
  // Numbers read on a picture: the rest happens in the editor.
  onNumbers(draft: ScoreDraft): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [sensitivity, setSensitivity] = useState(0.5);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [octave, setOctave] = useState(0);
  const [snap, setSnap] = useState(true);
  // What could not be read as hoped, and what else can be tried.
  const [other, setOther] = useState<{ why: string; way: 'sound' | 'ai' } | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [description, setDescription] = useState('');
  const [folder, setFolder] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<PieceDifficulty | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // A tab being recorded.
  const [capture, setCapture] = useState<Capture | null>(null);
  const [seconds, setSeconds] = useState(0);
  // A video opened in another tab, to be captured.
  const [link, setLink] = useState('');
  const [opened, setOpened] = useState(false);
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  useEffect(() => {
    if (!capture) return;
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      clearInterval(id);
      capture.stop();
    };
  }, [capture]);
  const file = files[0] ?? null;
  const kind = file ? fileKind(file) : null;

  const show = (r: ImportResult) => {
    setResult(r);
    setOctave(0);
    setTitle(r.title);
    setArtist(r.artist ?? '');
  };
  const attempt = async (work: () => Promise<void>) => {
    setError('');
    setOther(null);
    setResult(null);
    try {
      await work();
    } catch (e) {
      if (e instanceof NotAScore) setOther({ why: 'Ce PDF est un scan, ou vient d’un logiciel dont les symboles ne sont pas reconnus.', way: 'ai' });
      else if (e instanceof NoKeyboard) setOther({ why: `${e.message}.`, way: 'sound' });
      else setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const bySound = (f: File) => attempt(async () => {
    show(await importAudio(f, {
      sensitivity,
      onProgress: (stage, p) => setProgress(stage === 'transcribe' && p !== undefined ? `${STAGES[stage]} : ${Math.round(p * 100)} %` : STAGES[stage]),
    }));
  });
  const byAi = (list: File[]) => attempt(async () => {
    setProgress('Lecture par l’IA… (jusqu’à une minute)');
    const pictures = fileKind(list[0]) === 'pdf' ? await pdfPictures(list[0], MAX_PICTURES) : list;
    const read = await readPictures(pictures, guessNames(list[0].name).title);
    if (read.kind === 'numbers') onNumbers({ title: read.title, score: read.score, toPlace: numbersToPlace(read.score) });
    else show(read.result);
  });
  const direct: Partial<Record<FileKind, (f: File) => Promise<ImportResult>>> = {
    midi: importMidi,
    musicxml: importMusicXml,
    pdf: importPdf,
    video: (f) => importVideo(f, (p) => setProgress(`Lecture des images : ${Math.round(p * 100)} %`)),
  };

  const choose = (list: File[]) => {
    if (!list.length) return;
    const k = fileKind(list[0]);
    // Several pictures are the pages of one piece.
    const own = k === 'image' ? list.filter((f) => fileKind(f) === 'image').slice(0, MAX_PICTURES) : list.slice(0, 1);
    setFiles(own);
    setResult(null);
    setOther(null);
    setError(k ? '' : 'Format non reconnu.');
    const convert = k && direct[k];
    if (convert) {
      void attempt(async () => {
        setProgress(k === 'video' ? 'Recherche du clavier dans la vidéo…' : 'Lecture…');
        show(await convert(own[0]));
      });
    }
  };

  const record = async () => {
    setError('');
    try {
      const started = await captureScreen();
      // Closed meanwhile: nobody waits for it.
      if (!open.current) return started.stop();
      setCapture(started);
      const recorded = await started.done;
      if (!open.current) return;
      setCapture(null);
      choose([recorded]);
    } catch (e) {
      setCapture(null);
      // Nothing picked in the browser's window: nothing to say.
      if ((e as Error).name !== 'NotAllowedError') setError((e as Error).message);
    }
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    setError('');
    try {
      const { warnings: _, ...read } = result;
      const piece = snap && transcribed(result) ? snapPiece(read) : read;
      const { id } = await piecesApi.create({
        ...piece,
        notes: shifted(piece.notes, octave),
        title: title.trim() || result.title,
        artist: artist.trim() || null,
      }, { folder_id: folder, difficulty, description: description.trim() || null });
      onSaved(id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const duration = result ? result.notes.reduce((end, n) => Math.max(end, n.time + n.duration), 0) : 0;
  const busy = !!progress;

  return (
    <Modal title="Importer un morceau" onClose={onClose} width="md">
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy || !!capture}
          onDragOver={(e: DragEvent) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            setOver(false);
            if (!busy && !capture) choose([...e.dataTransfer.files]);
          }}
          className={`w-full rounded-xl border-2 border-dashed px-4 py-7 text-center text-sm transition-colors ${over ? 'border-neutral-900 bg-neutral-50 text-neutral-900' : 'border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-900'}`}
        >
          {file
            ? <span className="block truncate font-medium text-neutral-900">{files.length > 1 ? `${files.length} images` : file.name}</span>
            : 'Dépose ou choisis un fichier'}
          <span className="mt-1.5 block text-xs text-neutral-400">Image de numéros ou de partition (lue par l’IA) · partition PDF · vidéo · son · MIDI · MusicXML</span>
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = '';
            choose(list);
          }}
        />

        {capture ? (
          <div className="space-y-3 rounded-lg bg-neutral-50 p-4">
            <p className="text-sm text-neutral-700">
              <b className="tabular-nums">{formatDuration(seconds)}</b> · Dans l’onglet de la vidéo, lance-la depuis le début, sans pause et sans cacher son clavier, puis reviens ici.
            </p>
            <button type="button" onClick={() => capture.stop()} className={primaryButton}>Terminer et lire</button>
          </div>
        ) : !busy && !file && canCapture() && (
          <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const url = videoLink(link);
                if (!url) return setError('Ce n’est pas un lien de vidéo.');
                setError('');
                window.open(url, '_blank', 'noopener');
                setOpened(true);
              }}
            >
              <input
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setOpened(false);
                }}
                placeholder="Lien d’une vidéo de notes qui tombent (YouTube, TikTok…)"
                inputMode="url"
                aria-label="Lien de la vidéo"
                className={`${inputClass} min-w-0 flex-1`}
              />
              <button type="submit" disabled={!link.trim()} className={secondaryButton}>Ouvrir</button>
            </form>
            {opened ? (
              <div className="space-y-2">
                <p className="text-xs text-neutral-500">La vidéo est ouverte dans un autre onglet. Reviens ici, clique Capturer, choisis cet onglet dans la fenêtre du navigateur, puis lance la vidéo depuis le début.</p>
                <button type="button" onClick={() => void record()} className={`${primaryButton} w-full`}>Capturer l’onglet de la vidéo</button>
              </div>
            ) : (
              <button type="button" onClick={() => void record()} className="w-full text-center text-xs text-neutral-500 underline hover:text-neutral-900">
                ou capturer un onglet déjà ouvert
              </button>
            )}
          </div>
        )}
        {busy && <p className="text-sm text-neutral-500">{progress}</p>}

        {!busy && kind === 'image' && !result && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-600">L’IA lit l’image : des numéros écrits, ou une partition. Elle est envoyée à Gemini (Google), ou à Mistral si Gemini ne répond pas.</p>
            <button type="button" onClick={() => void byAi(files)} className={primaryButton}>Lire l’image</button>
          </div>
        )}
        {!busy && kind === 'audio' && <Sound sensitivity={sensitivity} again={!!result} onSensitivity={setSensitivity} onRun={() => file && void bySound(file)} />}
        {!busy && other && (
          <div className="space-y-3 rounded-lg bg-neutral-50 p-4">
            <p className="text-sm text-neutral-700">{other.why}</p>
            {other.way === 'sound'
              ? <Sound sensitivity={sensitivity} again={false} onSensitivity={setSensitivity} onRun={() => file && void bySound(file)} />
              : (
                <>
                  <p className="text-xs text-neutral-500">L’IA peut essayer sur ses pages, envoyées en images à Gemini ou Mistral (les {MAX_PICTURES} premières). À vérifier ensuite.</p>
                  <button type="button" onClick={() => void byAi(files)} className={secondaryButton}>Essayer avec l’IA</button>
                </>
              )}
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="rounded-lg border border-neutral-200 px-4 py-3 text-sm text-neutral-600">
              <span className="font-semibold text-neutral-900">{result.notes.length} notes</span> · {formatDuration(duration)} · {sourceLabels[result.source]}
              {result.bpm && <> · {result.bpm} bpm</>}
              {result.warnings.map((w) => <p key={w} className="mt-1.5 text-xs text-amber-700">{w}</p>)}
            </div>
            {result.source === 'video' && (
              <div className="flex items-center gap-3 text-sm text-neutral-600">
                Octave
                <button type="button" onClick={() => setOctave(octave - 1)} aria-label="Une octave plus bas" className="h-8 w-8 rounded-lg bg-neutral-100 hover:bg-neutral-200">−</button>
                <span className="w-8 text-center tabular-nums">{octave > 0 ? `+${octave}` : octave}</span>
                <button type="button" onClick={() => setOctave(octave + 1)} aria-label="Une octave plus haut" className="h-8 w-8 rounded-lg bg-neutral-100 hover:bg-neutral-200">+</button>
                {kind === 'video' && <button type="button" onClick={() => file && void bySound(file)} className="ml-auto text-xs underline">Transcrire le son à la place</button>}
              </div>
            )}
            {transcribed(result) && (
              <div className="-ml-2">
                <Switch on={snap} label="Caler les notes sur les cases" title="Les petits décalages disparaissent et le tempo devient régulier." onChange={setSnap} />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Titre">
                <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Artiste">
                <input value={artist} maxLength={120} placeholder="Facultatif" onChange={(e) => setArtist(e.target.value)} className={inputClass} />
              </Field>
            </div>
            <Field label="Description">
              <input value={description} maxLength={200} placeholder="Facultatif : « en entier », « boucle du refrain »…" onChange={(e) => setDescription(e.target.value)} className={inputClass} />
            </Field>
            {folders.length > 0 && (
              <Field label="Dossier">
                <FolderSelect folders={folders} value={folder} onChange={setFolder} />
              </Field>
            )}
            <Field label="Difficulté">
              <DifficultyPicker value={difficulty} onChange={setDifficulty} />
            </Field>
          </div>
        )}

        <ErrorText>{error}</ErrorText>
        {result && (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
            <button type="button" onClick={() => void save()} disabled={saving || busy} className={primaryButton}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Heard or seen, not written: never quite on the beat.
const transcribed = (r: ImportResult) => r.source === 'audio' || r.source === 'video';

// Notes that would leave the piano stay on its last octave.
function shifted(notes: ImportResult['notes'], octaves: number): ImportResult['notes'] {
  if (!octaves) return notes;
  return notes.map((n) => {
    let midi = n.midi + octaves * 12;
    while (midi < 21) midi += 12;
    while (midi > 108) midi -= 12;
    return { ...n, midi };
  });
}

function Sound({ sensitivity, again, onSensitivity, onRun }: { sensitivity: number; again: boolean; onSensitivity(v: number): void; onRun(): void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        Le son peut être transcrit en notes, dans ton navigateur. Fiable sur du piano seul, approximatif avec une voix ou une batterie.
      </p>
      <label className="flex items-center gap-3 text-sm text-neutral-600">
        Sensibilité
        <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => onSensitivity(Number(e.target.value))} className="flex-1 accent-neutral-900" />
        <span className="w-24 text-right text-xs text-neutral-400">{sensitivity < 0.35 ? 'notes sûres' : sensitivity > 0.65 ? 'toutes les notes' : 'équilibrée'}</span>
      </label>
      <button type="button" onClick={onRun} className={secondaryButton}>{again ? 'Retranscrire' : 'Transcrire le son'}</button>
    </div>
  );
}
