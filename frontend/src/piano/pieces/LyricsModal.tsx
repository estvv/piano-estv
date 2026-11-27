import type { LyricLine } from '@piano/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, inputClass } from '../../components/Field';
import { ConfirmModal, Modal } from '../../components/Modal';
import { ErrorText, primaryButton, secondaryButton } from '../../components/ui';
import { piecesApi } from './api';
import { layoutOf, levelNotes } from './derive';
import { anchored, lineAt, parseLyrics, placed, toSave, type Anchors, type FoundLyrics } from './lyrics';
import { Small } from './Numbers';
import { clock } from './PlayerControls';
import type { StoredPiece } from './types';
import { usePreview } from './usePreview';

// The lyrics of a piece: found or pasted, then put in their place while it plays.
export function LyricsModal({ piece, onSaved, onClose }: {
  piece: StoredPiece;
  onSaved(lyrics: LyricLine[] | null): void;
  onClose(): void;
}) {
  const [lines, setLines] = useState<LyricLine[] | null>(piece.lyrics?.length ? piece.lyrics : null);
  const [changed, setChanged] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const close = () => {
    if (changed && !leaving) setLeaving(true);
    else if (!leaving) onClose();
  };
  return (
    <>
      <Modal title="Karaoké" subtitle={piece.title} onClose={close} width="lg">
        {lines
          ? <Place piece={piece} lines={lines} isNew={lines !== piece.lyrics} onChanged={() => setChanged(true)} onOther={() => setLines(null)} onSaved={onSaved} />
          : <Find piece={piece} onFound={(l) => { setLines(l); setChanged(true); }} onBack={piece.lyrics?.length ? () => setLines(piece.lyrics!) : null} />}
      </Modal>
      {leaving && (
        <ConfirmModal
          title="Abandonner les paroles ?"
          message="Ce qui n’est pas enregistré sera perdu."
          confirmLabel="Abandonner"
          danger
          onConfirm={onClose}
          onClose={() => setLeaving(false)}
        />
      )}
    </>
  );
}

function Find({ piece, onFound, onBack }: { piece: StoredPiece; onFound(lines: LyricLine[]): void; onBack: (() => void) | null }) {
  const [title, setTitle] = useState(piece.title);
  const [artist, setArtist] = useState(piece.artist ?? '');
  const [found, setFound] = useState<FoundLyrics[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const search = async () => {
    setSearching(true);
    setError('');
    try {
      setFound(await piecesApi.findLyrics(title.trim(), artist.trim() || null));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };
  const use = (lyrics: string) => {
    const lines = parseLyrics(lyrics);
    if (lines.length) onFound(lines);
    else setError('Aucune parole dans ce texte.');
  };

  return (
    <div className="space-y-5" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) void search();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Titre de la chanson"><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={inputClass} /></Field>
          <Field label="Artiste"><input value={artist} maxLength={120} onChange={(e) => setArtist(e.target.value)} className={inputClass} /></Field>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={searching || !title.trim()} className={primaryButton}>{searching ? 'Recherche…' : 'Chercher les paroles'}</button>
          <span className="text-xs text-neutral-400">Sur LRCLIB : seuls le titre et l’artiste sont envoyés.</span>
        </div>
      </form>
      {found && (found.length ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">
          {found.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => use(f.synced ?? f.plain!)} className="flex w-full items-center gap-3 rounded-lg bg-neutral-50 px-3 py-2 text-left hover:bg-neutral-100">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-neutral-900">{f.title}</span>
                  <span className="block truncate text-xs text-neutral-500">{[f.artist, f.album].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums text-neutral-400">
                  {f.duration > 0 && clock(f.duration)}
                  <span className={`block ${f.synced ? 'text-emerald-700' : ''}`}>{f.synced ? 'Minutées' : 'Texte seul'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-neutral-500">Rien trouvé. Vérifie le titre et l’artiste, ou colle les paroles.</p>)}

      <div className="space-y-2 border-t border-neutral-100 pt-4">
        <Field label="Ou colle les paroles">
          <textarea value={text} rows={5} onChange={(e) => setText(e.target.value)} placeholder="Une ligne par phrase chantée (texte, ou fichier LRC)" className={inputClass} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!text.trim()} onClick={() => use(text)} className={secondaryButton}>Utiliser ce texte</button>
          <button type="button" onClick={() => file.current?.click()} className={secondaryButton}>Fichier .lrc</button>
          <span className="flex-1" />
          {onBack && <button type="button" onClick={onBack} className={secondaryButton}>Garder les paroles actuelles</button>}
        </div>
        <input
          ref={file}
          type="file"
          accept=".lrc,.txt,text/plain"
          className="hidden"
          onChange={async (e) => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (picked) use(await picked.text());
          }}
        />
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function Place({ piece, lines, isNew, onChanged, onOther, onSaved }: {
  piece: StoredPiece;
  lines: LyricLine[];
  // Not saved yet.
  isNew: boolean;
  onChanged(): void;
  onOther(): void;
  onSaved(lyrics: LyricLine[] | null): void;
}) {
  // Every change, to take them back.
  const [past, setPast] = useState<{ anchors: Anchors; cursor: number }[]>([]);
  const [anchors, setAnchors] = useState<Anchors>(new Map());
  // The next line to put in its place.
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const shown = useMemo(() => placed(lines, anchors), [lines, anchors]);
  const timed = lines.some((l) => l.time !== null);
  const missing = shown.filter((l) => l.time === null && l.text).length;

  const notes = useMemo(() => levelNotes(piece), [piece]);
  const { duration } = useMemo(() => layoutOf(piece), [piece]);
  const preview = usePreview(notes, duration);
  const { now } = lineAt(shown, preview.position);
  const list = useRef<HTMLUListElement>(null);
  // Words not timed yet: the one to come is what matters.
  const followed = timed && preview.playing ? now : cursor;
  useEffect(() => {
    list.current?.querySelector(`[data-line="${followed}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [followed]);

  const here = (line: number, time = preview.position) => {
    if (!lines[line]) return;
    setError('');
    setPast((p) => [...p, { anchors, cursor }]);
    setAnchors(anchored(anchors, line, time));
    setCursor(Math.min(lines.length, line + 1));
    onChanged();
  };
  const back = () => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast(past.slice(0, -1));
    setAnchors(last.anchors);
    setCursor(last.cursor);
  };
  // All of them, sooner or later.
  const nudge = (by: number) => {
    const at = shown.findIndex((l) => l.time !== null);
    if (at < 0) return;
    setPast((p) => [...p, { anchors, cursor }]);
    setAnchors(anchors.size ? new Map([...anchors].map(([i, t]) => [i, t + by])) : new Map([[at, shown[at].time! + by]]));
    onChanged();
  };
  const listen = () => (preview.playing ? preview.stop() : preview.play(preview.position >= duration - 0.1 ? 0 : preview.position));

  // Space: the line starts now. Caught before the player behind.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (e.code !== 'Space' && e.key !== 'Backspace') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat || removing) return;
    if (e.key === 'Backspace') back();
    else if (preview.playing) here(cursor);
    else listen();
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, []);

  const save = async (lyrics: LyricLine[] | null) => {
    if (lyrics && lyrics.every((l) => l.time === null)) return setError('Aucune ligne n’est encore placée : lance le morceau et appuie sur Espace au début de chaque ligne.');
    preview.stop();
    setSaving(true);
    setError('');
    try {
      await piecesApi.update(piece.id, { lyrics });
      onSaved(lyrics);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        {timed
          ? 'Les temps viennent d’un enregistrement. Lance le morceau et appuie sur Espace quand la première ligne doit commencer : les autres suivent. Fais pareil avec une ligne de la fin (bouton « Ici ») si le tempo n’est pas le même.'
          : 'Lance le morceau et appuie sur Espace au début de chaque ligne.'}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={(e) => { e.currentTarget.blur(); listen(); }} className={secondaryButton}>{preview.playing ? 'Arrêter' : 'Lancer'}</button>
        <button type="button" onClick={(e) => { e.currentTarget.blur(); here(cursor); }} disabled={!preview.playing || cursor >= lines.length} className={primaryButton}>Elle commence (Espace)</button>
        <Small onClick={() => preview.play(0)} title="Reprendre du début">↺</Small>
        <Small onClick={back} title="Annuler le dernier placement (Retour arrière)">↶</Small>
        <span className="flex-1" />
        <Small onClick={() => nudge(-0.1)} title="Toutes les lignes un peu plus tôt">− 0,1 s</Small>
        <Small onClick={() => nudge(0.1)} title="Toutes les lignes un peu plus tard">+ 0,1 s</Small>
        <span className="w-12 text-right text-sm tabular-nums text-neutral-500">{clock(Math.max(0, preview.position))}</span>
      </div>
      <ul ref={list} className="max-h-[45dvh] space-y-0.5 overflow-y-auto overscroll-contain rounded-lg border border-neutral-200 p-1">
        {shown.map((l, i) => {
          const hidden = l.time !== null && (l.time < 0 || l.time > duration);
          return (
            <li key={i} data-line={i} className={`flex items-center gap-2 rounded-md px-2 ${i === now && preview.playing ? 'bg-sky-100' : i === cursor ? 'bg-neutral-100' : ''}`}>
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  setCursor(i);
                  if (l.time !== null) preview.play(Math.max(0, l.time - 1));
                }}
                title={l.time === null ? 'Prochaine ligne à placer' : 'Écouter à partir d’ici'}
                className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
              >
                <span className={`w-12 shrink-0 text-right text-xs tabular-nums ${anchors.has(i) ? 'font-semibold text-sky-700' : hidden ? 'text-red-500' : 'text-neutral-400'}`}>
                  {l.time === null ? '–' : l.time < 0 ? 'avant' : l.time > duration ? 'après' : clock(l.time)}
                </span>
                <span className={`truncate text-sm ${l.text ? 'text-neutral-900' : 'text-neutral-300'}`}>{l.text || '♪'}</span>
              </button>
              <Small onClick={() => here(i)} title="Cette ligne commence à l’endroit où en est le morceau">Ici</Small>
            </li>
          );
        })}
      </ul>
      {missing > 0 && missing < lines.length && <p className="text-xs text-neutral-400">{missing} ligne{missing > 1 ? 's' : ''} pas encore placée{missing > 1 ? 's' : ''} : {missing > 1 ? 'elles ne seront pas affichées' : 'elle ne sera pas affichée'}.</p>}
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap justify-end gap-2">
        {!!piece.lyrics?.length && <button type="button" onClick={() => setRemoving(true)} className={secondaryButton}>Enlever</button>}
        <button type="button" onClick={() => { preview.stop(); onOther(); }} className={secondaryButton}>Autres paroles</button>
        <span className="flex-1" />
        <button type="button" onClick={() => void save(toSave(shown))} disabled={saving || (!isNew && !anchors.size)} className={primaryButton}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
      {removing && (
        <ConfirmModal
          title="Enlever les paroles ?"
          message="Le morceau n’est pas changé."
          confirmLabel="Enlever"
          danger
          onConfirm={() => void save(null)}
          onClose={() => setRemoving(false)}
        />
      )}
    </div>
  );
}
