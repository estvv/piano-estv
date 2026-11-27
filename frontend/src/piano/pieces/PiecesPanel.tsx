import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../app/auth';
import { ActionSheet, type Action } from '../../components/ActionSheet';
import { Field, inputClass } from '../../components/Field';
import { ChevronDownIcon, PencilIcon, PlusIcon, ShuffleIcon } from '../../components/icons';
import { ConfirmModal, Modal } from '../../components/Modal';
import { ErrorText, primaryButton, secondaryButton } from '../../components/ui';
import { TOUCH, useMedia } from '../../lib/useMedia';
import { foldersApi, piecesApi } from './api';
import { ExtractModal } from './ExtractModal';
import { PracticeStrip } from './PracticeStrip';
import { downloadMidi } from './midiExport';
import { foldersToReveal, type FolderKey } from './folderPath';
import { ImportModal } from './ImportModal';
import { CopyModal, PasteModal } from './PasteModal';
import { copyOf, encodePieces, looksLikePieces, type PieceCopy } from './pieceCopy';
import { Cover, DifficultyBadge, DifficultyPicker, FolderSelect } from './pieceFields';
import type { ScoreDraft } from './ScoreEditor';
import { voices } from './voice/store';
import { sourceLabels, type PieceFolder, type PieceMeta, type PieceSummary } from './types';

const formatDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

type Dragged = { kind: 'piece' | 'folder'; id: number };
const INDENT = 14; // px per folder level

// Side panel of the practice page: the account's pieces, sorted into a tree
// of folders, and the import.
// Folders start closed, except the way down to the current piece.
export function PiecesPanel({ current, listening, onCreate, onPick, onShuffle, onUpdated, onClose }: {
  current: number | null;
  listening: boolean;
  // Writes a piece by hand, from scratch or from what was read on a picture.
  onCreate(from?: ScoreDraft): void;
  onPick(id: number | null): void;
  // Plays these pieces in a random order, endlessly.
  onShuffle(ids: number[]): void;
  onUpdated(id: number, meta: PieceMeta & { cover?: string | null }): void;
  onClose(): void;
}) {
  const { user } = useAuth();
  const [pieces, setPieces] = useState<PieceSummary[] | null>(null);
  const [folders, setFolders] = useState<PieceFolder[]>([]);
  const [open, setOpen] = useState<FolderKey[]>([]);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<PieceSummary | null>(null);
  const [removing, setRemoving] = useState<PieceSummary | null>(null);
  // Folder modal: rename `folder`, or create one inside `parent`.
  const [naming, setNaming] = useState<{ folder: PieceFolder | null; parent: number | null } | null>(null);
  const [removingFolder, setRemovingFolder] = useState<PieceFolder | null>(null);
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [dropTarget, setDropTarget] = useState<FolderKey | null>(null);
  const [error, setError] = useState('');
  // Fingers have no hover and do not drag rows: a menu per row.
  const touch = useMedia(TOUCH);
  // Copying pieces, here or to another site.
  const [said, setSaid] = useState('');
  const [copying, setCopying] = useState<string | null>(null);
  const [pasting, setPasting] = useState<string | null>(null);
  // A new piece from parts of this one.
  const [extracting, setExtracting] = useState<PieceSummary | null>(null);
  useEffect(() => {
    if (!said) return;
    const id = setTimeout(() => setSaid(''), 4000);
    return () => clearTimeout(id);
  }, [said]);
  const copyPieces = async (list: PieceSummary[]) => {
    setError('');
    try {
      const copies: PieceCopy[] = [];
      for (const p of list) copies.push(copyOf(await piecesApi.get(p.id)));
      const text = await encodePieces(copies);
      try {
        await navigator.clipboard.writeText(text);
        setSaid(list.length > 1 ? `${list.length} morceaux copiés.` : `« ${list[0].title} » copié.`);
      } catch {
        setCopying(text);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openPaste = async () => {
    const text = await navigator.clipboard.readText().catch(() => '');
    setPasting(looksLikePieces(text) ? text : '');
  };
  const dialog = importing || editing || removing || naming || removingFolder || copying !== null || pasting !== null || extracting;
  // Ctrl+V anywhere in the list.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') ?? '';
      if (!dialog && user && looksLikePieces(text)) setPasting(text);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [dialog, user]);
  const [menu, setMenu] = useState<{ title: string; actions: Action[] } | null>(null);

  // Read at the first load only: later reloads (after an edit) keep what the
  // user opened or closed.
  const currentRef = useRef(current);
  const revealed = useRef(false);

  const load = useCallback(() => {
    if (!user) return;
    Promise.all([piecesApi.list(), foldersApi.list()]).then(([p, f]) => {
      setPieces(p);
      setFolders(f);
      if (!revealed.current) {
        revealed.current = true;
        setOpen(foldersToReveal(currentRef.current, p, f));
      }
    }, (e: Error) => setError(e.message));
  }, [user]);
  useEffect(load, [load]);

  const run = (p: Promise<unknown>) => p.catch((e: Error) => {
    setError(e.message);
    load();
  });

  const toggle = (key: FolderKey) => setOpen((o) => (o.includes(key) ? o.filter((k) => k !== key) : [...o, key]));
  const childrenOf = (parent: number | null) => folders.filter((f) => f.parent_id === parent);
  const known = new Set(folders.map((f) => f.id));
  const folderOf = (p: PieceSummary): number | null => (p.folder_id !== null && known.has(p.folder_id) ? p.folder_id : null);
  // `id` itself or one of its subfolders, at any depth.
  const within = (id: number, ancestor: number) => {
    for (let at: number | null = id; at !== null; at = folders.find((f) => f.id === at)?.parent_id ?? null) if (at === ancestor) return true;
    return false;
  };
  const visible = pieces ?? [];
  const piecesIn = (id: number) => visible.filter((p) => { const f = folderOf(p); return f !== null && within(f, id); });

  const patchPiece = (p: PieceSummary, change: Partial<PieceMeta> & { cover?: string | null }) => {
    const meta = { title: p.title, artist: p.artist, description: p.description, folder_id: p.folder_id, difficulty: p.difficulty, cover: p.cover, ...change };
    setPieces((list) => list?.map((x) => (x.id === p.id ? { ...x, ...meta } : x)) ?? list);
    onUpdated(p.id, meta);
  };

  const movePiece = (pieceId: number, folder: number | null) => {
    const p = pieces?.find((x) => x.id === pieceId);
    if (!p || p.folder_id === folder) return;
    patchPiece(p, { folder_id: folder });
    void run(piecesApi.update(p.id, { folder_id: folder }));
  };

  const moveFolderInto = (id: number, parent: number | null) => {
    const f = folders.find((x) => x.id === id);
    if (!f || f.parent_id === parent || (parent !== null && within(parent, id))) return;
    setFolders((list) => list.map((x) => (x.id === id ? { ...x, parent_id: parent, position: Number.MAX_SAFE_INTEGER } : x)));
    if (parent !== null) setOpen((o) => (o.includes(parent) ? o : [...o, parent]));
    void run(foldersApi.update(id, { parent_id: parent }).then(load));
  };

  // Up or down among the folders of the same parent.
  const shift = (f: PieceFolder, by: -1 | 1) => {
    const siblings = childrenOf(f.parent_id);
    const i = siblings.findIndex((x) => x.id === f.id);
    const order = [...siblings];
    order.splice(i, 1);
    order.splice(i + by, 0, f);
    const position = new Map(order.map((x, k) => [x.id, k]));
    setFolders((list) => [...list.map((x) => (position.has(x.id) ? { ...x, position: position.get(x.id)! } : x))].sort((a, b) => a.position - b.position || a.id - b.id));
    void run(foldersApi.reorder(order.map((x) => x.id)));
  };

  // Drop target: a folder, or "none" (out of any folder / top level).
  const dropProps = (key: FolderKey) => {
    const accepts = () => dragged !== null && (dragged.kind === 'piece' || key === 'none' || !within(key, dragged.id));
    return {
      onDragOver: (e: DragEvent) => {
        if (!accepts()) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDropTarget(key);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget((t) => (t === key ? null : t));
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const target = key === 'none' ? null : key;
        if (dragged?.kind === 'piece') movePiece(dragged.id, target);
        else if (dragged && accepts()) moveFolderInto(dragged.id, target);
        setDragged(null);
        setDropTarget(null);
      },
    };
  };
  const dragProps = (item: Dragged) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`);
      setDragged(item);
    },
    onDragEnd: () => {
      setDragged(null);
      setDropTarget(null);
    },
  });

  const rootPieces = visible.filter((p) => folderOf(p) === null);
  const hasFolders = folders.length > 0;

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="flex h-full w-full max-w-sm flex-col border-l border-neutral-200 bg-white shadow-2xl animate-[fade-in_120ms_ease-out]">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4">
          <h2 className="text-lg font-bold text-neutral-900">Morceaux</h2>
          <button type="button" onClick={onClose} title="Fermer" className="-mr-2 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {!user ? (
          <div className="p-5 text-sm text-neutral-600">
            Les morceaux importés sont privés et liés à ton compte. <Link to="/connexion" className="underline">Connecte-toi</Link> pour importer des fichiers MIDI, des partitions ou des enregistrements.
          </div>
        ) : (
          <>
            <div className="flex gap-2 p-4 pb-2">
              <button type="button" onClick={() => setImporting(true)} className={`${primaryButton} min-w-0 flex-1`} title="Image (IA), partition PDF, vidéo, son, MIDI">
                <PlusIcon className="h-4 w-4" />Importer
              </button>
              <button type="button" onClick={() => onCreate()} className={`${secondaryButton} min-w-0 flex-1`} title="Écrire un morceau à la main, en chiffres">
                <PencilIcon className="h-4 w-4" />Créer
              </button>
              <button
                type="button"
                onClick={() => void openPaste()}
                title="Coller un morceau copié (Ctrl+V)"
                aria-label="Coller un morceau copié"
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white px-3 text-neutral-700 transition-colors hover:bg-neutral-50"
              >
                <PasteIcon />
              </button>
              {pieces && (
                <button
                  type="button"
                  onClick={() => setNaming({ folder: null, parent: null })}
                  title="Nouveau dossier"
                  aria-label="Nouveau dossier"
                  className="inline-flex shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white px-3 text-neutral-700 transition-colors hover:bg-neutral-50"
                >
                  <FolderPlusIcon />
                </button>
              )}
            </div>

            <PracticeStrip onPick={onPick} />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
              <button
                type="button"
                onClick={() => onPick(null)}
                className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${current === null ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" className="h-5 w-5" aria-hidden>
                    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 5v8M12 5v8M16 5v8" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-neutral-900">Jeu libre</span>
                  <span className="block text-xs text-neutral-500">Joue sans partition</span>
                </span>
              </button>

              {visible.length > 0 && (
                <button
                  type="button"
                  onClick={() => onShuffle(visible.map((p) => p.id))}
                  className={`mt-0.5 flex w-full items-center gap-3 rounded-xl p-2 text-left ${listening ? 'bg-sky-50' : 'hover:bg-neutral-50'}`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                    <ShuffleIcon />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-neutral-900">Lecture aléatoire</span>
                    <span className="block text-xs text-neutral-500">{listening ? `En cours · ${touch ? 'touche' : 'clique'} pour remélanger tout` : `${visible.length} morceau${visible.length > 1 ? 'x' : ''} au hasard, en boucle`}</span>
                  </span>
                </button>
              )}

              {pieces?.length === 0 && !hasFolders && <p className="px-3 py-4 text-sm text-neutral-400">Aucun morceau pour l’instant.</p>}

              {pieces && (
                <div className="mt-2">
                  {childrenOf(null).map((f, i, siblings) => folderNode(f, 0, i, siblings.length))}

                  {/* Without folders, a plain list; with folders, a closed group like the others. */}
                  {!hasFolders ? (
                    <div className="space-y-0.5">{rootPieces.map((p) => row(p, 0))}</div>
                  ) : (rootPieces.length > 0 || dragged !== null) && (
                    <section {...dropProps('none')} className={`mt-1 rounded-xl transition-colors ${dropTarget === 'none' ? 'bg-sky-50 ring-2 ring-inset ring-sky-300' : ''}`}>
                      <button type="button" onClick={() => toggle('none')} className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-50">
                        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open.includes('none') ? '' : '-rotate-90'}`} />
                        <span className="truncate text-sm font-semibold text-neutral-500">{dragged?.kind === 'folder' ? 'Hors des dossiers' : 'Sans dossier'}</span>
                        <span className="shrink-0 text-xs text-neutral-400">{rootPieces.length}</span>
                      </button>
                      {open.includes('none') && <div className="space-y-0.5 pb-1">{rootPieces.map((p) => row(p, 1))}</div>}
                    </section>
                  )}
                </div>
              )}

              <div className="px-3"><ErrorText>{error}</ErrorText></div>
            </div>
            <div aria-live="polite">
              {said && <p className="border-t border-neutral-100 px-5 py-3 text-sm text-neutral-700">{said} <span className="text-neutral-400">Colle-le dans Morceaux, ici ou sur l’autre site.</span></p>}
            </div>
          </>
        )}
      </aside>

      {menu && <ActionSheet title={menu.title} actions={menu.actions} onClose={() => setMenu(null)} />}
      {importing && (
        <ImportModal
          folders={folders}
          onClose={() => setImporting(false)}
          onNumbers={(draft) => {
            setImporting(false);
            onCreate(draft);
          }}
          onSaved={(id) => {
            setImporting(false);
            load();
            onPick(id);
          }}
        />
      )}
      {copying !== null && <CopyModal text={copying} onClose={() => setCopying(null)} />}
      {pasting !== null && (
        <PasteModal
          text={pasting}
          folders={folders}
          onClose={() => setPasting(null)}
          onPaste={async (copy, folder) => void (await piecesApi.paste(copy, folder))}
          onDone={(folder) => {
            setPasting(null);
            if (folder !== null) setOpen((o) => (o.includes(folder) ? o : [...o, folder]));
            load();
          }}
        />
      )}
      {extracting && (
        <ExtractModal
          id={extracting.id}
          onClose={() => setExtracting(null)}
          onSaved={(id) => {
            setExtracting(null);
            onPick(id);
          }}
        />
      )}
      {editing && (
        <EditModal
          piece={editing}
          folders={folders}
          onClose={() => setEditing(null)}
          onSaved={(meta) => {
            patchPiece(editing, meta);
            setEditing(null);
          }}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Supprimer « ${removing.title} » ?`}
          message="Le morceau sera supprimé de ton compte."
          confirmLabel="Supprimer"
          danger
          onConfirm={async () => {
            await piecesApi.remove(removing.id);
            void voices.remove(removing.id).catch(() => {});
            if (current === removing.id) onPick(null);
            load();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
      {naming && (
        <FolderModal
          folder={naming.folder}
          parentName={naming.parent !== null ? folders.find((f) => f.id === naming.parent)?.name ?? null : null}
          onClose={() => setNaming(null)}
          onSave={async (name) => {
            if (naming.folder) await foldersApi.update(naming.folder.id, { name });
            else {
              await foldersApi.create(name, naming.parent);
              if (naming.parent !== null) setOpen((o) => (o.includes(naming.parent!) ? o : [...o, naming.parent!]));
            }
            setNaming(null);
            load();
          }}
        />
      )}
      {removingFolder && (
        <ConfirmModal
          title={`Supprimer le dossier « ${removingFolder.name} » ?`}
          message="Rien n’est perdu : ses morceaux et ses sous-dossiers remontent d’un niveau."
          confirmLabel="Supprimer le dossier"
          danger
          onConfirm={async () => {
            await foldersApi.remove(removingFolder.id);
            load();
          }}
          onClose={() => setRemovingFolder(null)}
        />
      )}
    </div>
  );

  function folderNode(f: PieceFolder, depth: number, index: number, siblings: number): ReactNode {
    const inside = piecesIn(f.id);
    const isOpen = open.includes(f.id);
    const subfolders = childrenOf(f.id);
    const own = visible.filter((p) => folderOf(p) === f.id);
    const actions: Action[] = [
      ...(inside.length > 0 ? [{ label: 'Écouter ce dossier au hasard, en boucle', icon: <ShuffleIcon className="h-3.5 w-3.5" />, onClick: () => onShuffle(inside.map((p) => p.id)) }] : []),
      ...(inside.length > 0 ? [{ label: 'Copier les morceaux du dossier', icon: <CopyIcon />, onClick: () => void copyPieces(inside) }] : []),
      { label: 'Monter', icon: '↑', disabled: index === 0, onClick: () => shift(f, -1) },
      { label: 'Descendre', icon: '↓', disabled: index === siblings - 1, onClick: () => shift(f, 1) },
      { label: 'Nouveau sous-dossier', icon: <PlusIcon className="h-3.5 w-3.5" />, onClick: () => setNaming({ folder: null, parent: f.id }) },
      { label: 'Renommer', icon: <PencilIcon className="h-3.5 w-3.5" />, onClick: () => setNaming({ folder: f, parent: f.parent_id }) },
      { label: 'Supprimer le dossier', icon: <TrashIcon />, danger: true, onClick: () => setRemovingFolder(f) },
    ];
    return (
      <section
        key={f.id}
        {...dropProps(f.id)}
        className={`rounded-xl transition-colors ${dropTarget === f.id ? 'bg-sky-50 ring-2 ring-inset ring-sky-300' : ''} ${dragged?.kind === 'folder' && dragged.id === f.id ? 'opacity-40' : ''}`}
      >
        <div {...(touch ? {} : dragProps({ kind: 'folder', id: f.id }))} className="group/folder flex items-center gap-1 rounded-lg pr-1 hover:bg-neutral-50" style={{ paddingLeft: depth * INDENT }}>
          <button type="button" onClick={() => toggle(f.id)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left">
            <ChevronDownIcon className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
            <span className="truncate text-sm font-semibold text-neutral-900">{f.name}</span>
            <span className="shrink-0 text-xs text-neutral-400">{inside.length}</span>
          </button>
          {touch ? (
            <IconButton title={`Actions : ${f.name}`} big onClick={() => setMenu({ title: f.name, actions })}><DotsIcon /></IconButton>
          ) : (
            <div className="hidden shrink-0 items-center group-hover/folder:flex">
              {actions.map((a) => <IconButton key={a.label} title={a.label} disabled={a.disabled} danger={a.danger} onClick={a.onClick}>{a.icon}</IconButton>)}
            </div>
          )}
        </div>
        {isOpen && (
          <div className="space-y-0.5 pb-1">
            {subfolders.map((c, i) => folderNode(c, depth + 1, i, subfolders.length))}
            {own.map((p) => row(p, depth + 1))}
            {subfolders.length === 0 && own.length === 0 && (
              <p className="py-2 pr-3 text-xs text-neutral-400" style={{ paddingLeft: (depth + 1) * INDENT + 12 }}>
                {touch ? 'Vide.' : 'Vide : glisse un morceau ou un dossier ici.'}
              </p>
            )}
          </div>
        )}
      </section>
    );
  }

  function row(p: PieceSummary, depth: number) {
    const active = current === p.id;
    const actions: Action[] = [
      { label: 'Modifier (titre, artiste, dossier, difficulté)', icon: <PencilIcon className="h-4 w-4" />, onClick: () => setEditing(p) },
      { label: 'Nouveau morceau avec des parties de celui-ci', icon: <ScissorsIcon />, onClick: () => setExtracting(p) },
      { label: 'Télécharger en MIDI', icon: <DownloadIcon />, onClick: () => void piecesApi.get(p.id).then(downloadMidi, (e: Error) => setError(e.message)) },
      { label: 'Copier le morceau', icon: <CopyIcon />, onClick: () => void copyPieces([p]) },
      { label: 'Supprimer', icon: <TrashIcon />, danger: true, onClick: () => setRemoving(p) },
    ];
    return (
      <div
        key={p.id}
        {...(touch ? {} : dragProps({ kind: 'piece', id: p.id }))}
        style={{ marginLeft: depth * INDENT }}
        className={`group flex items-center gap-1 rounded-xl pr-1.5 ${active ? 'bg-neutral-100' : 'hover:bg-neutral-50'} ${dragged?.kind === 'piece' && dragged.id === p.id ? 'opacity-40' : ''}`}
      >
        <button
          type="button"
          onClick={() => onPick(p.id)}
          onDoubleClick={touch ? undefined : () => setEditing(p)}
          title={`${sourceLabels[p.source]} · ${p.note_count} notes`}
          className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
        >
          <Cover key={p.cover} src={p.cover} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-neutral-900">{p.title}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
              <span className="truncate">
                {p.artist ?? <span className="text-neutral-400">Artiste inconnu</span>}
                {p.description && <span className="text-neutral-400"> · {p.description}</span>}
              </span>
              {p.difficulty && <DifficultyBadge value={p.difficulty} />}
            </span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-neutral-400 group-hover:hidden">{formatDuration(p.duration)}</span>
        </button>
        {touch ? (
          <IconButton title={`Actions : ${p.title}`} big onClick={() => setMenu({ title: p.title, actions })}><DotsIcon /></IconButton>
        ) : (
          <div className="hidden shrink-0 items-center group-hover:flex">
            {actions.map((a) => <IconButton key={a.label} title={a.label} danger={a.danger} onClick={a.onClick}>{a.icon}</IconButton>)}
          </div>
        )}
      </div>
    );
  }
}

function IconButton({ title, onClick, disabled, danger, big, children }: { title: string; onClick(): void; disabled?: boolean; danger?: boolean; big?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex ${big ? 'h-10 w-10' : 'h-7 w-7'} shrink-0 items-center justify-center rounded-lg text-sm text-neutral-400 disabled:opacity-30 disabled:hover:bg-transparent ${
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-neutral-200/70 hover:text-neutral-900'
      }`}
    >
      {children}
    </button>
  );
}

const FolderPlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v5M9.5 13.5h5" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </svg>
);

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);

const ScissorsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
  </svg>
);

const PasteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <path d="M9 5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M12 11v5M9.5 14l2.5 2.5 2.5-2.5" />
  </svg>
);

const DotsIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
    <circle cx="12" cy="5" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="12" cy="19" r="1.75" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
);

function EditModal({ piece, folders, onClose, onSaved }: { piece: PieceSummary; folders: PieceFolder[]; onClose(): void; onSaved(meta: PieceMeta & { cover: string | null }): void }) {
  const [title, setTitle] = useState(piece.title);
  const [artist, setArtist] = useState(piece.artist ?? '');
  const [description, setDescription] = useState(piece.description ?? '');
  const [folder, setFolder] = useState(piece.folder_id);
  const [difficulty, setDifficulty] = useState(piece.difficulty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // A Deezer / Apple Music link picks the cover by hand; without one, the
  // cover follows the title and artist being typed.
  const [link, setLink] = useState('');
  const [linking, setLinking] = useState(false);
  const [preview, setPreview] = useState<{ cover: string | null; searching: boolean }>({ cover: piece.cover, searching: false });

  useEffect(() => {
    const l = link.trim();
    const t = title.trim();
    const a = artist.trim() || null;
    if (!l && (!t || (t === piece.title && a === piece.artist))) {
      setPreview({ cover: t ? piece.cover : null, searching: false });
      return;
    }
    setPreview((p) => ({ ...p, searching: true }));
    const abort = new AbortController();
    const timer = setTimeout(() => {
      (l ? piecesApi.coverFromLink(l, abort.signal) : piecesApi.findCover(t, a, abort.signal)).then(
        ({ cover }) => setPreview({ cover, searching: false }),
        () => !abort.signal.aborted && setPreview((p) => ({ ...p, searching: false })),
      );
    }, l ? 200 : 500);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [title, artist, link, piece]);
  const linkCover = link.trim() && !preview.searching ? preview.cover : null;
  // Sent from a file: above all the rest.
  const [uploaded, setUploaded] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const shown = uploaded ?? preview.cover;

  const save = async () => {
    const meta: PieceMeta = { title: title.trim(), artist: artist.trim() || null, description: description.trim() || null, folder_id: folder, difficulty };
    if (!meta.title) return setError('Le titre ne peut pas être vide.');
    if (!uploaded && link.trim() && !linkCover) return setError('Ce lien ne donne pas de pochette : colle le lien d’un morceau, d’un album ou d’un artiste Deezer ou Apple Music.');
    setSaving(true);
    try {
      const picked = uploaded ?? linkCover;
      const { cover } = await piecesApi.update(piece.id, picked ? { ...meta, cover: picked } : meta);
      onSaved({ ...meta, cover });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Modifier le morceau"
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
          <button type="submit" form="piece-edit" disabled={saving} className={primaryButton}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        </>
      )}
    >
      <form
        id="piece-edit"
        className="space-y-4"
        // Keep typing out of the piano shortcuts.
        onKeyDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex gap-4">
          <div className="w-24 shrink-0 text-center">
            <div className={`transition-opacity ${preview.searching && !uploaded ? 'opacity-40' : ''}`}>
              <Cover key={shown} src={shown} size="lg" />
            </div>
            {uploaded ? (
              <button type="button" onClick={() => setUploaded(null)} className="mt-1.5 text-[11px] text-neutral-400 underline-offset-2 hover:text-neutral-900 hover:underline">Retirer l’image</button>
            ) : link.trim() && !preview.searching && !preview.cover ? (
              <p className="mt-1.5 text-[11px] leading-tight text-red-600">Lien non reconnu</p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (linking) setLink('');
                  setLinking(!linking);
                }}
                className="mt-1.5 text-[11px] text-neutral-400 underline-offset-2 hover:text-neutral-900 hover:underline"
              >
                {linking ? 'Annuler' : 'Changer'}
              </button>
            )}
            {!uploaded && (
              <button type="button" onClick={() => file.current?.click()} className="block w-full text-[11px] text-neutral-400 underline-offset-2 hover:text-neutral-900 hover:underline">
                Importer une image
              </button>
            )}
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const [f] = e.target.files ?? [];
                e.target.value = '';
                if (!f) return;
                setError('');
                coverFromFile(f).then(setUploaded, (err: Error) => setError(err.message));
              }}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <Field label="Titre">
              <input autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Artiste">
              <input value={artist} maxLength={120} placeholder="Facultatif" onChange={(e) => setArtist(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </div>
        {linking && (
          <input
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Lien Deezer ou Apple Music du morceau, de l’album ou de l’artiste"
            inputMode="url"
            aria-label="Lien de la pochette"
            className={inputClass}
          />
        )}
        <Field label="Description">
          <input value={description} maxLength={200} placeholder="Facultatif : « en entier », « boucle du refrain »…" onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Dossier">
          <FolderSelect folders={folders} value={folder} onChange={setFolder} />
        </Field>
        <Field label="Difficulté">
          <DifficultyPicker value={difficulty} onChange={setDifficulty} />
        </Field>
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}

function FolderModal({ folder, parentName, onClose, onSave }: { folder: PieceFolder | null; parentName: string | null; onClose(): void; onSave(name: string): Promise<void> }) {
  const [name, setName] = useState(folder?.name ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Modal
      title={folder ? 'Renommer le dossier' : parentName ? 'Nouveau sous-dossier' : 'Nouveau dossier'}
      subtitle={!folder && parentName ? `Dans « ${parentName} »` : ''}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
          <button type="submit" form="folder-name" disabled={saving || !name.trim()} className={primaryButton}>{folder ? 'Renommer' : 'Créer'}</button>
        </>
      )}
    >
      <form
        id="folder-name"
        onKeyDown={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setSaving(true);
          try {
            await onSave(name.trim());
          } catch (err) {
            setError((err as Error).message);
            setSaving(false);
          }
        }}
      >
        <Field label="Nom">
          <input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}

// A cover from the owner's files: square, cut in its middle, small enough to keep.
const COVER_SIDE = 800;
const MAX_COVER = 550_000;
async function coverFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image illisible : choisis un PNG, un JPEG ou un WebP.'));
      i.src = url;
    });
    const crop = Math.min(img.naturalWidth, img.naturalHeight);
    const side = Math.min(COVER_SIDE, crop);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = side;
    canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop, 0, 0, side, side);
    // PNG if it is light enough (transparency kept), else JPEG.
    for (const [type, quality] of [['image/png', undefined], ['image/jpeg', 0.9], ['image/jpeg', 0.75], ['image/jpeg', 0.6]] as const) {
      const data = canvas.toDataURL(type, quality);
      if (data.length <= MAX_COVER && data.startsWith(`data:${type}`)) return data;
    }
    throw new Error('Image trop lourde, même réduite.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
