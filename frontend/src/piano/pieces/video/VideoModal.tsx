import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, inputClass } from '../../../components/Field';
import { Modal } from '../../../components/Modal';
import { Segmented } from '../../../components/Segmented';
import { Toggle } from '../../../components/settings';
import { ErrorText, primaryButton, secondaryButton } from '../../../components/ui';
import { look } from '../../../lib/appearance';
import { useObservable } from '../../../lib/store';
import { ensureAudio } from '../../audio';
import { clock } from '../PlayerControls';
import type { PiecePlayer } from '../player';
import { FrameMaker, loadCover, type Film } from './frame';
import { canEncode, encodeVideo, Stopped } from './encode';
import { renderSound } from '../../audio';
import type { Voice } from '../voice/store';
import { scoreOf } from './sound';
import { MAX_LOGO, setVideo, sizeOf, videoOptions, type KeyNames } from './settings';

// A video of the piece as it plays here, to share. Worked out picture by picture.
export function VideoModal({ player, base, range, voice, cover: coverUrl, onBefore, onAfter, onClose }: {
  player: PiecePlayer;
  base: Omit<Film, 'player' | 'start'>;
  // What is filmed: the loop, or the whole piece.
  range: { start: number; end: number; name: string };
  // The piece is made ready (listen mode, no loop), then given back.
  // Heard along, when on.
  voice: Voice | null;
  cover: string | null;
  onBefore(): void;
  onAfter(): void;
  onClose(): void;
}) {
  const options = useObservable(videoOptions);
  const colors = useObservable(look);
  const size = sizeOf(options);
  // While made: how far (0 to 1), or the sound being prepared.
  const [making, setMaking] = useState<{ share: number; sound: boolean } | null>(null);
  const stop = useRef(false);
  const filming = !!making;
  const [result, setResult] = useState<{ url: string; name: string; bytes: number } | null>(null);
  const [error, setError] = useState('');
  const preview = useRef<HTMLCanvasElement>(null);
  const [cover, setCover] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let stale = false;
    void loadCover(coverUrl).then((img) => !stale && setCover(img));
    return () => {
      stale = true;
    };
  }, [coverUrl]);
  const filmData = useMemo((): Film => ({ ...base, player, start: range.start, cover }), [base, player, range.start, cover]);

  // A picture, a second into it.
  useEffect(() => {
    const canvas = preview.current;
    if (!canvas || filming) return;
    const [w, h] = size;
    Object.assign(canvas, { width: w, height: h });
    const ctx = canvas.getContext('2d')!;
    const shown = { ...filmData, player: { position: range.start + 1.5, rate: player.rate, notes: player.notes, state: { get: () => ({ expected: [], playing: false }) } } };
    const maker = new FrameMaker(shown, options, colors, w, h);
    const draw = () => maker.draw(ctx, performance.now());
    // Again once the logo has come.
    draw();
    const id = setTimeout(draw, 300);
    return () => clearTimeout(id);
  }, [options, colors, filmData, size, range.start, player, filming]);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const start = async () => {
    setError('');
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    stop.current = false;
    await ensureAudio().catch(() => {});
    onBefore();
    player.pause();
    try {
      // The sound first, all of it, then the pictures at its exact times.
      let sound: AudioBuffer | null = null;
      if (options.sound) {
        setMaking({ share: 0, sound: true });
        sound = await renderSound(await scoreOf(player.notes, range.start, range.end, player.rate, voice));
      }
      setMaking({ share: 0, sound: false });
      const place = { position: range.start };
      const source = { get position() { return place.position; }, rate: player.rate, notes: player.notes, state: { get: () => ({ expected: [], playing: true }) } };
      const maker = new FrameMaker({ ...filmData, player: source }, options, colors, size[0], size[1]);
      const blob = await encodeVideo(maker, size, {
        from: range.start, end: range.end, rate: player.rate, sound,
        onFrame: (p) => (place.position = p),
        onProgress: (share) => setMaking({ share, sound: false }),
        stopped: () => stop.current,
      });
      setResult({ url: URL.createObjectURL(blob), name: `${base.title}${range.name ? ` - ${range.name}` : ''}.mp4`.replace(/[\\/:*?"<>|]+/g, ' '), bytes: blob.size });
    } catch (e) {
      if (!(e instanceof Stopped)) setError(`Vidéo impossible : ${(e as Error).message}`);
    } finally {
      setMaking(null);
      onAfter();
    }
  };

  const total = range.end - range.start;
  const supported = canEncode();

  return (
    <Modal title="Exporter en vidéo" subtitle={range.name ? `Partie ${range.name}` : 'Morceau entier'} onClose={() => (filming ? (stop.current = true) : onClose())} width="lg">
      {!supported ? (
        <p className="text-sm text-neutral-600">Ce navigateur ne sait pas fabriquer de vidéo. Utilise Chrome ou Edge à jour sur ordinateur.</p>
      ) : making ? (
        <div className="space-y-4">
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full bg-neutral-900 transition-[width]" style={{ width: `${Math.round(making.share * 100)}%` }} />
          </div>
          <div className="flex items-center justify-between text-sm tabular-nums text-neutral-500">
            <span>{making.sound ? '' : `${Math.round(making.share * 100)} %`}</span>
            <button type="button" onClick={() => (stop.current = true)} className={secondaryButton}>Arrêter</button>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
          <div className="space-y-4">
            <Field label="Format">
              <Segmented<'landscape' | 'portrait'> full value={options.format} onChange={(format) => setVideo({ format })} options={[{ value: 'portrait', label: 'Vertical 9:16' }, { value: 'landscape', label: 'Paysage 16:9' }]} />
            </Field>
            <Field label="Qualité">
              <Segmented<720 | 1080> full value={options.quality} onChange={(quality) => setVideo({ quality })} options={[{ value: 1080, label: '1080p' }, { value: 720, label: '720p (plus léger)' }]} />
            </Field>
            <div className="space-y-2">
              <Toggle checked={options.sound} onChange={(sound) => setVideo({ sound })} label="Son du piano (et de la voix)" />
              {base.lyrics && <Toggle checked={options.lyrics} onChange={(lyrics) => setVideo({ lyrics })} label="Paroles" />}
              <Toggle checked={options.numbers} onChange={(numbers) => setVideo({ numbers })} label="Chiffres sur les notes" />
              <Toggle checked={options.cover} onChange={(c) => setVideo({ cover: c })} label={options.format === 'portrait' ? 'Pochette et titre en haut' : 'Pochette et titre en coin'} />
              {!options.cover && <Toggle checked={options.title} onChange={(title) => setVideo({ title })} label="Titre au début" />}
            </div>
            <Field label="Noms sur les touches">
              <Segmented<KeyNames> full value={options.keyNames} onChange={(keyNames) => setVideo({ keyNames })} options={[{ value: 'letters', label: 'C D E' }, { value: 'names', label: 'Do Ré Mi' }, { value: 'none', label: 'Aucun' }]} />
            </Field>
            <Field label="Filigrane">
              <div className="flex gap-2">
                <input value={options.logo} maxLength={40} placeholder="Ton nom, discret dans un coin" onChange={(e) => setVideo({ logo: e.target.value })} className={`${inputClass} min-w-0 flex-1`} />
                <LogoImage value={options.logoImage} onChange={(logoImage) => setVideo({ logoImage })} onError={setError} />
              </div>
            </Field>
          </div>
          <div className="space-y-3">
            <canvas ref={preview} aria-label="Aperçu" className={`mx-auto block rounded-lg border border-neutral-200 ${options.format === 'portrait' ? 'max-h-80 w-auto' : 'w-full'}`} />
            {result ? (
              <div className="space-y-2 rounded-xl bg-emerald-50 p-3">
                <p className="text-sm text-emerald-800">Vidéo prête ({(result.bytes / 1e6).toFixed(1).replace('.', ',')} Mo).</p>
                <div className="flex gap-2">
                  <a href={result.url} download={result.name} className={primaryButton}>Télécharger</a>
                  <button type="button" onClick={() => void start()} className={secondaryButton}>Refaire</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => void start()} className={`${primaryButton} w-full`}>Enregistrer la vidéo</button>
            )}
            <ErrorText>{error}</ErrorText>
          </div>
        </div>
      )}
    </Modal>
  );
}

function LogoImage({ value, onChange, onError }: { value: string; onChange(v: string): void; onError(e: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => (value ? onChange('') : input.current?.click())} className={secondaryButton} title={value ? 'Enlever l’image' : 'Ajouter une image (PNG transparent de préférence)'}>
        {value ? <><img src={value} alt="" className="h-5 w-5 object-contain" />✕</> : 'Image'}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/webp,image/jpeg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const [file] = e.target.files ?? [];
          e.target.value = '';
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const url = String(reader.result);
            if (url.length > MAX_LOGO) return onError('Image trop lourde (300 Ko maximum).');
            onError('');
            onChange(url);
          };
          reader.readAsDataURL(file);
        }}
      />
    </>
  );
}
