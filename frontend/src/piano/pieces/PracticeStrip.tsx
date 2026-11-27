import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { panel, StatTile } from '../../components/ui';
import { HEAT } from '../../lib/theme';
import { piecesApi, type Practice } from './api';
import { Cover } from './pieceFields';
import { Stars } from './TakeCard';
import { STARS } from './takes';

const minutes = (s: number) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`);
const dayName = (day: string, how: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { ...how, timeZone: 'UTC' });

// Time played today and this week, at the top of the list of pieces.
export function PracticeStrip({ onPick }: { onPick(id: number): void }) {
  const [practice, setPractice] = useState<Practice | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    piecesApi.practice().then(setPractice, () => {});
  }, []);
  if (!practice) return null;
  const { today, days } = practice;
  const week = days.slice(-7).reduce((s, d) => s + d.seconds, 0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mx-4 mb-2 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl bg-neutral-50 px-3 py-2 text-left text-sm hover:bg-neutral-100">
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-neutral-900">{today >= 1 ? `${minutes(today)} aujourd’hui` : 'Rien joué aujourd’hui'}</span>
          <span className="block text-xs text-neutral-500">{week >= 1 ? `${minutes(week)} ces 7 derniers jours` : 'Rien ces 7 derniers jours'}</span>
        </span>
        <span className="text-xs text-neutral-400">Détails</span>
      </button>
      {open && <PracticeModal practice={practice} onPick={(id) => { setOpen(false); onPick(id); }} onClose={() => setOpen(false)} />}
    </>
  );
}

function PracticeModal({ practice, onPick, onClose }: { practice: Practice; onPick(id: number): void; onClose(): void }) {
  const { days, pieces } = practice;
  const week = days.slice(-7).reduce((s, d) => s + d.seconds, 0);
  const total = days.reduce((s, d) => s + d.seconds, 0);
  // From nothing to an hour and more.
  const level = (s: number) => (s < 60 ? 0 : s < 600 ? 1 : s < 1200 ? 2 : s < 2400 ? 3 : 4);
  const offset = (new Date(`${days[0].day}T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [...Array<null>(offset).fill(null), ...days];
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const recent = days.slice(-14);
  const most = Math.max(60, ...recent.map((d) => d.seconds));

  return (
    <Modal title="Ta pratique" subtitle="Le temps passé à jouer les morceaux." onClose={onClose} width="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Aujourd’hui" value={minutes(practice.today)} />
          <StatTile label="7 derniers jours" value={minutes(week)} />
          <StatTile label="3 derniers mois" value={minutes(total)} />
        </div>

        <div className={`${panel} p-4`}>
          <div className="mb-3 text-sm font-semibold text-neutral-900">Deux dernières semaines</div>
          <div className="flex h-28 items-end gap-1.5">
            {recent.map((d) => (
              <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${dayName(d.day, { weekday: 'long', day: 'numeric', month: 'long' })} : ${minutes(d.seconds)}`}>
                <div className={`w-full rounded-t ${d.seconds >= 60 ? 'bg-emerald-500' : 'bg-neutral-200'}`} style={{ height: `${Math.max(3, (d.seconds / most) * 100)}%` }} />
                <span className="text-[10px] text-neutral-400">{dayName(d.day, { weekday: 'narrow' })}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`${panel} overflow-x-auto p-4`}>
          <div className="flex w-max gap-[3px]">
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-col gap-[3px]">
                {w.map((d, j) => (
                  <span key={j} title={d ? `${dayName(d.day, { day: 'numeric', month: 'long' })} : ${minutes(d.seconds)}` : undefined} className={`h-3 w-3 rounded-[3px] ${d ? HEAT[level(d.seconds)] : 'bg-transparent'}`} />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-neutral-400">Trois derniers mois</div>
        </div>

        {pieces.length > 0 && (
          <div>
            <div className="mb-2 text-sm font-semibold text-neutral-900">Les plus joués</div>
            <ul className="space-y-1">
              {pieces.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onPick(p.id)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-neutral-50">
                    <Cover key={p.cover} src={p.cover} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-neutral-900">{p.title}</span>
                      <span className="block truncate text-xs text-neutral-500">{[p.artist, `joué le ${dayName(p.last, { day: 'numeric', month: 'long' })}`].filter(Boolean).join(' · ')}</span>
                    </span>
                    {p.best !== null && <span className="flex flex-col items-end"><Stars count={STARS.filter((s) => p.best! >= s).length} /><span className="text-[11px] tabular-nums text-neutral-400">{p.best}</span></span>}
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums text-neutral-500">{minutes(p.seconds)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
