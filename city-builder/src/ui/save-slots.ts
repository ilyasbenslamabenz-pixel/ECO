/**
 * Emplacements de sauvegarde (navigateur). Le CONTENU est le SaveFile versionné produit par la
 * simulation ; lecture/écriture via src/save/storage.ts. Ce module ajoute l'inventaire et la
 * suppression, absents de storage.ts : il relit les mêmes clés (préfixe documenté ci-dessous).
 * Demande d'ajout de listSaves()/deleteSave() à storage.ts : docs/requests/construction-ui.md.
 * Propriétaire : agent construction/caméra/UI.
 */
import type { SaveFile } from '../shared/contracts';

/** Doit rester identique au PREFIX de src/save/storage.ts. */
export const SAVE_PREFIX = 'aube-urbaine:save:';

export interface SlotInfo {
  slot: string;
  cityName: string;
  savedAt: string;
  money: number;
  buildings: number;
  /** Date de jeu lisible (« an 2, mars »). */
  gameDate: string;
  version: number;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function describeSave(slot: string, s: SaveFile): SlotInfo {
  const minutes = s.clock?.totalMinutes ?? 0;
  const days = Math.floor(minutes / 1440);
  const year = Math.floor(days / 360) + 1;
  const month = Math.floor((days % 360) / 30);
  return {
    slot, cityName: s.params?.cityName ?? '—', savedAt: s.savedAt ?? '', money: s.economy?.money ?? 0,
    buildings: s.buildings?.length ?? 0, gameDate: `an ${year}, ${MONTHS[month] ?? ''}`, version: s.version ?? 0,
  };
}

export function listSlots(): SlotInfo[] {
  const out: SlotInfo[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(SAVE_PREFIX)) continue;
      try { out.push(describeSave(k.slice(SAVE_PREFIX.length), JSON.parse(localStorage.getItem(k) ?? 'null') as SaveFile)); } catch { /* sauvegarde illisible ignorée */ }
    }
  } catch { return []; }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function deleteSlot(slot: string): boolean {
  try { localStorage.removeItem(SAVE_PREFIX + slot); return true; } catch { return false; }
}

/** Nom d'emplacement sûr à partir d'une saisie libre. */
export function slotId(name: string): string {
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  return s || 'partie';
}
