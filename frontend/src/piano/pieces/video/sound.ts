import type { PieceNote } from '@piano/shared';
import type { Score } from '../../audio';
import { atRate, decode } from '../voice/decode';
import type { Voice } from '../voice/store';
import { syncOf } from '../voice/sync';

// The sound of a video, from `from` to `end` in the piece, at a speed: the notes,
// and the recording heard along when there is one.

// The last notes ring a little.
const TAIL = 1.5;

export async function scoreOf(notes: readonly PieceNote[], from: number, end: number, rate: number, voice: Voice | null): Promise<Score> {
  const real = (t: number) => (t - from) / rate;
  const played = notes
    .filter((n) => n.time >= from - 0.01 && n.time < end)
    .map((n) => ({ midi: n.midi, time: real(n.time), duration: n.duration / rate, velocity: n.velocity }));
  const length = real(end) + TAIL;
  const clips: Score['clips'] = [];
  if (voice?.on) {
    const { offset, speed } = syncOf(voice.points);
    const buffer = await decode(voice.file);
    // Where the recording is when the video starts, and how fast it goes.
    const at = from * speed + offset;
    const pace = rate * speed;
    const same = Math.abs(pace - 1) < 0.003;
    const used = same ? buffer : await atRate(buffer, pace);
    // In the samples used: the recording made slower or faster.
    const into = same ? at : at / pace;
    clips.push(into >= 0 ? { buffer: used, when: 0, from: into, volume: voice.volume } : { buffer: used, when: -into, from: 0, volume: voice.volume });
  }
  return { notes: played, clips, length };
}
