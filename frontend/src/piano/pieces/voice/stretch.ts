// The same sound, slower or faster, at the same pitch (WSOLA): short frames are
// laid closer or further apart, each taken where it best goes on from the last.

const FRAME = 0.046; // seconds
const SEARCH = 0.012;
// Samples skipped when comparing, then when laying.
const SKIP = 4;

// `rate`: 0.5 lasts twice as long.
export function stretch(channels: Float32Array[], sampleRate: number, rate: number): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  const size = Math.round((FRAME * sampleRate) / 2) * 2;
  const hop = size / 2;
  const search = Math.round(SEARCH * sampleRate);
  const total = Math.max(1, Math.round(length / rate));
  const out = channels.map(() => new Float32Array(total));
  if (length < size * 2) {
    out.forEach((o, c) => o.set(channels[c].subarray(0, Math.min(length, total))));
    return out;
  }
  const window = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  // Compared on one channel.
  const first = channels[0];
  let previous = -1;
  for (let at = 0; at < total; at += hop) {
    const ideal = Math.round(at * rate);
    let from = Math.min(ideal, length - size);
    if (previous >= 0) {
      // What would come next, had nothing been moved.
      const next = previous + hop;
      let best = -Infinity;
      const low = Math.max(0, ideal - search);
      const high = Math.min(length - size, ideal + search);
      for (let candidate = low; candidate <= high; candidate += SKIP) {
        let same = 0;
        for (let i = 0; i < hop && next + i < length; i += SKIP) same += first[candidate + i] * first[next + i];
        if (same > best) {
          best = same;
          from = candidate;
        }
      }
    }
    for (let c = 0; c < channels.length; c++) {
      const source = channels[c];
      const target = out[c];
      for (let i = 0; i < size && at + i < total; i++) {
        // Nothing overlaps the very first half.
        target[at + i] += source[from + i] * (at === 0 && i < hop ? 1 : window[i]);
      }
    }
    previous = from;
  }
  return out;
}
