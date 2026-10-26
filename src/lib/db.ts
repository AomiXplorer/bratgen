import type { ProjectRecord, ProjectState } from './types';

const DB_NAME = 'bratgen';
const DB_VERSION = 1;
const STORE = 'projects';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB tidak dapat dibuka'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Operasi IndexedDB gagal'));
      }),
  );
}

export async function saveProject(project: ProjectState, audio?: Blob | null): Promise<void> {
  const existing = await getProject(project.id);
  const record: ProjectRecord = {
    ...project,
    updatedAt: Date.now(),
    // keep the previously stored audio unless a new blob is supplied
    audio: audio ?? existing?.audio,
  };
  await tx('readwrite', (store) => store.put(record));
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return tx<ProjectRecord | undefined>('readonly', (store) => store.get(id));
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const all = await tx<ProjectRecord[]>(
    'readonly',
    (store) => store.getAll() as IDBRequest<ProjectRecord[]>,
  );
  return all.map((r) => ({ ...r, audio: undefined })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
