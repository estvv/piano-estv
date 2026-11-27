// On or off, at a glance.
export function Switch({ on, label, title, onChange }: { on: boolean; label: string; title?: string; onChange(on: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      onClick={() => onChange(!on)}
      className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors hover:bg-neutral-100 ${on ? 'text-neutral-900' : 'text-neutral-500'}`}
    >
      <span className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${on ? 'bg-neutral-900' : 'bg-neutral-300'}`}>
        <span className={`h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
      </span>
      {label}
    </button>
  );
}
