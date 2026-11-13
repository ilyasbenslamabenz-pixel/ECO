/**
 * Emplacements de sauvegarde (navigateur). Le CONTENU est le SaveFile versionné produit par la
 * simulation ; lecture/écriture via src/save/storage.ts. Ce module ajoute l'inventaire et la
 * suppression, absents de storage.ts : il relit les mêmes clés (préfixe documenté ci-dessous).
 * Demande d'ajout de listSaves()/deleteSave() à storage.ts : docs/requests/construction-ui.md.
 * Propriétaire : agent construction/caméra/UI.
 */
import type { SaveFile } from '../shared/contracts';
import { CLOUD_SAVE_EVENT, type CloudSaveStatus } from '../save/cloud';

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

/**
 * Source des emplacements : par défaut localStorage (ancienne API) ; main.ts branche le SaveStore
 * (IndexedDB + gzip, src/save/store.ts) avec `setSlotProvider`.
 */
export interface SlotProvider {
  list(): Promise<SlotInfo[]>;
  remove(slot: string): Promise<boolean>;
}

let provider: SlotProvider = {
  list: () => Promise.resolve(listLocalSlots()),
  remove: (slot) => Promise.resolve(deleteSlot(slot)),
};

export function setSlotProvider(p: SlotProvider): void { provider = p; }
export function listSlotsAsync(): Promise<SlotInfo[]> { return provider.list().catch(() => []); }
export function removeSlotAsync(slot: string): Promise<boolean> { return provider.remove(slot).catch(() => false); }

/** Date de jeu lisible à partir des minutes écoulées. */
export function gameDateLabel(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  return `an ${Math.floor(days / 360) + 1}, ${MONTHS[Math.floor((days % 360) / 30)] ?? ''}`;
}

export function listSlots(): SlotInfo[] { return listLocalSlots(); }

function listLocalSlots(): SlotInfo[] {
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

/**
 * Indicateur discret des sauvegardes en ligne (« Sauvegardé en ligne » / « Hors ligne — sauvegarde
 * locale ») : écoute l'évènement 'meknes:cloudsave' (src/save/cloud.ts). Rien n'est affiché hors
 * artifact (état « disabled »). La refonte d'interface peut le remplacer en écoutant le même évènement.
 */
export function installCloudSaveBadge(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  let el: HTMLElement | null = null;
  const show = (s: CloudSaveStatus | undefined): void => {
    if (!s || s.state === 'disabled' || !s.label) { el?.remove(); el = null; return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'cloud-save-status';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:40;pointer-events:none;font:11px/1.5 system-ui,sans-serif;'
        + 'padding:1px 8px;border-radius:9px;background:rgba(20,20,20,.5);color:#f4efe6;opacity:.8';
      document.body.appendChild(el);
    }
    el.textContent = `${s.state === 'offline' ? '○' : '●'} ${s.label}`;
    el.title = s.message ?? (s.lastSyncAt ? `Dernière synchronisation : ${new Date(s.lastSyncAt).toLocaleTimeString('fr-FR')}` : '');
  };
  window.addEventListener(CLOUD_SAVE_EVENT, (e) => show((e as CustomEvent<CloudSaveStatus>).detail));
  show((window as unknown as { __aube?: { cloudSave?: CloudSaveStatus } }).__aube?.cloudSave);
}
