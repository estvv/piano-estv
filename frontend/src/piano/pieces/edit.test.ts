import { describe, expect, it } from 'vitest';
import { commit, redo, startHistory, undo } from './edit';

describe('undo / redo', () => {
  it('walks back and forth, and a new change clears what could be redone', () => {
    let h = startHistory([1, 2, 3, 4]);
    h = commit(h, [2, 3, 4]);
    h = commit(h, [3, 4]);
    h = undo(h);
    expect(h.present).toHaveLength(3);
    h = undo(h);
    expect(h.present).toHaveLength(4);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toHaveLength(3);
    h = commit(h, [4]);
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });

  it('ignores a change that changed nothing', () => {
    const h = startHistory([1]);
    expect(commit(h, h.present)).toBe(h);
  });
});
