import { Modal } from '../../components/Modal';

export type WaitInput = 'keys' | 'mic';

// How the notes are heard while the piece waits for them.
export function WaitChoice({ current, onPick, onClose }: { current: WaitInput; onPick(input: WaitInput): void; onClose(): void }) {
  const choices: { value: WaitInput; title: string; text: string }[] = [
    { value: 'keys', title: 'Clavier', text: 'Piano MIDI branché, ou touches à l’écran. Chaque note de l’accord, juste.' },
    { value: 'mic', title: 'Micro', text: 'Un vrai piano, écouté. Plus souple : une note de l’accord suffit, l’octave peut varier, rien ne compte faux.' },
  ];
  return (
    <Modal title="Attendre quelles notes ?" onClose={onClose} centered>
      <div className="grid gap-2">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            autoFocus={c.value === current}
            onClick={() => onPick(c.value)}
            className={`rounded-xl border p-4 text-left transition-colors ${c.value === current ? 'border-neutral-900' : 'border-neutral-200 hover:border-neutral-400'}`}
          >
            <span className="block text-sm font-semibold text-neutral-900">{c.title}</span>
            <span className="mt-0.5 block text-xs text-neutral-500">{c.text}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
