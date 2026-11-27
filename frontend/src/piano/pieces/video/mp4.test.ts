import { describe, expect, it } from 'vitest';
import { audioConfig, mp4 } from './mp4';

// Boxes at one level: [type, start of content, end].
function boxes(b: Uint8Array, from = 0, to = b.length): [string, number, number][] {
  const view = new DataView(b.buffer, b.byteOffset);
  const out: [string, number, number][] = [];
  for (let at = from; at < to;) {
    const size = view.getUint32(at);
    out.push([String.fromCharCode(...b.subarray(at + 4, at + 8)), at + 8, at + size]);
    at += size;
  }
  return out;
}

describe('an MP4 file', () => {
  it('holds the samples where it says, sound and pictures by time', async () => {
    const sample = (byte: number, timestamp: number, key = false) => ({ data: new Uint8Array(10).fill(byte), timestamp, duration: 33_333, key });
    const blob = mp4([
      { kind: 'video', width: 1080, height: 1920, avcC: Uint8Array.of(1, 2, 3), samples: [sample(1, 0, true), sample(2, 33_333), sample(3, 66_666)] },
      { kind: 'audio', codec: 'aac', sampleRate: 48_000, channels: 2, config: null, samples: [sample(9, 0, true), sample(8, 40_000, true)] },
    ]);
    const b = new Uint8Array(await blob.arrayBuffer());
    const top = boxes(b);
    expect(top.map((x) => x[0])).toEqual(['ftyp', 'mdat', 'moov']);
    const [, start] = top[1];
    expect([...b.subarray(start, start + 50)].filter((_, i) => i % 10 === 0)).toEqual([1, 9, 2, 8, 3]);
    expect(blob.type).toBe('video/mp4');
  });

  it('describes AAC when the encoder does not', () => {
    expect([...audioConfig(48_000, 2)]).toEqual([0x11, 0x90]);
    expect([...audioConfig(44_100, 2)]).toEqual([0x12, 0x10]);
  });
});
