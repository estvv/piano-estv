import { frenchName, octaveOf, type Hand } from '@piano/shared';
import { useEffect, useState } from 'react';
import { NoteText } from '../Accidentals';
import type { Key } from './numbers';

// Which key each number is: typed here, or given by playing the keys in order.
export function OwnNumbers({ hand, keys, assign, onNumber, onHear }: {
  hand: Hand;
  keys: Key[];
  assign: boolean;
  onNumber(midi: number, number: number): void;
  onHear(midi: number): void;
}) {
  return (
    <>
      <p className="mb-4 text-sm text-neutral-500">
        {assign ? `Joue les touches de la main ${hand === 'left' ? 'gauche' : 'droite'} dans l’ordre que tu veux : 1, 2, 3…` : 'Joue pour écouter. Change un numéro ici, ou allume Assigner et joue les touches dans l’ordre.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {keys.map((k) => (
          <span key={k.midi} className={`flex h-12 items-center rounded-xl ${hand === 'left' ? 'bg-hand-l-soft text-hand-l-ink' : 'bg-hand-r-soft text-hand-r-ink'}`}>
            <NumberInput value={k.number} label={`Numéro de ${frenchName(k.midi)}`} onChange={(v) => onNumber(k.midi, v)} />
            <button type="button" onClick={() => onHear(k.midi)} title="Écouter" className="h-12 pl-1.5 pr-4 text-sm opacity-75 hover:opacity-100">
              <NoteText text={frenchName(k.midi)} />
              {keys.some((o) => o !== k && (o.midi - k.midi) % 12 === 0) && octaveOf(k.midi)}
            </button>
          </span>
        ))}
        {!keys.length && <span className="text-sm text-neutral-400">La main {hand === 'left' ? 'gauche' : 'droite'} ne joue pas dans cette partie.</span>}
      </div>
    </>
  );
}

function NumberInput({ value, label, onChange }: { value: number; label: string; onChange(v: number): void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const save = () => {
    if (!/^\d{1,2}$/.test(text.trim())) return setText(String(value));
    if (Number(text) !== value) onChange(Number(text));
  };
  return (
    <input
      value={text}
      inputMode="numeric"
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="ml-1.5 h-9 w-11 rounded-lg bg-transparent text-center text-xl font-bold tabular-nums hover:bg-white focus:bg-white focus:outline-none focus:ring-1 focus:ring-neutral-400"
    />
  );
}
