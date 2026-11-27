// An MP4 file put together from what WebCodecs encoded: H.264 pictures, and AAC
// or Opus sound. The samples first, then where they are (moov at the end).

export interface Sample {
  data: Uint8Array;
  // Microseconds.
  timestamp: number;
  duration: number;
  key: boolean;
}

export interface VideoTrack {
  kind: 'video';
  width: number;
  height: number;
  // The avcC record WebCodecs gives (decoderConfig.description).
  avcC: Uint8Array;
  samples: Sample[];
}

export interface AudioTrack {
  kind: 'audio';
  codec: 'aac' | 'opus';
  sampleRate: number;
  channels: number;
  // AAC: its AudioSpecificConfig. Opus: unused.
  config: Uint8Array | null;
  samples: Sample[];
}

type Track = VideoTrack | AudioTrack;

const TEXT = new TextEncoder();

class Bytes {
  private parts: number[] = [];
  u8(v: number) {
    this.parts.push(v & 255);
    return this;
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v);
  }
  u24(v: number) {
    return this.u8(v >> 16).u8(v >> 8).u8(v);
  }
  u32(v: number) {
    return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v);
  }
  zeros(n: number) {
    for (let i = 0; i < n; i++) this.u8(0);
    return this;
  }
  bytes(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.parts.push(b[i]);
    return this;
  }
  text(s: string) {
    return this.bytes(TEXT.encode(s));
  }
  get done(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.parts);
  }
}

const join = (list: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(list.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const b of list) {
    out.set(b, at);
    at += b.length;
  }
  return out;
};

export function box(type: string, ...content: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = join(content);
  return join([new Bytes().u32(body.length + 8).text(type).done, body]);
}
const full = (type: string, version: number, flags: number, ...content: Uint8Array[]) => box(type, new Bytes().u8(version).u24(flags).done, ...content);

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
const matrix = (b: Bytes) => MATRIX.forEach((v) => b.u32(v));

// Of each track, in its own units.
const timescaleOf = (t: Track) => (t.kind === 'video' ? 90_000 : t.sampleRate);
const MOVIE_SCALE = 1000;

function trackDuration(t: Track): number {
  const last = t.samples[t.samples.length - 1];
  return last ? (last.timestamp + last.duration) / 1e6 : 0;
}

// Runs of equal values: [count, value].
function runs(values: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0]++;
    else out.push([1, v]);
  }
  return out;
}

function sampleEntry(t: Track): Uint8Array {
  if (t.kind === 'video') {
    const b = new Bytes().zeros(6).u16(1).zeros(16).u16(t.width).u16(t.height).u32(0x00480000).u32(0x00480000).u32(0).u16(1).zeros(32).u16(0x0018).u16(0xffff);
    return box('avc1', b.done, box('avcC', t.avcC));
  }
  const head = new Bytes().zeros(6).u16(1).zeros(8).u16(t.channels).u16(16).u16(0).u16(0).u32(t.sampleRate * 65536 >>> 0).done;
  if (t.codec === 'opus') {
    // Opus is always told at 48 kHz; 312 samples of encoder delay.
    const dOps = new Bytes().u8(0).u8(t.channels).u16(312).u32(t.sampleRate).u16(0).u8(0).done;
    return box('Opus', head, box('dOps', dOps));
  }
  const config = t.config ?? audioConfig(t.sampleRate, t.channels);
  const specific = new Bytes().u8(0x05).u8(config.length).bytes(config).done;
  const decoder = new Bytes().u8(0x04).u8(13 + specific.length).u8(0x40).u8(0x15).u24(0).u32(0).u32(0).bytes(specific).done;
  const sl = new Bytes().u8(0x06).u8(1).u8(0x02).done;
  const es = new Bytes().u8(0x03).u8(3 + decoder.length + sl.length).u16(1).u8(0).bytes(decoder).bytes(sl).done;
  return box('mp4a', head, full('esds', 0, 0, es));
}

// AAC-LC, when the encoder does not say.
export function audioConfig(sampleRate: number, channels: number): Uint8Array {
  const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const index = Math.max(0, RATES.indexOf(sampleRate));
  const v = (2 << 11) | (index << 7) | (channels << 3);
  return Uint8Array.of(v >> 8, v & 255);
}

function trak(t: Track, id: number, offsets: number[]): Uint8Array {
  const scale = timescaleOf(t);
  const duration = trackDuration(t);
  const video = t.kind === 'video';

  const tkhd = new Bytes().u32(0).u32(0).u32(id).u32(0).u32(Math.round(duration * MOVIE_SCALE)).zeros(8).u16(0).u16(0).u16(video ? 0 : 0x0100).u16(0);
  matrix(tkhd);
  tkhd.u32(video ? t.width * 65536 : 0).u32(video ? t.height * 65536 : 0);

  const mdhd = new Bytes().u32(0).u32(0).u32(scale).u32(Math.round(duration * scale)).u16(0x55c4).u16(0).done;
  const hdlr = new Bytes().u32(0).text(video ? 'vide' : 'soun').zeros(12).text(video ? 'VideoHandler' : 'SoundHandler').u8(0).done;
  const header = video ? full('vmhd', 0, 1, new Bytes().zeros(8).done) : full('smhd', 0, 0, new Bytes().zeros(4).done);
  const dinf = box('dinf', full('dref', 0, 0, new Bytes().u32(1).done, full('url ', 0, 1)));

  // Decode order is the order given; presentation from the timestamps.
  const ticks = (us: number) => Math.round((us / 1e6) * scale);
  const starts = t.samples.map((s) => ticks(s.timestamp));
  const decode = [...starts].sort((a, b) => a - b);
  const deltas = decode.map((d, i) => (i + 1 < decode.length ? decode[i + 1] - d : ticks(t.samples[i].duration) || 1));
  const stts = new Bytes();
  const sttsRuns = runs(deltas);
  stts.u32(sttsRuns.length);
  for (const [count, delta] of sttsRuns) stts.u32(count).u32(delta);
  const shifts = starts.map((s, i) => s - decode[i]);
  const reordered = shifts.some((s) => s !== 0);
  const ctts = new Bytes();
  if (reordered) {
    const r = runs(shifts);
    ctts.u32(r.length);
    for (const [count, shift] of r) ctts.u32(count).u32(shift);
  }
  const keys = t.samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  const stss = new Bytes().u32(keys.length);
  for (const k of keys) stss.u32(k);
  const stsz = new Bytes().u32(0).u32(t.samples.length);
  for (const s of t.samples) stsz.u32(s.data.length);
  const stco = new Bytes().u32(offsets.length);
  for (const o of offsets) stco.u32(o);

  const stbl = box(
    'stbl',
    full('stsd', 0, 0, new Bytes().u32(1).done, sampleEntry(t)),
    full('stts', 0, 0, stts.done),
    ...(video && keys.length < t.samples.length ? [full('stss', 0, 0, stss.done)] : []),
    // Version 1: shifts may be below zero.
    ...(reordered ? [full('ctts', shifts.some((x) => x < 0) ? 1 : 0, 0, ctts.done)] : []),
    full('stsc', 0, 0, new Bytes().u32(1).u32(1).u32(1).u32(1).done),
    full('stsz', 0, 0, stsz.done),
    full('stco', 0, 0, stco.done),
  );
  return box('trak', full('tkhd', 0, 3, tkhd.done), box('mdia', full('mdhd', 0, 0, mdhd), full('hdlr', 0, 0, hdlr), box('minf', header, dinf, stbl)));
}

// The whole file.
export function mp4(tracks: Track[]): Blob {
  const ftyp = box('ftyp', new Bytes().text('isom').u32(512).text('isomiso2avc1mp41').done);
  // Samples one after the other, each its own chunk; the two kinds woven by time
  // so that a player reads on without jumping.
  const order = tracks.flatMap((t, ti) => t.samples.map((s, si) => ({ ti, si, at: s.timestamp }))).sort((a, b) => a.at - b.at || a.ti - b.ti);
  const size = order.reduce((n, o) => n + tracks[o.ti].samples[o.si].data.length, 0);
  const offsets = tracks.map((t) => new Array<number>(t.samples.length));
  let at = ftyp.length + 8;
  for (const o of order) {
    offsets[o.ti][o.si] = at;
    at += tracks[o.ti].samples[o.si].data.length;
  }
  const mdatHead = new Bytes().u32(size + 8).text('mdat').done;
  const duration = Math.max(0, ...tracks.map(trackDuration));
  const mvhd = new Bytes().u32(0).u32(0).u32(MOVIE_SCALE).u32(Math.round(duration * MOVIE_SCALE)).u32(0x00010000).u16(0x0100).zeros(10);
  matrix(mvhd);
  mvhd.zeros(24).u32(tracks.length + 1);
  const moov = box('moov', full('mvhd', 0, 0, mvhd.done), ...tracks.map((t, i) => trak(t, i + 1, offsets[i])));
  const parts: BlobPart[] = [ftyp, mdatHead];
  for (const o of order) parts.push(tracks[o.ti].samples[o.si].data as Uint8Array<ArrayBuffer>);
  parts.push(moov);
  return new Blob(parts, { type: 'video/mp4' });
}
