import { noteLabel } from '@piano/shared';
import { useState } from 'react';
import { Section, Toggle } from '../components/settings';
import { useObservable } from '../lib/store';
import { primaryButton, secondaryButton } from '../components/ui';
import { audioState, playNotes } from './audio';
import { sourceLabels, type SourceId } from './input/bus';
import { useHeldNotes, useNoteInput } from './input/hooks';
import { disableMic, enableMic, micState } from './input/mic';
import { disableMidi, enableMidi, midiState } from './input/midi';
import { inputSettings, updateSettings } from './input/settings';
import { PianoKeyboard } from './PianoKeyboard';
import { StageFields, StagePreview } from './stage/StageFields';

const statusText = { off: 'désactivé', pending: 'autorisation…', on: 'actif', denied: 'refusé par le navigateur' } as const;

export function MusicSettings() {
  const settings = useObservable(inputSettings);
  const audio = useObservable(audioState);
  const midi = useObservable(midiState);
  const mic = useObservable(micState);
  const held = useHeldNotes();
  const [lastSource, setLastSource] = useState<SourceId | null>(null);
  useNoteInput((e) => e.type === 'on' && setLastSource(e.source));

  const heldList = [...held].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      <Section title="Tester les entrées">
        <div className="mb-3 text-sm text-neutral-500">
          {heldList.length ? heldList.map((m) => noteLabel(m, true)).join(' + ') : 'Joue une note avec n’importe quelle entrée.'}
          {lastSource && <span className="ml-2 text-neutral-400">via {sourceLabels[lastSource]}</span>}
        </div>
        <PianoKeyboard from={48} to={83} labels="names" height={140} />
      </Section>

      <Section title="Notes qui tombent" description="Pour les morceaux. Les couleurs de base des mains se choisissent dans Général ; chaque morceau peut avoir les siennes, dans ses options.">
        <div className="grid gap-5 lg:grid-cols-2">
          <StageFields />
          <StagePreview />
        </div>
      </Section>

      <Section title="Son" description="Piano échantillonné (Salamander Grand Piano).">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-3 text-sm">
            Volume
            <input
              type="range" min={0} max={1} step={0.05} value={settings.volume}
              onChange={(e) => updateSettings((s) => ({ ...s, volume: Number(e.target.value) }))}
              className="w-40 accent-neutral-900"
            />
          </label>
          <button type="button" className={secondaryButton} onClick={() => void playNotes([60, 64, 67, 72], 'melody', 0.25)}>Tester le son</button>
          <span className="text-xs text-neutral-400">
            {audio === 'loading' ? 'Chargement des sons…' : audio === 'error' ? 'Erreur de chargement' : audio === 'ready' ? 'Sons chargés' : ''}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-4">
          {(Object.keys(sourceLabels) as SourceId[]).map((s) => (
            <Toggle
              key={s}
              label={`Son pour ${sourceLabels[s].toLowerCase()}`}
              checked={settings.monitor[s]}
              onChange={(v) => updateSettings((st) => ({ ...st, monitor: { ...st.monitor, [s]: v } }))}
            />
          ))}
        </div>
      </Section>

      <Section title="Clavier MIDI" description="Branche un clavier en USB. Fonctionne dans Chrome et Edge.">
        {!midi.supported ? (
          <p className="text-sm text-neutral-500">Ce navigateur ne gère pas le MIDI (Web MIDI). Utilise Chrome ou Edge.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {midi.status === 'on'
              ? <button type="button" className={secondaryButton} onClick={disableMidi}>Désactiver</button>
              : <button type="button" className={primaryButton} onClick={() => void enableMidi()}>Activer le MIDI</button>}
            <span className="text-neutral-500">
              {statusText[midi.status]}
              {midi.status === 'on' && ` · ${midi.devices.length ? midi.devices.join(', ') : 'aucun appareil branché'}`}
            </span>
          </div>
        )}
      </Section>

      <Section title="Micro" description="Pour un vrai instrument : l’app écoute et reconnaît une note à la fois (pas les accords).">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {mic.status === 'on'
            ? <button type="button" className={secondaryButton} onClick={disableMic}>Couper le micro</button>
            : <button type="button" className={primaryButton} onClick={() => void enableMic()}>Activer le micro</button>}
          <span className="text-neutral-500">{statusText[mic.status]}</span>
        </div>
        {mic.status === 'on' && (
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="w-24 text-neutral-500">Niveau</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full bg-neutral-900" style={{ width: `${Math.min(100, mic.level * 400)}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 text-neutral-500">Seuil</span>
              <input
                type="range" min={0.002} max={0.1} step={0.002} value={settings.mic.threshold}
                onChange={(e) => updateSettings((s) => ({ ...s, mic: { threshold: Number(e.target.value) } }))}
                className="flex-1 accent-neutral-900"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 text-neutral-500">Entendu</span>
              <span className="font-medium">
                {mic.pitch !== null ? `${noteLabel(Math.round(mic.pitch), true)} ${centsText(mic.pitch)}` : '—'}
              </span>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function centsText(pitch: number) {
  const cents = Math.round((pitch - Math.round(pitch)) * 100);
  return cents === 0 ? '' : `(${cents > 0 ? '+' : ''}${cents} cents)`;
}
