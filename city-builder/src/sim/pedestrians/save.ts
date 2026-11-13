/**
 * Format de sauvegarde du module piétons (section `save.plugins.pietons`), versions et migrations.
 * La description officielle de la section (`SaveSectionSpec`) est dans src/sim/save-sections/pietons.ts, qui
 * réexporte ce fichier. La logique vit ici parce que le garde-fou d'architecture (tests/unit/architecture.test.ts)
 * refuse tout import commençant par « ../save » depuis src/sim/** (il vise src/save, côté navigateur) : ni
 * src/sim/plugins/pietons.ts ni src/sim/pedestrians/ ne peuvent donc importer « ../save-sections/… ».
 *
 * Historique :
 *  - v1 : gabarit vide `{}` de la préparation de la phase 2 (aucune donnée) ;
 *  - v2 : configuration, marcheurs (emplois du temps) et trajets en cours.
 * Une sauvegarde SANS section « pietons » (phase 1, ou module encore vierge) se charge normalement : le module
 * repart de zéro et recrée ses marcheurs depuis la démographie de la ville.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { PIETONS_CONFIG_DEFAUT, type PietonsConfig } from '../../shared/protocol-ext/pietons';

export const PIETONS_SAVE_VERSION = 2;

/** v1 : gabarit vide. */
export type PietonsSaveV1 = Record<string, never>;

/** Marcheurs : colonnes parallèles (une entrée par marcheur). L'épisode du jour n'est pas sauvegardé (régénéré à l'identique). */
export interface PietonsMarcheursV2 {
  /** Bâtiment du domicile, lieu d'attache (emploi / école, -1 si aucun). */
  home: number[];
  anchor: number[];
  /** 0 actif, 1 écolier, 2 retraité, 3 autre. */
  role: number[];
  /** Octet « profil » (âge | genre) et graine d'apparence (voir src/shared/protocol-ext/pietons.ts). */
  look: number[];
  seed8: number[];
  /** Graine des plans quotidiens. */
  seed: number[];
  /** Jour du dernier épisode décidé (-1 : aucun) et 1 si cet épisode est fait ou abandonné. */
  planDay: number[];
  done: number[];
}

export interface PietonsSaveV2 {
  config: PietonsConfig;
  /** Prochain identifiant de piéton (les identifiants ne sont jamais réutilisés). */
  prochainId: number;
  marcheurs: PietonsMarcheursV2;
  /** Trajets en cours, 6 entiers par trajet : marcheur, x (dm), z (dm), bâtiment de destination, d'origine, motif. */
  trajets: number[];
}
export type PietonsSave = PietonsSaveV2;

export function emptyPietonsSave(): PietonsSave {
  return {
    config: { ...PIETONS_CONFIG_DEFAUT },
    prochainId: 1,
    marcheurs: { home: [], anchor: [], role: [], look: [], seed8: [], seed: [], planDay: [], done: [] },
    trajets: [],
  };
}

/** Étapes de migration : STEPS[v] transforme des données v en v+1. */
export const PIETONS_MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 (gabarit vide) -> v2 : aucune donnée à reprendre, structure vide du format v2.
  1: () => emptyPietonsSave() as unknown as Record<string, unknown>,
};

const MARCHEUR_COLUMNS: readonly (keyof PietonsMarcheursV2)[] = ['home', 'anchor', 'role', 'look', 'seed8', 'seed', 'planDay', 'done'];
const isNumArray = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Vérifie la forme du format courant (lève avec un message précis). */
function validate(d: Record<string, unknown>): PietonsSave {
  const cfg = d.config as Record<string, unknown> | undefined;
  if (typeof cfg !== 'object' || cfg === null || typeof cfg.actif !== 'boolean' || typeof cfg.maxPietons !== 'number' || typeof cfg.foule !== 'number') {
    throw new Error('section pietons : configuration invalide');
  }
  const m = d.marcheurs as Record<string, unknown> | undefined;
  if (typeof m !== 'object' || m === null) throw new Error('section pietons : marcheurs absents');
  let n = -1;
  for (const col of MARCHEUR_COLUMNS) {
    const a = m[col];
    if (!isNumArray(a)) throw new Error(`section pietons : colonne « ${col} » invalide`);
    if (n < 0) n = a.length; else if (a.length !== n) throw new Error(`section pietons : colonne « ${col} » de longueur ${a.length} (attendu ${n})`);
  }
  if (!isNumArray(d.trajets)) throw new Error('section pietons : trajets invalides');
  if (typeof d.prochainId !== 'number') throw new Error('section pietons : prochainId invalide');
  return d as unknown as PietonsSave;
}

/**
 * Migre des données écrites en version `fromVersion` vers le format courant, puis en vérifie la forme.
 * LÈVE une erreur si les données sont inutilisables (mêmes règles et messages que `runMigrations` de
 * src/sim/save-sections/types.ts : objet attendu, version entière ≥ 1, pas plus récente que la version courante).
 */
export function migratePietons(data: unknown, fromVersion: number): PietonsSave {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('section pietons : objet attendu');
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error(`section pietons : version ${fromVersion} invalide`);
  if (fromVersion > PIETONS_SAVE_VERSION) throw new Error(`section pietons : version ${fromVersion} plus récente que ${PIETONS_SAVE_VERSION}`);
  let d = data as Record<string, unknown>;
  for (let v = fromVersion; v < PIETONS_SAVE_VERSION; v++) {
    const step = PIETONS_MIGRATIONS[v];
    if (!step) throw new Error(`section pietons : aucune migration depuis la version ${v}`);
    d = step(d);
  }
  return validate(d);
}
