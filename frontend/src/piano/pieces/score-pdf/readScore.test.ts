import { describe, expect, it } from 'vitest';
import type { Glyph, PageContent, Shape } from './primitives';
import { NotAScore, readScore } from './readScore';

// A page drawn symbol by symbol. Staves are 5 points between two lines.
const S = 5;
class Page {
  glyphs: Glyph[] = [];
  shapes: Shape[] = [];
  staff(y: number, x0 = 40, x1 = 560) {
    for (let i = 0; i < 5; i++) this.line(x0, y + i * S, x1, y + i * S);
  }
  line(x0: number, y0: number, x1: number, y1: number, curved = false) {
    const points = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
    this.shapes.push({ points, filled: curved, curved, line: 0.6, box: { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) } });
  }
  glyph(code: number, x: number, y: number, width = 6, size = 20) {
    this.glyphs.push({ code, x, y, width, size });
  }
  // A quarter note by default, its stem going up.
  note(x: number, y: number, code = 0xe0a4) {
    this.glyph(code, x, y);
    if (code !== 0xe0a2) this.line(x + 6, y - 17, x + 6, y);
  }
  beam(x0: number, x1: number, y: number) {
    const points = [{ x: x0, y }, { x: x1, y }, { x: x1, y: y + 2.5 }, { x: x0, y: y + 2.5 }];
    this.shapes.push({ points, filled: true, curved: false, line: 0, box: { x0, y0: y, x1, y1: y + 2.5 } });
  }
  bar(x: number, y0: number, y1: number) {
    this.line(x, y0, x, y1);
  }
  time(x: number, y: number, over: number, under: number) {
    this.glyph(0xe080 + over, x, y + S);
    this.glyph(0xe080 + under, x, y + 3 * S);
  }
  get content(): PageContent {
    return { width: 600, height: 840, glyphs: this.glyphs, shapes: this.shapes };
  }
}
// On a treble staff whose top line is at y: E5 is the second space… F5 the top line.
const treble = (y: number, name: string) => y + { F5: 0, E5: 2.5, D5: 5, C5: 7.5, B4: 10, A4: 12.5, G4: 15, F4: 17.5, E4: 20, C4: 25 }[name]!;
const bass = (y: number, name: string) => y + { A3: 0, G3: 2.5, F3: 5, E3: 7.5, D3: 10, C3: 12.5, G2: 20 }[name]!;

// One treble staff, one bar line at the end of each bar.
function single(bars: number[] = [300, 560]) {
  const p = new Page();
  p.staff(100);
  p.glyph(0xe050, 44, 115, 12);
  for (const x of bars) p.bar(x, 100, 120);
  return p;
}
const heard = (p: Page) => {
  const r = readScore([p.content]);
  const beat = 60 / r.bpm!;
  return r.notes.map((n) => `${n.midi}@${+(n.time / beat).toFixed(2)}`).join(' ');
};

describe('reading a PDF score', () => {
  it('reads pitches, bar after bar', () => {
    const p = single();
    ['F5', 'E5', 'D5', 'C5'].forEach((n, i) => p.note(90 + i * 45, treble(100, n)));
    ['B4', 'A4', 'G4', 'C4'].forEach((n, i) => p.note(310 + i * 50, treble(100, n)));
    expect(heard(p)).toBe('77@0 76@1 74@2 72@3 71@4 69@5 67@6 60@7');
  });

  it('reads two staves, hands apart and in step', () => {
    const p = new Page();
    p.staff(100);
    p.staff(160);
    p.glyph(0xe050, 44, 115, 12);
    p.glyph(0xe062, 44, 165, 12);
    p.bar(40, 100, 180);
    p.bar(560, 100, 180);
    p.note(100, treble(100, 'C5'), 0xe0a3); // half
    p.note(300, treble(100, 'D5'), 0xe0a3);
    ['C3', 'E3', 'G3', 'E3'].forEach((n, i) => p.note(100 + i * 100, bass(160, n)));
    const { notes } = readScore([p.content]);
    expect(notes.map((n) => `${n.midi}${n.hand![0]}@${+(n.time / 0.6).toFixed(2)}`)).toEqual(['48l@0', '72r@0', '52l@1', '55l@2', '74r@2', '52l@3']);
  });

  it('applies the key signature, and accidentals to the end of their bar', () => {
    const p = single();
    // One flat after the clef: B.
    p.glyph(0xe260, 60, treble(100, 'B4'), 4.5);
    p.note(100, treble(100, 'B4'));
    p.glyph(0xe262, 142, treble(100, 'F4'), 5);
    p.note(150, treble(100, 'F4'));
    p.note(200, treble(100, 'F4'));
    p.note(250, treble(100, 'F5'));
    p.note(320, treble(100, 'F4'));
    expect(heard(p)).toBe('70@0 66@1 66@2 77@3 65@4');
  });

  it('reads beams, flags, dots, rests and triplets', () => {
    const p = single([560]);
    p.time(60, 100, 4, 4);
    const y = treble(100, 'A4');
    p.note(100, y);
    p.note(130, y);
    p.beam(106, 136, y - 17);
    p.glyph(0xe0a4, 180, y);
    p.line(186, y - 17, 186, y);
    p.glyph(0xe1e7, 188, y, 2);
    p.note(230, y);
    p.glyph(0xe240, 236, y - 17, 5);
    p.glyph(0xe4e6, 280, 110, 5); // eighth rest
    p.note(320, y);
    p.glyph(0xe240, 326, y - 17, 5);
    // 0 and 1/2, dotted quarter at 1, eighth at 2.5, rest at 3, eighth at 3.5.
    expect(heard(p)).toBe('69@0 69@0.5 69@1 69@2.5 69@3.5');

    const t = single([560]);
    [100, 140, 180].forEach((x) => t.note(x, y));
    t.beam(106, 186, y - 17);
    t.glyph(0xe883, 141, y - 24, 4);
    t.note(260, y);
    expect(heard(t)).toBe('69@0 69@0.33 69@0.67 69@1');
  });

  it('joins tied notes, not slurred ones', () => {
    const p = single();
    const a = treble(100, 'A4');
    p.note(250, a);
    p.note(320, a);
    p.line(258, a + 3, 318, a + 3, true);
    p.note(380, treble(100, 'C5'));
    p.line(328, a + 4, 378, treble(100, 'C5') + 4, true);
    const { notes } = readScore([p.content]);
    expect(notes.map((n) => n.midi)).toEqual([69, 72]);
    // A quarter in the first bar (alone in it), then another one.
    expect(notes[0].duration).toBeCloseTo(2 * 0.6 * 0.97, 1);
  });

  it('reads the tempo', () => {
    const p = single();
    p.note(100, treble(100, 'A4'));
    p.glyph(0xeca5, 60, 80, 4, 12);
    [...'=148'].forEach((c, i) => p.glyph(c.charCodeAt(0), 70 + i * 6, 80, 5, 10));
    expect(readScore([p.content]).bpm).toBe(148);
  });

  it('refuses what is no score', () => {
    expect(() => readScore([new Page().content])).toThrow(NotAScore);
    const empty = single();
    expect(() => readScore([empty.content])).toThrow(NotAScore);
  });
});
