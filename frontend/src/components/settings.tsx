import { panel } from './ui';
import type { ReactNode } from 'react';

export function Section({ title, description, aside, children }: { title: string; description?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${panel} p-4 sm:p-5`}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold">{title}</h2>
        {aside}
      </div>
      {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-neutral-900" />
      {label}
    </label>
  );
}
