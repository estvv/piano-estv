import { Midi } from '@tonejs/midi';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importMidi } from './importMidi';
import { importMusicXml } from './importMusicXml';
import { pieceRange, PiecePlayer } from './player';

describe('MIDI import', () => {
  it('reads notes in seconds and assigns hands from two tracks', async () => {
    const midi = new Midi();
    midi.header.setTempo(60);
    midi.name = 'Test';
    const right = midi.addTrack();
    right.addNote({ midi: 72, time: 0, duration: 1 });
    right.addNote({ midi: 74, time: 1, duration: 1 });
    const left = midi.addTrack();
    left.addNote({ midi: 48, time: 0, duration: 2 });
    const file = new File([midi.toArray() as BlobPart], 'test.mid');
    const r = await importMidi(file);
    expect(r.title).toBe('Test');
    expect(r.bpm).toBe(60);
    expect(r.notes.find((n) => n.midi === 72)?.hand).toBe('right');
    expect(r.notes.find((n) => n.midi === 48)?.hand).toBe('left');
    expect(r.notes.find((n) => n.midi === 74)?.time).toBeCloseTo(1, 2);
  });
});

describe('MIDI import with several instruments', () => {
  const band = () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    const piano = midi.addTrack();
    piano.name = 'Piano';
    piano.instrument.number = 0; // acoustic grand piano
    piano.addNote({ midi: 72, time: 0, duration: 0.5 });
    piano.addNote({ midi: 48, time: 0, duration: 0.5 });
    const bass = midi.addTrack();
    bass.instrument.number = 33; // electric bass (finger)
    bass.addNote({ midi: 36, time: 0.5, duration: 0.5 });
    const drums = midi.addTrack();
    drums.channel = 9;
    drums.addNote({ midi: 38, time: 0, duration: 0.1 });
    return new File([midi.toArray() as BlobPart], 'Groupe - Chanson.mid');
  };

  it('keeps every instrument but the drums, piano on and the others off', async () => {
    const r = await importMidi(band());
    expect(r.tracks).toEqual([
      { name: 'Piano', instrument: 'Acoustic grand piano', enabled: true },
      { name: 'Electric bass (finger)', instrument: 'Electric bass (finger)', enabled: false },
    ]);
    expect(r.notes.map((n) => [n.midi, n.track])).toEqual([[72, 0], [48, 0], [36, 1]]);
    // One piano track: hands split at middle C.
    expect(r.notes.find((n) => n.midi === 72)?.hand).toBe('right');
    expect(r.notes.find((n) => n.midi === 48)?.hand).toBe('left');
    expect(r.warnings.some((w) => w.includes('Pistes'))).toBe(true);
  });

  it('has no tracks for a single-instrument file', async () => {
    const midi = new Midi();
    midi.addTrack().addNote({ midi: 60, time: 0, duration: 1 });
    const r = await importMidi(new File([midi.toArray() as BlobPart], 'solo.mid'));
    expect(r.tracks).toBeUndefined();
    expect(r.notes[0].track).toBeUndefined();
  });
});

describe('player with tracks turned on and off', () => {
  it('keeps its place and the whole-piece duration when the notes change', () => {
    const notes = [
      { midi: 60, time: 0, duration: 1, velocity: 0.8, hand: null, track: 0 },
      { midi: 40, time: 3, duration: 1, velocity: 0.8, hand: null, track: 1 },
    ];
    const player = new PiecePlayer(notes, 4);
    player.seek(2);
    player.setNotes(notes.filter((n) => n.track === 0));
    expect(player.position).toBe(2);
    expect(player.duration).toBe(4);
    expect(player.notes).toHaveLength(1);
    player.dispose();
  });
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Petite pièce</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><staves>2</staves></attributes>
      <direction><sound tempo="60"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><staff>1</staff></note>
      <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><tie type="start"/><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><tie type="stop"/><staff>1</staff></note>
      <note><rest/><duration>2</duration><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

describe('MusicXML import', () => {
  it('handles chords, voices, staves, ties and tempo', async () => {
    const r = await importMusicXml(new File([xml], 'piece.musicxml'));
    expect(r.title).toBe('Petite pièce');
    expect(r.bpm).toBe(60);
    const byMidi = Object.fromEntries(r.notes.map((n) => [n.midi, n]));
    expect(Object.keys(byMidi).map(Number).sort()).toEqual([48, 60, 64, 66]);
    expect(byMidi[64].time).toBeCloseTo(0); // chord with C4
    expect(byMidi[66].time).toBeCloseTo(1); // after one quarter at 60 bpm
    expect(byMidi[66].duration).toBeCloseTo(2); // tied over the bar line
    expect(byMidi[48].hand).toBe('left');
    expect(byMidi[60].hand).toBe('right');
  });

  it('reads compressed .mxl archives', async () => {
    const zip = zipSync({
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'),
      'score.xml': strToU8(xml),
    });
    const r = await importMusicXml(new File([zip as BlobPart], 'piece.mxl'));
    expect(r.notes).toHaveLength(4);
  });
});

describe('player', () => {
  it('groups chords and fits the keyboard range', () => {
    const notes = [
      { midi: 60, time: 0, duration: 1, velocity: 1, hand: null },
      { midi: 64, time: 0.01, duration: 1, velocity: 1, hand: null },
      { midi: 67, time: 1, duration: 1, velocity: 1, hand: null },
    ];
    expect(pieceRange(notes)).toEqual([48, 71]);
    const player = new PiecePlayer(notes);
    expect(player.duration).toBe(2);
    player.dispose();
  });
});
