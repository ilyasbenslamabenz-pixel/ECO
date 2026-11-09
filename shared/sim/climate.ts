// --- plan climat --- « Plan climat facteur 4 » (inspiré de Clim'City, Cap Sciences 2009).
//
// Objectif : diviser par quatre les émissions nettes entre 2030 et 2080.
// - Référence : émissions territoriales nettes de 2030 (moyenne des 12 mois de 2030, série `emissionsNet` du module énergie).
// - Trajectoire visée : « linéaire par jalons » (2035 −20 %, 2040 −30 %, 2050 −50 %, 2065 −65 %, 2080 −75 %)
//   ou « exponentielle » (référence × 4^(−(année − 2030)/50)) ; modifiable jusqu'au premier jalon.
// - Jalons : évalués en décembre de l'année du jalon sur la moyenne des 12 mois de l'année. Atteint → capital de soutien,
//   confiance, humeur des électeurs de la majorité (donc popularité via politicsStep), XP (missions) ; manqué → sanctions
//   proportionnées à l'écart.
// - Émissions cumulées depuis le 1er janvier 2030 et « indice de réchauffement local » : grandeur ABSTRAITE de jeu dérivée
//   du cumul (ce n'est pas un modèle climatique ; une cité-État ne pilote pas seule le climat). Elle pilote la probabilité
//   et la gravité des aléas climatiques du module events.ts (canicule, inondation/submersion, pénurie d'eau/sécheresse,
//   tempête) : `riskIndex` remplace l'ancien terme purement temporel `mois / 480`, avec lequel il coïncide quand les
//   émissions restent à leur niveau de 2030 (risque = cumul / (40 × référence annuelle)).
// - Trois jauges de soutien 0–100 (État, Entreprises, Citoyens) DÉRIVÉES des indicateurs existants et lissées, plus un
//   « capital » par acteur gagné par les succès (jalons, missions) et dépensé par les cartes-actions (il revient vers 0 de
//   6 % par mois). Jauge affichée = dérivée lissée + capital, bornée à 0–100.
// - Catalogue de cartes-actions : chaque carte appelle un mécanisme EXISTANT du moteur (projets énergie, programmes
//   sectoriels, plans logement, programmes environnement, leviers de politique soumis au parlement via schedulePolicy,
//   crédits exceptionnels d'events.ts) ; les seuls effets directs sont des modificateurs de risque documentés
//   (`risk:<événement>` d'events.ts) pour les cartes d'adaptation.
// Module pur et déterministe (aucun tirage aléatoire ici : les aléas passent par le générateur graine+mois d'events.ts).
import { clamp } from './economy';
import { addExtraBudget, addModifier, EVENT_DEFS } from './events';
import { addRecord, bumpGroup, bumpParty, groupSupport, type Bill } from './politics';
import { applyEnergyAction, buildQuote, closeQuote } from './energy';
import { TECHS, type BuildId } from './energyData';
import { applyEnvAction, envQuote, type EnvProjectKind } from './environment';
import { applySectorAction, type SectorAction } from './sectorModules';
import { applyServicesAction } from './services';
import { PROGRAM_DEFS, type IndustryProgram } from './industry';
import { TRANSPORT_PROJECTS, VEHICLE_DEFS } from './transport';
import { AGRI_PROJECTS } from './agriculture';
import { WASTE_FACILITIES } from './waste';
import { HOUSING_CONST } from './housing';
import { BUILDINGS, buildCost } from './construction';
import { isUnlocked, TECH_INDEX } from './research';
import type { GameState, Policy } from './types';

// ---------- Constantes ----------
export const CLIMATE_VERSION = 1;
export const START = 2030;
export const MILESTONE_YEARS = [2035, 2040, 2050, 2065, 2080] as const;
/** Réductions visées par les jalons en mode « linéaire par jalons » (part de la référence). */
export const MILESTONE_CUTS: Record<number, number> = { 2035: 0.2, 2040: 0.3, 2050: 0.5, 2065: 0.65, 2080: 0.75 };
export const SUPPORT_FLOOR = 20; // une carte ne peut pas faire tomber une jauge sous ce seuil
export const CAPITAL_DECAY = 0.94; // retour mensuel du capital vers 0 (demi-vie ≈ 11 mois)
export const GAUGE_SMOOTH = 0.2; // lissage mensuel des jauges dérivées
/** XP d'une carte jouée et d'un bilan favorable (réduits : enchaîner les cartes ne doit pas suffire à monter en grade). */
export const CARD_XP = 4;
export const CARD_REPORT_XP = 8;
/** Lassitude : chaque nouvelle utilisation d'une carte multiplie son coût en soutien. */
export const CARD_FATIGUE = 1.3;
export const ACTORS = ['etat', 'entreprises', 'citoyens'] as const;
export type Actor = (typeof ACTORS)[number];
export const ACTOR_NAMES: Record<Actor, string> = { etat: 'État', entreprises: 'Entreprises', citoyens: 'Citoyens' };
export type TrajectoryMode = 'lineaire' | 'exponentielle';
/** Aléas climatiques d'events.ts pilotés par l'indice de réchauffement local. */
export const HAZARD_IDS = ['canicule', 'inondations', 'penurie_eau', 'tempete'] as const;
export const HAZARD_NAMES: Record<string, string> = { canicule: 'Canicule', inondations: 'Inondation / submersion', penurie_eau: 'Sécheresse / pénurie d\'eau', tempete: 'Tempête' };

// ---------- Types d'état ----------
export type Support = Record<Actor, number>;
export interface Milestone {
  year: number;
  target: number; // émissions visées (tCO2/an)
  actual?: number; // émissions réelles de l'année (moyenne 12 mois)
  gap?: number; // écart réel − visé en points de la référence (négatif = mieux que visé)
  status: 'a_venir' | 'atteint' | 'proche' | 'manque';
  month?: number; // mois d'évaluation
  text?: string;
}
export interface PlayedCard {
  uid: number;
  id: string;
  title: string;
  sector: ClimateSector;
  month: number;
  status: 'engagee' | 'vote' | 'rejetee' | 'en_vigueur';
  msg: string;
  spent: Support;
  cost: number; // € engagés (investissement)
  forecastCo2: number; // t CO2/an évitées (prévision au moment de la décision)
  metric: string; // série d'historique observée (émissions du secteur)
  before: number; // valeur de la série (moyenne 12 mois) au moment de la décision
  due: number; // mois du premier bilan (délai + 3 mois)
  observed?: number; // dernière valeur observée (moyenne 12 mois)
  reported?: boolean;
  bills?: number[];
}
export interface HazardOutlook { id: string; name: string; month: number; year: number } // probabilités (0..1) : ce mois-ci et sur 12 mois
export interface ClimateState {
  version: number;
  mode: TrajectoryMode;
  reference: number; // tCO2/an (provisoire jusqu'en décembre 2030)
  referenceFixed: boolean;
  cumulative: number; // tCO2 émises (nettes) depuis janvier 2030
  riskIndex: number; // facteur additif des probabilités d'aléas (0 en 2030)
  warming: number; // indice de réchauffement local (°C, abstrait)
  milestones: Milestone[];
  derived: Support; // jauges dérivées des indicateurs (lissées)
  capital: Support; // capital politique gagné / dépensé
  support: Support; // jauges affichées = dérivées + capital
  refs: { sat: number; trust: number; pop: number };
  played: PlayedCard[];
  plays: Record<string, number>; // nombre de fois où chaque carte a été jouée
  seq: number;
  lastWon: number; // missions réussies déjà comptées
  hazards: HazardOutlook[];
  onTrack: number; // écart à la trajectoire (points de la référence, négatif = en avance)
}

// ---------- Outils ----------
const nf = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
const mt = (v: number) => `${nf(v / 1e6, 1)} Mt`;
const money = (v: number) => (Math.abs(v) >= 1e9 ? `${nf(v / 1e9, 1)} Md€` : `${nf(v / 1e6)} M€`);
const gdp = (S: GameState) => Math.max(1, S.accounts.gdp);
const netNow = (S: GameState) => S.energy?.emissions.net ?? S.accounts.netEmissions ?? S.accounts.emissions;
function avgLast(h: number[] | undefined, n: number, end = h ? h.length : 0): number | undefined {
  if (!h || !h.length) return undefined;
  const s = h.slice(Math.max(0, end - n), end);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : undefined;
}
function notice(S: GameState, kind: 'info' | 'warn' | 'good' | 'bad', title: string, text: string) {
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind, title, text });
  if (S.notices.length > 80) S.notices.shift();
}
/** Retour dans le fil des missions (bandeau, toasts) et XP. Sans effet si le module missions est absent. */
function feedback(S: GameState, text: string, xp = 0) {
  const M = S.missions;
  if (!M || !Array.isArray(M.feedback)) return;
  M.xp += xp;
  M.feedback.push({ id: M.feedbackSeq++, month: S.month, icon: '', text, kind: 'suivi' });
  if (M.feedback.length > 24) M.feedback.splice(0, M.feedback.length - 24);
}
function coalitionMood(S: GameState, d: number) {
  const P = S.politics;
  if (!P) return;
  for (const id of P.coalition) bumpParty(S, id, d);
}
const govPopularity = (S: GameState) => {
  const P = S.politics;
  return P ? P.parties.filter((p) => P.coalition.includes(p.id)).reduce((s, p) => s + p.popularity, 0) : 0.5;
};
const zero = (): Support => ({ etat: 0, entreprises: 0, citoyens: 0 });

// ---------- Trajectoire ----------
/** Part de la référence visée pour une année (fractionnaire). */
export function targetShare(year: number, mode: TrajectoryMode): number {
  const y = clamp(year, START, 2080);
  if (mode === 'exponentielle') return Math.pow(4, -(y - START) / 50);
  const pts: [number, number][] = [[START, 1], ...MILESTONE_YEARS.map((m) => [m, 1 - MILESTONE_CUTS[m]] as [number, number])];
  for (let i = 1; i < pts.length; i++) {
    const [y0, v0] = pts[i - 1];
    const [y1, v1] = pts[i];
    if (y <= y1) return v0 + ((v1 - v0) * (y - y0)) / (y1 - y0);
  }
  return 0.25;
}
/** Émissions visées (tCO2/an) pour l'année civile `year`. */
export function targetFor(C: ClimateState, year: number) {
  return C.reference * targetShare(year, C.mode);
}
/** Trajectoire mensuelle visée de janvier 2030 à décembre 2080 (pour les graphiques). */
export function targetSeries(C: ClimateState): number[] {
  const out: number[] = [];
  for (let m = 0; m <= (2080 - START) * 12 + 11; m++) out.push(C.reference * targetShare(START + m / 12, C.mode));
  return out;
}

// ---------- Initialisation et migration ----------
export function initClimate(S: GameState): ClimateState {
  const H = S.history;
  const net = H.emissionsNet?.length ? H.emissionsNet : H.emissions;
  // référence : 12 mois de 2030 si l'historique les contient (anciennes sauvegardes), sinon provisoire
  const ref = avgLast(net, 12, Math.min(12, net?.length ?? 0)) ?? netNow(S);
  const fixed = (net?.length ?? 0) >= 12;
  const cumulative = net ? net.reduce((s, v) => s + v / 12, 0) : 0;
  const C: ClimateState = {
    version: CLIMATE_VERSION, mode: 'lineaire', reference: ref, referenceFixed: fixed, cumulative, riskIndex: 0, warming: 0,
    milestones: [], derived: zero(), capital: zero(), support: zero(),
    refs: { sat: S.satisfaction.overall, trust: S.satisfaction.trust, pop: govPopularity(S) },
    played: [], plays: {}, seq: 1, lastWon: S.missions?.won ?? 0, hazards: [], onTrack: 0,
  };
  // repères de 2030 si la partie est déjà avancée : indicateurs initiaux de l'historique
  if (H.satisfaction?.length) C.refs.sat = H.satisfaction[0];
  if (H.trust?.length) C.refs.trust = H.trust[0];
  if (H.govPopularity?.length) C.refs.pop = H.govPopularity[0];
  C.milestones = MILESTONE_YEARS.map((year) => ({ year, target: targetFor(C, year), status: 'a_venir' as const }));
  S.climate = C;
  updateRisk(S);
  const d = deriveSupport(S);
  C.derived = { ...d };
  C.support = { ...d };
  C.hazards = hazardOutlook(S);
  return C;
}

/** Crée ou complète l'état du plan climat (nouvelle partie, ancienne sauvegarde, état partiel). */
export function ensureClimate(S: GameState): ClimateState {
  const C = S.climate as ClimateState | undefined;
  if (!C || typeof C !== 'object' || !Array.isArray(C.milestones) || !Number.isFinite(C.reference)) return initClimate(S);
  C.capital ??= zero();
  C.plays ??= {};
  C.played ??= [];
  C.hazards ??= [];
  C.version = CLIMATE_VERSION;
  return C;
}

// ---------- Réchauffement local et aléas ----------
/** Met à jour l'indice de risque et l'indice de réchauffement local à partir du cumul. */
export function updateRisk(S: GameState) {
  const C = S.climate!;
  const refAnnual = Math.max(1, C.reference);
  // coïncide avec l'ancien terme mois/480 si les émissions restent au niveau de 2030
  C.riskIndex = Math.max(0, C.cumulative / (40 * refAnnual));
  // indice abstrait : +0,5 °C « de jeu » pour 40 années d'émissions au niveau de 2030
  C.warming = 0.5 * C.riskIndex;
}
/** Gravité des aléas climatiques (multiplicateur des dégâts immédiats), lue par events.ts. */
export function climateSeverity(S: GameState) {
  return clamp(1 + 0.5 * (S.climate?.riskIndex ?? S.month / 480), 1, 2.5);
}
/** Probabilités indicatives des aléas climatiques : ce mois-ci et sur les 12 prochains mois (hors délais entre événements). */
export function hazardOutlook(S: GameState): HazardOutlook[] {
  return HAZARD_IDS.map((id) => {
    const def = EVENT_DEFS.find((d) => d.id === id);
    if (!def) return { id, name: HAZARD_NAMES[id], month: 0, year: 0 };
    const p = (m: number) => clamp(def.prob({ ...S, month: m } as GameState), 0, 0.25);
    let none = 1;
    for (let k = 1; k <= 12; k++) none *= 1 - p(S.month + k);
    return { id, name: HAZARD_NAMES[id], month: p(S.month + 1), year: 1 - none };
  });
}

// ---------- Jauges de soutien ----------
/**
 * Jauges dérivées (avant lissage et capital) :
 * - État = 55 − 6 × (déficit − 2 %, en points) − 0,3 × (dette − 60 %, en points) + cohérence (écart à la trajectoire, ±12) ;
 * - Entreprises = 52 + 60 × (confiance des entreprises − 0,5) + 200 × (marge − marge initiale) − 120 × (IS − 25 %)
 *   − 0,08 × (hausse des taxes carbone, €/t) + 0,25 × (soutien du patronat − 50) ;
 * - Citoyens = 55 + (satisfaction − référence) + 0,5 × (confiance − référence) + 60 × (popularité de la majorité − référence).
 */
export function deriveSupport(S: GameState): Support {
  const C = S.climate;
  const A = S.accounts;
  const deficit = -A.balance / gdp(S);
  const debt = S.finance.debt / gdp(S);
  const coherence = C ? clamp(-C.onTrack * 0.8, -12, 12) : 0;
  const etat = 55 - 6 * (deficit - 0.02) * 100 - 0.3 * (debt - 0.6) * 100 + coherence;
  const out = S.sectors.reduce((s, x) => s + x.output, 0);
  const margin = S.sectors.reduce((s, x) => s + x.profit, 0) / Math.max(1, out);
  const carbonUp = (S.policy.eco.carbon - 45) + (S.policy.eco.industrial - 30);
  const ent = 52 + 60 * (S.macro.confidence - 0.5) + 200 * (margin - S.baseline.margin) - 120 * (S.policy.corporate.rate - 0.25) - 0.08 * carbonUp + 0.25 * (groupSupport(S, 'patronat') - 50);
  const refs = C?.refs ?? { sat: S.satisfaction.overall, trust: S.satisfaction.trust, pop: govPopularity(S) };
  const cit = 55 + (S.satisfaction.overall - refs.sat) + 0.5 * (S.satisfaction.trust - refs.trust) + 60 * (govPopularity(S) - refs.pop);
  const f = (v: number) => (Number.isFinite(v) ? clamp(v, 0, 100) : 50);
  return { etat: f(etat), entreprises: f(ent), citoyens: f(cit) };
}
function refreshSupport(C: ClimateState) {
  for (const a of ACTORS) C.support[a] = clamp(C.derived[a] + C.capital[a], 0, 100);
}
function addCapital(C: ClimateState, d: Partial<Support>) {
  for (const a of ACTORS) C.capital[a] = clamp(C.capital[a] + (d[a] ?? 0), -60, 60);
  refreshSupport(C);
}

// ---------- Cartes-actions ----------
export type ClimateSector = 'energie' | 'batiment' | 'transports' | 'industrie' | 'agriculture' | 'dechets' | 'nature';
export const SECTOR_NAMES: Record<ClimateSector, string> = {
  energie: 'Énergie', batiment: 'Bâtiment et logement', transports: 'Transports', industrie: 'Industrie',
  agriculture: 'Agriculture et alimentation', dechets: 'Déchets', nature: 'Nature et adaptation',
};
/** Effets prévisionnels (ordres de grandeur calculés sur l'état courant). */
export interface Forecast { cost: number; co2: number; jobs: number; sat: number; budget: number }
export interface CardContext { schedule: (p: Policy) => { bills: Bill[] } }
interface PlayResult { ok: boolean; msg: string; bills?: number[] }
export interface CardDef {
  id: string;
  sector: ClimateSector;
  title: string;
  desc: string;
  /** mécanisme réel appelé (documentation affichée) */
  mechanism: string;
  support: Support; // coût en soutien (impopularité auprès de chaque acteur)
  delay: number; // mois avant les premiers effets
  repeat?: number; // nombre maximal de fois (1 par défaut)
  unlock?: { tech?: string; milestone?: number };
  requires?: Partial<Support>; // niveau minimal de jauge (avant dépense)
  metric: string; // série d'historique observée pour l'effet constaté
  estimate: (S: GameState) => Forecast;
  play: (S: GameState, ctx: CardContext, uid: number) => PlayResult;
}

// séries observées (poussées dans l'historique par climateStep)
const SRC = ['electricite', 'autresEnergie', 'industrie', 'transport', 'batiments', 'agriculture', 'construction'] as const;
type Src = (typeof SRC)[number];
const src = (S: GameState, k: Src) => S.energy?.emissions.bySource[k] ?? 0;
const wasteEm = (S: GameState) => S.waste?.emissions ?? 0;
/** Intensité marginale d'émission de l'électricité déplacée (t/MWh) : au plus celle d'un cycle combiné gaz. */
const disp = (S: GameState) => clamp(((S.energy?.emissions.intensityElec ?? 300) / 1000) * 1.3, 0.05, 0.37);
const jobsOf = (cost: number, months: number) => cost / 1.2e5 / Math.max(1, months / 12);
const F = (p: Partial<Forecast>): Forecast => ({ cost: 0, co2: 0, jobs: 0, sat: 0, budget: 0, ...p });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Levier de politique : modifie une copie de la politique programmée et la soumet (décret ou projet de loi). */
function policyLever(label: string, change: (p: Policy) => boolean | void) {
  return (S: GameState, ctx: CardContext): PlayResult => {
    const base = clone(S.pending?.policy ?? S.policy);
    const before = JSON.stringify(base);
    if (change(base) === false || JSON.stringify(base) === before) return { ok: false, msg: `${label} : mesure déjà en vigueur ou au plafond autorisé` };
    const r = ctx.schedule(base);
    const bills = r.bills.map((b) => b.id);
    return { ok: true, bills, msg: bills.length ? `${label} : projet de loi soumis au parlement (vote le mois prochain)` : `${label} : décret en vigueur au 1er du mois prochain` };
  };
}
const energyBuild = (tech: BuildId, mw: number) => (S: GameState) => applyEnergyAction(S, { type: 'energyBuild', tech, mw });
const sector = (a: SectorAction) => (S: GameState) => applySectorAction(S, a);
const env = (kind: EnvProjectKind, km2: number, extra?: (S: GameState, uid: number) => void) => (S: GameState, _c: CardContext, uid: number) => {
  const r = applyEnvAction(S, { type: 'envProject', kind, km2 });
  if (r.ok) extra?.(S, uid);
  return r;
};
const risk = (S: GameState, id: string, v: number, uid: number, label: string) => addModifier(S, `risk:${id}`, v, 0.997, -1000 - uid, label);
const ep = (S: GameState) => S.policy.energy;
const largestCity = (S: GameState) => S.country.cities.reduce((b, c) => (S.cities[c.id].population > S.cities[b.id].population ? c : b), S.country.cities[0]).id;
const buildEst = (S: GameState, tech: BuildId, mw: number, cf: number, co2PerMWh: number): Forecast => {
  const q = buildQuote(S, tech, mw);
  return F({ cost: q.cost, co2: mw * 8760 * cf * co2PerMWh, jobs: q.jobsBuild + q.jobsOp, budget: q.om, sat: 0.1 });
};
const progEst = (S: GameState, prog: IndustryProgram, n: number): Forecast => {
  const d = PROGRAM_DEFS[prog];
  const gain = (1 - (S.industry?.adoption[prog] ?? 0)) * Math.min(1, d.step * n);
  const cost = d.trancheCost * n * S.macro.priceLevel;
  return F({ cost, co2: src(S, 'industrie') * d.emission * gain, jobs: jobsOf(cost, d.months), sat: 0 });
};

export const CARDS: CardDef[] = [
  // ----- Énergie -----
  { id: 'solaire', sector: 'energie', title: 'Plan solaire sur les toits', desc: '800 MW de photovoltaïque sur les toitures et parkings publics.', mechanism: 'Projet énergie public (energyBuild solaire 800 MW).',
    support: { etat: 4, entreprises: 0, citoyens: 1 }, delay: 12, repeat: 8, metric: 'em_electricite',
    estimate: (S) => buildEst(S, 'solaire', 800, TECHS.solaire.cf, disp(S)), play: energyBuild('solaire', 800) },
  { id: 'eolien_mer', sector: 'energie', title: 'Parc éolien en mer', desc: '1 000 MW au large de la baie, raccordés au réseau de la cité.', mechanism: 'Projet énergie public (energyBuild éolien en mer 1 000 MW).',
    support: { etat: 6, entreprises: 0, citoyens: 3 }, delay: 48, repeat: 5, metric: 'em_electricite',
    estimate: (S) => buildEst(S, 'eolienMer', 1000, TECHS.eolienMer.cf, disp(S)), play: energyBuild('eolienMer', 1000) },
  { id: 'sortie_charbon', sector: 'energie', title: 'Sortie du charbon', desc: 'Fermeture immédiate de toutes les centrales à charbon, indemnisation des exploitants.', mechanism: 'Fermeture programmée (energyClose charbon, toute la puissance installée).',
    support: { etat: 5, entreprises: 8, citoyens: 3 }, delay: 1, metric: 'em_electricite',
    estimate: (S) => { const mw = S.energy?.fleet.charbon.mw ?? 0; const q = closeQuote(S, 'charbon', mw); return F({ cost: q.cost, co2: mw * 8760 * 0.55 * (TECHS.charbon.co2 - TECHS.gaz.co2), jobs: -q.jobsLost, sat: 0.2 }); },
    play: (S) => { const mw = Math.round(S.energy?.fleet.charbon.mw ?? 0); return mw < 1 ? { ok: false, msg: 'Aucune centrale à charbon en service' } : applyEnergyAction(S, { type: 'energyClose', tech: 'charbon', mw }); } },
  { id: 'batteries', sector: 'energie', title: 'Stockage par batteries', desc: '600 MW de batteries pour absorber la production solaire et éolienne.', mechanism: 'Projet énergie public (energyBuild batteries 600 MW).',
    support: { etat: 3, entreprises: 0, citoyens: 0 }, delay: 12, repeat: 3, metric: 'em_electricite',
    estimate: (S) => { const q = buildQuote(S, 'batteries', 600); return F({ cost: q.cost, co2: 600 * 4 * 365 * 0.5 * disp(S) * 0.5, jobs: q.jobsBuild + q.jobsOp, budget: q.om }); }, play: energyBuild('batteries', 600) },
  { id: 'complement_ren', sector: 'energie', title: 'Complément de rémunération renouvelable', desc: '+30 €/MWh garantis aux nouvelles capacités renouvelables des opérateurs privés.', mechanism: 'Levier de politique énergétique (renewableSupport +30 €/MWh), décret ou loi climat.',
    support: { etat: 7, entreprises: 0, citoyens: 1 }, delay: 24, repeat: 2, metric: 'em_electricite',
    estimate: (S) => F({ co2: 2.5e6 * disp(S), budget: 30 * 2.5e6, jobs: 600 }),
    play: policyLever('Complément de rémunération', (p) => { if (p.energy.renewableSupport >= 150) return false; p.energy.renewableSupport = Math.min(150, p.energy.renewableSupport + 30); }) },
  { id: 'reseaux', sector: 'energie', title: 'Réseaux électriques renforcés', desc: '+600 M€/an pour les réseaux et les interconnexions.', mechanism: 'Levier de politique énergétique (gridBudget +600 M€/an).',
    support: { etat: 5, entreprises: 0, citoyens: 0 }, delay: 24, metric: 'em_electricite',
    estimate: (S) => F({ co2: src(S, 'electricite') * 0.02, budget: 6e8, jobs: jobsOf(6e8, 12) }),
    play: policyLever('Réseaux électriques', (p) => { p.energy.gridBudget = Math.min(2e10, p.energy.gridBudget + 6e8); }) },
  { id: 'geothermie', sector: 'energie', title: 'Géothermie profonde', desc: '150 MW de géothermie pilotable sous le plateau.', mechanism: 'Projet énergie public (energyBuild géothermie 150 MW).',
    support: { etat: 4, entreprises: 0, citoyens: 1 }, delay: 48, repeat: 2, metric: 'em_electricite',
    estimate: (S) => buildEst(S, 'geothermie', 150, TECHS.geothermie.cf, Math.max(0, disp(S) - TECHS.geothermie.co2)), play: energyBuild('geothermie', 150) },
  { id: 'smr', sector: 'energie', title: 'Petits réacteurs modulaires', desc: '600 MW nucléaires de nouvelle génération.', mechanism: 'Projet énergie public (energyBuild nucléaire 600 MW). Débloqué par la recherche « Réacteurs nucléaires avancés ».',
    support: { etat: 9, entreprises: 0, citoyens: 8 }, delay: 120, unlock: { tech: 'nucleaire_avance' }, metric: 'em_electricite',
    estimate: (S) => buildEst(S, 'nucleaire', 600, TECHS.nucleaire.cf, disp(S)), play: energyBuild('nucleaire', 600) },

  // ----- Bâtiment et logement -----
  { id: 'renovation', sector: 'batiment', title: 'Plan de rénovation thermique', desc: 'Rénovation complète de 60 000 logements en 3 ans.', mechanism: 'Plan logement du ministère (planLogement rénovation, 60 000 logements sur 36 mois).',
    support: { etat: 6, entreprises: 0, citoyens: 1 }, delay: 12, repeat: 8, metric: 'em_batiments',
    estimate: (S) => { const cost = 60000 * HOUSING_CONST.renovationCost * S.macro.priceLevel; return F({ cost, co2: src(S, 'batiments') * (60000 / Math.max(1, S.housing?.stock ?? 4.7e6)) * 0.5, jobs: jobsOf(cost, 36), sat: 0.3 }); },
    play: (S) => applyServicesAction(S, { type: 'planLogement', kind: 'renovation', units: 60000, months: 36 }) },
  { id: 'pac', sector: 'batiment', title: 'Prime pompe à chaleur', desc: '+4 000 € par logement qui remplace une chaudière fossile.', mechanism: 'Levier de politique énergétique (heatPumpSubsidy +4 000 €).',
    support: { etat: 6, entreprises: 0, citoyens: 0 }, delay: 24, repeat: 2, metric: 'em_batiments',
    estimate: (S) => F({ co2: src(S, 'batiments') * 0.04, budget: 4000 * 30000, jobs: 500, sat: 0.2 }),
    play: policyLever('Prime pompe à chaleur', (p) => { if (p.energy.heatPumpSubsidy >= 20000) return false; p.energy.heatPumpSubsidy = Math.min(20000, p.energy.heatPumpSubsidy + 4000); }) },
  { id: 'fonds_renov', sector: 'batiment', title: 'Fonds national de rénovation', desc: '+1,5 Md€/an pour la rénovation énergétique des bâtiments.', mechanism: 'Levier de politique énergétique (renovationBudget +1,5 Md€/an).',
    support: { etat: 9, entreprises: 0, citoyens: 0 }, delay: 12, repeat: 2, metric: 'em_batiments',
    estimate: (S) => F({ co2: src(S, 'batiments') * 0.03, budget: 1.5e9, jobs: jobsOf(1.5e9, 12), sat: 0.2 }),
    play: policyLever('Fonds de rénovation', (p) => { p.energy.renovationBudget = Math.min(3e10, p.energy.renovationBudget + 1.5e9); }) },
  { id: 'aide_isolation', sector: 'batiment', title: 'Aide à l\'isolation', desc: '+30 points de prise en charge des rénovations privées.', mechanism: 'Levier de politique du logement (insulationSubsidy +0,3).',
    support: { etat: 6, entreprises: 0, citoyens: 0 }, delay: 12, repeat: 2, metric: 'em_batiments',
    estimate: (S) => F({ co2: src(S, 'batiments') * 0.03, budget: 5e8, jobs: 2500, sat: 0.3 }),
    play: policyLever('Aide à l\'isolation', (p) => { if (p.housing.insulationSubsidy >= 0.8) return false; p.housing.insulationSubsidy = Math.min(0.8, p.housing.insulationSubsidy + 0.3); }) },
  { id: 'norme_re', sector: 'batiment', title: 'Norme de construction bas carbone', desc: '+40 points de logements neufs aux normes écologiques.', mechanism: 'Levier de politique du logement (greenStandard +0,4).',
    support: { etat: 1, entreprises: 7, citoyens: 1 }, delay: 24, metric: 'em_batiments',
    estimate: (S) => F({ co2: src(S, 'batiments') * 0.01 + src(S, 'construction') * 0.05, sat: 0 }),
    play: policyLever('Norme bas carbone', (p) => { if (p.housing.greenStandard >= 1) return false; p.housing.greenStandard = Math.min(1, p.housing.greenStandard + 0.4); }) },
  { id: 'ecoquartier', sector: 'batiment', title: 'Écoquartier', desc: '1 800 logements passifs desservis par les mobilités douces.', mechanism: 'Programme d\'équipement (programme éco-quartier dans le quartier le plus peuplé).',
    support: { etat: 3, entreprises: 0, citoyens: 1 }, delay: 42, repeat: 4, metric: 'em_batiments',
    estimate: (S) => { const cost = buildCost(S, BUILDINGS.eco_quartier); return F({ cost, co2: 1800 * 2.5, jobs: jobsOf(cost, 42), sat: 0.2 }); },
    play: (S) => applyServicesAction(S, { type: 'programme', building: 'eco_quartier', cityId: largestCity(S) }) },
  { id: 'passifs', sector: 'batiment', title: 'Bâtiments passifs généralisés', desc: 'Tous les logements neufs passifs, aide à l\'isolation +20 points.', mechanism: 'Leviers du logement (greenStandard = 1, insulationSubsidy +0,2). Débloqué par la recherche « Bâtiments passifs ».',
    support: { etat: 4, entreprises: 5, citoyens: 1 }, delay: 24, unlock: { tech: 'batiments_passifs' }, metric: 'em_batiments',
    estimate: (S) => F({ co2: src(S, 'batiments') * 0.04 + src(S, 'construction') * 0.08, budget: 3e8, jobs: 1500 }),
    play: policyLever('Bâtiments passifs', (p) => { p.housing.greenStandard = 1; p.housing.insulationSubsidy = Math.min(0.8, p.housing.insulationSubsidy + 0.2); }) },

  // ----- Transports -----
  { id: 'tram', sector: 'transports', title: 'Nouvelle ligne de tramway', desc: '15 km de tramway dans le quartier le moins bien desservi.', mechanism: 'Programme transports (transport:build tram 15 km).',
    support: { etat: 4, entreprises: 0, citoyens: 3 }, delay: 39, repeat: 6, metric: 'em_transport',
    estimate: (S) => { const cost = TRANSPORT_PROJECTS.tram.costPerUnit * 15 * S.macro.priceLevel; return F({ cost, co2: src(S, 'transport') * 0.01, jobs: jobsOf(cost, 39), budget: TRANSPORT_PROJECTS.tram.maintPerUnit * 15, sat: 0.3 }); },
    play: sector({ type: 'transport:build', kind: 'tram', size: 15 }) },
  { id: 'metro', sector: 'transports', title: 'Prolongement du métro', desc: '8 km de métro automatique.', mechanism: 'Programme transports (transport:build métro 8 km).',
    support: { etat: 8, entreprises: 0, citoyens: 3 }, delay: 58, repeat: 3, metric: 'em_transport',
    estimate: (S) => { const cost = TRANSPORT_PROJECTS.metro.costPerUnit * 8 * S.macro.priceLevel; return F({ cost, co2: src(S, 'transport') * 0.02, jobs: jobsOf(cost, 58), budget: TRANSPORT_PROJECTS.metro.maintPerUnit * 8, sat: 0.4 }); },
    play: sector({ type: 'transport:build', kind: 'metro', size: 8 }) },
  { id: 'velo', sector: 'transports', title: 'Réseau cyclable express', desc: '300 km de pistes cyclables protégées.', mechanism: 'Programme transports (transport:build pistes cyclables 300 km).',
    support: { etat: 1, entreprises: 1, citoyens: 2 }, delay: 12, repeat: 3, metric: 'em_transport',
    estimate: (S) => { const cost = TRANSPORT_PROJECTS.velo.costPerUnit * 300 * S.macro.priceLevel; return F({ cost, co2: src(S, 'transport') * 0.006, jobs: jobsOf(cost, 12), sat: 0.2 }); },
    play: sector({ type: 'transport:build', kind: 'velo', size: 300 }) },
  { id: 'bus_elec', sector: 'transports', title: 'Bus électriques', desc: '400 bus électriques remplacent autant de bus diesel.', mechanism: 'Commande de matériel (transport:buy busElectrique 400, remplacement).',
    support: { etat: 2, entreprises: 0, citoyens: 0 }, delay: 10, repeat: 5, metric: 'em_transport',
    estimate: (S) => { const cost = VEHICLE_DEFS.busElectrique.cost * 400 * S.macro.priceLevel; return F({ cost, co2: 400 * 65, jobs: jobsOf(cost, 10) * 0.3, sat: 0.1 }); },
    play: sector({ type: 'transport:buy', vehicle: 'busElectrique', count: 400, replace: true }) },
  { id: 'bornes', sector: 'transports', title: 'Bornes de recharge', desc: '5 000 bornes publiques de recharge.', mechanism: 'Programme transports (transport:build bornes 50 centaines).',
    support: { etat: 1, entreprises: 0, citoyens: 0 }, delay: 4, repeat: 3, metric: 'em_transport',
    estimate: (S) => { const cost = TRANSPORT_PROJECTS.bornes.costPerUnit * 50 * S.macro.priceLevel; return F({ cost, co2: src(S, 'transport') * 0.004, jobs: jobsOf(cost, 4) * 0.3 }); },
    play: sector({ type: 'transport:build', kind: 'bornes', size: 50 }) },
  { id: 'bonus_ve', sector: 'transports', title: 'Bonus voiture électrique', desc: '+4 000 € à l\'achat d\'un véhicule électrique.', mechanism: 'Levier de politique des transports (evBonus +4 000 €).',
    support: { etat: 6, entreprises: 0, citoyens: 0 }, delay: 24, repeat: 2, metric: 'em_transport',
    estimate: (S) => F({ co2: src(S, 'transport') * 0.04, budget: 4000 * (S.transport?.carSales ?? 2e5) * (S.transport?.evSalesShare ?? 0.3), sat: 0.2 }),
    play: policyLever('Bonus électrique', (p) => { const t = p.transport!; if (t.evBonus >= 15000) return false; t.evBonus = Math.min(15000, t.evBonus + 4000); }) },
  { id: 'malus', sector: 'transports', title: 'Malus thermique', desc: '+3 000 € à l\'achat d\'une voiture thermique neuve.', mechanism: 'Levier de politique des transports (thermalMalus +3 000 €).',
    support: { etat: 0, entreprises: 4, citoyens: 8 }, delay: 24, metric: 'em_transport',
    estimate: (S) => F({ co2: src(S, 'transport') * 0.035, budget: -3000 * (S.transport?.carSales ?? 2e5) * (1 - (S.transport?.evSalesShare ?? 0.3)), sat: -0.4 }),
    play: policyLever('Malus thermique', (p) => { const t = p.transport!; if (t.thermalMalus >= 30000) return false; t.thermalMalus = Math.min(30000, t.thermalMalus + 3000); }) },
  { id: 'tarif_tc', sector: 'transports', title: 'Transports en commun à moitié prix', desc: 'Tarifs divisés par deux, compensés aux exploitants.', mechanism: 'Levier de politique des transports (fareLevel × 0,5).',
    support: { etat: 8, entreprises: 0, citoyens: 0 }, delay: 3, metric: 'em_transport',
    estimate: (S) => F({ co2: src(S, 'transport') * 0.025, budget: 4e8, sat: 0.8 }),
    play: policyLever('Tarifs réduits', (p) => { const t = p.transport!; if (t.fareLevel <= 0.05) return false; t.fareLevel = Math.max(0, t.fareLevel * 0.5); }) },
  { id: 'frequence', sector: 'transports', title: 'Fréquences renforcées', desc: '+30 % de passages de bus, trams et métros.', mechanism: 'Levier de politique des transports (frequency +0,3).',
    support: { etat: 5, entreprises: 0, citoyens: 0 }, delay: 3, metric: 'em_transport',
    estimate: (S) => F({ co2: src(S, 'transport') * 0.015, budget: 3e8, jobs: 1500, sat: 0.4 }),
    play: policyLever('Fréquences', (p) => { const t = p.transport!; if (t.frequency >= 2.5) return false; t.frequency = Math.min(2.5, t.frequency + 0.3); }) },
  { id: 'fret', sector: 'transports', title: 'Fret ferroviaire', desc: 'Deux plateformes rail-route près du port.', mechanism: 'Programme transports (transport:build plateformes fret 2).',
    support: { etat: 3, entreprises: 0, citoyens: 0 }, delay: 24, repeat: 3, metric: 'em_transport',
    estimate: (S) => { const cost = TRANSPORT_PROJECTS.fret.costPerUnit * 2 * S.macro.priceLevel; return F({ cost, co2: src(S, 'transport') * 0.012, jobs: jobsOf(cost, 24), budget: TRANSPORT_PROJECTS.fret.maintPerUnit * 2 }); },
    play: sector({ type: 'transport:build', kind: 'fret', size: 2 }) },
  { id: 'carburants', sector: 'transports', title: 'Hausse de l\'accise sur les carburants', desc: '+10 points d\'accise sur l\'essence et le gazole.', mechanism: 'Levier fiscal (eco.fuel +0,1), décret ou loi climat.',
    support: { etat: 0, entreprises: 4, citoyens: 12 }, delay: 6, requires: { citoyens: 45 }, metric: 'em_transport',
    estimate: (S) => F({ co2: src(S, 'transport') * 0.04, budget: -(S.accounts.revenue.carburants ?? 0) * 0.25, sat: -0.8 }),
    play: policyLever('Accise carburants', (p) => { if (p.eco.fuel >= 1.5) return false; p.eco.fuel = Math.min(1.5, p.eco.fuel + 0.1); }) },

  // ----- Industrie -----
  { id: 'electrification', sector: 'industrie', title: 'Électrification des procédés', desc: 'Quatre tranches de fours et chaudières électriques.', mechanism: 'Programme industriel (industry:program électrification, 4 tranches).',
    support: { etat: 6, entreprises: 2, citoyens: 0 }, delay: 24, repeat: 6, metric: 'em_industrie',
    estimate: (S) => progEst(S, 'electrification', 4), play: sector({ type: 'industry:program', program: 'electrification', tranches: 4 }) },
  { id: 'chaleur', sector: 'industrie', title: 'Récupération de chaleur fatale', desc: 'Quatre tranches d\'échangeurs et de réseaux de chaleur.', mechanism: 'Programme industriel (industry:program chaleur, 4 tranches).',
    support: { etat: 3, entreprises: 0, citoyens: 0 }, delay: 12, repeat: 4, metric: 'em_industrie',
    estimate: (S) => progEst(S, 'chaleur', 4), play: sector({ type: 'industry:program', program: 'chaleur', tranches: 4 }) },
  { id: 'recyclage_ind', sector: 'industrie', title: 'Économie circulaire', desc: 'Trois tranches de matières recyclées et d\'écoconception.', mechanism: 'Programme industriel (industry:program recyclage, 3 tranches).',
    support: { etat: 3, entreprises: 0, citoyens: 0 }, delay: 18, repeat: 4, metric: 'em_industrie',
    estimate: (S) => progEst(S, 'recyclage', 3), play: sector({ type: 'industry:program', program: 'recyclage', tranches: 3 }) },
  { id: 'ccs', sector: 'industrie', title: 'Captage du carbone', desc: 'Trois tranches de captage et stockage sur les cimenteries et aciéries.', mechanism: 'Programme industriel (industry:program technologies propres, 3 tranches). Débloqué par la recherche « Capture industrielle du carbone ».',
    support: { etat: 6, entreprises: 3, citoyens: 1 }, delay: 36, repeat: 3, unlock: { tech: 'capture_carbone' }, metric: 'em_industrie',
    estimate: (S) => progEst(S, 'proprete', 3), play: sector({ type: 'industry:program', program: 'proprete', tranches: 3 }) },
  { id: 'hydrogene', sector: 'industrie', title: 'Acier et chimie à l\'hydrogène', desc: 'Trois tranches d\'hydrogène électrolytique.', mechanism: 'Programme industriel (industry:program hydrogène, 3 tranches). Débloqué par la recherche « Hydrogène vert ».',
    support: { etat: 6, entreprises: 2, citoyens: 0 }, delay: 36, repeat: 3, unlock: { tech: 'hydrogene_vert' }, metric: 'em_industrie',
    estimate: (S) => progEst(S, 'hydrogene', 3), play: sector({ type: 'industry:program', program: 'hydrogene', tranches: 3 }) },
  { id: 'taxe_carbone', sector: 'industrie', title: 'Taxe carbone renforcée', desc: '+30 €/t sur le carbone diffus et sur les émissions industrielles.', mechanism: 'Levier fiscal (eco.carbon +30, eco.industrial +30) : projet de loi climat soumis au vote.',
    support: { etat: 0, entreprises: 12, citoyens: 9 }, delay: 12, repeat: 3, requires: { entreprises: 35, citoyens: 40 }, metric: 'em_industrie',
    estimate: (S) => { const base = src(S, 'industrie') + src(S, 'transport') + src(S, 'batiments') + src(S, 'autresEnergie'); return F({ co2: base * 0.0015 * 30, budget: -30 * base * 0.8, sat: -0.6, jobs: -300 }); },
    play: policyLever('Taxe carbone', (p) => { if (p.eco.carbon >= 500) return false; p.eco.carbon = Math.min(500, p.eco.carbon + 30); p.eco.industrial = Math.min(500, p.eco.industrial + 30); }) },
  { id: 'aide_verte', sector: 'industrie', title: 'Subvention à l\'industrie propre', desc: '+20 points de prise en charge des investissements industriels propres.', mechanism: 'Levier de politique industrielle (greenSubsidy +0,2).',
    support: { etat: 7, entreprises: 0, citoyens: 0 }, delay: 18, repeat: 2, metric: 'em_industrie',
    estimate: (S) => F({ co2: src(S, 'industrie') * 0.04, budget: 4e8, jobs: 800 }),
    play: policyLever('Subvention industrie propre', (p) => { const i = p.industry!; if (i.greenSubsidy >= 0.5) return false; i.greenSubsidy = Math.min(0.5, i.greenSubsidy + 0.2); }) },

  // ----- Agriculture et alimentation -----
  { id: 'engrais', sector: 'agriculture', title: 'Moins d\'engrais azotés', desc: '−25 % d\'engrais de synthèse, accompagnement technique.', mechanism: 'Levier de politique agricole (fertilizerReduction +0,25).',
    support: { etat: 1, entreprises: 6, citoyens: 0 }, delay: 12, metric: 'em_agriculture',
    estimate: (S) => F({ co2: src(S, 'agriculture') * 0.38 * 0.25 * 0.8, sat: 0, jobs: -50 }),
    play: policyLever('Réduction des engrais', (p) => { const a = p.agriculture!; if (a.fertilizerReduction >= 0.6) return false; a.fertilizerReduction = Math.min(0.6, a.fertilizerReduction + 0.25); }) },
  { id: 'cheptel', sector: 'agriculture', title: 'Réduction aidée du cheptel', desc: '−20 % de bovins, indemnités aux éleveurs.', mechanism: 'Levier de politique agricole (herdReduction +0,2).',
    support: { etat: 4, entreprises: 8, citoyens: 2 }, delay: 12, metric: 'em_agriculture',
    estimate: (S) => F({ co2: src(S, 'agriculture') * 0.48 * 0.2, budget: 5e7, jobs: -200 }),
    play: policyLever('Réduction du cheptel', (p) => { const a = p.agriculture!; if (a.herdReduction >= 0.4) return false; a.herdReduction = Math.min(0.4, a.herdReduction + 0.2); }) },
  { id: 'sols', sector: 'agriculture', title: 'Sols vivants et haies', desc: 'Couverts végétaux sur 40 % des terres et 10 000 km de haies.', mechanism: 'Levier agricole (soilProtection +0,4) et projet agricole (agriculture:build haies, 2).',
    support: { etat: 3, entreprises: 2, citoyens: 0 }, delay: 12, metric: 'em_agriculture',
    estimate: (S) => { const cost = AGRI_PROJECTS.haies.cost * 2 * S.macro.priceLevel; return F({ cost, co2: src(S, 'agriculture') * 0.03, budget: 8e6, jobs: jobsOf(cost, 12) }); },
    play: (S, ctx) => { const r = sector({ type: 'agriculture:build', project: 'haies', count: 2 })(S); if (!r.ok) return r; const p = policyLever('Couverts végétaux', (q) => { const a = q.agriculture!; a.soilProtection = Math.min(1, a.soilProtection + 0.4); })(S, ctx); return { ok: true, bills: p.bills, msg: `${r.msg} ; ${p.msg}` }; } },
  { id: 'bio', sector: 'agriculture', title: 'Conversion au bio', desc: '+300 €/ha/an d\'aide à la conversion et au maintien en bio.', mechanism: 'Levier de politique agricole (bioAid +300 €/ha).',
    support: { etat: 4, entreprises: 0, citoyens: 0 }, delay: 24, metric: 'em_agriculture',
    estimate: (S) => F({ co2: src(S, 'agriculture') * 0.04, budget: 1.5e7, sat: 0.2, jobs: 150 }),
    play: policyLever('Aide au bio', (p) => { const a = p.agriculture!; if (a.bioAid >= 1500) return false; a.bioAid = Math.min(1500, a.bioAid + 300); }) },
  { id: 'precision', sector: 'agriculture', title: 'Agriculture de précision', desc: '+200 €/ha/an pour les capteurs et la modulation des intrants.', mechanism: 'Levier de politique agricole (precisionAid +200 €/ha). Débloqué par la recherche « Agriculture de précision ».',
    support: { etat: 3, entreprises: 0, citoyens: 0 }, delay: 12, unlock: { tech: 'agriculture_precision' }, metric: 'em_agriculture',
    estimate: (S) => F({ co2: src(S, 'agriculture') * 0.05, budget: 1e7 }),
    play: policyLever('Agriculture de précision', (p) => { const a = p.agriculture!; if (a.precisionAid >= 600) return false; a.precisionAid = Math.min(600, a.precisionAid + 200); }) },
  { id: 'irrigation', sector: 'agriculture', title: 'Irrigation économe', desc: 'Goutte-à-goutte et réutilisation des eaux usées : −15 % de risque de pénurie d\'eau.', mechanism: 'Levier agricole (waterEfficiency +0,4) et modificateur de risque « risk:penurie_eau » −0,15 (events.ts).',
    support: { etat: 3, entreprises: 0, citoyens: 0 }, delay: 12, metric: 'em_agriculture',
    estimate: () => F({ co2: 0, budget: 1e7, sat: 0.1 }),
    play: (S, ctx, uid) => { const r = policyLever('Irrigation économe', (p) => { const a = p.agriculture!; if (a.waterEfficiency >= 1) return false; a.waterEfficiency = Math.min(1, a.waterEfficiency + 0.4); })(S, ctx); if (r.ok) risk(S, 'penurie_eau', -0.15, uid, 'Irrigation économe'); return r; } },

  // ----- Déchets -----
  { id: 'biodechets', sector: 'dechets', title: 'Collecte des biodéchets', desc: 'Collecte séparée généralisée et deux unités de méthanisation.', mechanism: 'Levier déchets (organicCollection +0,5) et installations (waste:build méthanisation, 2).',
    support: { etat: 3, entreprises: 0, citoyens: 3 }, delay: 18, metric: 'em_dechets',
    estimate: (S) => { const cost = WASTE_FACILITIES.methanisation.cost * 2 * S.macro.priceLevel; return F({ cost, co2: wasteEm(S) * 0.2, jobs: jobsOf(cost, 18), budget: 4e7 }); },
    play: (S, ctx) => { const r = sector({ type: 'waste:build', facility: 'methanisation', count: 2 })(S); if (!r.ok) return r; const p = policyLever('Collecte des biodéchets', (q) => { const w = q.waste!; w.organicCollection = Math.min(1, w.organicCollection + 0.5); })(S, ctx); return { ok: true, bills: p.bills, msg: `${r.msg} ; ${p.msg}` }; } },
  { id: 'tri_incitatif', sector: 'dechets', title: 'Tarification incitative', desc: 'La redevance déchets dépend du poids des ordures résiduelles.', mechanism: 'Levier déchets (sortingIncentive +0,5).',
    support: { etat: 1, entreprises: 0, citoyens: 6 }, delay: 12, metric: 'em_dechets',
    estimate: (S) => F({ co2: wasteEm(S) * 0.1, sat: -0.2 }),
    play: policyLever('Tarification incitative', (p) => { const w = p.waste!; if (w.sortingIncentive >= 1) return false; w.sortingIncentive = Math.min(1, w.sortingIncentive + 0.5); }) },
  { id: 'consigne', sector: 'dechets', title: 'Consigne et réemploi', desc: 'Consigne des emballages, ressourceries : −15 % de déchets ménagers.', mechanism: 'Levier déchets (prevention +0,15).',
    support: { etat: 1, entreprises: 5, citoyens: 2 }, delay: 12, metric: 'em_dechets',
    estimate: (S) => F({ co2: wasteEm(S) * 0.1, jobs: 300 }),
    play: policyLever('Consigne', (p) => { const w = p.waste!; if (w.prevention >= 0.4) return false; w.prevention = Math.min(0.4, w.prevention + 0.15); }) },
  { id: 'recyclage_usines', sector: 'dechets', title: 'Usines de recyclage', desc: 'Deux usines de recyclage de 80 000 t/an.', mechanism: 'Installations déchets (waste:build recyclage, 2).',
    support: { etat: 2, entreprises: 0, citoyens: 0 }, delay: 24, repeat: 3, metric: 'em_dechets',
    estimate: (S) => { const cost = WASTE_FACILITIES.recyclage.cost * 2 * S.macro.priceLevel; return F({ cost, co2: wasteEm(S) * 0.05, jobs: jobsOf(cost, 24), budget: WASTE_FACILITIES.recyclage.maintenance * 2 }); },
    play: sector({ type: 'waste:build', facility: 'recyclage', count: 2 }) },

  // ----- Nature et adaptation -----
  { id: 'reboisement', sector: 'nature', title: 'Forêts périurbaines', desc: '2 000 ha reboisés sur des friches.', mechanism: 'Programme environnement (envProject reboisement 20 km²).',
    support: { etat: 2, entreprises: 1, citoyens: 0 }, delay: 24, repeat: 4, metric: 'em_puits',
    estimate: (S) => { const q = envQuote(S, 'reboisement', 20); return F({ cost: q.cost, co2: 2000 * 7, jobs: jobsOf(q.cost, 24), sat: 0.1 }); }, play: env('reboisement', 20) },
  { id: 'zones_humides', sector: 'nature', title: 'Zones humides littorales', desc: '1 000 ha de marais restaurés : puits de carbone et tampon contre la submersion.', mechanism: 'Programme environnement (envProject restauration 10 km²) et modificateur « risk:inondations » −0,25 (events.ts).',
    support: { etat: 3, entreprises: 2, citoyens: 0 }, delay: 36, repeat: 2, metric: 'em_puits',
    estimate: (S) => { const q = envQuote(S, 'restauration', 10); return F({ cost: q.cost, co2: 1000 * 2.5, jobs: jobsOf(q.cost, 36) }); },
    play: env('restauration', 10, (S, uid) => risk(S, 'inondations', -0.25, uid, 'Zones humides restaurées')) },
  { id: 'ilots', sector: 'nature', title: 'Îlots de fraîcheur', desc: '100 ha de parcs et de cours désimperméabilisées : −20 % de risque de canicule.', mechanism: 'Programme environnement (envProject parc 1 km²) et modificateur « risk:canicule » −0,2 (events.ts).',
    support: { etat: 3, entreprises: 0, citoyens: 0 }, delay: 18, repeat: 3, metric: 'em_puits',
    estimate: (S) => { const q = envQuote(S, 'parc', 1); return F({ cost: q.cost, co2: 100 * 1.5, jobs: jobsOf(q.cost, 18), sat: 0.4 }); },
    play: env('parc', 1, (S, uid) => risk(S, 'canicule', -0.2, uid, 'Îlots de fraîcheur')) },
  { id: 'digues', sector: 'nature', title: 'Protection littorale', desc: 'Digues, portes à marée et bassins de rétention : −40 % de risque de submersion.', mechanism: 'Crédits exceptionnels (infrastructures, 0,15 % du PIB/an pendant 24 mois) et modificateur « risk:inondations » −0,4. Débloqué après le jalon 2035.',
    support: { etat: 6, entreprises: 0, citoyens: 0 }, delay: 24, unlock: { milestone: 2035 }, metric: 'em_puits',
    estimate: (S) => F({ cost: 0.0015 * gdp(S) * 2, jobs: jobsOf(0.003 * gdp(S), 24), sat: 0.2 }),
    play: (S, _c, uid) => { addExtraBudget(S, 'infrastructures', 0.0015 * gdp(S), 24, 'Plan climat — protection littorale'); risk(S, 'inondations', -0.4, uid, 'Protection littorale'); return { ok: true, msg: `Protection littorale engagée : ${money(0.003 * gdp(S))} sur 24 mois` }; } },
  { id: 'plan_eau', sector: 'nature', title: 'Sécurisation de l\'eau', desc: '+300 M€/an pour les réseaux et réserves d\'eau : −30 % de risque de pénurie.', mechanism: 'Levier de politique environnementale (waterBudget +300 M€/an) et modificateur « risk:penurie_eau » −0,3.',
    support: { etat: 4, entreprises: 0, citoyens: 0 }, delay: 12, metric: 'em_puits',
    estimate: () => F({ budget: 3e8, jobs: jobsOf(3e8, 12), sat: 0.1 }),
    play: (S, ctx, uid) => { const r = policyLever('Sécurisation de l\'eau', (p) => { p.energy.waterBudget = Math.min(1e10, p.energy.waterBudget + 3e8); })(S, ctx); if (r.ok) risk(S, 'penurie_eau', -0.3, uid, 'Sécurisation de l\'eau'); return r; } },
  { id: 'reseau_resilient', sector: 'nature', title: 'Réseaux résilients aux tempêtes', desc: 'Enfouissement des lignes exposées : −30 % de risque de tempête destructrice.', mechanism: 'Levier énergétique (gridBudget +300 M€/an) et modificateur « risk:tempete » −0,3. Débloqué après le jalon 2040.',
    support: { etat: 5, entreprises: 0, citoyens: 0 }, delay: 24, unlock: { milestone: 2040 }, metric: 'em_puits',
    estimate: () => F({ budget: 3e8, jobs: jobsOf(3e8, 12) }),
    play: (S, ctx, uid) => { const r = policyLever('Réseaux résilients', (p) => { p.energy.gridBudget = Math.min(2e10, p.energy.gridBudget + 3e8); })(S, ctx); if (r.ok) risk(S, 'tempete', -0.3, uid, 'Réseaux résilients'); return r; } },
  { id: 'zan', sector: 'nature', title: 'Zéro artificialisation nette', desc: 'Toute nouvelle surface bâtie doit être compensée par une renaturation.', mechanism: 'Levier de politique environnementale (zan = 1).',
    support: { etat: 1, entreprises: 8, citoyens: 3 }, delay: 12, metric: 'em_puits',
    estimate: (S) => F({ co2: Math.max(0, S.energy?.emissions.landUse ?? 0) * 0.8 + 5000, jobs: -200 }),
    play: policyLever('Zéro artificialisation nette', (p) => { if (p.energy.zan >= 1) return false; p.energy.zan = 1; }) },
];
export const CARD_INDEX: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

/** Coût en soutien d'une carte : coût de base × 1,3 par utilisation précédente (lassitude). */
export function cardSupportCost(S: GameState, id: string): Support {
  const c = CARD_INDEX[id];
  const n = S.climate?.plays[id] ?? 0;
  const k = Math.pow(CARD_FATIGUE, n);
  return { etat: Math.round(c.support.etat * k), entreprises: Math.round(c.support.entreprises * k), citoyens: Math.round(c.support.citoyens * k) };
}

export interface CardStatus { available: boolean; reason?: string; cost: Support; forecast: Forecast; plays: number; max: number }
/** Disponibilité d'une carte (débloquée, non épuisée, soutien suffisant) et prévisions sur l'état courant. */
export function cardStatus(S: GameState, id: string): CardStatus {
  const c = CARD_INDEX[id];
  const C = S.climate;
  const cost = cardSupportCost(S, id);
  let forecast: Forecast;
  try { forecast = c.estimate(S); } catch { forecast = F({}); }
  const plays = C?.plays[id] ?? 0;
  const max = c.repeat ?? 1;
  const base = { cost, forecast, plays, max };
  if (!C) return { ...base, available: false, reason: 'Plan climat indisponible' };
  if (c.unlock?.tech && !isUnlocked(S, c.unlock.tech)) return { ...base, available: false, reason: `Nécessite la recherche « ${TECH_INDEX[c.unlock.tech]?.name ?? c.unlock.tech} »` };
  if (c.unlock?.milestone && !C.milestones.some((m) => m.year === c.unlock!.milestone && m.status !== 'a_venir')) return { ...base, available: false, reason: `Débloquée après le bilan du jalon ${c.unlock.milestone}` };
  if (plays >= max) return { ...base, available: false, reason: max > 1 ? `Déjà jouée ${max} fois (maximum)` : 'Déjà jouée' };
  for (const a of ACTORS) {
    const need = c.requires?.[a];
    if (need !== undefined && C.support[a] < need) return { ...base, available: false, reason: `Soutien ${ACTOR_NAMES[a]} trop faible : ${Math.round(C.support[a])}/100, il faut au moins ${need} pour cette mesure` };
    if (cost[a] > 0 && C.support[a] - cost[a] < SUPPORT_FLOOR) return { ...base, available: false, reason: `Soutien ${ACTOR_NAMES[a]} insuffisant : ${Math.round(C.support[a])}/100, la carte coûte ${cost[a]} et la jauge ne peut pas descendre sous ${SUPPORT_FLOOR}` };
  }
  return { ...base, available: true };
}

/** Joue une carte : vérifie la disponibilité, appelle le mécanisme réel, débite le soutien, enregistre le suivi. */
export function playClimateCard(S: GameState, id: string, ctx: CardContext): { ok: boolean; msg: string; uid?: number } {
  const C = ensureClimate(S);
  const c = CARD_INDEX[String(id)];
  if (!c) return { ok: false, msg: 'Carte inconnue' };
  const st = cardStatus(S, c.id);
  if (!st.available) return { ok: false, msg: `${c.title} : ${st.reason}` };
  const uid = C.seq;
  let r: PlayResult;
  try { r = c.play(S, ctx, uid); } catch { r = { ok: false, msg: 'Mesure impossible dans l\'état actuel' }; }
  if (!r.ok) return { ok: false, msg: `${c.title} : ${r.msg}` };
  C.seq++;
  C.plays[c.id] = (C.plays[c.id] ?? 0) + 1;
  addCapital(C, { etat: -st.cost.etat, entreprises: -st.cost.entreprises, citoyens: -st.cost.citoyens });
  const before = avgLast(S.history[c.metric], 12) ?? metricNow(S, c.metric);
  const card: PlayedCard = {
    uid, id: c.id, title: c.title, sector: c.sector, month: S.month, status: r.bills?.length ? 'vote' : 'engagee', msg: r.msg,
    spent: st.cost, cost: st.forecast.cost, forecastCo2: st.forecast.co2, metric: c.metric, before, due: S.month + c.delay + 3, bills: r.bills?.length ? r.bills : undefined,
  };
  C.played.push(card);
  if (C.played.length > 60) C.played.splice(0, C.played.length - 60);
  const costTxt = ACTORS.filter((a) => st.cost[a] > 0).map((a) => `${ACTOR_NAMES[a]} −${st.cost[a]}`).join(', ');
  notice(S, 'info', `Plan climat : ${c.title}`, `${r.msg}. Effet attendu : −${nf(st.forecast.co2 / 1000)} kt CO₂/an d'ici ${c.delay} mois environ.${costTxt ? ` Soutien dépensé : ${costTxt}.` : ''}`);
  feedback(S, `Plan climat — ${c.title} : −${nf(st.forecast.co2 / 1000)} kt CO₂/an attendues, bilan dans ${c.delay + 3} mois`, CARD_XP);
  return { ok: true, msg: `${c.title} : ${r.msg}`, uid };
}

/** Choix de la trajectoire (avant le bilan du premier jalon). */
export function setTrajectoryMode(S: GameState, mode: string): { ok: boolean; msg: string } {
  const C = ensureClimate(S);
  if (mode !== 'lineaire' && mode !== 'exponentielle') return { ok: false, msg: 'Trajectoire inconnue' };
  if (C.milestones.some((m) => m.status !== 'a_venir')) return { ok: false, msg: 'La trajectoire ne peut plus être modifiée après le premier jalon' };
  C.mode = mode;
  for (const m of C.milestones) m.target = targetFor(C, m.year);
  return { ok: true, msg: mode === 'lineaire' ? 'Trajectoire linéaire par jalons retenue' : 'Trajectoire exponentielle retenue (effort réparti à taux constant)' };
}

/** Valeur instantanée d'une série observée (avant son premier enregistrement dans l'historique). */
function metricNow(S: GameState, key: string): number {
  if (key === 'em_dechets') return wasteEm(S);
  if (key === 'em_puits') return (S.energy?.emissions.landUse ?? 0) - (S.energy?.emissions.absorptions ?? 0);
  const k = key.slice(3) as Src;
  return SRC.includes(k) ? src(S, k) : 0;
}

// ---------- Pas mensuel ----------
/** Appelé par `tick` après l'enregistrement de l'historique (engine.ts). */
export function climateStep(S: GameState) {
  const C = ensureClimate(S);
  const H = S.history;
  const push = (k: string, v: number) => { (H[k] ??= []).push(Math.round(v * 1e6) / 1e6); };
  const net = netNow(S);
  const netHist = H.emissionsNet?.length ? H.emissionsNet : H.emissions;

  // 1. Référence 2030 (moyenne des 12 mois de 2030), cumul, risque
  if (!C.referenceFixed) {
    const n = Math.min(12, netHist?.length ?? 0);
    const ref = avgLast(netHist, n, n);
    if (ref !== undefined) C.reference = ref;
    if (S.month >= 11 && n >= 12) {
      C.referenceFixed = true;
      for (const m of C.milestones) m.target = targetFor(C, m.year);
      notice(S, 'info', 'Plan climat : référence 2030 fixée', `Émissions nettes de 2030 : ${mt(C.reference)} CO₂e. Objectif facteur 4 : ${mt(C.reference / 4)} en 2080 ; premier jalon : ${mt(C.milestones[0].target)} en 2035 (−${nf((1 - C.milestones[0].target / C.reference) * 100)} %).`);
    }
  }
  C.cumulative += net / 12;
  updateRisk(S);
  const year = S.startYear + S.month / 12;
  const avg12 = avgLast(netHist, 12) ?? net;
  C.onTrack = S.month >= 12 ? ((avg12 - C.reference * targetShare(year - 0.5, C.mode)) / Math.max(1, C.reference)) * 100 : 0;

  // 2. Jauges : dérivées lissées, capital (succès des missions, retour vers 0)
  const d = deriveSupport(S);
  for (const a of ACTORS) C.derived[a] += GAUGE_SMOOTH * (d[a] - C.derived[a]);
  const won = S.missions?.won ?? C.lastWon;
  if (won > C.lastWon) { C.capital.citoyens += 3 * (won - C.lastWon); C.capital.etat += 2 * (won - C.lastWon); }
  C.lastWon = won;
  for (const a of ACTORS) C.capital[a] *= CAPITAL_DECAY;
  refreshSupport(C);

  // 3. Suivi des cartes jouées : votes du parlement, effet constaté
  for (const p of C.played) {
    if (p.status === 'vote' && p.bills?.length) {
      const bills = (S.politics?.bills ?? []).filter((b) => p.bills!.includes(b.id));
      if (bills.length && bills.every((b) => b.status !== 'en_debat')) {
        if (bills.some((b) => b.status === 'adoptee')) { p.status = 'en_vigueur'; p.msg = 'Loi adoptée par le parlement'; }
        else {
          p.status = 'rejetee';
          p.msg = 'Loi rejetée ou retirée : la mesure n\'entre pas en vigueur';
          addCapital(C, { etat: p.spent.etat / 2, entreprises: p.spent.entreprises / 2, citoyens: p.spent.citoyens / 2 });
          notice(S, 'warn', `Plan climat : ${p.title} rejetée`, 'Le parlement n\'a pas adopté la mesure. La moitié du soutien dépensé est restituée ; la carte peut être rejouée plus tard.');
          C.plays[p.id] = Math.max(0, (C.plays[p.id] ?? 1) - 1);
        }
      }
    } else if (p.status === 'engagee' && S.month >= p.month + 1) p.status = 'en_vigueur';
    if (p.status !== 'rejetee' && S.month >= p.month + 1) {
      p.observed = avgLast(H[p.metric], 12) ?? p.observed;
      if (!p.reported && S.month >= p.due && p.observed !== undefined) {
        p.reported = true;
        const delta = p.observed - p.before;
        const txt = `${p.title} : émissions du secteur (moyenne 12 mois) ${mt(p.before)} → ${mt(p.observed)} (${delta <= 0 ? '−' : '+'}${nf(Math.abs(delta) / 1000)} kt/an, toutes causes confondues ; prévision de la mesure : −${nf(p.forecastCo2 / 1000)} kt/an).`;
        notice(S, delta <= 0 ? 'good' : 'info', 'Plan climat : bilan d\'une mesure', txt);
        feedback(S, `Bilan — ${txt}`, delta < 0 ? CARD_REPORT_XP : 0);
      }
    }
  }

  // 4. Jalons (décembre de l'année du jalon, moyenne des 12 mois de l'année)
  for (const m of C.milestones) {
    if (m.status !== 'a_venir' || S.month !== (m.year - S.startYear) * 12 + 11) continue;
    evaluateMilestone(S, C, m, avg12);
  }

  // 5. Perspectives d'aléas, historique
  C.hazards = hazardOutlook(S);
  push('climatCumul', C.cumulative);
  push('climatRechauffement', C.warming);
  push('climatCible', C.reference * targetShare(year, C.mode));
  for (const a of ACTORS) push(`soutien_${a}`, C.support[a]);
  for (const k of SRC) push(`em_${k}`, src(S, k));
  push('em_dechets', wasteEm(S));
  push('em_puits', (S.energy?.emissions.landUse ?? 0) - (S.energy?.emissions.absorptions ?? 0));
}

function evaluateMilestone(S: GameState, C: ClimateState, m: Milestone, actual: number) {
  m.target = targetFor(C, m.year);
  m.actual = actual;
  m.gap = ((actual - m.target) / Math.max(1, C.reference)) * 100;
  m.month = S.month;
  const idx = MILESTONE_YEARS.indexOf(m.year as (typeof MILESTONE_YEARS)[number]);
  const cut = (1 - actual / Math.max(1, C.reference)) * 100;
  const goal = (1 - m.target / Math.max(1, C.reference)) * 100;
  const head = `Jalon ${m.year} : émissions ${mt(actual)} (${cut >= 0 ? '−' : '+'}${nf(Math.abs(cut))} % depuis 2030) pour un objectif de ${mt(m.target)} (−${nf(goal)} %).`;
  if (m.gap <= 0) {
    m.status = 'atteint';
    const xp = 150 + 50 * idx;
    addCapital(C, { etat: 20, entreprises: 10, citoyens: 15 });
    S.satisfaction.trust = clamp(S.satisfaction.trust + 2, 0, 100);
    coalitionMood(S, 0.12);
    addRecord(S, 0.06 + 0.02 * idx); // bilan : compense l'usure du pouvoir
    bumpGroup(S, 'climat', 0.25);
    m.text = `${head} Objectif atteint : soutien État +20, Entreprises +10, Citoyens +15, confiance +2, popularité en hausse, +${xp} XP.`;
    notice(S, 'good', `Plan climat : jalon ${m.year} atteint`, m.text);
    feedback(S, `Jalon ${m.year} du plan climat atteint (+${xp} XP)`, xp);
  } else if (m.gap <= 5) {
    m.status = 'proche';
    addCapital(C, { etat: 4, entreprises: 2, citoyens: 4 });
    m.text = `${head} Objectif presque atteint (écart de ${nf(m.gap, 1)} points) : soutien +4, +50 XP.`;
    notice(S, 'info', `Plan climat : jalon ${m.year} presque atteint`, m.text);
    feedback(S, `Jalon ${m.year} presque atteint (écart ${nf(m.gap, 1)} points, +50 XP)`, 50);
  } else {
    m.status = 'manque';
    const k = clamp(m.gap / 10, 0.5, 2);
    addCapital(C, { etat: -4 * k, citoyens: -6 * k });
    S.satisfaction.trust = clamp(S.satisfaction.trust - 1.5 * k, 0, 100);
    coalitionMood(S, -0.05 * k);
    addRecord(S, -0.02 * k);
    bumpGroup(S, 'climat', -0.25);
    m.text = `${head} Objectif manqué de ${nf(m.gap, 1)} points : soutien Citoyens −${nf(6 * k)}, État −${nf(4 * k)}, confiance −${nf(1.5 * k, 1)}, associations climat mécontentes.`;
    notice(S, 'bad', `Plan climat : jalon ${m.year} manqué`, m.text);
  }
}
