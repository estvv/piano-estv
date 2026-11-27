import type { ReactNode } from 'react';

// Classes and building blocks shared across pages, in the house style of the
// other *-estv apps (neutral palette, rounded-lg, white panels on #fafafa).
export const primaryButton =
  'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
export const secondaryButton =
  'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
export const ghostButton =
  'inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 rounded-lg transition-colors';
export const dangerButton =
  'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40';
export const panel = 'rounded-xl border border-neutral-200 bg-white shadow-sm';

export function Page({ children, width = 'md' }: { children: ReactNode; width?: 'sm' | 'md' | 'lg' | 'full' }) {
  const max = { sm: 'max-w-md', md: 'max-w-3xl', lg: 'max-w-5xl', full: 'max-w-[110rem]' }[width];
  return <main className={`${max} mx-auto px-4 py-5 sm:py-8 md:py-10`}>{children}</main>;
}

export function PageHeader({ title, subtitle, actions, back }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-6 sm:mb-8">
      {back && <div className="mb-3 text-sm">{back}</div>}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 basis-60 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-neutral-900">{title}</h1>
          {subtitle && <p className="text-neutral-500 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const BADGES = { neutral: 'bg-neutral-100 text-neutral-600', emerald: 'bg-emerald-50 text-emerald-700' };

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof BADGES }) {
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md ${BADGES[tone]}`}>{children}</span>;
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <div className="text-xl font-bold text-neutral-900 tabular-nums">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
      {sub && <div className="text-xs text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export function LoadingState() {
  return <div className="py-12 text-center text-sm text-neutral-400">Chargement…</div>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-red-600">{children}</p>;
}

