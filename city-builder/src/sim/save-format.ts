/**
 * Format de sauvegarde versionné (JSON, indépendant du moteur) : version courante,
 * migrations successives (v1 -> v2 -> ...) et validation STRICTE d'un fichier inconnu
 * (corrompu, tronqué, modifié à la main) : renvoie un message en français, ne lève jamais.
 *
 * v1 (architecte) : paramètres, horloge, argent, bâtiments, routes, prochains ids.
 * v2 (ce module)  : + état économique complet (taux, emprunts, historique, faillite),
 *                   population (citoyens, ménages, entreprises en colonnes), état du PRNG
 *                   et du planificateur d'événements.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { SaveFile } from '../shared/contracts';
import { ROAD_TYPES } from '../shared/contracts';
import { DEFAULT_TAX_RATE, MAX_TAX_RATE, TAX_SECTORS, type EconomyJSON } from './economy';
import type { DemographyJSON } from './demography';
import { CITIZEN_SCHEMA, COMPANY_SCHEMA, HOUSEHOLD_SCHEMA } from './population';
import type { ScheduledEvent } from './scheduler';

export const SAVE_FORMAT_ID = 'aube-urbaine-save';
/** Version écrite par cette simulation. (À reporter dans shared/constants SAVE_FORMAT_VERSION : demande à l'architecte.) */
export const CURRENT_SAVE_VERSION = 2;
export const MAX_BUILDINGS_IN_SAVE = 500_000;
export const MAX_ROAD_ITEMS_IN_SAVE = 1_000_000;
export const MAX_CITIZENS_IN_SAVE = 3_000_000;

export interface SimStateJSON {
  rng: number[];
  scheduler: { seq: number; events: ScheduledEvent[] };
}

export interface SaveFileV2 extends SaveFile {
  version: 2;
  economy: EconomyJSON;
  population: DemographyJSON;
  sim: SimStateJSON;
}

export type SaveValidation = { ok: true; save: SaveFileV2; migratedFrom: number } | { ok: false; message: string };

/* ------------------------------------------------------------------ */
/* Migrations                                                           */
/* ------------------------------------------------------------------ */

function emptyColumns(schema: Record<string, unknown>): Record<string, number[]> {
  const o: Record<string, number[]> = {};
  for (const k of Object.keys(schema)) o[k] = [];
  return o;
}

export function defaultEconomyJSON(money: number): EconomyJSON {
  return {
    money,
    taxRates: { residential: DEFAULT_TAX_RATE, commercial: DEFAULT_TAX_RATE, industrial: DEFAULT_TAX_RATE, office: DEFAULT_TAX_RATE },
    loans: [], nextLoanId: 1, history: [], monthsInDeficit: 0, bankrupt: false,
    month: { construction: 0, refunds: 0, loansTaken: 0 },
  };
}

export function emptyPopulationJSON(): DemographyJSON {
  const zero = { births: 0, deaths: 0, immigrants: 0, emigrants: 0, householdsFormed: 0, hires: 0 };
  return {
    nextCitizenId: 1, nextHouseholdId: 1,
    citizens: emptyColumns(CITIZEN_SCHEMA), households: emptyColumns(HOUSEHOLD_SCHEMA), companies: emptyColumns(COMPANY_SCHEMA),
    month: { ...zero }, lastMonth: { ...zero }, attractiveness: 0.5, tripsEmitted: 0,
  };
}

/** Migrations : MIGRATIONS[v] transforme une sauvegarde de version v en version v+1. */
export const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {
  1: (s) => {
    const eco = (s.economy ?? {}) as { money?: unknown };
    const money = typeof eco.money === 'number' ? eco.money : 0;
    // Les sauvegardes v1 n'ont pas de population : la ville se repeuple par immigration.
    // Le PRNG et le planificateur sont reconstruits par la simulation (sim: null).
    return { ...s, version: 2, economy: defaultEconomyJSON(money), population: emptyPopulationJSON(), sim: null };
  },
};

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

class Invalid extends Error {}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => fin(v) && Number.isInteger(v);
function need(cond: boolean, msg: string): asserts cond { if (!cond) throw new Invalid(msg); }

function checkColumns(j: unknown, schema: Record<string, unknown>, what: string, max: number): number {
  need(isObj(j), `${what} : données absentes`);
  const id = j.id;
  need(Array.isArray(id), `${what} : colonne id absente`);
  const n = id.length;
  need(n <= max, `${what} : trop d'entrées (${n})`);
  for (const k of Object.keys(schema)) {
    const col = j[k];
    need(Array.isArray(col), `${what} : colonne ${k} absente`);
    need(col.length === n, `${what} : colonne ${k} de longueur incohérente`);
    for (let i = 0; i < n; i++) need(fin(col[i]), `${what} : valeur invalide (${k}[${i}])`);
  }
  const seen = new Set<number>();
  for (const v of id as number[]) { need(int(v) && v > 0 && !seen.has(v), `${what} : identifiant invalide ou en double (${v})`); seen.add(v); }
  return n;
}

function validateV2(s: Record<string, unknown>): SaveFileV2 {
  need(s.format === SAVE_FORMAT_ID, 'Fichier de sauvegarde non reconnu');
  need(typeof s.savedAt === 'string', 'Date de sauvegarde absente');
  const p = s.params;
  need(isObj(p), 'Paramètres de partie absents');
  need(int(p.seed) && int(p.mapChunks) && p.mapChunks >= 1 && p.mapChunks <= 32 && fin(p.startMoney) && typeof p.cityName === 'string', 'Paramètres de partie invalides');
  need(isObj(s.clock) && fin(s.clock.totalMinutes) && s.clock.totalMinutes >= 0, 'Horloge invalide');

  // Bâtiments.
  const bs = s.buildings;
  need(Array.isArray(bs) && bs.length <= MAX_BUILDINGS_IN_SAVE, 'Liste des bâtiments invalide');
  const bIds = new Set<number>();
  for (const b of bs) {
    need(isObj(b) && int(b.id) && b.id > 0 && typeof b.assetId === 'string' && int(b.variant) && fin(b.x) && fin(b.y) && fin(b.z) && int(b.rot) && b.rot >= 0 && b.rot <= 3, 'Bâtiment mal formé');
    need(!bIds.has(b.id), `Bâtiment en double (${b.id})`);
    bIds.add(b.id);
  }
  // Routes.
  const r = s.roads;
  need(isObj(r) && Array.isArray(r.nodes) && Array.isArray(r.edges), 'Réseau routier absent');
  need(r.nodes.length + r.edges.length <= MAX_ROAD_ITEMS_IN_SAVE, 'Réseau routier trop grand');
  const nIds = new Set<number>();
  for (const n of r.nodes) {
    need(isObj(n) && int(n.id) && n.id > 0 && fin(n.x) && fin(n.y) && fin(n.z), 'Nœud routier mal formé');
    need(!nIds.has(n.id), `Nœud routier en double (${n.id})`);
    nIds.add(n.id);
  }
  const eIds = new Set<number>();
  for (const e of r.edges) {
    need(isObj(e) && int(e.id) && e.id > 0 && int(e.a) && int(e.b) && fin(e.length) && e.length >= 0 && typeof e.type === 'string' && e.type in ROAD_TYPES, 'Tronçon routier mal formé');
    need(nIds.has(e.a) && nIds.has(e.b), `Tronçon ${e.id} relié à un nœud inexistant`);
    need(!eIds.has(e.id), `Tronçon en double (${e.id})`);
    eIds.add(e.id);
  }
  const ni = s.nextIds;
  need(isObj(ni) && int(ni.building) && int(ni.roadNode) && int(ni.roadEdge), 'Compteurs d\'identifiants absents');
  for (const id of bIds) need(id < ni.building, 'Compteur de bâtiments incohérent');
  for (const id of nIds) need(id < ni.roadNode, 'Compteur de nœuds incohérent');
  for (const id of eIds) need(id < ni.roadEdge, 'Compteur de tronçons incohérent');

  // Économie.
  const eco = s.economy;
  need(isObj(eco) && fin(eco.money), 'Trésorerie invalide');
  need(isObj(eco.taxRates), 'Taux d\'imposition absents');
  for (const k of TAX_SECTORS) { const v = eco.taxRates[k]; need(fin(v) && v >= 0 && v <= MAX_TAX_RATE, `Taux d'imposition invalide (${k})`); }
  need(Array.isArray(eco.loans) && eco.loans.length <= 100, 'Emprunts invalides');
  const loanIds = new Set<number>();
  for (const l of eco.loans) {
    need(isObj(l) && int(l.id) && fin(l.principal) && l.principal > 0 && fin(l.annualRate) && l.annualRate >= 0 && l.annualRate < 1
      && int(l.months) && int(l.monthsLeft) && l.monthsLeft >= 0 && fin(l.remaining) && l.remaining >= 0 && fin(l.monthlyPayment) && l.monthlyPayment > 0 && fin(l.takenAtMinute), 'Emprunt mal formé');
    need(!loanIds.has(l.id), 'Emprunt en double');
    loanIds.add(l.id);
  }
  need(int(eco.nextLoanId) && [...loanIds].every((id) => id < (eco.nextLoanId as number)), 'Compteur d\'emprunts incohérent');
  need(Array.isArray(eco.history) && eco.history.length <= 10_000, 'Historique invalide');
  for (const h of eco.history) need(isObj(h) && int(h.monthIndex) && isObj(h.income) && isObj(h.expenses) && fin(h.moneyEnd) && fin(h.balance), 'Historique mensuel mal formé');
  need(int(eco.monthsInDeficit) && eco.monthsInDeficit >= 0 && typeof eco.bankrupt === 'boolean', 'État de faillite invalide');
  need(isObj(eco.month) && fin(eco.month.construction) && fin(eco.month.refunds) && fin(eco.month.loansTaken), 'Cumuls mensuels invalides');

  // Population.
  const pop = s.population;
  need(isObj(pop) && int(pop.nextCitizenId) && int(pop.nextHouseholdId), 'Population absente');
  const nc = checkColumns(pop.citizens, CITIZEN_SCHEMA, 'Citoyens', MAX_CITIZENS_IN_SAVE);
  const nh = checkColumns(pop.households, HOUSEHOLD_SCHEMA, 'Ménages', MAX_CITIZENS_IN_SAVE);
  checkColumns(pop.companies, COMPANY_SCHEMA, 'Entreprises', MAX_BUILDINGS_IN_SAVE);
  const cit = pop.citizens as Record<string, number[]>;
  const hh = pop.households as Record<string, number[]>;
  const comp = pop.companies as Record<string, number[]>;
  const hIds = new Set(hh.id!);
  const ref = (v: number): boolean => v === -1 || bIds.has(v);
  for (let i = 0; i < nc; i++) {
    need(cit.id![i]! < pop.nextCitizenId, 'Compteur de citoyens incohérent');
    need(hIds.has(cit.household![i]!), `Citoyen ${cit.id![i]} sans ménage valide`);
    need(ref(cit.home![i]!) && ref(cit.job![i]!) && ref(cit.school![i]!), `Citoyen ${cit.id![i]} relié à un bâtiment inexistant`);
    need(cit.education![i]! >= 0 && cit.education![i]! <= 4, 'Niveau d\'éducation invalide');
  }
  for (let i = 0; i < nh; i++) {
    need(hh.id![i]! < pop.nextHouseholdId, 'Compteur de ménages incohérent');
    need(ref(hh.home![i]!), `Ménage ${hh.id![i]} logé dans un bâtiment inexistant`);
  }
  for (const id of comp.id!) need(bIds.has(id), `Entreprise ${id} sans bâtiment`);
  need(isObj(pop.month) && isObj(pop.lastMonth) && fin(pop.attractiveness) && fin(pop.tripsEmitted), 'Compteurs démographiques invalides');

  // État interne (facultatif : null après migration depuis v1).
  if (s.sim !== null && s.sim !== undefined) {
    const sim = s.sim;
    need(isObj(sim) && Array.isArray(sim.rng) && sim.rng.length === 4 && sim.rng.every(int), 'État du générateur aléatoire invalide');
    need(isObj(sim.scheduler) && int(sim.scheduler.seq) && Array.isArray(sim.scheduler.events) && sim.scheduler.events.length <= 100_000, 'Planificateur invalide');
    for (const e of sim.scheduler.events) need(isObj(e) && fin(e.at) && int(e.seq) && int(e.type) && fin(e.every) && e.every >= 0 && fin(e.a) && fin(e.b), 'Événement planifié mal formé');
  }
  return s as unknown as SaveFileV2;
}

/**
 * Valide et migre une sauvegarde de provenance inconnue. Ne lève jamais : tout problème
 * devient un message lisible. Version future -> refus explicite (pas de perte silencieuse).
 */
export function validateSave(raw: unknown): SaveValidation {
  try {
    need(isObj(raw), 'Le fichier ne contient pas une sauvegarde (objet JSON attendu)');
    need(raw.format === SAVE_FORMAT_ID, 'Fichier de sauvegarde non reconnu');
    need(int(raw.version) && raw.version >= 1, 'Version de sauvegarde absente ou invalide');
    const from = raw.version as number;
    if (from > CURRENT_SAVE_VERSION) return { ok: false, message: `Version de sauvegarde ${from} non prise en charge (sauvegarde créée par une version plus récente du jeu)` };
    let s: Record<string, unknown> = raw;
    for (let v = from; v < CURRENT_SAVE_VERSION; v++) {
      const m = MIGRATIONS[v];
      need(!!m, `Aucune migration depuis la version ${v}`);
      s = m(s);
    }
    return { ok: true, save: validateV2(s), migratedFrom: from };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, message: `Sauvegarde corrompue : ${e.message}` };
    return { ok: false, message: `Sauvegarde illisible : ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Métadonnées affichables d'une sauvegarde (liste des emplacements). */
export interface SaveSummary {
  cityName: string;
  savedAt: string;
  totalMinutes: number;
  money: number;
  population: number;
  buildings: number;
  version: number;
}

export function summarizeSave(s: SaveFile): SaveSummary {
  const pop = (s as Partial<SaveFileV2>).population;
  return {
    cityName: s.params.cityName, savedAt: s.savedAt, totalMinutes: s.clock.totalMinutes,
    money: Math.round(s.economy.money), population: pop?.citizens?.id?.length ?? 0, buildings: s.buildings.length, version: s.version,
  };
}
