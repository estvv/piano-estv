// Recordings as plain samples, once for each file.

const MAX_SECONDS = 15 * 60;
const RATE = 44_100;

const decoded = new WeakMap<Blob, Promise<AudioBuffer>>();

export function decode(file: Blob): Promise<AudioBuffer> {
  let promise = decoded.get(file);
  if (!promise) {
    promise = (async () => {
      let buffer: AudioBuffer;
      try {
        buffer = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await file.arrayBuffer());
      } catch {
        throw new Error('Format non lu par ce navigateur (mp3, m4a, wav, ogg…)');
      }
      if (!buffer.length) throw new Error('Ce fichier n’a pas de son');
      if (buffer.duration > MAX_SECONDS) throw new Error('Enregistrement trop long (15 minutes maximum)');
      return buffer;
    })();
    decoded.set(file, promise);
    promise.catch(() => decoded.delete(file));
  }
  return promise;
}

// One speed is kept for each: the others are made again.
const stretched = new WeakMap<AudioBuffer, { rate: number; promise: Promise<AudioBuffer> }>();

export function atRate(buffer: AudioBuffer, rate: number): Promise<AudioBuffer> {
  const kept = stretched.get(buffer);
  if (kept && Math.abs(kept.rate - rate) < 1e-4) return kept.promise;
  const promise = new Promise<AudioBuffer>((resolve, reject) => {
    const worker = new Worker(new URL('./stretch.worker.ts', import.meta.url), { type: 'module' });
    const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c).slice());
    worker.onmessage = (e: MessageEvent<Float32Array<ArrayBuffer>[]>) => {
      worker.terminate();
      const out = new AudioBuffer({ numberOfChannels: e.data.length, length: e.data[0].length, sampleRate: buffer.sampleRate });
      e.data.forEach((c, i) => out.copyToChannel(c, i));
      resolve(out);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('Changement de vitesse impossible'));
    };
    worker.postMessage({ channels, sampleRate: buffer.sampleRate, rate }, channels.map((c) => c.buffer));
  });
  stretched.set(buffer, { rate, promise });
  promise.catch(() => stretched.delete(buffer));
  return promise;
}
