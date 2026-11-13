/**
 * Gestionnaire des sauvegardes : plusieurs emplacements nommés (métadonnées séparées pour
 * lister sans décompresser), export et import de fichier, validation systématique au
 * chargement (fichier corrompu -> message, jamais de plantage).
 */
import type { SaveFile } from '../shared/contracts';
import { summarizeSave, type SaveFileV2, type SaveSummary } from '../sim/save-format';
import { openBestBackend, type BackendKind, type SaveBackend, type StorageLike } from './backends';
import { decodeSave, encodeSave, type Result } from './codec';

export interface SlotInfo extends SaveSummary {
  slot: string;
  bytes: number;
  compressed: boolean;
}

export const SLOT_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATA = 'data:';
const META = 'meta:';
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class SaveStore {
  constructor(readonly backend: SaveBackend, readonly compress = true) {}

  static async open(env?: { indexedDB?: IDBFactory | undefined; localStorage?: StorageLike | undefined; compress?: boolean }): Promise<SaveStore> {
    return new SaveStore(await openBestBackend(env), env?.compress ?? true);
  }

  get kind(): BackendKind { return this.backend.kind; }

  async save(slot: string, data: SaveFile): Promise<Result<SlotInfo>> {
    if (!SLOT_RE.test(slot)) return { ok: false, message: 'Nom d\'emplacement invalide' };
    try {
      const { bytes, compressed } = await encodeSave(data, this.compress);
      const info: SlotInfo = { ...summarizeSave(data), slot, bytes: bytes.length, compressed };
      await this.backend.put(DATA + slot, bytes);
      await this.backend.put(META + slot, new TextEncoder().encode(JSON.stringify(info)));
      return { ok: true, value: info };
    } catch (e) {
      return { ok: false, message: `Sauvegarde impossible : ${msg(e)}` };
    }
  }

  async load(slot: string): Promise<Result<SaveFileV2>> {
    if (!SLOT_RE.test(slot)) return { ok: false, message: 'Nom d\'emplacement invalide' };
    let bytes: Uint8Array | null;
    try { bytes = await this.backend.get(DATA + slot); } catch (e) { return { ok: false, message: `Lecture impossible : ${msg(e)}` }; }
    if (!bytes) return { ok: false, message: `Aucune sauvegarde dans l'emplacement « ${slot} »` };
    const d = await decodeSave(bytes);
    return d.ok ? { ok: true, value: d.value.data } : d;
  }

  /** Octets encodés (gzip) et métadonnées d'un emplacement, sans décodage (synchronisation en ligne). */
  async getRaw(slot: string): Promise<{ bytes: Uint8Array; info: SlotInfo } | null> {
    if (!SLOT_RE.test(slot)) return null;
    try {
      const [bytes, meta] = await Promise.all([this.backend.get(DATA + slot), this.backend.get(META + slot)]);
      if (!bytes || !meta) return null;
      const info = JSON.parse(new TextDecoder().decode(meta)) as SlotInfo;
      return typeof info.savedAt === 'string' ? { bytes, info: { ...info, slot } } : null;
    } catch { return null; }
  }

  /** Écrit des octets déjà encodés (ex. sauvegarde rapatriée et vérifiée) avec leurs métadonnées. */
  async putRaw(slot: string, bytes: Uint8Array, info: SlotInfo): Promise<Result<SlotInfo>> {
    if (!SLOT_RE.test(slot)) return { ok: false, message: 'Nom d\'emplacement invalide' };
    const meta: SlotInfo = { ...info, slot, bytes: bytes.length };
    try {
      await this.backend.put(DATA + slot, bytes);
      await this.backend.put(META + slot, new TextEncoder().encode(JSON.stringify(meta)));
      return { ok: true, value: meta };
    } catch (e) {
      return { ok: false, message: `Sauvegarde impossible : ${msg(e)}` };
    }
  }

  async has(slot: string): Promise<boolean> {
    try { return (await this.backend.get(META + slot)) !== null; } catch { return false; }
  }

  /** Emplacements existants, du plus récent au plus ancien. Les métadonnées illisibles sont ignorées. */
  async list(): Promise<SlotInfo[]> {
    let keys: string[];
    try { keys = await this.backend.keys(); } catch { return []; }
    const out: SlotInfo[] = [];
    for (const k of keys) {
      if (!k.startsWith(META)) continue;
      try {
        const b = await this.backend.get(k);
        if (!b) continue;
        const info = JSON.parse(new TextDecoder().decode(b)) as SlotInfo;
        if (typeof info.slot === 'string' && typeof info.savedAt === 'string') out.push(info);
      } catch { /* métadonnée corrompue : ignorée */ }
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async remove(slot: string): Promise<void> {
    await this.backend.delete(DATA + slot);
    await this.backend.delete(META + slot);
  }

  /** Fichier à télécharger (gzip si disponible, sinon JSON lisible). */
  async exportFile(data: SaveFile): Promise<{ blob: Blob; filename: string }> {
    const { bytes, compressed } = await encodeSave(data, this.compress);
    const city = data.params.cityName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ville';
    const stamp = data.savedAt.slice(0, 19).replace(/[:T]/g, '-');
    return {
      blob: new Blob([bytes as BlobPart], { type: compressed ? 'application/gzip' : 'application/json' }),
      filename: `aube-urbaine-${city}-${stamp}${compressed ? '.aube.gz' : '.aube.json'}`,
    };
  }

  /** Lit un fichier importé (gzip ou JSON), valide et migre. */
  async importFile(file: Blob | ArrayBuffer | Uint8Array): Promise<Result<SaveFileV2>> {
    let bytes: Uint8Array;
    try {
      if (file instanceof Uint8Array) bytes = file;
      else if (file instanceof ArrayBuffer) bytes = new Uint8Array(file);
      else {
        if (file.size > 200 * 1024 * 1024) return { ok: false, message: 'Fichier trop volumineux (200 Mo max.)' };
        bytes = new Uint8Array(await file.arrayBuffer());
      }
    } catch (e) {
      return { ok: false, message: `Lecture du fichier impossible : ${msg(e)}` };
    }
    if (bytes.length === 0) return { ok: false, message: 'Fichier vide' };
    const d = await decodeSave(bytes);
    return d.ok ? { ok: true, value: d.value.data } : d;
  }
}

/** Déclenche le téléchargement d'un fichier (thread principal uniquement). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
