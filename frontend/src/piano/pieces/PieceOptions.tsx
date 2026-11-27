import { useState, type ReactNode } from 'react';
import type { Hand, PieceLevel, PieceNote, PieceNumbering, PieceTrack } from '@piano/shared';
import { PencilIcon, PlusIcon } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { Segmented } from '../../components/Segmented';
import { Toggle } from '../../components/settings';
import { StageFields, StagePreview } from '../stage/StageFields';
import { PieceHandColors } from '../../components/AppearanceFields';
import { Field } from '../../components/Field';
import type { PlayMode } from './player';
import { FROM, GOOD, progressive, setProgressive, STEP, TO } from './progressive';
import { useObservable } from '../../lib/store';
import { TrackList } from './PlayerControls';

export type HandChoice = 'both' | Hand;
// Where the player writes the numbers, and whether keys carry their names.
export interface NumbersShown { notes: boolean; keys: boolean; names: boolean }

export const RATES = [0.5, 0.75, 1, 1.25];

type Tab = 'play' | 'look' | 'edit';
// Opened again where it was left.
let lastTab: Tab = 'play';

// Everything that is not needed while playing, in a window.
export function PieceOptions({ mode, level, rate, hand, bothHands, numbered, tracks, notes, enabled, bigKeys, onMode, onLevel, onRate, onHand, onNumbered, onTracks, onBigKeys, onEdit, onEditNumbers, onExtract, lyrics, onLyrics, onKaraoke, voice, onVoice, onVoiceFile, onMidi, onCoach, onVideo, climbing, numbering, whole, onNumbering, pieceId, onClose }: {
  mode: PlayMode;
  level: PieceLevel;
  rate: number;
  hand: HandChoice;
  // Both play, at this level and with these tracks.
  bothHands: boolean;
  numbered: NumbersShown;
  tracks: PieceTrack[];
  notes: PieceNote[];
  enabled: boolean[];
  // Null when the screen has no need for them.
  bigKeys: boolean | null;
  onMode(mode: PlayMode): void;
  onLevel(level: PieceLevel): void;
  onRate(rate: number): void;
  onHand(hand: HandChoice): void;
  onNumbered(patch: Partial<NumbersShown>): void;
  onTracks(enabled: boolean[]): void;
  onBigKeys(on: boolean): void;
  // Left out for pieces written by hand: they only have one editor.
  onEdit?(): void;
  onEditNumbers(): void;
  // A new piece from parts of this one.
  onExtract(): void;
  // Shown or not; null: the piece has none.
  lyrics: boolean | null;
  onLyrics(on: boolean): void;
  // Finding them, putting them in their place.
  onKaraoke(): void;
  // A recording heard along; null: none on this device.
  voice: { on: boolean; volume: number } | null;
  onVoice(patch: Partial<{ on: boolean; volume: number }>): void;
  onVoiceFile(): void;
  // Downloads it, as it is played.
  onMidi(): void;
  onCoach(): void;
  onVideo(): void;
  // How keys get their numbers.
  numbering: PieceNumbering;
  whole: boolean;
  // Whose colours the hands are.
  pieceId: number;
  onNumbering(change: { numbering?: PieceNumbering; whole?: boolean }): void;
  // The tempo goes up by itself: a loop, in wait mode.
  climbing: boolean;
  onClose(): void;
}) {
  const [tab, setTab] = useState<Tab>(lastTab);
  const show = (next: Tab) => {
    lastTab = next;
    setTab(next);
  };

  return (
    <Modal title="Réglages" onClose={onClose} width="lg">
      <div className="mb-5">
        <Segmented<Tab> full value={tab} onChange={show} options={[{ value: 'play', label: 'Jouer' }, { value: 'look', label: 'Apparence' }, { value: 'edit', label: 'Modifier' }]} />
      </div>
      {/* As tall whatever the tab, so that they do not move under the mouse. */}
      <div className="sm:min-h-104">
        {tab === 'play' && (
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <Field label="Mode" hint={mode === 'wait' ? 'Le morceau attend que tu joues les bonnes notes.' : 'Le morceau se joue tout seul.'}>
              <Segmented<PlayMode> full value={mode} onChange={onMode} options={[{ value: 'listen', label: 'Écouter' }, { value: 'wait', label: 'Attente' }]} />
            </Field>
            <Field label="Mains" hint={!bothHands ? 'Une seule main joue avec ce niveau et ces pistes.' : hand === 'both' ? undefined : 'L’autre main n’est ni jouée ni affichée.'}>
              <div className={bothHands ? '' : 'pointer-events-none opacity-40'} inert={!bothHands}>
                <Segmented<HandChoice> full value={hand} onChange={onHand} options={[{ value: 'left', label: 'Gauche' }, { value: 'both', label: 'Les deux' }, { value: 'right', label: 'Droite' }]} />
              </div>
            </Field>
            <Field label="Niveau">
              <Segmented<PieceLevel>
                full
                value={level}
                onChange={onLevel}
                options={[{ value: 'original', label: 'Original' }, { value: 'simplified', label: 'Simplifié' }, { value: 'melody', label: 'Mélodie' }]}
              />
            </Field>
            <Field label="Vitesse">
              <Segmented<number> full value={rate} onChange={onRate} options={RATES.map((r) => ({ value: r, label: `${Math.round(r * 100)} %` }))} />
              {!RATES.includes(rate) && <p className="mt-1 text-xs text-neutral-500">En ce moment : {Math.round(rate * 100)} %</p>}
            </Field>
            <div className="sm:col-span-2"><ProgressiveField climbing={climbing} /></div>
            <div className="space-y-3 sm:col-span-2">
              {/* How keys are numbered counts everywhere (panel, parts), shown or not here. */}
              <div className="space-y-3 rounded-xl border border-neutral-200 p-3">
                <Field label="Chiffres" hint={''}>
                  <Segmented<PieceNumbering> full value={numbering} onChange={(n) => onNumbering({ numbering: n })} options={[{ value: 'order', label: 'Ordre' }, { value: 'hand', label: 'Position (par main)' }, { value: 'fixed', label: 'Position fixe' }]} />
                </Field>
                <Toggle checked={whole} onChange={(w) => onNumbering({ whole: w })} label="Sans parties : une seule suite pour tout le morceau" />
                <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-neutral-100 pt-3">
                  <span className="text-sm text-neutral-500">Afficher sur</span>
                  <Toggle checked={numbered.notes} onChange={(notes) => onNumbered({ notes })} label="les notes qui tombent" />
                  <Toggle checked={numbered.keys} onChange={(keys) => onNumbered({ keys })} label="les touches du clavier" />
                </div>
              </div>
              <div>
                <Toggle checked={numbered.names} onChange={(names) => onNumbered({ names })} label="Noms des notes sur les touches" />
                {numbered.names && numbered.keys && <p className="mt-1 text-xs text-neutral-400">Cachés tant que les chiffres sont sur les touches.</p>}
              </div>
              {lyrics !== null && <Toggle checked={lyrics} onChange={onLyrics} label="Paroles au-dessus des notes" />}
              {voice && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Toggle checked={voice.on} onChange={(on) => onVoice({ on })} label={mode === 'wait' ? 'Voix (muette en mode Attente)' : 'Voix'} />
                  <input type="range" min={0} max={1} step={0.02} value={voice.volume} disabled={!voice.on} onChange={(e) => onVoice({ volume: Number(e.target.value) })} aria-label="Volume de la voix" className="w-40 accent-neutral-900 disabled:opacity-40" />
                </div>
              )}
              {mode === 'wait' && bigKeys !== null && (
                <div>
                  <Toggle checked={bigKeys} onChange={onBigKeys} label="Grandes touches" />
                  <p className="mt-1 text-xs text-neutral-400">Pour jouer sur l’écran : le clavier suit les notes, et glisse si tu tires la zone au-dessus.</p>
                </div>
              )}
            </div>
            {tracks.length > 1 && (
              <div className="sm:col-span-2">
                <Field label="Pistes">
                  <div className="-mx-2 max-h-52 overflow-y-auto overscroll-contain"><TrackList tracks={tracks} notes={notes} enabled={enabled} onChange={onTracks} /></div>
                </Field>
              </div>
            )}
          </div>
        )}
        {tab === 'look' && (
          // The preview first on a phone, beside the fields and kept in sight otherwise.
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-[minmax(0,1fr)_15rem]">
            <div className="sm:order-2">
              <div className="sm:sticky sm:top-0"><StagePreview /></div>
            </div>
            <StageFields theme colours={<PieceHandColors piece={pieceId} />} />
          </div>
        )}
        {tab === 'edit' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {onEdit && <Choice title="Modifier les notes" text="Poser, déplacer et allonger les notes au-dessus du clavier." icon={<PencilIcon className="h-4 w-4" />} onClick={onEdit} />}
            <Choice title="Modifier en chiffres" text={onEdit ? 'Les numéros de chaque touche, et les cases une par une.' : 'Les numéros de chaque touche, et les notes.'} icon={<PencilIcon className="h-4 w-4" />} onClick={onEditNumbers} />
            <Choice
              title={lyrics === null ? 'Ajouter les paroles' : 'Paroles'}
              text="Karaoké : les trouver, et les caler sur le morceau."
              icon={lyrics === null ? <PlusIcon className="h-4 w-4" /> : <PencilIcon className="h-4 w-4" />}
              onClick={onKaraoke}
            />
            <Choice
              title={voice ? 'Voix' : 'Ajouter la voix'}
              text={voice ? 'Changer le fichier, le caler, l’enlever.' : 'Un mp3 joué en même temps que les notes.'}
              icon={voice ? <PencilIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
              onClick={onVoiceFile}
            />
            <Choice title="Exporter en vidéo" text="MP4 en paysage ou vertical, avec le style des notes, le son, les paroles et ton logo." icon={<VideoIcon />} onClick={onVideo} />
            <Choice title="Coach" text="Demander à l’IA : ta dernière prise, un doigté, ou n’importe quelle question." icon={<ChatIcon />} onClick={onCoach} />
            <Choice title="Télécharger en MIDI" text="Tel qu’il est joué ici : niveau, pistes, une piste par main." icon={<DownloadIcon />} onClick={onMidi} />
            <Choice title="Nouveau morceau avec des parties" text="Garder seulement quelques parties. Celui-ci ne change pas." icon={<PlusIcon className="h-4 w-4" />} onClick={onExtract} />
          </div>
        )}
      </div>
    </Modal>
  );
}

const VideoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" />
  </svg>
);

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <path d="M5 18.5 3.5 21l.5-4A8 8 0 1 1 7 19.5Z" /><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" />
  </svg>
);

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);

function ProgressiveField({ climbing }: { climbing: boolean }) {
  const p = useObservable(progressive);
  const pct = (r: number) => `${Math.round(r * 100)} %`;
  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <Toggle checked={p.on} onChange={(on) => setProgressive({ on })} label="Tempo progressif" />
      <p className="mt-1 text-xs text-neutral-500">
        {p.on && !climbing
          ? 'S’active sur une boucle, en mode Attente.'
          : `Une boucle commence lentement et accélère de ${Math.round(STEP * 100)} % après chaque passage noté ${GOOD} ou plus.`}
      </p>
      {p.on && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          De
          <select value={p.from} onChange={(e) => setProgressive({ from: Number(e.target.value) })} aria-label="Tempo de départ" className="rounded-lg border border-neutral-200 bg-white px-2 py-1">
            {FROM.map((r) => <option key={r} value={r}>{pct(r)}</option>)}
          </select>
          à
          <select value={p.to} onChange={(e) => setProgressive({ to: Number(e.target.value) })} aria-label="Tempo visé" className="rounded-lg border border-neutral-200 bg-white px-2 py-1">
            {TO.filter((r) => r > p.from).map((r) => <option key={r} value={r}>{pct(r)}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function Choice({ title, text, icon, onClick }: { title: string; text: string; icon: ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-xl border border-neutral-200 p-4 text-left transition-colors hover:border-neutral-400 hover:bg-neutral-50">
      <span className="mt-0.5 shrink-0 text-neutral-500">{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-neutral-900">{title}</span>
        <span className="mt-0.5 block text-xs text-neutral-500">{text}</span>
      </span>
    </button>
  );
}
