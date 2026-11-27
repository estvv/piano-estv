import type { FrameMaker } from './frame';
import { mp4, type AudioTrack, type Sample, type VideoTrack } from './mp4';

// The video is worked out picture by picture, not filmed: each picture is drawn
// at its exact time and the sound, worked out ahead, is encoded as it is. Nothing
// can stutter or crackle, and it goes as fast as the machine can.

export const FPS = 30;
// Seconds of picture after the end, the last notes dying away.
const TAIL = 1.2;
// A picture that can be started from, every so many.
const KEY_EVERY = FPS * 2;
// Encoded pictures waiting at most: past it, wait.
const QUEUE = 6;
const AUDIO_BLOCK = 1024;

export const canEncode = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

// Where the piece is, `seconds` into a video made at `rate`.
export const placeAt = (from: number, rate: number, seconds: number) => from + Math.max(0, seconds) * rate;

// High profile first; Main, Baseline then.
const AVC = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f'];

async function videoConfig(width: number, height: number): Promise<VideoEncoderConfig | null> {
  const bitrate = width * height > 1_500_000 ? 12_000_000 : 6_000_000;
  for (const codec of AVC) {
    for (const hardwareAcceleration of ['no-preference', 'prefer-software'] as const) {
      const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: FPS, avc: { format: 'avc' }, hardwareAcceleration, latencyMode: 'quality' };
      const { supported } = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
      if (supported) return config;
    }
  }
  return null;
}

async function audioConfig(sampleRate: number, channels: number): Promise<{ config: AudioEncoderConfig; codec: AudioTrack['codec'] } | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const tries: [AudioEncoderConfig, AudioTrack['codec']][] = [
    [{ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 192_000 }, 'aac'],
    [{ codec: 'opus', sampleRate, numberOfChannels: channels, bitrate: 192_000 }, 'opus'],
  ];
  for (const [config, codec] of tries) {
    const { supported } = await AudioEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (supported) return { config, codec };
  }
  return null;
}

const sampleOf = (chunk: EncodedVideoChunk | EncodedAudioChunk): Sample => {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return { data, timestamp: chunk.timestamp, duration: chunk.duration ?? 0, key: chunk.type === 'key' };
};

const description = (d: AllowSharedBufferSource | undefined): Uint8Array | null =>
  !d ? null : d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d as unknown as ArrayBuffer);

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class Stopped extends Error {}

// `sound`: made for this video (audio.ts renderSound), from its start.
export async function encodeVideo(maker: FrameMaker, [width, height]: [number, number], { from, end, rate, sound, onFrame, onProgress, stopped }: {
  from: number;
  end: number;
  rate: number;
  sound: AudioBuffer | null;
  // Where the piece is, before each picture.
  onFrame(position: number): void;
  onProgress(share: number): void;
  stopped(): boolean;
}): Promise<Blob> {
  const vConfig = await videoConfig(width, height);
  if (!vConfig) throw new Error('ce navigateur ne sait pas encoder en H.264');
  const aChoice = sound ? await audioConfig(sound.sampleRate, Math.min(2, sound.numberOfChannels)) : null;
  if (sound && !aChoice) throw new Error('ce navigateur ne sait pas encoder le son (AAC ou Opus)');

  let failure: Error | null = null;
  const video: VideoTrack = { kind: 'video', width, height, avcC: new Uint8Array(), samples: [] };
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const d = description(meta?.decoderConfig?.description);
      if (d) video.avcC = d;
      video.samples.push(sampleOf(chunk));
    },
    error: (e) => (failure = e as Error),
  });
  encoder.configure(vConfig);

  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [width, height];
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const seconds = (end - from) / rate + TAIL;
  const frames = Math.ceil(seconds * FPS);
  const step = 1e6 / FPS;
  try {
    for (let i = 0; i < frames; i++) {
      if (failure) throw failure;
      if (stopped()) throw new Stopped();
      const position = placeAt(from, rate, i / FPS);
      onFrame(position);
      maker.draw(ctx, (i * 1000) / FPS);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * step), duration: Math.round(step) });
      encoder.encode(frame, { keyFrame: i % KEY_EVERY === 0 });
      frame.close();
      while (encoder.encodeQueueSize > QUEUE) await new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }));
      if (i % 5 === 0) {
        onProgress((i / frames) * (sound ? 0.9 : 1));
        await pause();
      }
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw failure;
  if (!video.avcC.length) throw new Error('encodeur vidéo sans description');

  const tracks: (VideoTrack | AudioTrack)[] = [video];
  if (sound && aChoice) tracks.push(await encodeSound(sound, aChoice, Math.min(seconds, sound.duration), stopped));
  onProgress(1);
  return mp4(tracks);
}

async function encodeSound(sound: AudioBuffer, { config, codec }: { config: AudioEncoderConfig; codec: AudioTrack['codec'] }, seconds: number, stopped: () => boolean): Promise<AudioTrack> {
  const channels = config.numberOfChannels;
  const track: AudioTrack = { kind: 'audio', codec, sampleRate: sound.sampleRate, channels, config: null, samples: [] };
  let failure: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const d = description(meta?.decoderConfig?.description);
      if (d && !track.config) track.config = d;
      track.samples.push(sampleOf(chunk));
    },
    error: (e) => (failure = e as Error),
  });
  encoder.configure(config);
  const length = Math.min(sound.length, Math.round(seconds * sound.sampleRate));
  const planes = Array.from({ length: channels }, (_, c) => sound.getChannelData(Math.min(c, sound.numberOfChannels - 1)));
  try {
    for (let at = 0; at < length; at += AUDIO_BLOCK) {
      if (failure) throw failure;
      if (stopped()) throw new Stopped();
      const n = Math.min(AUDIO_BLOCK, length - at);
      const data = new Float32Array(n * channels);
      planes.forEach((p, c) => data.set(p.subarray(at, at + n), c * n));
      const block = new AudioData({ format: 'f32-planar', sampleRate: sound.sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((at / sound.sampleRate) * 1e6), data });
      encoder.encode(block);
      block.close();
      if (encoder.encodeQueueSize > 32) await new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }));
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw failure;
  return track;
}
