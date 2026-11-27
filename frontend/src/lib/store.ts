import { useSyncExternalStore } from 'react';

// Tiny observable value for state shared outside React (audio, inputs).
export class Observable<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}

  get = () => this.value;

  set(next: T | ((prev: T) => T)) {
    this.value = typeof next === 'function' ? (next as (prev: T) => T)(this.value) : next;
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
}

export function useObservable<T>(o: Observable<T>): T {
  return useSyncExternalStore(o.subscribe, o.get);
}
