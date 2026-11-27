import { frenchName, type Hand } from '@piano/shared';
import { useEffect, useRef, useState } from 'react';
import { NoteText } from '../Accidentals';
import { Segmented } from '../../components/Segmented';
import { Switch } from '../../components/Switch';
import { inputBus } from '../input/bus';
import type { Key } from './numbers';

// Fills the cell picked: type its numbers, or touch the numbers already known
// (as on the keyboard, the sound comes with it).

const COLOR: Record<Hand, string> = { left: 'text-hand-l-ink hover:bg-hand-l-soft', right: 'text-hand-r-ink hover:bg-hand-r-soft' };

export function playKey(midi: number) {
  inputBus.noteOn(midi, 'virtual');
  setTimeout(() => inputBus.noteOff(midi, 'virtual'), 220);
}

export function CellPad({ id, hand, text, keys, fill, chord, focus, onFill, onChord, onText, onMove }: {
  // Of the cell: another cell, another text.
  id: string;
  hand: Hand;
  text: string;
  keys: Key[];
  // Keys played are written in the cell. Off: they are only heard.
  fill: boolean;
  // Keys add up in the cell instead of going to the next one.
  chord: boolean;
  // Typed on a computer: its own keys move and empty.
  focus: boolean;
  onFill(on: boolean): void;
  onChord(on: boolean): void;
  // False when the text makes no sense: it stays there.
  onText(text: string): boolean;
  // To the cell before, after, or the other hand's.
  onMove(to: 'previous' | 'next' | 'hand'): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(text);
  useEffect(() => {
    setValue(text);
    if (focus) {
      input.current?.focus();
      input.current?.select();
    }
  }, [id, text, focus]);

  const save = () => value.trim() === text || onText(value.trim());

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<Hand> value={hand} onChange={(h) => h !== hand && onMove('hand')} options={[{ value: 'left', label: 'Gauche' }, { value: 'right', label: 'Droite' }]} />
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          const go = (to: 'previous' | 'next' | 'hand') => {
            e.preventDefault();
            if (save()) onMove(to);
          };
          if (e.key === 'Enter' || e.key === ' ') go('next');
          else if (e.key === 'ArrowRight' && el.selectionEnd === value.length) go('next');
          else if (e.key === 'ArrowLeft' && (el.selectionStart === 0 || value === '')) go('previous');
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') go('hand');
          else if (e.key === 'Backspace' && value === '') go('previous');
        }}
        placeholder="vide"
        inputMode="decimal"
        aria-label="Numéros de la case"
        className="w-20 rounded-lg border border-neutral-300 px-2 py-1.5 text-center text-base font-semibold tabular-nums focus:border-neutral-500 focus:outline-none"
      />
      <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-1">
        {keys.map((k) => (
          <button key={k.number} type="button" onClick={() => playKey(k.midi)} className={`flex h-9 items-center gap-1 rounded-lg px-2 text-sm ${COLOR[hand]}`}>
            <b className="tabular-nums">{k.number}</b>
            <span className="text-xs opacity-75"><NoteText text={frenchName(k.midi)} /></span>
          </button>
        ))}
        {!keys.length && <span className="text-xs text-neutral-400">Aucun numéro dans cette main.</span>}
      </div>
      <div className="flex flex-wrap items-center">
        <Switch on={fill} label="Remplir" title="Les touches jouées s’écrivent dans la grille" onChange={onFill} />
        {fill && <Switch on={chord} label="Accord" title="Les touches jouées s’ajoutent dans la même case" onChange={onChord} />}
      </div>
      {!focus && <button type="button" onClick={() => onText('')} disabled={!text} className="h-9 rounded-lg px-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-35">Vider</button>}
      {!focus && <div className="flex">
        <button type="button" onClick={() => onMove('previous')} aria-label="Case précédente" className="h-9 w-9 rounded-lg text-neutral-600 hover:bg-neutral-100">←</button>
        <button type="button" onClick={() => onMove('next')} aria-label="Case suivante" className="h-9 w-9 rounded-lg text-neutral-600 hover:bg-neutral-100">→</button>
      </div>}
    </div>
  );
}
