import { useCallback, useEffect, useRef, useState } from 'react';
import { voices, type Voice } from './store';
import { VoicePlayer, type Leader } from './VoicePlayer';

// The recording joined to a piece, if there is one on this device.
export function useVoice(piece: number) {
  const [voice, setVoice] = useState<Voice | null>(null);
  useEffect(() => {
    let stale = false;
    setVoice(null);
    voices.get(piece).then((v) => !stale && setVoice(v ?? null), () => {});
    return () => {
      stale = true;
    };
  }, [piece]);
  // Sliders change often: shown at once, kept once they rest.
  const waiting = useRef<{ timer: ReturnType<typeof setTimeout>; keep(): void } | null>(null);
  // What is kept, then what is shown: the promise fails when it cannot be kept.
  const save = useCallback(async (next: Voice | null) => {
    // Nothing older is written over it.
    if (waiting.current) clearTimeout(waiting.current.timer);
    waiting.current = null;
    if (next) await voices.set(piece, next);
    else await voices.remove(piece);
    setVoice(next);
  }, [piece]);
  const settle = useCallback(() => {
    if (!waiting.current) return;
    clearTimeout(waiting.current.timer);
    waiting.current.keep();
    waiting.current = null;
  }, []);
  useEffect(() => settle, [piece, settle]);
  const tweak = (patch: Partial<Pick<Voice, 'on' | 'volume'>>) => {
    if (!voice) return;
    const next = { ...voice, ...patch };
    setVoice(next);
    if (waiting.current) clearTimeout(waiting.current.timer);
    const keep = () => void voices.set(piece, next).catch(() => {});
    waiting.current = { keep, timer: setTimeout(settle, 500) };
  };
  return { voice, save, tweak };
}

// Heard along with the piece, as long as `on`.
export function useVoicePlayer(voice: Voice | null, leader: Leader, on: boolean) {
  const player = useRef<VoicePlayer | null>(null);
  const allowed = useRef(on);
  allowed.current = on;
  const file = voice?.file ?? null;
  useEffect(() => {
    if (!file) return;
    const p = new VoicePlayer(file, leader, () => allowed.current);
    player.current = p;
    return () => {
      player.current = null;
      p.dispose();
    };
  }, [file, leader]);
  useEffect(() => {
    if (voice) player.current?.set(voice.points, voice.volume);
  }, [voice, file, leader, on]);
}
