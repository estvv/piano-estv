import { describe, expect, it } from 'vitest';
import { scrollToKeys } from './keyScroll';

// Five octaves from C2 (36) to B6 (95): 35 white keys of 40 px, seen through 360 px.
const view = (scrollLeft: number) => ({ scrollLeft, clientWidth: 360, scrollWidth: 1400 });
const at = (midis: number[], scrollLeft = 0) => scrollToKeys(midis, 36, 95, view(scrollLeft));

describe('scrollToKeys', () => {
  it('stays still when the keys are in view', () => {
    expect(at([40, 43])).toBeNull();
  });

  it('centres keys out of view', () => {
    // C4: 14th white key, 560–600 px.
    expect(at([60])).toBe(400);
  });

  it('stops at both ends of the keyboard', () => {
    expect(at([36], 500)).toBe(0);
    expect(at([95])).toBe(1040);
  });

  it('does not move again for the first and last keys once at the end', () => {
    expect(at([36], 0)).toBeNull();
    expect(at([95], 1040)).toBeNull();
  });

  it('goes to the lowest key when they do not fit together', () => {
    expect(at([48, 84], 900)).toBe(120); // C3: 280–320 px
  });

  it('does nothing when the whole keyboard is on screen', () => {
    expect(scrollToKeys([95], 36, 95, { scrollLeft: 0, clientWidth: 1400, scrollWidth: 1400 })).toBeNull();
    expect(at([])).toBeNull();
  });
});
