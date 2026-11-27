import { GOOD } from './progressive';
import { STARS } from './takes';

const pct = (r: number) => `${Math.round(r * 100)} %`;
import type { Done } from './useTakes';

// The score of a take that just ended, over the notes.
export function TakeCard({ done, onClose, onCoach }: { done: Done; onClose(): void; onCoach(): void }) {
  return (
    <div role="status" className="pointer-events-auto absolute left-1/2 top-4 z-30 w-72 -translate-x-1/2 animate-[pop-in_200ms_ease-out] rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-center shadow-xl">
      <button type="button" onClick={onClose} aria-label="Fermer" className="absolute right-2 top-2 rounded-lg p-1 text-neutral-400 hover:text-neutral-900">✕</button>
      <div className="text-xs font-medium text-neutral-500">{done.part ? `Partie ${done.part}` : 'Morceau entier'}</div>
      <Stars count={done.stars} big />
      <div className="text-3xl font-bold tabular-nums text-neutral-900">{done.score}</div>
      <div className="mt-1 text-xs text-neutral-500">
        {done.clean}/{done.chords} du premier coup{done.wrong ? ` · ${done.wrong} fausse${done.wrong > 1 ? 's' : ''} note${done.wrong > 1 ? 's' : ''}` : ''}
      </div>
      <div className={`mt-2 text-xs font-semibold ${done.record ? 'text-emerald-700' : 'text-neutral-400'}`}>
        {done.record ? (done.before === null ? 'Premier score !' : `Record ! (avant : ${done.before})`) : `Record : ${done.before}`}
      </div>
      {done.next !== null && (
        <div className={`mt-2 rounded-lg px-2 py-1 text-xs font-semibold ${done.next > done.rate ? 'bg-sky-50 text-sky-700' : 'bg-neutral-100 text-neutral-500'}`}>
          {done.next > done.rate ? `Tempo ${pct(done.rate)} → ${pct(done.next)}` : done.score >= GOOD ? `Tempo ${pct(done.rate)} : objectif atteint` : `Tempo ${pct(done.rate)} : ${GOOD} pour accélérer`}
        </div>
      )}
      {done.score < 100 && <button type="button" onClick={onCoach} className="mt-3 w-full rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800">Demander au coach</button>}
      {done.stars < 3 && <div className="mt-1 text-[11px] text-neutral-400">{STARS[done.stars]} pour {done.stars + 1} étoile{done.stars ? 's' : ''}</div>}
    </div>
  );
}

export function Stars({ count, big }: { count: number; big?: boolean }) {
  return (
    <span className={`inline-flex justify-center gap-0.5 ${big ? 'my-1 text-2xl' : 'text-[10px]'}`} aria-label={`${count} étoile${count > 1 ? 's' : ''} sur 3`}>
      {[0, 1, 2].map((i) => <span key={i} className={i < count ? 'text-amber-400' : 'text-neutral-300'}>★</span>)}
    </span>
  );
}
