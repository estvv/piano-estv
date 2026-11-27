// Calls back every few milliseconds, also in a hidden tab, where animation
// frames stop and the page's own timers are slowed down.
export function startBackgroundTimer(callback: () => void, ms = 25): () => void {
  const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms})`], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = callback;
  return () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}
