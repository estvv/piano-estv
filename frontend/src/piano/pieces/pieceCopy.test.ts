// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { copyOf, decodePieces, encodePieces, looksLikePieces } from './pieceCopy';
import type { StoredPiece } from './types';

const piece: StoredPiece = {
  id: 7, title: 'Été ♯1', artist: 'Moi', source: 'midi', bpm: 120, difficulty: 'easy', cover: 'https://img.test/a.jpg', description: 'boucle', level: 'simplified',
  notes: Array.from({ length: 2000 }, (_, i) => ({ midi: 60 + (i % 12), time: i / 3, duration: 0.25, velocity: 0.7, hand: 'right' as const })),
  sections: [{ start: 0, label: 'A' }], edits: { simplified: { removed: [{ midi: 60, time: 0 }], added: [] } }, numbers: [{ label: 'A', hand: 'right', midi: 60, number: 4 }], lyrics: [{ time: 1, text: 'la' }],
};

describe('pieces copied as text', () => {
  it('come back whole, without what belongs to the account', async () => {
    const text = await encodePieces([copyOf(piece), copyOf({ ...piece, title: 'B' })]);
    expect(looksLikePieces(text)).toBe(true);
    const [a, b] = await decodePieces(text);
    expect(a).toEqual(copyOf(piece));
    expect(b.piece.title).toBe('B');
    expect(JSON.stringify(a)).not.toContain('"id"');
    // Much shorter than its notes, on one line.
    expect(text.length).toBeLessThan(40_000);
    expect(text).not.toMatch(/\s/);
  });

  it('survive being cut into lines', async () => {
    const text = await encodePieces([copyOf(piece)]);
    expect(await decodePieces(`  ${text.replace(/(.{70})/g, '$1\r\n')}\n`)).toHaveLength(1);
  });

  it('say what is wrong with other texts', async () => {
    const text = await encodePieces([copyOf(piece)]);
    await expect(decodePieces('bonjour')).rejects.toThrow('pas un morceau');
    await expect(decodePieces('piano-estv:morceaux:2:abc')).rejects.toThrow('plus récente');
    await expect(decodePieces(text.slice(0, -200))).rejects.toThrow('incomplet');
    await expect(decodePieces('piano-estv:morceaux:1:abc')).rejects.toThrow('incomplet');
  });

  it('read those copied from learn-estv', async () => {
    const text = await encodePieces([copyOf(piece)]);
    expect(await decodePieces(text.replace('piano-estv:', 'learn-estv:'))).toHaveLength(1);
  });
});
