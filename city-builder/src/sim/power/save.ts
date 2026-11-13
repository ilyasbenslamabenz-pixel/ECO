/**
 * Format de la section de sauvegarde du module « Électricité » (phase 2B, sous-étape 4) — propriété de la branche
 * p2b-electricite. Écrite sous `save.plugins.electricite = { v, data, rng }` par l'hôte des modules. Déclarée comme
 * section dans src/sim/save-sections/electricite.ts (le garde-fou d'architecture interdit `../save*` depuis src/sim).
 *
 * Contenu (v1) : `power` = état du service (réglages, lignes HT, pannes en cours, toitures, pénalité de
 * satisfaction, journal, cumuls du mois) ; `municipal` = contrat municipal hébergé par le module quand le module
 * `municipal` n'est pas enregistré (sinon absent : le contrat a sa propre section).
 * Règles : toute modification du format incrémente `ELECTRICITE_SAVE_VERSION` et ajoute une étape à STEPS, avec un
 * test dans tests/electricite/. `migrateElectricite` LÈVE si les données sont inutilisables.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { CONSUMER_CLASSES } from '../../shared/power/types';
import type { PowerState } from './system';
import { emptyPowerState } from './system';

export const ELECTRICITE_SAVE_VERSION = 1;

export interface ElectriciteSaveV1 {
  power?: PowerState;
  municipal?: unknown;
  /** Version de la section du contrat municipal hébergé (`MUNICIPAL_SAVE_VERSION` à l'écriture). */
  municipalVersion?: number;
}
export type ElectriciteSave = ElectriciteSaveV1;

export function emptyElectriciteSave(): ElectriciteSave {
  return {};
}

const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

/** Même contrat que `runMigrations` de src/sim/save-sections/types.ts (non importable d'ici : garde-fou `../save*`). */
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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Vérifie et complète l'état du service (lève si incohérent). */
export function checkPowerState(raw: unknown): PowerState {
  if (!isObj(raw)) throw new Error('electricite : état du service illisible');
  const base = emptyPowerState();
  const s = { ...base, ...raw } as PowerState;
  if (!isObj(s.settings) || !fin(s.settings.funding)) throw new Error('electricite : réglages illisibles');
  const pr = s.settings.priorities;
  if (!Array.isArray(pr) || pr.length !== CONSUMER_CLASSES.length || !pr.every((c) => (CONSUMER_CLASSES as readonly string[]).includes(c as string))) {
    throw new Error('electricite : priorités illisibles');
  }
  if (!Array.isArray(s.lines) || !s.lines.every((l) => isObj(l) && fin(l.id) && fin(l.a) && fin(l.b) && fin(l.lengthM) && fin(l.failedUntil))) {
    throw new Error('electricite : lignes illisibles');
  }
  if (!isObj(s.facilities) || !Array.isArray(s.rooftopIds) || !Array.isArray(s.events)) throw new Error('electricite : état illisible');
  s.settings = { funding: s.settings.funding, priorities: [...pr], rooftops: !!s.settings.rooftops };
  s.month = { ...base.month, ...(isObj(s.month) ? s.month : {}) };
  s.lastMonth = { ...base.lastMonth, ...(isObj(s.lastMonth) ? s.lastMonth : {}) };
  return s;
}

/** Migre des données écrites en version `fromVersion` vers le format courant (lève si impossible). */
export function migrateElectricite(data: unknown, fromVersion: number): ElectriciteSave {
  const d = runMigrations(data, fromVersion, ELECTRICITE_SAVE_VERSION, STEPS, 'electricite') as ElectriciteSave;
  const out: ElectriciteSave = {};
  if (d.power !== undefined) out.power = checkPowerState(d.power);
  if (d.municipal !== undefined) { out.municipal = d.municipal; out.municipalVersion = fin(d.municipalVersion) ? d.municipalVersion : 1; }
  return out;
}
