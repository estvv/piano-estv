import type { Hand, PieceNote } from '@piano/shared';
import { strFromU8, unzipSync } from 'fflate';
import type { ImportResult } from './types';
import { guessNames } from './names';

// MusicXML (.musicxml / .xml) and compressed MusicXML (.mxl, a zip), as
// exported by MuseScore and most notation software. Covered: parts, voices
// (backup/forward), chords, ties, staves (staff 1 = right hand, 2 = left),
// tempo changes. Not covered: repeats and jumps are played straight through
// once, grace notes are skipped.

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

async function readXml(file: File): Promise<string> {
  if (!/\.mxl$/i.test(file.name)) return file.text();
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const container = files['META-INF/container.xml'];
  let path = container ? /full-path="([^"]+)"/.exec(strFromU8(container))?.[1] : undefined;
  path ??= Object.keys(files).find((f) => /\.(musicxml|xml)$/i.test(f) && !f.startsWith('META-INF'));
  if (!path || !files[path]) throw new Error('Archive .mxl sans partition');
  return strFromU8(files[path]);
}

const num = (el: Element | null | undefined, sel: string) => {
  const v = el?.querySelector(sel)?.textContent;
  return v ? Number(v) : undefined;
};

interface RawNote { midi: number; start: number; length: number; velocity: number; hand: Hand | null; tieStop: boolean; tieStart: boolean }

export async function importMusicXml(file: File): Promise<ImportResult> {
  const doc = new DOMParser().parseFromString(await readXml(file), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fichier MusicXML illisible');
  const root = doc.documentElement;
  if (root.nodeName === 'score-timewise') throw new Error('Format « timewise » non pris en charge : réexporte en MusicXML standard');

  // Positions are in quarter notes; tempo changes are collected per quarter.
  const tempos: { at: number; bpm: number }[] = [];
  const raw: RawNote[] = [];
  const parts = [...root.querySelectorAll(':scope > part')];
  if (parts.length === 0) throw new Error('Aucune partie dans cette partition');

  for (const [partIndex, part] of parts.entries()) {
    let divisions = 1;
    let cursor = 0; // in divisions
    let measureStartQ = 0; // quarters
    let measureLengthQ = 0;
    let lastStart = 0;
    let velocity = 0.75;
    const staves = Number(part.querySelector('attributes staves')?.textContent ?? 1);

    for (const measure of part.querySelectorAll(':scope > measure')) {
      cursor = 0;
      let maxCursor = 0;
      for (const el of measure.children) {
        switch (el.nodeName) {
          case 'attributes':
            divisions = num(el, 'divisions') ?? divisions;
            break;
          case 'sound':
          case 'direction': {
            const sound = el.nodeName === 'sound' ? el : el.querySelector('sound');
            const tempo = sound?.getAttribute('tempo') ?? undefined;
            const perMinute = num(el, 'metronome per-minute');
            const bpm = tempo ? Number(tempo) : perMinute;
            if (bpm && partIndex === 0) tempos.push({ at: measureStartQ + cursor / divisions, bpm });
            const dyn = sound?.getAttribute('dynamics');
            if (dyn) velocity = Math.min(1, Math.max(0.1, Number(dyn) / 100 * 0.85));
            break;
          }
          case 'backup':
            cursor -= num(el, 'duration') ?? 0;
            break;
          case 'forward':
            cursor += num(el, 'duration') ?? 0;
            break;
          case 'note': {
            const duration = num(el, ':scope > duration') ?? 0;
            const isChord = !!el.querySelector(':scope > chord');
            const start = isChord ? lastStart : cursor;
            if (!isChord) lastStart = cursor;
            const pitch = el.querySelector(':scope > pitch');
            if (pitch && !el.querySelector(':scope > grace') && duration > 0) {
              const step = pitch.querySelector('step')?.textContent ?? 'C';
              const midi = (num(pitch, 'octave') ?? 4) * 12 + 12 + STEP[step] + (num(pitch, 'alter') ?? 0);
              const staff = num(el, ':scope > staff') ?? 1;
              const ties = [...el.querySelectorAll(':scope > tie')].map((t) => t.getAttribute('type'));
              raw.push({
                midi: Math.round(midi),
                start: measureStartQ + start / divisions,
                length: duration / divisions,
                velocity,
                hand: staves >= 2 ? (staff === 1 ? 'right' : 'left') : null,
                tieStart: ties.includes('start'),
                tieStop: ties.includes('stop'),
              });
            }
            if (!isChord) cursor += duration;
            break;
          }
        }
        maxCursor = Math.max(maxCursor, cursor);
      }
      measureLengthQ = maxCursor / divisions;
      measureStartQ += measureLengthQ;
    }
  }
  if (raw.length === 0) throw new Error('Aucune note dans cette partition');

  // Merge tied notes into one.
  raw.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const merged: RawNote[] = [];
  const open = new Map<string, RawNote>();
  for (const n of raw) {
    const key = `${n.midi}:${n.hand}`;
    const prev = open.get(key);
    if (n.tieStop && prev && Math.abs(prev.start + prev.length - n.start) < 1e-6) {
      prev.length += n.length;
      if (!n.tieStart) open.delete(key);
      continue;
    }
    merged.push(n);
    if (n.tieStart) open.set(key, n);
  }

  // Quarters -> seconds through the tempo map (default 120 bpm).
  tempos.sort((a, b) => a.at - b.at);
  if (!tempos.length || tempos[0].at > 0) tempos.unshift({ at: 0, bpm: tempos[0]?.bpm ?? 120 });
  const seconds = (q: number) => {
    let t = 0;
    for (let i = 0; i < tempos.length; i++) {
      const from = tempos[i].at;
      const to = Math.min(q, tempos[i + 1]?.at ?? Infinity);
      if (to > from) t += (to - from) * 60 / tempos[i].bpm;
      if (q <= (tempos[i + 1]?.at ?? Infinity)) break;
    }
    return t;
  };

  const notes: PieceNote[] = merged.map((n) => {
    const time = seconds(n.start);
    return { midi: n.midi, time, duration: Math.max(0.05, seconds(n.start + n.length) - time), velocity: n.velocity, hand: n.hand };
  });
  const scoreTitle = root.querySelector('work > work-title')?.textContent?.trim() || root.querySelector('movement-title')?.textContent?.trim();
  const composer = root.querySelector('identification > creator[type="composer"]')?.textContent?.trim();
  const names = scoreTitle ? { title: scoreTitle, artist: composer || null } : guessNames(file.name);

  return {
    ...names,
    artist: names.artist || composer || null,
    source: 'musicxml',
    bpm: Math.round(tempos[0].bpm),
    notes,
    warnings: [
      ...(root.querySelector('repeat, segno, coda') ? ['Les reprises et renvois (D.C., D.S.) sont joués une seule fois, sans retour.'] : []),
      ...(notes.every((n) => n.hand === null) ? ['Une seule portée : les mains sont réparties automatiquement.'] : []),
    ],
  };
}
