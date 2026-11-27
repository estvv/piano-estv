import { stepText, type Part } from './numbers';

// How a part's grid is cut into lines that fit the screen.

export interface Sizing {
  font: number; // px
  char: number; // width of one character
  min: number; // narrowest column
  beat: number; // narrowest beat: parts with few columns keep the pace of the others
  cap: number; // widest beat
}

export interface LineBox {
  from: number; // first column
  widths: number[]; // narrowest width of each column, px
}

// Beats per line, most first.
const LINE_BEATS = [16, 8, 4, 2, 1];
const PADDING = 6;

export function columnWidths(part: Part, { char, min, beat }: Sizing): number[] {
  const longest = new Array<number>(part.columns).fill(1);
  for (const row of part.rows) {
    for (const s of row.steps) longest[s.step] = Math.max(longest[s.step], stepText(s).length);
  }
  return longest.map((n) => Math.max(min, beat / part.division, n * char + PADDING));
}

export function breakLines(part: Part, width: number, sizing: Sizing): LineBox[] {
  const widths = columnWidths(part, sizing);
  const cut = (beats: number) => {
    const size = beats * part.division;
    const lines: LineBox[] = [];
    for (let from = 0; from < part.columns; from += size) lines.push({ from, widths: widths.slice(from, from + size) });
    return lines;
  };
  const beats = LINE_BEATS.find((b) => cut(b).every((l) => l.widths.reduce((a, w) => a + w, 0) <= width));
  return cut(beats ?? 1);
}

export const lineWidth = (line: LineBox, part: Part, sizing: Sizing) =>
  Math.max((line.widths.length / part.division) * sizing.cap, line.widths.reduce((a, w) => a + w, 0));
