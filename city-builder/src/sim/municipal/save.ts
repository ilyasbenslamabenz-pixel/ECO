/**
 * Format versionné de la section de sauvegarde du contrat municipal (`save.plugins.municipal = { v, data, rng }`).
 * Enregistré comme section par src/sim/save-sections/municipal.ts.
 *
 * Contenu : grilles d'indicateurs (valeurs Float32 en base64), couplages, réseaux (topologie et paramètres),
 * budget (mois en cours et historique), registre d'effets, échéances de l'ordonnanceur. Aucune section n'est
 * écrite tant que rien n'a été défini (contrat inutilisé = sauvegarde identique).
 *
 * Règles : toute modification du format incrémente `MUNICIPAL_SAVE_VERSION` et ajoute une étape à `STEPS`
 * (v -> v+1), avec un test dans tests/municipal/ (données de l'ancienne version -> chargées).
 * `migrateMunicipal` LÈVE si les données sont inutilisables : l'hôte attrape, notifie, conserve la section.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { BudgetLine, BudgetMonth, EffectCause, EffectRecord, GridGeometry, IndicatorSpec, NetworkJSON } from '../../shared/municipal/types';
import type { Coupling } from './grids';

export const MUNICIPAL_SAVE_VERSION = 1;

export interface MunicipalSaveV1 {
  grids: {
    geometry: GridGeometry;
    grids: { spec: IndicatorSpec; geometry: GridGeometry; values: string }[];
    couplings: Coupling[];
  };
  networks: NetworkJSON[];
  budget: { current: BudgetLine[]; mirrored: BudgetLine[]; history: BudgetMonth[] };
  effects: {
    nextCause: number;
    nextEffect: number;
    causes: EffectCause[];
    summaries: { cause: number; count: number; byTarget: Record<string, number> }[];
    effects: EffectRecord[];
  };
  scheduler: { lastHour: number; lastDay: number; lastMonth: number; lastDayAt: number; lastMonthAt: number; tickCount: number };
}
export type MunicipalSave = MunicipalSaveV1;

export function emptyMunicipalSave(): MunicipalSave {
  return {
    grids: { geometry: { originX: 0, originZ: 0, cellSize: 32, cols: 1, rows: 1 }, grids: [], couplings: [] },
    networks: [],
    budget: { current: [], mirrored: [], history: [] },
    effects: { nextCause: 1, nextEffect: 1, causes: [], summaries: [], effects: [] },
    scheduler: { lastHour: -1, lastDay: -1, lastMonth: -1, lastDayAt: -1, lastMonthAt: -1, tickCount: 0 },
  };
}

/** Étapes de migration : STEPS[v] transforme des données v en v+1. */
const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Contrôle de forme minimal du format courant (lève avec un message précis). */
function checkShape(d: Record<string, unknown>): MunicipalSave {
  const g = d.grids, b = d.budget, e = d.effects, s = d.scheduler;
  if (!isObj(g) || !isObj(g.geometry) || !Array.isArray(g.grids) || !Array.isArray(g.couplings)) throw new Error('section municipal : grilles mal formées');
  if (!Array.isArray(d.networks)) throw new Error('section municipal : réseaux mal formés');
  if (!isObj(b) || !Array.isArray(b.current) || !Array.isArray(b.mirrored) || !Array.isArray(b.history)) throw new Error('section municipal : budget mal formé');
  if (!isObj(e) || !Array.isArray(e.causes) || !Array.isArray(e.summaries) || !Array.isArray(e.effects)) throw new Error('section municipal : effets mal formés');
  if (!isObj(s) || typeof s.lastHour !== 'number') throw new Error('section municipal : ordonnanceur mal formé');
  return d as unknown as MunicipalSave;
}

/**
 * Migre des données écrites en version `fromVersion` vers le format courant (lève si impossible).
 * Même contrat que `runMigrations` (src/sim/save-sections/types.ts), réécrit ici pour que src/sim/municipal
 * ne dépende pas de src/sim/save-sections (garde-fou d'architecture sur les imports `../save*`).
 */
export function migrateMunicipal(data: unknown, fromVersion: number): MunicipalSave {
  if (!isObj(data)) throw new Error('section municipal : objet attendu');
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error(`section municipal : version ${fromVersion} invalide`);
  if (fromVersion > MUNICIPAL_SAVE_VERSION) throw new Error(`section municipal : version ${fromVersion} plus récente que ${MUNICIPAL_SAVE_VERSION}`);
  let d = data;
  for (let v = fromVersion; v < MUNICIPAL_SAVE_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new Error(`section municipal : aucune migration depuis la version ${v}`);
    d = step(d);
  }
  return checkShape(d);
}

