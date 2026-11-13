/**
 * Copie de secours en FICHIER (GitHub Pages, navigateur sans sauvegarde en ligne, ou par prudence) :
 * - export `Meknes-City_<ville>_<date>.meknes` (JSON gzip) ; livraison : artifact claude.ai ->
 *   `claude.use("downloads").save()` (JSON lisible `.meknes.json` : `.meknes` n'est pas une extension
 *   autorisée par ce runtime) ; mobile -> `navigator.share({files})` (« Enregistrer dans Fichiers /
 *   iCloud Drive ») ; sinon lien de téléchargement ;
 * - import (gzip ou JSON) : validation complète + migration de version (codec/decodeSave) ;
 * - rappel discret toutes les ~30 min de jeu sans sauvegarde en ligne (désactivable) ;
 * - `navigator.storage.persist()` pour que Safari conserve les données locales.
 */
import type { SaveFile } from '../shared/contracts';
import type { SaveFileV2 } from '../sim/save-format';
import { decodeSave, encodeSave, type Result } from './codec';
import { SLOT_RE } from './store';

export interface ExportFile { bytes: Uint8Array; filename: string; mime: string; compressed: boolean }

const ascii = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** « Meknes-City_<ville>_<AAAA-MM-JJ_HH-MM>.meknes » (caractères sûrs pour tous les systèmes de fichiers). */
export function meknesFilename(cityName: string, savedAt: string, ext = '.meknes'): string {
  const city = ascii(cityName).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ville';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(savedAt);
  const stamp = m ? `${m[1]}_${m[2]}-${m[3]}` : 'sans-date';
  return `Meknes-City_${city}_${stamp}${ext}`;
}

/** Fichier d'export. `artifact` : JSON lisible en `.meknes.json` (extension acceptée par downloads.save). */
export async function exportMeknes(data: SaveFile, opts: { artifact?: boolean } = {}): Promise<ExportFile> {
  const { bytes, compressed } = await encodeSave(data, !opts.artifact);
  const ext = opts.artifact ? '.meknes.json' : '.meknes'; // .meknes : gzip, ou JSON si le navigateur ne compresse pas
  return { bytes, filename: meknesFilename(data.params.cityName, data.savedAt, ext), mime: compressed ? 'application/gzip' : 'application/json', compressed };
}

export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/** Lit un fichier importé (gzip ou JSON) : validation complète et migration ; jamais d'exception. */
export async function importMeknes(file: Blob | ArrayBuffer | Uint8Array): Promise<Result<SaveFileV2>> {
  let bytes: Uint8Array;
  try {
    if (file instanceof Uint8Array) bytes = file;
    else if (file instanceof ArrayBuffer) bytes = new Uint8Array(file);
    else {
      if (file.size > MAX_IMPORT_BYTES) return { ok: false, message: 'Fichier trop volumineux (200 Mo max.)' };
      bytes = new Uint8Array(await file.arrayBuffer());
    }
  } catch (e) {
    return { ok: false, message: `Lecture du fichier impossible : ${e instanceof Error ? e.message : String(e)}` };
  }
  if (bytes.length === 0) return { ok: false, message: 'Fichier vide' };
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, message: 'Fichier trop volumineux (200 Mo max.)' };
  const d = await decodeSave(bytes);
  return d.ok ? { ok: true, value: d.value.data } : { ok: false, message: d.message };
}

/** Nouvel emplacement libre pour une sauvegarde importée : « import-<ville> », puis « -2 », « -3 »… */
export function importSlotName(cityName: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const base = `import-${ascii(cityName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'ville'}`;
  for (let i = 1; ; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    if (!taken.has(s) && SLOT_RE.test(s)) return s;
  }
}

// ---------- Livraison du fichier ----------

export interface DownloadsLike { save(req: { filename: string; data: Blob | ArrayBuffer | ArrayBufferView | string }): Promise<unknown> }
export interface ShareNavigator {
  canShare?(d: { files: File[] }): boolean;
  share?(d: { files: File[]; title?: string }): Promise<void>;
}
export type Delivery = 'artifact' | 'share' | 'download' | 'cancelled';

/** `claude.use("downloads")` (artifact) ou null ; jamais d'exception, 10 s max. */
export async function resolveDownloads(claude: { use?(n: string): Promise<unknown> } | null | undefined = (globalThis as { claude?: { use?(n: string): Promise<unknown> } }).claude): Promise<DownloadsLike | null> {
  if (!claude || typeof claude.use !== 'function') return null;
  let h: ReturnType<typeof setTimeout> | undefined;
  const to = new Promise<null>((r) => { h = setTimeout(() => r(null), 10_000); });
  try {
    const d = await Promise.race([claude.use('downloads').catch(() => null), to]) as DownloadsLike | null;
    return d && typeof d.save === 'function' ? d : null;
  } finally { clearTimeout(h); }
}

/** Appareil tactile (iPhone, iPad, Android) : le partage de fichier y est le bon geste. */
function touchDevice(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

/**
 * Livre le fichier au joueur. À appeler directement depuis un clic (Safari exige un geste récent pour
 * `navigator.share` : préparer le fichier AVANT le clic). Annulation du partage -> 'cancelled'.
 */
export async function deliverFile(f: ExportFile, env: {
  downloads?: DownloadsLike | null; nav?: ShareNavigator | null; preferShare?: boolean; fallback?: (blob: Blob, name: string) => void;
} = {}): Promise<Delivery> {
  if (env.downloads) {
    try { await env.downloads.save({ filename: f.filename, data: f.bytes.slice() }); return 'artifact'; } catch (e) {
      if ((e as { code?: string })?.code === 'declined') return 'cancelled';
      throw new Error(`Téléchargement refusé (${(e as { code?: string })?.code ?? (e instanceof Error ? e.message : String(e))})`);
    }
  }
  const blob = new Blob([f.bytes as BlobPart], { type: f.mime });
  const nav = env.nav === undefined ? (globalThis.navigator as ShareNavigator | undefined) : env.nav;
  const preferShare = env.preferShare ?? touchDevice();
  if (preferShare && nav?.share && typeof File !== 'undefined') {
    const file = new File([blob], f.filename, { type: f.mime });
    if (nav.canShare?.({ files: [file] }) ?? false) {
      try { await nav.share({ files: [file], title: f.filename }); return 'share'; } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
        /* partage impossible : repli téléchargement */
      }
    }
  }
  (env.fallback ?? downloadLink)(blob, f.filename);
  return 'download';
}

function downloadLink(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- Stockage persistant ----------

/** Demande au navigateur (Safari notamment) de ne pas effacer les données locales. */
export async function requestPersistentStorage(nav: { storage?: { persisted?(): Promise<boolean>; persist?(): Promise<boolean> } } | undefined = globalThis.navigator): Promise<boolean | null> {
  const s = nav?.storage;
  if (!s?.persist) return null;
  try {
    if (s.persisted && (await s.persisted())) return true;
    return await s.persist();
  } catch { return null; }
}

// ---------- Rappel de copie de secours ----------

export const REMINDER_OFF_KEY = 'meknes:rappel-copie:off';

export interface ReminderOptions {
  /** Partie en cours et horloge qui tourne. */
  isPlaying: () => boolean;
  /** Sauvegarde en ligne active (dans ce cas, pas de rappel). */
  hasCloud: () => boolean;
  /** Affiche le rappel. */
  remind: () => void;
  everyMs?: number;
  tickMs?: number;
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
}

/** Compte le temps de jeu effectif ; rappel après ~30 min sans sauvegarde en ligne. */
export class BackupReminder {
  private played = 0;
  private handle: unknown = null;
  readonly everyMs: number;
  readonly tickMs: number;

  constructor(private readonly o: ReminderOptions) {
    this.everyMs = o.everyMs ?? 30 * 60_000;
    this.tickMs = o.tickMs ?? 60_000;
  }

  private get store() {
    if (this.o.storage !== undefined) return this.o.storage;
    try { return globalThis.localStorage ?? null; } catch { return null; }
  }

  get disabled(): boolean {
    try { return this.store?.getItem(REMINDER_OFF_KEY) === '1'; } catch { return false; }
  }
  disable(): void { try { this.store?.setItem(REMINDER_OFF_KEY, '1'); } catch { /* sans stockage : pour cette session */ } this.stop(); }

  /** Une minute (tickMs) de plus. Rend true si le rappel a été affiché. */
  tick(): boolean {
    if (!this.o.isPlaying() || this.disabled) return false;
    if (this.o.hasCloud()) { this.played = 0; return false; }
    this.played += this.tickMs;
    if (this.played < this.everyMs) return false;
    this.played = 0;
    this.o.remind();
    return true;
  }

  /** Une copie vient d'être faite : le compte repart de zéro. */
  reset(): void { this.played = 0; }

  start(): void {
    if (this.handle !== null || this.disabled) return;
    const t = this.o.timers ?? { set: (fn: () => void, ms: number) => setInterval(fn, ms), clear: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>) };
    this.handle = t.set(() => { this.tick(); }, this.tickMs);
  }

  stop(): void {
    if (this.handle === null) return;
    const t = this.o.timers ?? { set: () => 0, clear: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>) };
    t.clear(this.handle);
    this.handle = null;
  }
}

