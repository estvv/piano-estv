import type { PieceNote } from '@piano/shared';
import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { Segmented } from '../../components/Segmented';
import { Switch } from '../../components/Switch';
import { appearance, setTheme, type Appearance } from '../../lib/appearance';
import { useObservable } from '../../lib/store';
import { FallingNotes, type NoteSource } from '../pieces/FallingNotes';
import { PianoKeyboard } from '../PianoKeyboard';
import { setStage, stage, STYLE_IDS, STYLE_NAMES, type Effects, type KeyLight as KeyLightMode, type Sparks, type StyleId } from './settings';

// What each looks like, on a button.
const SWATCHES: Record<StyleId, CSSProperties> = {
  classic: { background: 'linear-gradient(90deg, var(--color-hand-l-pale) 50%, var(--color-hand-r-pale) 50%)' },
  glow: { background: 'linear-gradient(#7d9bff, #cfdcff)', boxShadow: '0 0 14px #6f8dffaa' },
  glass: { background: '#7d9bff3d', border: '1.5px solid #a9bdff', boxShadow: '0 0 10px #6f8dff66' },
  outline: { border: '2px solid #8ea6ff', boxShadow: '0 0 12px #6f8dffaa, inset 0 0 6px #6f8dff66' },
  comet: { background: 'linear-gradient(transparent, #7d9bff 60%, #ffffff)', borderRadius: 99, boxShadow: '0 6px 12px -2px #8ea6ffcc' },
  plain: { background: 'var(--color-hand-r)', border: '1px solid var(--color-hand-r-ink)', borderRadius: 3 },
};

// Grouped from the main choice to the details: how notes look, their colours,
// then what goes with them. `colours`: the hands' (those of the piece); `theme`:
// the theme can be chosen, which only the classic style is played in.
export function StageFields({ colours, theme }: { colours?: ReactNode; theme?: boolean }) {
  const s = useObservable(stage);
  const { theme: chosenTheme } = useObservable(appearance);
  const plain = s.style === 'classic';
  const keyColour = !plain && s.keys !== 'off';
  const ledColour = !plain && s.led;
  return (
    <div className="space-y-6">
      <Group title="Notes">
        <div className="grid grid-cols-3 gap-2">
          {STYLE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setStage({ style: id })}
              aria-pressed={s.style === id}
              className={`overflow-hidden rounded-lg border text-center text-xs font-medium transition-colors ${s.style === id ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 text-neutral-700 hover:border-neutral-400'}`}
            >
              <span className={`flex h-10 items-center justify-center ${id === 'classic' ? '' : 'bg-black'}`}>
                {id === 'classic' ? <span className="h-full w-full" style={SWATCHES.classic} /> : <span className="h-6 w-3 rounded" style={SWATCHES[id]} />}
              </span>
              <span className="block py-1.5">{STYLE_NAMES[id]}</span>
            </button>
          ))}
        </div>
        {plain ? (
          theme && (
            <Row label="Thème">
              <Segmented<Appearance['theme']> value={chosenTheme} onChange={setTheme} options={[{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Nuit' }]} />
            </Row>
          )
        ) : (
          <p className="text-xs text-neutral-400">Ce style se joue toujours dans le noir.</p>
        )}
      </Group>

      {(colours || keyColour || ledColour) && (
        <Group title="Couleurs">
          {colours}
          {keyColour && <OwnColor label="Touches jouées" value={s.keyColor} onChange={(keyColor) => setStage({ keyColor })} />}
          {ledColour && <OwnColor label="LED" value={s.ledColor} onChange={(ledColor) => setStage({ ledColor })} />}
        </Group>
      )}

      {!plain && (
        <Group title="Effets">
          <Row label="Particules">
            <Segmented<Effects> value={s.effects} onChange={(effects) => setStage({ effects })} options={[{ value: 'off', label: 'Aucune' }, { value: 'soft', label: 'Douces' }, { value: 'max', label: 'Max' }]} />
          </Row>
          {s.effects !== 'off' && (
            <Row label="Genre">
              <Segmented<Sparks> value={s.sparks} onChange={(sparks) => setStage({ sparks })} options={[{ value: 'cloud', label: 'Nuées' }, { value: 'embers', label: 'Braises' }]} />
            </Row>
          )}
          <Row label="Touches jouées">
            <Segmented<KeyLightMode> value={s.keys} onChange={(keys) => setStage({ keys })} options={[{ value: 'glow', label: 'Éclairées' }, { value: 'solid', label: 'Pleines' }, { value: 'off', label: 'Normales' }]} />
          </Row>
          <Row label="LED au-dessus du clavier">
            <Switch on={s.led} label={s.led ? 'Oui' : 'Non'} onChange={(led) => setStage({ led })} />
          </Row>
        </Group>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{title}</h3>
      {children}
    </section>
  );
}

// The name on the left, the choice on the right; one under the other when narrow.
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="text-sm text-neutral-700">{label}</span>
      {children}
    </div>
  );
}

// That of the notes, or one chosen ('' or a colour).
function OwnColor({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        {value && <Swatch label={label} value={value} onChange={onChange} />}
        <Segmented<'notes' | 'own'> value={value ? 'own' : 'notes'} onChange={(v) => onChange(v === 'own' ? value || '#ff7a1a' : '')} options={[{ value: 'notes', label: 'Des mains' }, { value: 'own', label: 'Choisie' }]} />
      </div>
    </Row>
  );
}

// A colour to click on.
export function Swatch({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <label title={label} className="relative block h-7 w-7 shrink-0 cursor-pointer rounded-md ring-1 ring-black/10 ring-inset" style={{ background: value }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </label>
  );
}

// A tune over and over, without a sound.
const LOOP = 8; // seconds
const TUNE: PieceNote[] = [
  ...[0, 2, 4, 6].flatMap((time, i) => [[48, 52], [45, 55], [53, 57], [50, 55]][i].map((midi) => ({ midi, time, duration: 1.7, velocity: 0.7, hand: 'left' as const }))),
  ...[72, 76, 79, 76, 74, 77, 81, 77, 72, 74, 76, 79, 83, 79, 77, 74].map((midi, i) => ({ midi, time: i * 0.5, duration: i % 3 ? 0.3 : 0.45, velocity: 0.7, hand: 'right' as const })),
].sort((a, b) => a.time - b.time);

export function StagePreview() {
  const s = useObservable(stage);
  const keys = useRef<HTMLCanvasElement>(null);
  const source = useMemo((): NoteSource => {
    // Twice, so that the second time is seen coming during the first.
    const notes = [...TUNE, ...TUNE.map((n) => ({ ...n, time: n.time + LOOP }))];
    const start = performance.now();
    const state = { expected: [], playing: true };
    return { notes, rate: 1, state: { get: () => state }, get position() { return ((performance.now() - start) / 1000) % LOOP; } };
  }, []);
  return (
    <div className={`overflow-hidden rounded-lg border border-neutral-200 ${s.style === 'classic' ? 'bg-white' : 'bg-black'}`} aria-hidden>
      <div className="h-36 sm:h-56"><FallingNotes player={source} from={48} to={83} keyLight={keys} /></div>
      <div className="pointer-events-none relative">
        <PianoKeyboard from={48} to={83} interactive={false} height={84} />
        <KeyLight canvas={keys} />
      </div>
    </div>
  );
}

// Over the keys: see Scene.drawKeys.
export function KeyLight({ canvas }: { canvas: React.RefObject<HTMLCanvasElement | null> }) {
  const { style, keys } = useObservable(stage);
  if (style === 'classic' || keys === 'off') return null;
  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 z-20 h-full w-full mix-blend-multiply" />;
}
