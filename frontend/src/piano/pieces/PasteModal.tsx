import { useEffect, useState } from 'react';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { ErrorText, primaryButton, secondaryButton } from '../../components/ui';
import { decodePieces, type PieceCopy } from './pieceCopy';
import { FolderSelect } from './pieceFields';
import type { PieceFolder } from './types';

// Pieces copied here or on another site. `text`: from the clipboard; empty when
// the browser keeps it to itself, to be pasted by hand.
export function PasteModal({ text: given, folders, onPaste, onDone, onClose }: {
  text: string;
  folders: PieceFolder[];
  onPaste(piece: PieceCopy, folder: number | null): Promise<void>;
  onDone(folder: number | null): void;
  onClose(): void;
}) {
  const [text, setText] = useState(given);
  const [pieces, setPieces] = useState<PieceCopy[] | null>(null);
  const [folder, setFolder] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPieces(null);
    setError('');
    if (!text.trim()) return;
    let stale = false;
    decodePieces(text).then((p) => !stale && setPieces(p), (e: Error) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [text]);

  const save = async () => {
    if (!pieces) return;
    setSaving(true);
    setError('');
    // One by one: after a failure, only the ones left are tried again.
    let left = pieces;
    try {
      for (; left.length; left = left.slice(1)) await onPaste(left[0], folder);
      onDone(folder);
    } catch (e) {
      setPieces(left);
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal title="Coller un morceau" onClose={onClose}>
      <div className="space-y-4">
        {pieces ? (
          <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg bg-neutral-50 px-4 py-3 text-sm">
            {pieces.map((p, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="min-w-0 truncate font-semibold text-neutral-900">{p.piece.title}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">{p.piece.artist}</span>
                <span className="shrink-0 text-xs tabular-nums text-neutral-400">{p.piece.notes.length} notes</span>
              </li>
            ))}
          </ul>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Colle ici (Ctrl+V) le morceau copié"
            className={`${inputClass} break-all font-mono text-xs`}
          />
        )}
        {pieces && folders.length > 0 && <Field label="Dossier"><FolderSelect folders={folders} value={folder} onChange={setFolder} /></Field>}
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
          <button type="button" onClick={() => void save()} disabled={!pieces || saving} className={primaryButton}>
            {saving ? 'Ajout…' : pieces && pieces.length > 1 ? `Ajouter ${pieces.length} morceaux` : 'Ajouter'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// When the browser does not let the app write to the clipboard.
export function CopyModal({ text, onClose }: { text: string; onClose(): void }) {
  return (
    <Modal title="Copier un morceau" onClose={onClose}>
      <p className="mb-3 text-sm text-neutral-600">Ton navigateur n’a pas voulu copier tout seul : copie ce texte (Ctrl+C), puis colle-le dans Morceaux sur l’autre site.</p>
      <textarea readOnly value={text} rows={5} autoFocus onFocus={(e) => e.currentTarget.select()} className={`${inputClass} break-all font-mono text-xs`} />
    </Modal>
  );
}
