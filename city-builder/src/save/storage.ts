/**
 * Ancienne API synchrone de sauvegarde (localStorage, JSON brut), conservée pour main.ts.
 * Nouvelle API recommandée : src/save/index.ts (SaveStore : IndexedDB + gzip + emplacements
 * multiples + export/import ; Autosaver). Le contenu est le SaveFile versionné de la simulation,
 * revalidé par le worker au chargement.
 * Toute erreur de stockage (navigation privée, quota) est renvoyée proprement.
 */
import type { SaveFile } from '../shared/contracts';

const PREFIX = 'aube-urbaine:save:';

export function writeSave(slot: string, data: SaveFile): { ok: true } | { ok: false; message: string } {
  try {
    localStorage.setItem(PREFIX + slot, JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `Sauvegarde impossible : ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function readSave(slot: string): SaveFile | null {
  try {
    const raw = localStorage.getItem(PREFIX + slot);
    return raw ? (JSON.parse(raw) as SaveFile) : null;
  } catch {
    return null;
  }
}

export function hasSave(slot: string): boolean {
  try {
    return localStorage.getItem(PREFIX + slot) !== null;
  } catch {
    return false;
  }
}
