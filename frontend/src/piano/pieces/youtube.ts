// Links to a video: the page is opened in another tab, then that tab is captured
// (captureScreen.ts). Nothing is downloaded.

// The same video, from its start. Null: not a link to a video.
export function videoLink(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim().replace(/^(?!https?:\/\/)/i, 'https://'));
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null;
  }
  if (id !== null) return /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}&t=0s` : null;
  // Other sites (TikTok, Instagram…): as it is.
  return url.protocol === 'https:' && host.includes('.') ? url.href : null;
}
