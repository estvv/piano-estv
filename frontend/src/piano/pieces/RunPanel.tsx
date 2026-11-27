import type { Hand } from '@piano/shared';
import { useEffect, useRef, useState } from 'react';
import { Field, inputClass } from '../../components/Field';
import { Segmented } from '../../components/Segmented';
import { Modal } from '../../components/Modal';
import { ErrorText, primaryButton, secondaryButton } from '../../components/ui';
import { ensureAudio, playNote } from '../audio';
import { parseRun } from './score';

// A hand's numbers written in one go ("4-4 6-2-5-3"), then set one after the
// other, or on the rhythm tapped along with the video.
export function RunPanel({ hand: initial, textOf, unknown, midiOf, onPlaceKeys, onPlace, onClose }: {
  hand: Hand;
  // What the hand plays now.
  textOf(hand: Hand): string;
  unknown(hand: Hand, run: number[][]): number[];
  midiOf(hand: Hand, number: number): number | undefined;
  // Some numbers have no key yet: pick them on the keyboard, then come back.
  onPlaceKeys(hand: Hand, numbers: number[], text: string): void;
  // Taps in seconds; null: one column each.
  onPlace(hand: Hand, run: number[][], taps: number[] | null): void;
  onClose(): void;
}) {
  const [hand, setHand] = useState(initial);
  const [text, setText] = useState(() => textOf(initial));
  const [error, setError] = useState('');
  const [taps, setTaps] = useState<number[] | null>(null);
  const run = parseRun(text);

  const ready = (): number[][] | null => {
    if (!run) return setError('Écris des numéros séparés par des espaces ou des tirets, et + pour ceux joués ensemble : 4-4 6-2 1+3'), null;
    if (!run.length) return setError('Écris au moins un numéro.'), null;
    const missing = unknown(hand, run);
    if (missing.length) return onPlaceKeys(hand, missing, text), null;
    setError('');
    return run;
  };

  // Read by the key listener without restarting it.
  const state = useRef({ run, taps, hand });
  state.current = { run, taps, hand };
  const tap = () => {
    const { run: r, taps: t, hand: h } = state.current;
    if (!r || !t || t.length >= r.length) return;
    const now = performance.now() / 1000;
    for (const n of r[t.length]) {
      const midi = midiOf(h, n);
      if (midi !== undefined) playNote(midi, 0.5);
    }
    const next = [...t, now];
    state.current.taps = next;
    setTaps(next);
    if (next.length === r.length) onPlace(h, r, next);
  };
  const tapping = taps !== null;
  useEffect(() => {
    if (!tapping) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.key === 'Escape' || e.key === 'Tab') return;
      e.preventDefault();
      e.stopPropagation();
      tap();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapping]);

  return (
    <Modal title="Écrire la suite" onClose={onClose} width="md">
      {tapping && run ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-neutral-600">
            Tape en rythme avec la vidéo, une fois par numéro : sur le bouton, ou avec n’importe quelle touche. Le premier tap est le début de la partie.
          </p>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              tap();
            }}
            className={`flex h-40 w-full touch-none select-none flex-col items-center justify-center rounded-2xl active:brightness-90 ${hand === 'left' ? 'bg-hand-l text-hand-l-on' : 'bg-hand-r text-hand-r-on'}`}
          >
            <span className="text-6xl font-bold tabular-nums">{run[taps.length]?.join('+') ?? '✓'}</span>
            <span className="mt-1 text-sm opacity-80">{taps.length} / {run.length}</span>
          </button>
          <div className="flex justify-between">
            <button type="button" onClick={() => setTaps(null)} className={secondaryButton}>Retour</button>
            <button type="button" onClick={() => setTaps([])} className={secondaryButton}>Recommencer</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Segmented<Hand>
            full
            value={hand}
            onChange={(h) => {
              setHand(h);
              setText(textOf(h));
              setError('');
            }}
            options={[{ value: 'left', label: 'Gauche' }, { value: 'right', label: 'Droite' }]}
          />
          <Field label="Numéros, dans l’ordre" hint="Espaces ou tirets entre les numéros, + pour ceux joués ensemble. Remplace ce que cette main joue dans la partie.">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="4-4 6-2-5-3 5-6-5-4-1" className={`${inputClass} text-base tabular-nums`} autoFocus />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => { const r = ready(); if (r) onPlace(hand, r, null); }} className={secondaryButton}>Placer à la suite</button>
            <button
              type="button"
              onClick={() => {
                if (!ready()) return;
                void ensureAudio().catch(() => {});
                setTaps([]);
              }}
              className={primaryButton}
            >
              Taper le rythme
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
