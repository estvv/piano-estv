interface Option<T> {
  value: T;
  label: string;
}

export function Segmented<T extends string | number>({ options, value, onChange, full }: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  // As wide as its place, every option the same width.
  full?: boolean;
}) {
  return (
    <div className={`${full ? 'flex' : 'inline-flex max-w-full overflow-x-auto'} rounded-lg border border-neutral-200 bg-white p-0.5`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-md text-sm font-medium transition-colors ${full ? 'min-w-0 flex-1 px-1 py-2' : 'shrink-0 px-3 py-1.5'} ${
            o.value === value ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
