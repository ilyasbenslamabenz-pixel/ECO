/**
 * Format et migrations de la section de sauvegarde du module « hubs » (port et aéroport) — propriété de la branche p2c-port-aeroport.
 * Écrite sous `save.plugins.hubs = { v, data, rng }`. Toute évolution du format incrémente `HUBS_SAVE_VERSION`
 * et ajoute une étape à `STEPS` avec un test dans tests/hubs/.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
// Ici (et non dans save-sections/) : le garde-fou d'architecture interdit les imports `../save*` depuis src/sim.
import type { HubsSaveData } from './system';

export const HUBS_SAVE_VERSION = 1;
export type HubsSave = HubsSaveData;

export function emptyHubsSave(): HubsSave {
  return { hubs: [], nextId: 1, movements: [], nextMovementId: 1, phys: 0, runtime: [], used: { port: { exportT: 0, importT: 0 }, aeroport: { exportT: 0, importT: 0 } }, applied: [] };
}

const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

/** Même contrat que `runMigrations` (src/sim/save-sections/types.ts), recopié pour respecter le garde-fou d'imports. */
function runMigrations(data: unknown, from: number, current: number, steps: typeof STEPS, what: string): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error(`section ${what} : objet attendu`);
  if (!Number.isInteger(from) || from < 1) throw new Error(`section ${what} : version ${from} invalide`);
  if (from > current) throw new Error(`section ${what} : version ${from} plus récente que ${current}`);
  let d = data as Record<string, unknown>;
  for (let v = from; v < current; v++) {
    const step = steps[v];
    if (!step) throw new Error(`section ${what} : aucune migration depuis la version ${v}`);
    d = step(d);
  }
  return d;
}

/** Migre puis contrôle la forme (lève si inutilisable : l'hôte notifie et remet le module à neuf). */
export function migrateHubs(data: unknown, fromVersion: number): HubsSave {
  const d = runMigrations(data, fromVersion, HUBS_SAVE_VERSION, STEPS, 'hubs');
  if (Object.keys(d).length === 0) return emptyHubsSave();
  const base = emptyHubsSave();
  const out = { ...base, ...d } as HubsSave;
  if (!Array.isArray(out.hubs) || !Array.isArray(out.movements) || !Array.isArray(out.runtime) || !Array.isArray(out.applied)) throw new Error('section hubs : tableaux attendus');
  for (const h of out.hubs) {
    if (typeof h !== 'object' || h === null || typeof h.id !== 'number' || typeof h.type !== 'string' || ![h.x, h.z, h.rot, h.y].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error('section hubs : pôle illisible');
    }
    if (!['port_commerce', 'port_passagers', 'aeroport'].includes(h.type)) throw new Error(`section hubs : type inconnu ${h.type}`);
  }
  if (typeof out.phys !== 'number' || typeof out.nextId !== 'number') throw new Error('section hubs : compteurs illisibles');
  return out;
}
