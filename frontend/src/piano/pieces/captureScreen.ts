// Records a tab or a window the user picks (the browser asks), to read the
// video playing in it. Stays in the browser.

export const canCapture = () => typeof navigator.mediaDevices?.getDisplayMedia === 'function' && typeof MediaRecorder !== 'undefined';

export interface Capture {
  stop(): void;
  // Once stopped, here or from the browser's own bar.
  done: Promise<File>;
}

const TYPES = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

export async function captureScreen(): Promise<Capture> {
  // Tabs first: that is where the video plays; this one is no use.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30 }, displaySurface: 'browser' },
    audio: true,
    selfBrowserSurface: 'exclude',
    preferCurrentTab: false,
  } as DisplayMediaStreamOptions);
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
    // Pictures complete in themselves, often: the reading jumps from one to another.
    videoKeyFrameIntervalDuration: 500,
  } as MediaRecorderOptions);
  const pieces: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && pieces.push(e.data);
  const end = () => {
    if (recorder.state !== 'inactive') recorder.stop();
  };
  const done = new Promise<File>((resolve, reject) => {
    recorder.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      const type = recorder.mimeType || 'video/webm';
      if (pieces.length) resolve(new File(pieces, `Capture.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type }));
      else reject(new Error('Rien n’a été capturé'));
    };
  });
  // "Stop sharing" in the browser's bar.
  stream.getVideoTracks()[0].onended = end;
  recorder.start(1000);
  return { stop: end, done };
}
