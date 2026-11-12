/**
 * Supports de stockage des sauvegardes : IndexedDB (préféré : binaire, gros volumes),
 * repli localStorage (texte base64, ~5 Mo), repli mémoire (navigation privée stricte).
 * Toute erreur (quota, accès refusé) est rejetée avec un message français.
 */

export type BackendKind = 'indexeddb' | 'localstorage' | 'memory';

export interface SaveBackend {
  readonly kind: BackendKind;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class MemoryBackend implements SaveBackend {
  readonly kind = 'memory' as const;
  private readonly map = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> { const v = this.map.get(key); return v ? v.slice() : null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.map.set(key, bytes.slice()); }
  async delete(key: string): Promise<void> { this.map.delete(key); }
  async keys(): Promise<string[]> { return [...this.map.keys()]; }
}

/** Sous-ensemble de l'API Storage utilisé (injectable pour les tests). */
export interface StorageLike {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export class LocalStorageBackend implements SaveBackend {
  readonly kind = 'localstorage' as const;
  constructor(private readonly storage: StorageLike, private readonly prefix = 'aube-urbaine:v2:') {}

  async get(key: string): Promise<Uint8Array | null> {
    const v = this.storage.getItem(this.prefix + key);
    if (v === null) return null;
    try {
      const s = atob(v);
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    } catch {
      return new Uint8Array(0);
    }
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    try {
      this.storage.setItem(this.prefix + key, btoa(s));
    } catch (e) {
      throw new Error(`Espace de stockage du navigateur insuffisant (${msg(e)})`);
    }
  }

  async delete(key: string): Promise<void> { this.storage.removeItem(this.prefix + key); }

  async keys(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k && k.startsWith(this.prefix)) out.push(k.slice(this.prefix.length));
    }
    return out;
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error(`IndexedDB : ${r.error?.message ?? 'erreur inconnue'}`));
  });
}

export class IndexedDbBackend implements SaveBackend {
  readonly kind = 'indexeddb' as const;
  private constructor(private readonly db: IDBDatabase, private readonly store: string) {}

  static async open(factory: IDBFactory, dbName = 'aube-urbaine', store = 'saves'): Promise<IndexedDbBackend> {
    const r = factory.open(dbName, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store); };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error(`IndexedDB indisponible : ${r.error?.message ?? 'accès refusé'}`));
      r.onblocked = () => reject(new Error('IndexedDB bloquée par un autre onglet'));
    });
    return new IndexedDbBackend(db, store);
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(this.store, mode).objectStore(this.store);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const v = await req(this.tx('readonly').get(key));
    if (v === undefined || v === null) return null;
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return null;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    try {
      const store = this.tx('readwrite');
      await req(store.put(bytes, key));
    } catch (e) {
      throw new Error(`Écriture impossible (${msg(e)})`);
    }
  }

  async delete(key: string): Promise<void> { await req(this.tx('readwrite').delete(key)); }

  async keys(): Promise<string[]> {
    const ks = await req(this.tx('readonly').getAllKeys());
    return ks.map(String);
  }
}

/** Ouvre le meilleur support disponible : IndexedDB, sinon localStorage, sinon mémoire. */
export async function openBestBackend(env: { indexedDB?: IDBFactory | undefined; localStorage?: StorageLike | undefined } = {}): Promise<SaveBackend> {
  const g = globalThis as { indexedDB?: IDBFactory; localStorage?: StorageLike };
  const idb = 'indexedDB' in env ? env.indexedDB : g.indexedDB;
  if (idb) {
    try { return await IndexedDbBackend.open(idb); } catch { /* repli */ }
  }
  let ls: StorageLike | undefined;
  try { ls = 'localStorage' in env ? env.localStorage : g.localStorage; } catch { ls = undefined; }
  if (ls) {
    try {
      const probe = 'aube-urbaine:probe';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return new LocalStorageBackend(ls);
    } catch { /* repli */ }
  }
  return new MemoryBackend();
}
