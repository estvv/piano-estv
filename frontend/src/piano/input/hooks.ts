import { useEffect, useRef } from 'react';
import { useObservable } from '../../lib/store';
import { inputBus, type NoteEvent } from './bus';

// Declares that the component wants note input (the piano
// sounds load) and optionally listens to note events.
export function useNoteInput(onEvent?: (e: NoteEvent) => void, active = true) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!active) return;
    const release = inputBus.acquire();
    const unsubscribe = inputBus.subscribe((e) => handler.current?.(e));
    return () => {
      unsubscribe();
      release();
    };
  }, [active]);
}

export function useHeldNotes(): ReadonlySet<number> {
  return useObservable(inputBus.held);
}
