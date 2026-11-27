import { pieceDuration } from '@piano/shared';
import { useEffect, useMemo, useState } from 'react';
import { Field, inputClass } from '../../components/Field';
import { PlayIcon } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { ErrorText, primaryButton, secondaryButton } from '../../components/ui';
import { foldersApi, piecesApi } from './api';
import { cuttable, toggled, type Cuttable } from './extract';
import { Small } from './Numbers';
import { OrderChips } from './OrderChips';
import { FolderSelect } from './pieceFields';
import { clock } from './PlayerControls';
import type { PieceFolder, StoredPiece } from './types';
import { usePreview } from './usePreview';

// A new piece made of some of the parts of this one, which stays as it is.
export function ExtractModal({ id, onSaved, onClose }: {
  id: number;
  onSaved(id: number): void;
  onClose(): void;
}) {
  const [piece, setPiece] = useState<StoredPiece | null>(null);
  const [folders, setFolders] = useState<PieceFolder[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let stale = false;
    piecesApi.get(id).then((p) => !stale && setPiece(p), (e: Error) => !stale && setError(e.message));
    foldersApi.list().then((f) => !stale && setFolders(f), () => {});
    return () => {
      stale = true;
    };
  }, [id]);
  const source = useMemo(() => piece && cuttable(piece), [piece]);

  return (
    <Modal title="Nouveau morceau avec des parties" subtitle={piece?.title ?? ''} onClose={onClose} width="md">
      {piece && source
        ? <Choice piece={piece} source={source} folders={folders} onSaved={onSaved} onClose={onClose} />
        : error ? <ErrorText>{error}</ErrorText> : <p className="text-sm text-neutral-400">Chargement du morceau…</p>}
    </Modal>
  );
}

function Choice({ piece, source, folders, onSaved, onClose }: {
  piece: StoredPiece;
  source: Cuttable;
  folders: PieceFolder[];
  onSaved(id: number): void;
  onClose(): void;
}) {
  // Places in the piece, in the order of the new one.
  const [places, setPlaces] = useState<number[]>([]);
  const [title, setTitle] = useState(piece.title);
  // Null: says which parts it has.
  const [description, setDescription] = useState<string | null>(null);
  const [folder, setFolder] = useState(piece.folder_id ?? null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const labels = places.map((p) => source.parts[p].label);
  const made = useMemo(() => (places.length ? source.take(places).piece.notes : []), [source, places]);
  const duration = useMemo(() => pieceDuration(made), [made]);
  // One part of the piece, or what is being made.
  const whole = usePreview(source.notes, source.duration);
  const result = usePreview(made, duration);
  const [heard, setHeard] = useState<number | null>(null);
  const stop = () => {
    whole.stop();
    result.stop();
  };
  const hear = (place: number) => {
    const again = whole.playing && heard === place;
    stop();
    if (again) return;
    const { start, end } = source.parts[place];
    setHeard(place);
    whole.play(start, { start, end });
  };
  const choose = (next: number[]) => {
    stop();
    setError('');
    setPlaces(next);
  };
  const said = `${labels.length > 1 ? 'Parties' : 'Partie'} ${labels.join(' ')}`.slice(0, 200);

  const save = async () => {
    if (!made.length) return setError('Ces parties n’ont aucune note.');
    stop();
    setSaving(true);
    setError('');
    try {
      const copy = source.take(places);
      const { id } = await piecesApi.paste({
        ...copy,
        piece: { ...copy.piece, title: title.trim() || piece.title },
        description: (description ?? said).trim() || null,
      }, folder);
      onSaved(id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-5"
      // Keep typing out of the piano shortcuts.
      onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div>
        <div className="mb-2 flex items-center">
          <span className="flex-1 text-sm font-semibold text-neutral-900">Parties à prendre</span>
          <Small onClick={() => choose(source.parts.map((_, i) => i))}>Toutes</Small>
          <Small onClick={() => choose([])}>Aucune</Small>
        </div>
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto overscroll-contain p-0.5">
          {source.parts.map((p, i) => {
            const on = places.includes(i);
            const playing = whole.playing && heard === i;
            return (
              <span key={i} className={`flex h-10 items-center rounded-lg ${on ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700'}`}>
                <button type="button" onClick={() => choose(toggled(places, i))} aria-pressed={on} title={`${clock(p.start)} – ${clock(p.end)}`} className="flex h-10 min-w-10 items-center gap-1.5 pl-3 pr-1.5 text-sm font-semibold">
                  {p.label}
                  <span className="text-[11px] font-normal tabular-nums opacity-60">{clock(p.end - p.start)}</span>
                </button>
                <button type="button" onClick={() => hear(i)} title={playing ? 'Arrêter' : 'Écouter'} aria-label={`${playing ? 'Arrêter' : 'Écouter'} ${p.label}`} className="flex h-10 w-8 items-center justify-center opacity-60 hover:opacity-100">
                  {playing ? <span className="h-2.5 w-2.5 rounded-sm bg-current" /> : <PlayIcon className="h-3 w-3" />}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {places.length > 0 && (
        <div>
          <div className="mb-2 flex items-center">
            <span className="flex-1 text-sm font-semibold text-neutral-900">
              Nouveau morceau <span className="font-normal tabular-nums text-neutral-400">{clock(duration)}</span>
            </span>
            <Small
              active={result.playing}
              onClick={() => {
                const playing = result.playing;
                stop();
                if (!playing) result.play(0);
              }}
            >
              {result.playing ? 'Arrêter' : 'Écouter'}
            </Small>
          </div>
          <OrderChips
            order={labels}
            selected={null}
            onPick={() => {}}
            onMove={(a, b) => {
              const next = [...places];
              next.splice(b, 0, ...next.splice(a, 1));
              choose(next);
            }}
          />
          {places.length > 1 && <p className="mt-1.5 text-xs text-neutral-400">Glisse une partie pour changer sa place.</p>}
        </div>
      )}

      <Field label="Titre"><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={inputClass} /></Field>
      <Field label="Description">
        <input value={description ?? (places.length ? said : '')} maxLength={200} placeholder="Facultatif" onChange={(e) => setDescription(e.target.value)} className={inputClass} />
      </Field>
      {folders.length > 0 && <Field label="Dossier"><FolderSelect folders={folders} value={folder} onChange={setFolder} /></Field>}
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
        <button type="submit" disabled={!places.length || saving} className={primaryButton}>{saving ? 'Création…' : 'Créer le morceau'}</button>
      </div>
    </form>
  );
}
