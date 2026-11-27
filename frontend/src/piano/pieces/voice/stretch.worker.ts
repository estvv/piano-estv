import { stretch } from './stretch';

self.onmessage = (e: MessageEvent<{ channels: Float32Array[]; sampleRate: number; rate: number }>) => {
  const out = stretch(e.data.channels, e.data.sampleRate, e.data.rate);
  self.postMessage(out, { transfer: out.map((c) => c.buffer as ArrayBuffer) });
};
