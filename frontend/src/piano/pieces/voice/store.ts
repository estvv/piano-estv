import type { SyncPoint } from './sync';

// Recordings joined to pieces. They stay in this browser: never sent to the server.

export interface Voice {
  file: Blob;
  name: string;
  points: SyncPoint[];
  volume: number; // 0..1
  on: boolean;
}

const DB = 'piano-voices';
const STORE = 'voices';
export const MAX_SIZE = 80 * 1024 * 1024;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Ce navigateur ne peut pas garder de fichier'));
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Ce navigateur refuse de garder des fichiers (navigation privée ?)'));
  });
}

async function run<T>(mode: IDBTransactionMode, what: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = what(tx.objectStore(STORE));
      const fail = () => reject(tx.error?.name === 'QuotaExceededError' ? new Error('Plus assez de place dans ce navigateur') : new Error('Enregistrement impossible'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = fail;
      tx.onabort = fail;
    });
  } finally {
    db.close();
  }
}

export const voices = {
  get: (piece: number) => run<Voice | undefined>('readonly', (s) => s.get(piece) as IDBRequest<Voice | undefined>),
  set: (piece: number, voice: Voice) => run('readwrite', (s) => s.put(voice, piece)),
  remove: (piece: number) => run('readwrite', (s) => s.delete(piece)),
};
