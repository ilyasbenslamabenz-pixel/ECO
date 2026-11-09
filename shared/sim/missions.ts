// Missions, retours « avant → après », progression du joueur (expérience, titres, trophées) et bilan annuel.
//
// Boucle de jeu visée : décision → retour immédiat → résultat en quelques mois → nouvel objectif.
// - Trois missions sont actives en permanence. Elles sont générées de façon déterministe à partir des besoins réels
//   (`assessNeeds`) : un besoin de niveau 1–2 donne une mission ciblée, sinon des missions d'amélioration (chômage,
//   électricité renouvelable, satisfaction, dette, émissions, file d'attente logement…) dont la cible est relative à
//   la valeur de départ. Rien n'est tiré au hasard : l'ordre des candidats dépend uniquement de l'état.
// - Réussite (cible atteinte avant l'échéance) : expérience, confiance, humeur des électeurs de la majorité
//   (donc popularité, via `politicsStep`) et petite dotation exceptionnelle de trésorerie. Échec à l'échéance :
//   petite perte de confiance et d'humeur électorale.
// - Retours : quand un équipement entre en service ou qu'une réforme prend effet, un message « avant → après » est
//   calculé sur l'indicateur concerné, puis un suivi est publié trois mois plus tard.
// - Bilan annuel : chaque mois de janvier, comparaison avec janvier précédent et causes probables connues.
// Module pur et déterministe, appelé par `tick` (engine.ts) : `missionsPre` au début du mois, `missionsStep` à la fin.
import { clamp } from './economy';
import { assessNeeds, type Need } from './needs';
import { addRecord } from './politics';
import { addRevenue } from './sectors';
import type { GameState, InfraType, Notice } from './types';

// ---------- Indicateurs suivis ----------
export type MetricId =
  | 'chomage' | 'renouvelable' | 'satisfaction' | 'confiance' | 'dette' | 'deficit' | 'emissions' | 'pib' | 'pauvrete'
  | 'attenteLogement' | 'tensionLogement' | 'ecoles' | 'universites' | 'attenteSoins' | 'capaciteSoins'
  | 'margeElec' | 'securite' | 'congestion' | 'air';

export interface MetricDef {
  label: string; // nom court affiché
  phrase: string; // groupe nominal utilisé dans les titres (« l'occupation des écoles »)
  icon: string;
  dir: 'min' | 'max'; // sens souhaité
  get: (S: GameState) => number | undefined;
  /** valeur instantanée pour les retours « avant → après » (si l'indicateur de mission est lissé sur 12 mois) */
  instant?: (S: GameState) => number | undefined;
  fmt: (v: number) => string;
  /** écart jugé significatif sur un an (bilan annuel) */
  scale: (v: number) => number;
  panel: string;
}

const nf = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (d: number) => (v: number) => `${nf(v * 100, d)} %`;
/** pourcentage à 1 décimale, sans « ,0 » final (ex. 95 % ; 94,6 %) */
const pctT = (v: number) => `${nf(Math.round(v * 1000) / 10, 1).replace(/,0$/, '')} %`;
const unemployment = (S: GameState) => S.demography.unemployed / Math.max(1, S.demography.labourForce);
/** Moyenne des 12 derniers mois d'une série d'historique (lisse les saisons). */
function avg12(S: GameState, key: string): number | undefined {
  const h = S.history[key];
  if (!h || !h.length) return undefined;
  const t = h.slice(-12);
  return t.reduce((s, v) => s + v, 0) / t.length;
}

export const METRICS: Record<MetricId, MetricDef> = {
  chomage: { label: 'Chômage', phrase: 'le chômage', icon: '💼', dir: 'min', get: unemployment, fmt: pct(1), scale: () => 0.004, panel: 'travail' },
  renouvelable: { label: 'Électricité renouvelable', phrase: 'la part renouvelable de l\'électricité (12 mois)', icon: '🌱', dir: 'max', get: (S) => S.energy?.elecRenShare, instant: (S) => S.energy?.elecRenShareMonth, fmt: pct(1), scale: () => 0.015, panel: 'energie' },
  satisfaction: { label: 'Satisfaction', phrase: 'la satisfaction', icon: '🙂', dir: 'max', get: (S) => S.satisfaction.overall, fmt: (v) => `${nf(v, 1)}/100`, scale: () => 1.5, panel: 'population' },
  confiance: { label: 'Confiance', phrase: 'la confiance dans le gouvernement', icon: '🤝', dir: 'max', get: (S) => S.satisfaction.trust, fmt: (v) => `${nf(v, 1)}/100`, scale: () => 2, panel: 'politique' },
  dette: { label: 'Dette publique', phrase: 'la dette publique', icon: '🏦', dir: 'min', get: (S) => S.finance.debt / Math.max(1, S.accounts.gdp), fmt: (v) => `${nf(v * 100, 1)} % du PIB`, scale: () => 0.015, panel: 'finances' },
  deficit: { label: 'Déficit public', phrase: 'le déficit public', icon: '🧾', dir: 'min', get: (S) => -S.accounts.balance / Math.max(1, S.accounts.gdp), fmt: (v) => `${nf(v * 100, 1)} % du PIB`, scale: () => 0.005, panel: 'finances' },
  emissions: { label: 'Émissions de CO₂', phrase: 'les émissions de CO₂ (moyenne 12 mois)', icon: '🏭', dir: 'min', get: (S) => avg12(S, 'emissions') ?? S.accounts.emissions, instant: (S) => S.accounts.emissions, fmt: (v) => `${nf(v / 1e6, 1)} Mt/an`, scale: (v) => Math.abs(v) * 0.03, panel: 'environnement' },
  pib: { label: 'PIB', phrase: 'le PIB', icon: '📈', dir: 'max', get: (S) => S.accounts.gdp, fmt: (v) => `${nf(v / 1e9, 0)} Md€/an`, scale: (v) => Math.abs(v) * 0.03, panel: 'economie' },
  pauvrete: { label: 'Pauvreté', phrase: 'le taux de pauvreté', icon: '🥖', dir: 'min', get: (S) => S.accounts.poverty, fmt: pct(1), scale: () => 0.005, panel: 'population' },
  attenteLogement: { label: 'Attente logement social', phrase: 'la file d\'attente des logements sociaux', icon: '🏘️', dir: 'min', get: (S) => S.housing?.socialWaiting, fmt: (v) => `${nf(v)} ménages`, scale: (v) => Math.max(500, Math.abs(v) * 0.1), panel: 'logement' },
  tensionLogement: { label: 'Tension du logement', phrase: 'la tension du marché du logement', icon: '🏠', dir: 'min', get: (S) => S.housing?.tension, fmt: (v) => `${nf(v, 2)} ménage/logement`, scale: () => 0.01, panel: 'logement' },
  ecoles: { label: 'Occupation des écoles', phrase: 'l\'occupation des écoles', icon: '🏫', dir: 'min', get: (S) => S.education?.occupancySchool, fmt: pctT, scale: () => 0.02, panel: 'education' },
  universites: { label: 'Occupation des universités', phrase: 'l\'occupation des universités', icon: '🎓', dir: 'min', get: (S) => S.education?.occupancyUni, fmt: pctT, scale: () => 0.02, panel: 'education' },
  attenteSoins: { label: 'Attente spécialiste', phrase: 'l\'attente pour un spécialiste', icon: '🏥', dir: 'min', get: (S) => S.health?.waitDays, fmt: (v) => `${nf(v)} jours`, scale: () => 2, panel: 'sante' },
  capaciteSoins: { label: 'Capacité de soins', phrase: 'la capacité de soins', icon: '🛏️', dir: 'max', get: (S) => S.health?.ratio, fmt: pctT, scale: () => 0.02, panel: 'sante' },
  margeElec: { label: 'Marge électrique', phrase: 'la marge de sécurité électrique', icon: '⚡', dir: 'max', get: (S) => S.energy?.balance?.margin, fmt: pct(0), scale: () => 0.05, panel: 'energie' },
  securite: { label: 'Sentiment de sécurité', phrase: 'le sentiment de sécurité', icon: '🚓', dir: 'max', get: (S) => S.security?.feeling, fmt: (v) => `${nf(v, 1)}/100`, scale: () => 1.5, panel: 'securite' },
  congestion: { label: 'Congestion', phrase: 'la congestion routière', icon: '🚇', dir: 'min', get: (S) => S.transport?.congestion, fmt: (v) => `indice ${nf(v, 2)}`, scale: () => 0.02, panel: 'transports' },
  air: { label: 'Qualité de l\'air', phrase: 'la qualité de l\'air', icon: '🍃', dir: 'max', get: (S) => S.environment?.airQuality, fmt: (v) => `${nf(Math.round(v * 1000) / 10, 1).replace(/,0$/, '')}/100`, scale: () => 0.02, panel: 'environnement' },
};
export const METRIC_IDS = Object.keys(METRICS) as MetricId[];

const val = (S: GameState, m: MetricId): number | undefined => {
  const v = METRICS[m].get(S);
  return v === undefined || !Number.isFinite(v) ? undefined : v;
};
const reached = (m: MetricId, v: number, target: number) => (METRICS[m].dir === 'min' ? v <= target : v >= target);

// ---------- Types d'état ----------
export interface Reward { xp: number; trust: number; mood: number; cash: number }
export interface Mission {
  id: number;
  metric: MetricId;
  icon: string;
  title: string;
  source: 'besoin' | 'amelioration';
  needId?: string;
  start: number;
  target: number;
  value: number;
  progress: number; // 0..1
  startMonth: number;
  deadline: number; // mois (indice de simulation) de l'échéance
  difficulty: 1 | 2 | 3;
  reward: Reward;
  penalty: { trust: number; mood: number };
  status: 'active' | 'reussie' | 'echouee';
  endMonth?: number;
  panel: string;
}
export interface Feedback { id: number; month: number; icon: string; text: string; kind: 'chantier' | 'reforme' | 'suivi' | 'mission' | 'trophee' }
interface Followup { due: number; icon: string; label: string; metric: MetricId; before: number }
interface LogEntry { month: number; label: string; metrics: MetricId[] }
export interface ReviewRow { metric: MetricId; label: string; start: number; end: number; startTxt: string; endTxt: string; better: boolean | null }
export interface YearReview {
  year: number; month: number;
  rows: ReviewRow[];
  moves: { label: string; icon: string; text: string; better: boolean; cause: string }[];
  won: number; failed: number; xp: number;
  trophies: string[]; // libellés des trophées obtenus dans l'année
  title: string;
}
export interface MissionsState {
  version: 1;
  active: Mission[];
  history: Mission[]; // missions terminées, plus récentes à la fin (40 max)
  seq: number;
  xp: number;
  won: number;
  failed: number;
  streak: number; // réussites consécutives
  bestStreak: number;
  titleIndex: number; // dernier titre annoncé (indice dans TITLES)
  trophies: Record<string, number>; // id → mois d'obtention
  records: Partial<Record<MetricId, number>>;
  cooldown: Partial<Record<MetricId, number>>; // mois jusqu'auquel l'indicateur n'est pas reproposé
  feedback: Feedback[]; // derniers retours (24 max)
  feedbackSeq: number;
  followups: Followup[];
  ref: { emissions: number; socialWaitingPeak: number };
  /** repères de janvier ; les indicateurs saisonniers (émissions…) y sont relevés au mois près (janvier contre janvier) */
  yearStart: { month: number; values: Partial<Record<MetricId, number>>; won: number; failed: number; xp: number };
  yearLog: LogEntry[];
  review: YearReview | null;
}

// ---------- Titres et trophées ----------
export const TITLES: { xp: number; name: string }[] = [
  // seuils calibrés par les parties simulées (docs/EQUILIBRAGE.md) : un joueur actif est Ministre vers 10 ans et Chef
  // d'État vers 30 ans ; « visionnaire » récompense une partie exceptionnelle
  { xp: 0, name: 'Maire adjoint' },
  { xp: 300, name: 'Maire' },
  { xp: 900, name: 'Préfet' },
  { xp: 1700, name: 'Ministre délégué' },
  { xp: 2800, name: 'Ministre' },
  { xp: 4400, name: 'Premier ministre' },
  { xp: 6800, name: 'Chef d\'État' },
  { xp: 12000, name: 'Chef d\'État visionnaire' },
];
export function titleOf(xp: number) {
  let k = 0;
  for (let i = 0; i < TITLES.length; i++) if (xp >= TITLES[i].xp) k = i;
  const next = TITLES[k + 1] ?? null;
  const cur = TITLES[k];
  return { index: k, name: cur.name, next: next?.name ?? null, nextXp: next?.xp ?? null, progress: next ? clamp((xp - cur.xp) / (next.xp - cur.xp), 0, 1) : 1 };
}

const RENEWABLE_INFRA: InfraType[] = ['parc_eolien', 'parc_solaire', 'parc_eolien_mer', 'centrale_geothermique', 'centrale_biomasse', 'barrage'];
type TrophyCtx = { S: GameState; M: MissionsState; activated: { type: InfraType }[] };
export interface TrophyDef { id: string; icon: string; name: string; desc: string; xp: number; test: (c: TrophyCtx) => boolean }
export const TROPHIES: TrophyDef[] = [
  { id: 'premiere_mission', icon: '🎯', name: 'Premier pas', desc: 'Réussir une première mission.', xp: 50, test: ({ M }) => M.won >= 1 },
  { id: 'premier_chantier', icon: '🏗️', name: 'Bâtisseur', desc: 'Mettre en service un premier équipement construit pendant le mandat.', xp: 80, test: ({ activated }) => activated.length > 0 },
  { id: 'premiere_renouvelable', icon: '🌞', name: 'Première centrale verte', desc: 'Mettre en service une première centrale renouvelable.', xp: 120, test: ({ activated }) => activated.some((i) => RENEWABLE_INFRA.includes(i.type)) },
  { id: 'vert_30', icon: '🌱', name: 'Courant vert', desc: '30 % d\'électricité renouvelable (12 mois glissants).', xp: 150, test: ({ S }) => (S.energy?.elecRenShare ?? 0) >= 0.3 },
  { id: 'vert_50', icon: '🌿', name: 'Moitié verte', desc: '50 % d\'électricité renouvelable (12 mois glissants).', xp: 250, test: ({ S }) => (S.energy?.elecRenShare ?? 0) >= 0.5 },
  { id: 'vert_80', icon: '🌳', name: 'Réseau décarboné', desc: '80 % d\'électricité renouvelable (12 mois glissants).', xp: 400, test: ({ S }) => (S.energy?.elecRenShare ?? 0) >= 0.8 },
  { id: 'emissions_25', icon: '💨', name: '−25 % de CO₂', desc: 'Émissions (moyenne 12 mois) inférieures de 25 % à celles de la prise de fonctions.', xp: 300, test: ({ S, M }) => (val(S, 'emissions') ?? Infinity) <= M.ref.emissions * 0.75 },
  { id: 'chomage_5', icon: '💼', name: 'Plein emploi', desc: 'Chômage sous 5 %.', xp: 250, test: ({ S }) => unemployment(S) < 0.05 },
  { id: 'dette_60', icon: '🏦', name: 'Finances saines', desc: 'Dette publique sous 60 % du PIB.', xp: 250, test: ({ S }) => S.finance.debt / Math.max(1, S.accounts.gdp) < 0.6 },
  { id: 'equilibre', icon: '⚖️', name: 'Budget à l\'équilibre', desc: 'Solde public positif sur un mois.', xp: 120, test: ({ S }) => S.accounts.balance >= 0 },
  { id: 'satisfaction_70', icon: '😊', name: 'Pays heureux', desc: 'Satisfaction d\'au moins 70/100.', xp: 200, test: ({ S }) => S.satisfaction.overall >= 70 },
  { id: 'air_pur', icon: '🍃', name: 'Air pur', desc: 'Qualité de l\'air d\'au moins 75/100.', xp: 150, test: ({ S }) => (S.environment?.airQuality ?? 0) >= 0.75 },
  { id: 'reelu', icon: '🗳️', name: 'Réélu', desc: 'Gagner une élection.', xp: 200, test: ({ S }) => (S.politics?.electionsWon ?? 0) >= 1 },
  { id: 'serie_5', icon: '🔥', name: 'Sans faute', desc: 'Réussir 5 missions d\'affilée.', xp: 150, test: ({ M }) => M.bestStreak >= 5 },
  { id: 'missions_10', icon: '🏅', name: 'Dix missions', desc: 'Réussir 10 missions.', xp: 200, test: ({ M }) => M.won >= 10 },
  { id: 'missions_25', icon: '🏆', name: 'Vingt-cinq missions', desc: 'Réussir 25 missions.', xp: 400, test: ({ M }) => M.won >= 25 },
  { id: 'decennie', icon: '📅', name: 'Une décennie au pouvoir', desc: 'Gouverner 10 ans.', xp: 300, test: ({ S }) => S.month >= 120 },
];

// ---------- Initialisation et migration ----------
export function initMissions(S: GameState): MissionsState {
  const values: Partial<Record<MetricId, number>> = {};
  for (const m of METRIC_IDS) { const v = val(S, m); if (v !== undefined) values[m] = v; }
  const M: MissionsState = {
    version: 1, active: [], history: [], seq: 1, xp: 0, won: 0, failed: 0, streak: 0, bestStreak: 0, titleIndex: 0,
    trophies: {}, records: { ...pick(values, ['chomage', 'renouvelable', 'satisfaction', 'dette', 'emissions']) }, cooldown: {},
    feedback: [], feedbackSeq: 1, followups: [],
    ref: { emissions: values.emissions ?? S.accounts.emissions, socialWaitingPeak: values.attenteLogement ?? 0 },
    yearStart: { month: S.month - (S.month % 12), values: reviewValues(S), won: 0, failed: 0, xp: 0 },
    yearLog: [], review: null,
  };
  S.missions = M;
  refill(S, M);
  return M;
}
function pick<T extends object>(o: T, keys: (keyof T)[]): Partial<T> {
  const r: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}
/** Anciennes sauvegardes (sans missions) ou état partiel : crée ou complète l'état des missions. */
export function ensureMissions(S: GameState): MissionsState {
  if (!S.missions || typeof S.missions !== 'object' || !Array.isArray(S.missions.active)) return initMissions(S);
  return S.missions;
}

// ---------- Génération déterministe ----------
interface Candidate { metric: MetricId; source: Mission['source']; needId?: string; target: number; months: number; difficulty: 1 | 2 | 3 }

/**
 * Première année : la conjoncture de départ fait déjà baisser spontanément le chômage, le déficit et la dette ; une mission
 * sur ces indicateurs serait gagnée sans rien faire. Elles ne sont proposées qu'après ce délai, comme les missions d'émissions
 * (leur moyenne glissante sur 12 mois n'est complète qu'après un an : avant, elle suit la saison).
 */
export const MACRO_WARMUP = 12;

/** Arrondi au demi-point (cibles sur 100 : satisfaction, sécurité) : l'arrondi ne doit pas doubler l'effort demandé. */
const half = (v: number) => Math.round(v * 2) / 2;

/** Mission ciblée tirée d'un besoin de niveau 1–2 (null si le besoin n'a pas d'indicateur mesurable). */
function fromNeed(S: GameState, n: Need): Candidate | null {
  const d = (n.level === 2 ? 3 : 2) as 2 | 3;
  const months = n.level === 2 ? 12 : 9;
  const c = (metric: MetricId, target: number, mo = months): Candidate | null => {
    const v = val(S, metric);
    if (v === undefined || reached(metric, v, target)) return null;
    return { metric, source: 'besoin', needId: n.id, target, months: mo, difficulty: d };
  };
  switch (n.id) {
    case 'ecoles': {
      const occ = val(S, 'ecoles') ?? 1;
      if (occ > 0.98) return c('ecoles', Math.min(0.96, Math.floor((occ - 0.03) * 100) / 100), 24); // chantier d'école : 18 à 30 mois
      return null; // sous-occupation : pas de mission (démolir n'est pas un objectif en soi)
    }
    case 'universites': return c('universites', Math.min(0.99, Math.floor((S.education!.occupancyUni - 0.03) * 100) / 100), 24);
    case 'sante': {
      const w = S.health!.waitDays;
      if (w > 40) return c('attenteSoins', Math.max(30, Math.round(w * 0.9)), months + 3);
      return c('capaciteSoins', Math.min(1, Math.ceil((S.health!.ratio + 0.02) * 100) / 100), months + 3);
    }
    case 'logement': {
      const wait = S.housing!.socialWaiting;
      if (wait > 500) return c('attenteLogement', Math.round(wait * 0.85 / 100) * 100, months + 6);
      return c('tensionLogement', Math.max(1, Math.floor((S.housing!.tension - 0.02) * 100) / 100), months + 6);
    }
    case 'electricite': return c('margeElec', 0.08, months + 3);
    case 'verte': return c('renouvelable', Math.min(0.98, Math.ceil((S.energy!.elecRenShare + 0.03) * 100) / 100), 24);
    case 'securite': return c('securite', Math.min(70, half(S.security!.feeling + 1)), months + 3);
    case 'emploi': if (S.month < MACRO_WARMUP) return null; return c('chomage', Math.max(0.03, Math.round((unemployment(S) - 0.002) * 1000) / 1000), months + 6);
    case 'transports': return c('congestion', Math.max(1, Math.floor((S.transport!.congestion - 0.03) * 100) / 100), months + 6);
    case 'air': return c('air', Math.min(0.9, Math.round((S.environment!.airQuality + 0.008) * 200) / 200), months + 6);
    default: return null;
  }
}

/** Missions d'amélioration (cibles relatives à la situation actuelle, exigeant une action du joueur). */
function improvements(S: GameState): Candidate[] {
  const out: Candidate[] = [];
  const add = (metric: MetricId, target: number, months: number, difficulty: 1 | 2 | 3, ok = true) => {
    const v = val(S, metric);
    if (!ok || v === undefined || reached(metric, v, target)) return;
    out.push({ metric, source: 'amelioration', target, months, difficulty });
  };
  const u = unemployment(S);
  add('chomage', Math.round((u - 0.002) * 1000) / 1000, 18, 2, u > 0.035 && S.month >= MACRO_WARMUP);
  const ren = S.energy?.elecRenShare;
  if (ren !== undefined) add('renouvelable', Math.min(0.98, Math.ceil((ren + 0.03) * 100) / 100), 24, 2, ren < 0.95);
  const sat = S.satisfaction.overall;
  add('satisfaction', Math.min(90, half(sat + 0.5)), 18, 1, sat < 88);
  const debt = val(S, 'dette') ?? 0;
  add('dette', Math.round((debt - 0.02) * 200) / 200, 24, 2, debt > 0.3 && S.month >= MACRO_WARMUP);
  const def = val(S, 'deficit') ?? 0;
  add('deficit', def > 0.035 ? Math.max(0.03, Math.floor((def - 0.01) * 1000) / 1000) : Math.floor((def - 0.005) * 1000) / 1000, 18, 1, def > 0.005 && S.month >= MACRO_WARMUP);
  const em = val(S, 'emissions') ?? 0;
  add('emissions', em * 0.95, 24, 2, em > 0 && S.month >= MACRO_WARMUP);
  const wait = S.housing?.socialWaiting ?? 0;
  add('attenteLogement', Math.round(wait * 0.8 / 100) * 100, 18, 1, wait > 1000);
  const hw = S.health?.waitDays;
  if (hw !== undefined) add('attenteSoins', Math.max(20, Math.round(hw - 2)), 15, 1, hw > 25);
  const feel = S.security?.feeling;
  if (feel !== undefined) add('securite', Math.min(85, half(feel + 1)), 15, 1, feel < 82);
  const pov = S.accounts.poverty;
  add('pauvrete', Math.round((pov - 0.002) * 1000) / 1000, 24, 2, pov > 0.05);
  const air = S.environment?.airQuality;
  if (air !== undefined) add('air', Math.min(0.92, Math.round((air + 0.006) * 200) / 200), 24, 1, air < 0.9);
  return out;
}

const monthName = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateOf = (S: GameState, month: number) => `${monthName[month % 12]} ${S.startYear + Math.floor(month / 12)}`;

function missionTitle(S: GameState, c: Candidate, deadline: number) {
  const m = METRICS[c.metric];
  const t = m.fmt(c.target);
  const verb = m.dir === 'min' ? `Ramener ${m.phrase} sous ${t}` : `Porter ${m.phrase} à ${t}`;
  return `${verb} d'ici ${dateOf(S, deadline)}`;
}

function makeMission(S: GameState, M: MissionsState, c: Candidate): Mission {
  const start = val(S, c.metric)!;
  const d = c.difficulty;
  const gdp = Math.max(1, S.accounts.gdp);
  const deadline = S.month + c.months;
  return {
    id: M.seq++, metric: c.metric, icon: METRICS[c.metric].icon, title: missionTitle(S, c, deadline), source: c.source, needId: c.needId,
    start, target: c.target, value: start, progress: 0, startMonth: S.month, deadline, difficulty: d,
    // récompense modeste : expérience, confiance (0–100), humeur des électeurs de la majorité (−1..1), dotation de trésorerie
    reward: { xp: 60 + 40 * d, trust: 1 + 0.5 * d, mood: 0.015 * d, cash: Math.round((gdp * 1e-4 * d) / 1e6) * 1e6 },
    penalty: { trust: 0.5 + 0.5 * d, mood: 0.01 * d },
    status: 'active', panel: METRICS[c.metric].panel,
  };
}

/** Complète les missions actives jusqu'à trois. Ordre : besoins (urgence décroissante), puis améliorations en rotation. */
export function refill(S: GameState, M: MissionsState, needs?: Need[]) {
  if (M.active.length >= 3) return;
  let list: Need[] = [];
  try { list = needs ?? assessNeeds(S); } catch { list = []; }
  const fromNeeds = list.filter((n) => n.level >= 1).map((n) => fromNeed(S, n)).filter((c): c is Candidate => !!c);
  const imp = improvements(S);
  const rot = imp.length ? (M.seq + M.won + M.failed) % imp.length : 0;
  const ordered = [...fromNeeds, ...imp.slice(rot), ...imp.slice(0, rot)];
  const take = (respectCooldown: boolean) => {
    for (const c of ordered) {
      if (M.active.length >= 3) return;
      if (M.active.some((m) => m.metric === c.metric)) continue;
      if (respectCooldown && (M.cooldown[c.metric] ?? -1) > S.month) continue;
      M.active.push(makeMission(S, M, c));
    }
  };
  take(true);
  take(false);
}

// ---------- Effets ----------
/** Bilan politique (politics.ts, usure du pouvoir) gagné par point de difficulté d'une mission réussie ; un échec en retire 35 %. */
export const RECORD_PER_DIFFICULTY = 0.012;
function coalitionMood(S: GameState, d: number) {
  const P = S.politics;
  if (!P) return;
  for (const p of P.parties) if (P.coalition.includes(p.id)) p.mood = clamp(p.mood + d, -1, 1);
}
function notice(S: GameState, kind: Notice['kind'], title: string, text: string) {
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind, title, text });
  if (S.notices.length > 80) S.notices.shift();
}
function feedback(M: MissionsState, month: number, icon: string, text: string, kind: Feedback['kind']) {
  M.feedback.push({ id: M.feedbackSeq++, month, icon, text, kind });
  if (M.feedback.length > 24) M.feedback.splice(0, M.feedback.length - 24);
}
const money = (v: number) => (Math.abs(v) >= 1e9 ? `${nf(v / 1e9, 1)} Md€` : `${nf(v / 1e6)} M€`);
export function rewardLabel(r: Reward) {
  return `+${r.xp} XP · +${nf(r.trust, 1)} confiance · popularité ↑ · +${money(r.cash)}`;
}

function finish(S: GameState, M: MissionsState, m: Mission, ok: boolean) {
  m.status = ok ? 'reussie' : 'echouee';
  m.endMonth = S.month;
  M.active = M.active.filter((x) => x !== m);
  M.history.push(m);
  if (M.history.length > 40) M.history.splice(0, M.history.length - 40);
  M.cooldown[m.metric] = S.month + 6;
  if (ok) {
    M.won++; M.streak++; M.bestStreak = Math.max(M.bestStreak, M.streak);
    M.xp += m.reward.xp;
    S.satisfaction.trust = clamp(S.satisfaction.trust + m.reward.trust, 0, 100);
    coalitionMood(S, m.reward.mood);
    addRecord(S, RECORD_PER_DIFFICULTY * m.difficulty); // bilan : compense l'usure du pouvoir
    // dotation exceptionnelle comptabilisée en recette « divers » du mois (identité trésorerie = solde + emprunts préservée)
    addRevenue(S, 'divers', m.reward.cash * 12);
    const txt = `${m.title.replace(/ d'ici .*$/, '')} : objectif atteint (${METRICS[m.metric].fmt(m.value)}). Récompense : ${rewardLabel(m.reward)} (dotation exceptionnelle : crédits de la réserve de précaution débloqués).`;
    notice(S, 'good', `🎯 Mission réussie`, txt);
    feedback(M, S.month, '🎯', `Mission réussie : ${METRICS[m.metric].label} ${METRICS[m.metric].fmt(m.start)} → ${METRICS[m.metric].fmt(m.value)} (+${m.reward.xp} XP)`, 'mission');
  } else {
    M.failed++; M.streak = 0;
    S.satisfaction.trust = clamp(S.satisfaction.trust - m.penalty.trust, 0, 100);
    coalitionMood(S, -m.penalty.mood);
    addRecord(S, -RECORD_PER_DIFFICULTY * 0.35 * m.difficulty);
    notice(S, 'bad', 'Mission échouée', `${m.title} : échéance dépassée (${METRICS[m.metric].fmt(m.value)} pour une cible de ${METRICS[m.metric].fmt(m.target)}). Confiance −${nf(m.penalty.trust, 1)}, popularité en baisse.`);
  }
  M.yearLog.push({ month: S.month, label: `mission « ${METRICS[m.metric].label} » ${ok ? 'réussie' : 'échouée'}`, metrics: ['confiance'] });
}

// ---------- Retours « avant → après » ----------
const INFRA_METRICS: Partial<Record<InfraType, MetricId[]>> = {
  ecole: ['ecoles'], college: ['ecoles'], lycee: ['ecoles'], universite: ['universites'],
  hopital: ['capaciteSoins', 'attenteSoins'], clinique: ['capaciteSoins', 'attenteSoins'], centre_medical: ['capaciteSoins', 'attenteSoins'],
  logements_sociaux: ['attenteLogement', 'tensionLogement'], eco_quartier: ['tensionLogement', 'attenteLogement'], zone_residentielle: ['tensionLogement', 'attenteLogement'],
  commissariat: ['securite'], tribunal: ['securite'], prison: ['securite'], caserne_pompiers: ['securite'],
  zone_industrielle: ['chomage'], zone_commerciale: ['chomage'], usine: ['chomage'], centre_formation: ['chomage'],
  parc_eolien: ['renouvelable', 'margeElec'], parc_solaire: ['renouvelable', 'margeElec'], parc_eolien_mer: ['renouvelable', 'margeElec'],
  centrale_geothermique: ['renouvelable', 'margeElec'], centrale_biomasse: ['renouvelable', 'margeElec'], barrage: ['renouvelable', 'margeElec'],
  stockage_batteries: ['margeElec'], centrale_smr: ['margeElec', 'emissions'], centrale_nucleaire: ['margeElec', 'emissions'], centrale_gaz: ['margeElec'],
};
const INFRA_ICON: Partial<Record<InfraType, string>> = {
  ecole: '🏫', college: '🏫', lycee: '🏫', universite: '🎓', hopital: '🏥', clinique: '🏥', centre_medical: '🩺', logements_sociaux: '🏘️', eco_quartier: '🌿',
  zone_residentielle: '🏠', commissariat: '🚓', tribunal: '⚖️', prison: '🔒', caserne_pompiers: '🚒', zone_industrielle: '🏭', zone_commerciale: '🛍️', usine: '🏭',
  centre_formation: '🧑‍🏫', laboratoire: '🔬', parc_eolien: '🌬️', parc_solaire: '☀️', parc_eolien_mer: '🌊', centrale_geothermique: '🌋', centrale_biomasse: '🌿',
  barrage: '💧', stockage_batteries: '🔋', centrale_smr: '⚛️', centrale_nucleaire: '⚛️', centrale_gaz: '🔥',
};

/** Valeurs relevées au début du mois, avant tout calcul du tick. */
export interface MissionsPre {
  values: Partial<Record<MetricId, number>>;
  instant: Partial<Record<MetricId, number>>;
  status: Map<number, string>;
  publicSites: Set<number>; // sites des projets énergétiques publics (décidés par le joueur)
  pending: boolean;
  adopted: number;
  revenue: number;
  balanceRatio: number;
}
function readValues(S: GameState) {
  const values: Partial<Record<MetricId, number>> = {};
  const instant: Partial<Record<MetricId, number>> = {};
  for (const m of METRIC_IDS) {
    const v = val(S, m);
    if (v !== undefined) values[m] = v;
    const i = METRICS[m].instant?.(S);
    if (i !== undefined && Number.isFinite(i)) instant[m] = i; else if (v !== undefined) instant[m] = v;
  }
  return { values, instant };
}
export function missionsPre(S: GameState): MissionsPre {
  ensureMissions(S);
  const status = new Map<number, string>();
  for (const i of S.country.infra) status.set(i.id, i.status ?? 'active');
  const publicSites = new Set<number>();
  for (const p of S.energy?.projects ?? []) if (p.public && p.kind === 'build' && p.infraId !== undefined) publicSites.add(p.infraId);
  return { ...readValues(S), status, publicSites, pending: !!S.pending, adopted: S.politics?.adopted ?? 0, revenue: S.accounts.revenueTotal, balanceRatio: S.accounts.balance / Math.max(1, S.accounts.gdp) };
}

const capTxt = (v: number, unit: string) => `+${nf(v)} ${unit}`.trim();

// ---------- Pas mensuel ----------
export function missionsStep(S: GameState, pre: MissionsPre) {
  const M = ensureMissions(S);
  const { values, instant } = readValues(S);

  // 1. Équipements décidés par le joueur mis en service ce mois (les investissements privés ne sont pas comptés) :
  //    retour immédiat et suivi à 3 mois
  const activated = S.country.infra.filter((i) => {
    const was = pre.status.get(i.id);
    return (was === 'chantier' || was === 'construction') && (!i.status || i.status === 'active') && (i.custom || pre.publicSites.has(i.id));
  });
  for (const inf of activated.slice(0, 6)) {
    const icon = INFRA_ICON[inf.type] ?? '🏗️';
    const ms = (INFRA_METRICS[inf.type] ?? []).filter((m) => pre.instant[m] !== undefined && instant[m] !== undefined);
    const m = ms[0];
    const cap = inf.capacity > 0 ? ` : ${capTxt(inf.capacity, inf.capacityUnit)}` : '';
    const delta = m ? ` → ${METRICS[m].label.toLowerCase()} ${METRICS[m].fmt(pre.instant[m]!)} → ${METRICS[m].fmt(instant[m]!)}` : '';
    feedback(M, S.month, icon, `${inf.name} en service${cap}${delta}`, 'chantier');
    if (m && values[m] !== undefined) M.followups.push({ due: S.month + 3, icon, label: inf.name, metric: m, before: pre.values[m] ?? values[m]! });
    M.yearLog.push({ month: S.month, label: `mise en service de ${inf.name}`, metrics: INFRA_METRICS[inf.type] ?? [] });
  }
  if (activated.length > 6) feedback(M, S.month, '🏗️', `${activated.length - 6} autres équipements mis en service ce mois-ci`, 'chantier');

  // 2. Réformes entrées en vigueur (décrets du mois précédent ou lois adoptées par le parlement)
  const lawPassed = (S.politics?.adopted ?? 0) > pre.adopted;
  if ((pre.pending && !S.pending) || lawPassed) {
    const rev = `recettes ${nf(pre.revenue / 1e9, 1)} → ${nf(S.accounts.revenueTotal / 1e9, 1)} Md€/an`;
    const bal = `solde ${nf(pre.balanceRatio * 100, 1)} % → ${nf((S.accounts.balance / Math.max(1, S.accounts.gdp)) * 100, 1)} % du PIB`;
    const sat = pre.values.satisfaction !== undefined ? ` · satisfaction ${nf(pre.values.satisfaction, 1)} → ${nf(values.satisfaction ?? 0, 1)}/100` : '';
    feedback(M, S.month, '📜', `Réformes en vigueur : ${rev} · ${bal}${sat}`, 'reforme');
    for (const m of ['satisfaction', 'chomage'] as MetricId[]) if (pre.values[m] !== undefined) M.followups.push({ due: S.month + 3, icon: '📜', label: 'Réformes', metric: m, before: pre.values[m]! });
    M.yearLog.push({ month: S.month, label: lawPassed ? 'loi adoptée par le parlement' : 'réformes entrées en vigueur', metrics: ['satisfaction', 'confiance', 'deficit', 'dette', 'chomage', 'pauvrete'] });
  }

  // 3. Suivis à trois mois
  const due = M.followups.filter((f) => f.due <= S.month);
  M.followups = M.followups.filter((f) => f.due > S.month).slice(-20);
  for (const f of due) {
    const v = values[f.metric];
    if (v === undefined) continue;
    feedback(M, S.month, f.icon, `3 mois après — ${f.label} : ${METRICS[f.metric].label.toLowerCase()} ${METRICS[f.metric].fmt(f.before)} → ${METRICS[f.metric].fmt(v)}`, 'suivi');
  }

  // 4. Avancement des missions, réussites et échecs
  for (const m of [...M.active]) {
    const v = values[m.metric];
    if (v === undefined) { if (S.month >= m.deadline) finish(S, M, m, false); continue; }
    m.value = v;
    const span = m.target - m.start;
    m.progress = Math.abs(span) < 1e-12 ? 1 : clamp((v - m.start) / span, 0, 1);
    if (reached(m.metric, v, m.target)) { m.progress = 1; finish(S, M, m, true); }
    else if (S.month >= m.deadline) finish(S, M, m, false);
  }
  refill(S, M);

  // 5. Records (petits gains d'expérience quand un indicateur clé bat son meilleur niveau du mandat)
  const STEP: Partial<Record<MetricId, number>> = { chomage: 0.002, renouvelable: 0.01, satisfaction: 1, dette: 0.01 };
  for (const [k, step] of Object.entries(STEP) as [MetricId, number][]) {
    const v = values[k];
    const best = M.records[k];
    if (v === undefined) continue;
    if (best === undefined) { M.records[k] = v; continue; }
    const better = METRICS[k].dir === 'min' ? best - v >= step : v - best >= step;
    if (better) { M.records[k] = v; M.xp += 10; }
  }
  const em = values.emissions;
  if (em !== undefined && S.month >= 12) {
    const best = M.records.emissions ?? em;
    if (best - em >= best * 0.01) { M.records.emissions = em; M.xp += 10; }
  }

  // 6. Trophées
  const ctx: TrophyCtx = { S, M, activated };
  for (const t of TROPHIES) {
    if (M.trophies[t.id] !== undefined) continue;
    let ok = false;
    try { ok = t.test(ctx); } catch { ok = false; }
    if (!ok) continue;
    M.trophies[t.id] = S.month;
    M.xp += t.xp;
    notice(S, 'good', `${t.icon} Trophée : ${t.name}`, `${t.desc} (+${t.xp} XP)`);
    feedback(M, S.month, t.icon, `Trophée débloqué : ${t.name} (+${t.xp} XP)`, 'trophee');
  }
  announcePromotion(S, M);

  // 7. Bilan annuel (janvier) et nouveaux repères de l'année
  if (S.month > 0 && S.month % 12 === 0) yearReview(S, M, reviewValues(S));
  if (M.yearLog.length > 60) M.yearLog.splice(0, M.yearLog.length - 60);
}

/** Annonce chaque promotion (changement de titre) une seule fois. */
function announcePromotion(S: GameState, M: MissionsState) {
  const cur = titleOf(M.xp).index;
  if (M.titleIndex === undefined) M.titleIndex = cur;
  for (let k = M.titleIndex + 1; k <= cur; k++) {
    notice(S, 'good', '🎖️ Promotion', `Vous êtes désormais ${TITLES[k].name}.`);
    feedback(M, S.month, '🎖️', `Promotion : vous êtes désormais ${TITLES[k].name}`, 'trophee');
  }
  M.titleIndex = Math.max(M.titleIndex, cur);
}

/** Valeurs comparées d'un janvier à l'autre : valeur instantanée pour les indicateurs saisonniers. */
function reviewValues(S: GameState) {
  const { values, instant } = readValues(S);
  const r: Partial<Record<MetricId, number>> = { ...values };
  for (const m of METRIC_IDS) if (METRICS[m].instant && instant[m] !== undefined) r[m] = instant[m];
  return r;
}

function yearReview(S: GameState, M: MissionsState, values: Partial<Record<MetricId, number>>) {
  const year = S.startYear + S.month / 12 - 1;
  const Y = M.yearStart;
  const ROWS: MetricId[] = ['emissions', 'pib', 'chomage', 'satisfaction', 'dette', 'renouvelable', 'deficit', 'confiance'];
  const rows: ReviewRow[] = [];
  for (const m of ROWS) {
    const a = Y.values[m], b = values[m];
    if (a === undefined || b === undefined) continue;
    const d = b - a;
    const better = Math.abs(d) < METRICS[m].scale(a) * 0.25 ? null : METRICS[m].dir === 'max' ? d > 0 : d < 0; // stable = neutre
    rows.push({ metric: m, label: METRICS[m].label, start: a, end: b, startTxt: METRICS[m].fmt(a), endTxt: METRICS[m].fmt(b), better });
  }
  const growth = S.history.growth?.at(-1) ?? 0;
  const yearLog = M.yearLog.filter((e) => e.month > Y.month && e.month <= S.month);
  const moves = METRIC_IDS.filter((m) => m !== 'pib').map((m: MetricId) => {
    const a = Y.values[m], b = values[m];
    if (a === undefined || b === undefined) return null;
    const n = (b - a) / Math.max(1e-9, METRICS[m].scale(a));
    return Math.abs(n) >= 1 ? { m, a, b, n } : null;
  }).filter((x): x is { m: MetricId; a: number; b: number; n: number } => !!x)
    .sort((x, y) => Math.abs(y.n) - Math.abs(x.n)).slice(0, 4)
    .map(({ m, a, b }) => {
      const better = METRICS[m].dir === 'max' ? b > a : b < a;
      const related = yearLog.filter((e) => e.metrics.includes(m));
      let cause: string;
      if (related.length) {
        const labels = [...new Set(related.map((e) => e.label))];
        cause = labels.length > 2 ? `${labels.slice(-2).join(', ')} et ${labels.length - 2} autre(s) décision(s)` : labels.join(', ');
      } else if (m === 'dette' || m === 'deficit') cause = `solde public de ${nf((S.accounts.balance / Math.max(1, S.accounts.gdp)) * 100, 1)} % du PIB et croissance de ${nf(growth * 100, 1)} %`;
      else if (m === 'chomage' || m === 'pauvrete') cause = `conjoncture : croissance de ${nf(growth * 100, 1)} %, inflation de ${nf(S.macro.inflation * 100, 1)} %`;
      else if (m === 'emissions' || m === 'air') cause = `évolution du mix énergétique (${nf((S.energy?.elecRenShare ?? 0) * 100, 0)} % renouvelable) et de l'activité`;
      else if (m === 'attenteSoins' || m === 'capaciteSoins') cause = 'vieillissement de la population et moyens du système de soins';
      else cause = 'évolution spontanée de la société et de l\'économie (aucune décision directe identifiée)';
      return { label: METRICS[m].label, icon: METRICS[m].icon, text: `${METRICS[m].fmt(a)} → ${METRICS[m].fmt(b)}`, better, cause };
    });
  const trophies = TROPHIES.filter((t) => { const mo = M.trophies[t.id]; return mo !== undefined && mo > Y.month && mo <= S.month; }).map((t) => `${t.icon} ${t.name}`);
  M.review = { year, month: S.month, rows, moves, won: M.won - Y.won, failed: M.failed - Y.failed, xp: M.xp - Y.xp, trophies, title: titleOf(M.xp).name };
  M.yearStart = { month: S.month, values: { ...values }, won: M.won, failed: M.failed, xp: M.xp };
}
