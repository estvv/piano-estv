import { audioClock, startClip, type Clip } from '../../audio';
import { atRate, decode } from './decode';
import { syncOf, type SyncPoint } from './sync';

// Plays a recording along with a piece, on the clock of the piano: started at the
// right place it needs nothing more. It is only started again when the piece goes
// elsewhere, or when the two clocks have come apart.

// What can be told where it is: a PiecePlayer.
export interface Leader {
  readonly position: number;
  readonly rate: number;
  readonly state: { get(): { playing: boolean } };
}

// Given in tests.
export interface Sound {
  clock: typeof audioClock;
  start: typeof startClip;
  decode(file: Blob): Promise<AudioBuffer>;
  atRate(buffer: AudioBuffer, rate: number): Promise<AudioBuffer>;
}
const SOUND: Sound = { clock: audioClock, start: startClip, decode, atRate };

const EVERY = 40; // ms
// So close to its own speed, nobody hears the pitch change (5 cents).
const SAME = 0.003;
// Seconds apart: at once, or for long.
const JUMP = 0.2;
const DRIFT = 0.04;
// How much of the past is kept in mind, each time.
const SMOOTH = 0.06;
// Not before this long after the last start.
const REST = 1.2;
const FADE = 0.03;

interface Playing {
  clip: Clip;
  // On the clock, and in the recording.
  when: number;
  from: number;
  speed: number;
  points: readonly SyncPoint[];
  apart: number;
}

export class VoicePlayer {
  private timer: ReturnType<typeof setInterval>;
  private points: readonly SyncPoint[] = [];
  private volume = 1;
  private now: Playing | null = null;
  private buffer: AudioBuffer | null = null;
  private stretched: { speed: number; buffer: AudioBuffer } | null = null;
  private making = 0;
  private asked = false;
  private gone = false;

  // `leader` and `allowed` are asked each time.
  constructor(private file: Blob, private leader: Leader, private allowed: () => boolean, private sound: Sound = SOUND) {
    this.timer = setInterval(() => this.follow(), EVERY);
  }

  set(points: readonly SyncPoint[], volume: number) {
    this.points = points;
    this.volume = Math.max(0, Math.min(1, volume));
    this.now?.clip.setVolume(this.volume);
  }

  follow() {
    if (this.gone) return;
    if (!this.allowed()) return this.stop();
    if (!this.buffer) {
      if (!this.asked) {
        this.asked = true;
        this.sound.decode(this.file).then((b) => { this.buffer = b; }, () => {});
      }
      return;
    }
    const clock = this.sound.clock();
    if (!clock || !this.leader.state.get().playing) return this.stop();
    const { offset, speed: own } = syncOf(this.points);
    const speed = this.leader.rate * own;
    const samples = this.ready(this.buffer, speed);
    if (!samples) return this.stop();

    // The notes of this place are heard at that time.
    const when = clock.now + clock.ahead;
    const wanted = this.leader.position * own + offset;
    if (wanted < 0 || wanted >= this.buffer.duration) return this.stop();
    if (this.now && (this.now.speed !== speed || this.now.points !== this.points)) this.stop();
    if (this.now) {
      const { now } = this;
      const apart = wanted - (now.from + (when - now.when) * speed);
      now.apart += (apart - now.apart) * SMOOTH;
      const rested = when - now.when > REST;
      if (Math.abs(apart) < JUMP * Math.max(1, speed) && !(rested && Math.abs(now.apart) > DRIFT)) return;
      this.stop();
    }
    const clip = samples.plain
      ? this.sound.start(samples.buffer, { when, from: wanted, rate: speed, volume: this.volume, fade: FADE })
      : this.sound.start(samples.buffer, { when, from: wanted / speed, rate: 1, volume: this.volume, fade: FADE });
    if (clip) this.now = { clip, when, from: wanted, speed, points: this.points, apart: 0 };
  }

  // The samples for that speed; null while they are being made.
  private ready(buffer: AudioBuffer, speed: number): { buffer: AudioBuffer; plain: boolean } | null {
    if (Math.abs(speed - 1) <= SAME) return { buffer, plain: true };
    if (this.stretched?.speed === speed) return { buffer: this.stretched.buffer, plain: false };
    if (this.making !== speed) {
      this.making = speed;
      this.sound.atRate(buffer, speed).then((b) => {
        if (this.making === speed) this.stretched = { speed, buffer: b };
      }, () => {});
    }
    return null;
  }

  private stop() {
    this.now?.clip.stop(FADE);
    this.now = null;
  }

  dispose() {
    this.gone = true;
    clearInterval(this.timer);
    this.stop();
  }
}
