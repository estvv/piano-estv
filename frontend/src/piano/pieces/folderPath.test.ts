import { describe, expect, it } from 'vitest';
import { foldersToReveal, listOrder, neighbour } from './folderPath';

// Priorité (1) > Chopin (2) > Nocturnes (3); Priorité > Liszt (4); Plus tard (5).
const folders = [
  { id: 1, parent_id: null },
  { id: 2, parent_id: 1 },
  { id: 3, parent_id: 2 },
  { id: 4, parent_id: 1 },
  { id: 5, parent_id: null },
];
const pieces = [
  { id: 10, folder_id: 3 },
  { id: 11, folder_id: 2 },
  { id: 12, folder_id: null },
  { id: 13, folder_id: 99 }, // folder deleted meanwhile
];

describe('folders opened for the current piece', () => {
  it('opens the path down to the piece, root first, and no other folder', () => {
    expect(foldersToReveal(10, pieces, folders)).toEqual([1, 2, 3]);
  });

  it('does not open the subfolders of the piece’s folder', () => {
    // Chopin (2) holds Nocturnes (3): only Priorité and Chopin open.
    expect(foldersToReveal(11, pieces, folders)).toEqual([1, 2]);
  });

  it('opens "Sans dossier" for a piece out of any folder, or in a missing one', () => {
    expect(foldersToReveal(12, pieces, folders)).toEqual(['none']);
    expect(foldersToReveal(13, pieces, folders)).toEqual(['none']);
  });

  it('opens nothing in free play, for an unknown piece, or without folders', () => {
    expect(foldersToReveal(null, pieces, folders)).toEqual([]);
    expect(foldersToReveal(42, pieces, folders)).toEqual([]);
    expect(foldersToReveal(12, pieces, [])).toEqual([]);
  });

  it('survives a broken tree', () => {
    const loop = [{ id: 1, parent_id: 2 }, { id: 2, parent_id: 1 }];
    expect(foldersToReveal(1, [{ id: 1, folder_id: 1 }], loop)).toEqual([2, 1]);
  });
});

describe('order of the list', () => {
  const folders = [{ id: 1, parent_id: null }, { id: 2, parent_id: null }, { id: 3, parent_id: 1 }];
  const pieces = [{ id: 10, folder_id: null }, { id: 11, folder_id: 1 }, { id: 12, folder_id: 3 }, { id: 13, folder_id: 2 }, { id: 14, folder_id: 99 }];

  it('goes down the list, subfolders before the folder’s own pieces', () => {
    expect(listOrder(pieces, folders)).toEqual([12, 11, 13, 10, 14]);
    expect(listOrder(pieces, [])).toEqual([10, 11, 12, 13, 14]);
  });

  it('goes round and round', () => {
    expect(neighbour([5, 6, 7], 7, 1)).toBe(5);
    expect(neighbour([5, 6, 7], 5, -1)).toBe(7);
    expect(neighbour([5], 5, 1)).toBe(5);
    expect(neighbour([5, 6], 9, 1)).toBe(5);
    expect(neighbour([], 9, 1)).toBeNull();
  });
});
