/**
 * Section de sauvegarde versionnée du module « Eau et assainissement » (phase 2B.5).
 * Écrite sous `save.plugins.eau = { v, data }` par l'hôte des modules, seulement quand le service est actif.
 *
 * v1 : `{ system: WaterSaveV1, municipal: MunicipalSave | null }` — `municipal` contient le contrat municipal PRIVÉ
 * du module quand le module `municipal` n'est pas enregistré (sinon null : grilles et réseaux sont dans sa section).
 * Toute modification du format incrémente `EAU_SAVE_VERSION` et ajoute une étape à STEPS, avec un test dans tests/eau/.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { MunicipalSave } from '../municipal/save';
import type { WaterSaveV1 } from '../water-network/system';
import { runMigrations, type SaveSectionSpec } from './types';

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

export const eauSaveSection: SaveSectionSpec<EauSave> = {
  id: 'eau', version: EAU_SAVE_VERSION, empty: emptyEauSave, migrate: migrateEau,
};
