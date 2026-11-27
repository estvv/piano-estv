import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { ErrorText, primaryButton, secondaryButton } from '../../components/ui';
import { askCoach, type Turn } from './coach';

// Questions to the coach, with what the app knows about the piece. Nothing is sent
// before a question is asked.
export function CoachModal({ context, part, hasTake, startWith, onClose }: {
  context: string;
  // The passage worked on, and whether a take has just been played.
  part: string;
  hasTake: boolean;
  // Asked at once (a button that asks).
  startWith?: string;
  onClose(): void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [turns, waiting]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || waiting) return;
    const next = [...turns, { role: 'user' as const, text: q }];
    setTurns(next);
    setText('');
    setError('');
    setWaiting(true);
    try {
      const answer = await askCoach(context, next);
      setTurns([...next, { role: 'coach', text: answer }]);
    } catch (e) {
      setError((e as Error).message);
      setTurns(turns);
      setText(q);
    } finally {
      setWaiting(false);
    }
  };
  const asked = useRef(false);
  useEffect(() => {
    if (startWith && !asked.current) {
      asked.current = true;
      void ask(startWith);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quick = [
    ...(hasTake ? [`Qu’est-ce qui coince dans ma dernière prise, et comment le travailler ?`] : []),
    `Quel doigté pour ${part} ?`,
    `Comment travailler ${part} pour le jouer plus vite ?`,
  ];

  return (
    <Modal title="Coach" subtitle={`Envoyé à l’IA (Gemini ou Mistral) seulement quand tu poses une question : le morceau${hasTake ? ', ta dernière prise' : ''} et ta question.`} onClose={onClose} width="lg">
      <div className="space-y-3" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
        <div ref={list} className="max-h-[50dvh] min-h-24 space-y-3 overflow-y-auto overscroll-contain">
          {turns.map((t, i) => (
            <div key={i} className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${t.role === 'user' ? 'ml-auto bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-900'}`}>{t.text}</div>
          ))}
          {waiting && <div className="w-fit rounded-2xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-500">Le coach réfléchit…</div>}
          {!turns.length && !waiting && (
            <div className="flex flex-wrap gap-2">
              {quick.map((q) => <button key={q} type="button" onClick={() => void ask(q)} className={secondaryButton}>{q}</button>)}
            </div>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text);
          }}
        >
          <textarea
            value={text}
            rows={2}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(text);
              }
            }}
            placeholder="Ta question (Entrée pour envoyer)"
            className="min-w-0 flex-1 resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <button type="submit" disabled={waiting || !text.trim()} className={primaryButton}>Envoyer</button>
        </form>
      </div>
    </Modal>
  );
}
