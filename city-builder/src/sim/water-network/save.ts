/**
 * Format de la section de sauvegarde versionnée du module « Eau et assainissement » (phase 2B.5).
 * Écrite sous `save.plugins.eau = { v, data }` par l'hôte des modules, seulement quand le service est actif.
 *
 * v1 : `{ system: WaterSaveV1, municipal: MunicipalSave | null }` — `municipal` contient le contrat municipal PRIVÉ
 * du module quand le module `municipal` n'est pas enregistré (sinon null : grilles et réseaux sont dans sa section).
 * Toute modification du format incrémente `EAU_SAVE_VERSION` et ajoute une étape à STEPS, avec un test dans tests/eau/.
 * (Ici et non dans src/sim/save-sections : le garde-fou d'architecture interdit les imports `../save*` depuis src/sim/plugins.)
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { MunicipalSave } from '../municipal/save';
import type { WaterSaveV1 } from './system';

export const EAU_SAVE_VERSION = 1;

export interface EauSaveV1 {
  system: WaterSaveV1 | null;
  municipal: MunicipalSave | null;
}
export type EauSave = EauSaveV1;

export function emptyEauSave(): EauSave {
  return { system: null, municipal: null };
}

const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Même contrat que `runMigrations` (src/sim/save-sections/types.ts), réécrit ici (garde-fou sur les imports `../save*`). */
function runMigrations(data: unknown, fromVersion: number, current: number, steps: typeof STEPS, what: string): Record<string, unknown> {
  if (!isObj(data)) throw new Error(`section ${what} : objet attendu`);
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error(`section ${what} : version ${fromVersion} invalide`);
  if (fromVersion > current) throw new Error(`section ${what} : version ${fromVersion} plus récente que ${current}`);
  let d = data;
  for (let v = fromVersion; v < current; v++) {
    const step = steps[v];
    if (!step) throw new Error(`section ${what} : aucune migration depuis la version ${v}`);
    d = step(d);
  }
  return d;
}

/** Migre des données écrites en version `fromVersion` vers le format courant (lève si inutilisable). */
export function migrateEau(data: unknown, fromVersion: number): EauSave {
  const d = runMigrations(data, fromVersion, EAU_SAVE_VERSION, STEPS, 'eau');
  if (d.system !== null && d.system !== undefined) {
    const s = d.system;
    if (!isObj(s) || typeof s.active !== 'boolean' || typeof s.river !== 'string' || typeof s.satisfaction !== 'string' || !Array.isArray(s.tanks) || !isObj(s.served)) {
      throw new Error('section eau : état du service illisible');
    }
  }
  if (d.municipal !== null && d.municipal !== undefined && !isObj(d.municipal)) throw new Error('section eau : contrat municipal illisible');
  return { system: (d.system ?? null) as WaterSaveV1 | null, municipal: (d.municipal ?? null) as MunicipalSave | null };
}
