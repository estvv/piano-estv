import { describe, expect, it } from 'vitest';
import { cleaned, DEFAULT_HANDS, lookOf, luminance, mix, shadesOf, type Theme } from './appearance';

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('how the app looks', () => {
  it('is red on the left and blue on the right, unless chosen otherwise', () => {
    expect(cleaned({}).hands.light).toEqual({ left: '#ef4444', right: '#3b82f6' });
    expect(cleaned({}).theme).toBe('auto');
    const saved = cleaned({ theme: 'dark', hands: { dark: { left: '#00ff00', right: 'red' } } as never });
    expect(saved).toEqual({ theme: 'dark', hands: { light: DEFAULT_HANDS.light, dark: { left: '#00ff00', right: DEFAULT_HANDS.dark.right } } });
  });

  it('follows the device when asked to', () => {
    const a = cleaned({});
    expect([lookOf(a, false).theme, lookOf(a, true).theme]).toEqual(['light', 'dark']);
    expect(lookOf({ ...a, theme: 'light' }, true).theme).toBe('light');
    expect(lookOf(a, true).left.strong).toBe(DEFAULT_HANDS.dark.left);
  });

  it('mixes colours', () => {
    expect(mix('#ff0000', '#000000', 0.5)).toBe('#800000');
    expect(mix('#123456', '#ffffff', 1)).toBe('#123456');
  });

  it('can be read, with the default colours', () => {
    for (const theme of ['light', 'dark'] as Theme[]) {
      for (const color of Object.values(DEFAULT_HANDS[theme])) {
        const s = shadesOf(color, theme);
        expect(contrast(s.ink, theme === 'dark' ? '#1c1c1c' : '#ffffff')).toBeGreaterThan(4.5);
        expect(contrast(s.ink, s.pale)).toBeGreaterThan(4);
        expect(contrast(s.ink, s.soft)).toBeGreaterThan(4.5);
        expect(contrast(s.on, s.strong)).toBeGreaterThan(3);
        expect(contrast(s.keyInk, s.key)).toBeGreaterThan(3);
        expect(contrast(s.keyInk, '#e4e4e4')).toBeGreaterThan(3);
        expect(contrast(s.bright, '#262626')).toBeGreaterThan(4.5);
        // Waiting and sounding are told apart.
        expect(contrast(s.pale, s.strong)).toBeGreaterThan(1.8);
      }
    }
  });
});
