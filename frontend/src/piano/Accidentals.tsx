import type { ReactNode } from 'react';

// Plus Jakarta Sans has no ♯/♭ glyphs and the fallback font draws them thin
// and badly aligned. Drawn here instead, scaled with the surrounding text.

const svgProps = {
  viewBox: '0 0 12 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  'aria-hidden': true,
  // Tailwind's preflight makes every svg `display: block`: keep these inline.
  style: { display: 'inline-block', height: '0.72em', width: '0.36em', verticalAlign: '0.08em', margin: '0 0.03em', overflow: 'visible' },
};

export function SharpGlyph() {
  return (
    <svg {...svgProps}>
      <path d="M4.3 2.5v19M7.7 1.5v19" strokeWidth={1.6} />
      <path d="M1.8 10.2 10.2 8M1.8 16.4 10.2 14.2" strokeWidth={2.8} />
    </svg>
  );
}

export function FlatGlyph() {
  return (
    <svg {...svgProps}>
      <path d="M3 1v20.5" strokeWidth={1.8} />
      <path d="M3 21.5c4.5-2.6 7.6-5.3 6.8-8.2-.8-2.6-4.2-2.3-6.8.6" strokeWidth={1.9} strokeLinejoin="round" />
    </svg>
  );
}

// Text with every ♯/♭ (or # / b after a note letter) drawn as a glyph.
export function NoteText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  text.split(/([♯♭])/).forEach((chunk, i) => {
    if (chunk === '♯') parts.push(<SharpGlyph key={i} />);
    else if (chunk === '♭') parts.push(<FlatGlyph key={i} />);
    else if (chunk) parts.push(chunk);
  });
  return <span className="whitespace-nowrap">{parts}</span>;
}
