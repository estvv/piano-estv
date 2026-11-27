import type { Hand } from '@piano/shared';
import type { Part, Step } from './numbers';

// What one hand plays, in order, as written by hand to learn a piece: "-" from
// a key to the next, "+" for keys played together, a space for a short breath,
// a new line for a real one. Time is left out.
//   5-7-5-4
//   3-7-6 3-7-6 5-3

// Columns between two keys, next to the usual gap: a breath, a new line.
const BREATH = 1.5;
const LINE = 2.5;
// Longer lines are cut at their widest gap.
const LONGEST = 10;

const stepText = (s: Step) => s.chords.map((c) => c.join('+')).join('-');

// One key (or chord) of a line, and what comes before it: '', '-' or ' '.
export interface Said {
  before: string;
  text: string;
  step: Step;
}

export function sequenceSaid(part: Part, hand: Hand): Said[][] {
  const steps = part.rows.find((r) => r.hand === hand)?.steps ?? [];
  if (!steps.length) return [];
  const gaps = steps.slice(1).map((s, i) => s.step - steps[i].step);
  const usual = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 1;
  // A new line after a whole beat of nothing at least.
  const line = Math.max(usual * LINE, part.division * 2);
  const lines: Step[][] = [[steps[0]]];
  gaps.forEach((gap, i) => {
    if (gap >= line) lines.push([]);
    lines[lines.length - 1].push(steps[i + 1]);
  });
  return lines.flatMap((l) => cut(l)).map((l) => l.map((s, i) => ({
    before: i === 0 ? '' : s.step - l[i - 1].step >= usual * BREATH ? ' ' : '-',
    text: stepText(s),
    step: s,
  })));
}

export const sequenceLines = (part: Part, hand: Hand): string[] =>
  sequenceSaid(part, hand).map((l) => l.map((x) => x.before + x.text).join(''));

// One line: too long, cut where it breathes most.
function cut(steps: Step[]): Step[][] {
  if (steps.length <= LONGEST) return [steps];
  let at = Math.floor(steps.length / 2);
  const gap = (i: number) => steps[i].step - steps[i - 1].step;
  for (let i = 3; i < steps.length - 2; i++) {
    if (gap(i) > gap(at) || (gap(i) === gap(at) && Math.abs(i - steps.length / 2) < Math.abs(at - steps.length / 2))) at = i;
  }
  return [...cut(steps.slice(0, at)), ...cut(steps.slice(at))];
}

// The whole piece, part after part, a blank line between them.
export function sequenceText(parts: Part[], hand: Hand): string {
  return parts.map((p) => sequenceLines(p, hand)).filter((l) => l.length).map((l) => l.join('\n')).join('\n\n');
}
