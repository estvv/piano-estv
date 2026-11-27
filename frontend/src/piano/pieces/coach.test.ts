import type { PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { contextOf } from './coach';
import { BeatGrid } from './grid';
import { takeOf } from './takes';

const n = (midi: number, time: number, hand: 'left' | 'right'): PieceNote => ({ midi, time, duration: 0.4, velocity: 0.7, hand });

describe('what the coach is told', () => {
  const about = {
    title: 'Amnésie', artist: 'Damso', level: 'Original', bpm: 120, rate: 0.75, grid: BeatGrid.regular(0, 0.5),
    part: { name: 'la partie B', start: 2, end: 4 },
    notes: [n(48, 1.5, 'left'), n(48, 2, 'left'), n(55, 2, 'left'), n(72, 2, 'right'), n(74, 2.5, 'right'), n(76, 4, 'right')],
  };

  it('tells the passage, chord by chord, and nothing outside it', () => {
    const text = contextOf(about, null);
    expect(text).toContain('Amnésie — Damso');
    expect(text).toContain('joué à 75 %');
    expect(text).toContain('mesure 2, temps 1, main gauche : Do3+Sol3');
    expect(text).toContain('mesure 2, temps 1, main droite : Do5');
    expect(text).toContain('mesure 2, temps 2, main droite : Ré5');
    expect(text).not.toContain('Mi5');
    expect(text).not.toContain('prise');
  });

  it('tells what went wrong in a take, the worst first kept', () => {
    const take = takeOf([
      { wrong: 0, waited: 0.2, at: 2, notes: [{ midi: 72, hand: 'right' }], keys: [] },
      { wrong: 2, waited: 3.04, at: 2.5, notes: [{ midi: 74, hand: 'right' }], keys: [73, 75] },
    ]);
    const text = contextOf(about, take);
    expect(text).toContain('1/2 accords justes du premier coup, 2 fausses notes');
    expect(text).toContain('mesure 2, temps 2, main droite, attendu Ré5, joué à tort Do♯5, Ré♯5, trouvé en 3,0 s');
    expect(text.match(/attendu/g)).toHaveLength(1);
  });
});
