import { readJson, writeJson } from '../../../lib/storage';
import { Observable } from '../../../lib/store';

// What goes into a video, kept on this device.

export interface VideoOptions {
  format: 'landscape' | 'portrait';
  quality: 720 | 1080;
  sound: boolean;
  lyrics: boolean;
  numbers: boolean;
  title: boolean;
  // The cover, the title and the artist, at the top.
  cover: boolean;
  // Written on the white keys.
  keyNames: KeyNames;
  // Written in a corner, and a picture beside it (data URL); empty: none.
  logo: string;
  logoImage: string;
}

export type KeyNames = 'none' | 'letters' | 'names';
const KEY = 'piano.video.v1';
// A picture kept on the device: small.
export const MAX_LOGO = 400_000;
const DEFAULTS: VideoOptions = { format: 'portrait', quality: 1080, sound: true, lyrics: true, numbers: false, title: true, cover: true, keyNames: 'letters', logo: '', logoImage: '' };

export function cleanedVideo(v: Partial<VideoOptions>): VideoOptions {
  const flag = (k: 'sound' | 'lyrics' | 'numbers' | 'title' | 'cover') => (typeof v[k] === 'boolean' ? v[k] : DEFAULTS[k]);
  return {
    format: v.format === 'landscape' ? 'landscape' : v.format === 'portrait' ? 'portrait' : DEFAULTS.format,
    quality: v.quality === 720 ? 720 : 1080,
    sound: flag('sound'), lyrics: flag('lyrics'), numbers: flag('numbers'), title: flag('title'), cover: flag('cover'),
    keyNames: v.keyNames === 'none' || v.keyNames === 'names' ? v.keyNames : 'letters',
    logo: typeof v.logo === 'string' ? v.logo.slice(0, 40) : '',
    logoImage: typeof v.logoImage === 'string' && v.logoImage.startsWith('data:image/') && v.logoImage.length <= MAX_LOGO ? v.logoImage : '',
  };
}

export const videoOptions = new Observable<VideoOptions>(cleanedVideo(readJson<Partial<VideoOptions>>(KEY, {})));
videoOptions.subscribe(() => writeJson(KEY, videoOptions.get()));
export const setVideo = (patch: Partial<VideoOptions>) => videoOptions.set((v) => cleanedVideo({ ...v, ...patch }));

// Pixels of the video.
export const sizeOf = ({ format, quality }: VideoOptions): [number, number] =>
  (format === 'landscape' ? [Math.round((quality * 16) / 9), quality] : [quality, Math.round((quality * 16) / 9)]);
