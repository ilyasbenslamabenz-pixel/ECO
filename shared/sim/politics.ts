// Moteur politique : partis, parlement, coalition, groupes d'intérêt (syndicats, associations, patronat),
// couche législative (décrets / projets de loi et votes), élections tous les 4 ans, motion de censure.
// Tout est déterministe : les seuls aléas proviennent de `mulberry32` initialisé par la graine de la partie.
import { hashString, mulberry32 } from '../noise';
import { BUDGET_LINES, CATEGORY_IDS, type BudgetLine, type CategoryId } from './data';
import { clamp } from './economy';
import type { GameState, Policy } from './types';

// ---------- Partis ----------
export const PARTY_IDS = ['ecologistes', 'sociaux_democrates', 'centristes', 'liberaux', 'conservateurs'] as const;
export type PartyId = (typeof PARTY_IDS)[number];

/** Positions idéologiques sur trois axes : [gauche (+) / droite (−), écologie (+), protection-souveraineté (+) / libre-échange (−)]. */
export type Axes = [number, number, number];
export const AXIS_NAMES = ['Gauche / droite', 'Écologie', 'Protection / libre-échange'] as const;

export interface PartyDef {
  id: PartyId;
  name: string;
  short: string;
  color: string;
  pos: Axes;
  priorities: string[];
}

export const PARTIES: PartyDef[] = [
  { id: 'ecologistes', name: 'Les Écologistes', short: 'ÉCO', color: '#2a9d4b', pos: [0.5, 1, 0.2], priorities: ['Baisse des émissions', 'Transports publics', 'Fiscalité écologique', 'Qualité de l\'air'] },
  { id: 'sociaux_democrates', name: 'Parti social-démocrate', short: 'SD', color: '#e04f6a', pos: [0.7, 0.3, 0.3], priorities: ['Emploi et salaires', 'Retraites', 'Services publics', 'Réduction des inégalités'] },
  { id: 'centristes', name: 'Mouvement centriste', short: 'CEN', color: '#f2b134', pos: [0, 0.3, -0.2], priorities: ['Équilibre budgétaire', 'Stabilité', 'Éducation', 'Europe et commerce'] },
  { id: 'liberaux', name: 'Alliance libérale', short: 'LIB', color: '#3fa7d6', pos: [-0.8, 0, -0.8], priorities: ['Baisse des impôts', 'Compétitivité', 'Libre-échange', 'Dette maîtrisée'] },
  { id: 'conservateurs', name: 'Union conservatrice', short: 'CON', color: '#3b4d9b', pos: [-0.5, -0.4, 0.6], priorities: ['Sécurité', 'Pouvoir d\'achat', 'Souveraineté', 'Agriculture'] },
];
export const PARTY_INDEX = Object.fromEntries(PARTIES.map((p, i) => [p.id, i])) as Record<PartyId, number>;

// Affinité électorale de chaque catégorie pour chaque parti (ordre de PARTY_IDS, lignes normalisées à 1).
const AFFINITY: Partial<Record<CategoryId, number[]>> = {
  etudiants: [0.3, 0.25, 0.17, 0.13, 0.15],
  cadres: [0.14, 0.2, 0.26, 0.26, 0.14],
  employes: [0.12, 0.32, 0.2, 0.12, 0.24],
  ouvriers: [0.06, 0.34, 0.12, 0.1, 0.38],
  independants: [0.06, 0.12, 0.22, 0.3, 0.3],
  entrepreneurs: [0.04, 0.08, 0.22, 0.44, 0.22],
  retraites: [0.07, 0.24, 0.2, 0.14, 0.35],
  chomeurs: [0.14, 0.38, 0.12, 0.08, 0.28],
  inactifs: [0.1, 0.28, 0.18, 0.12, 0.32],
};

// ---------- Groupes d'intérêt ----------
export interface InterestGroupDef { id: string; name: string; kind: 'syndicat' | 'association' | 'patronat' | 'economique'; pos: Axes; base: Partial<Record<CategoryId, number>>; icon: string }
export const INTEREST_GROUPS: InterestGroupDef[] = [
  { id: 'cgt', name: 'Confédération générale des travailleurs', kind: 'syndicat', icon: '✊', pos: [1, 0.2, 0.3], base: { ouvriers: 0.6, employes: 0.4 } },
  { id: 'reformistes', name: 'Union des syndicats réformistes', kind: 'syndicat', icon: '🤝', pos: [0.5, 0.3, 0], base: { employes: 0.5, cadres: 0.5 } },
  { id: 'patronat', name: 'Mouvement des entreprises', kind: 'patronat', icon: '💼', pos: [-1, 0, -0.4], base: { entrepreneurs: 0.7, independants: 0.3 } },
  { id: 'agriculteurs', name: 'Fédération des exploitants agricoles', kind: 'economique', icon: '🚜', pos: [-0.2, -0.5, 1], base: { independants: 1 } },
  { id: 'climat', name: 'Réseau Action Climat', kind: 'association', icon: '🌍', pos: [0.3, 1, 0], base: { etudiants: 1 } },
  { id: 'retraites', name: 'Association nationale des retraités', kind: 'association', icon: '👵', pos: [0.5, 0, 0.2], base: { retraites: 1 } },
  { id: 'locataires', name: 'Confédération nationale du logement', kind: 'association', icon: '🏠', pos: [0.7, 0.2, 0], base: { employes: 0.5, chomeurs: 0.5 } },
];

// ---------- Lois ----------
export type LawCategory = 'fiscal' | 'climat' | 'retraites' | 'sante' | 'travail' | 'logement' | 'transports' | 'commerce' | 'budget';
export const LAW_CATEGORY_NAMES: Record<LawCategory, string> = {
  fiscal: 'Loi fiscale', climat: 'Loi climat', retraites: 'Réforme des retraites', sante: 'Loi santé', travail: 'Loi travail',
  logement: 'Loi logement', transports: 'Loi transports', commerce: 'Loi commerciale', budget: 'Loi de finances rectificative',
};

export interface PartyVote { party: PartyId; yes: number; no: number; abstention: number }

export interface Bill {
  id: number;
  title: string;
  category: LawCategory;
  groups: string[]; // groupes de mesures concernés
  summary: string[]; // description chiffrée des mesures
  patch: Record<string, unknown>; // valeurs proposées par groupe de mesures
  vector: Axes; // orientation politique du texte
  submitted: number;
  voteMonth: number;
  status: 'en_debat' | 'adoptee' | 'rejetee' | 'retiree';
  votes?: PartyVote[];
  yes?: number;
  no?: number;
  abstention?: number;
}

export interface PartyState { id: PartyId; popularity: number; seats: number; mood: number }
export interface InterestGroupState { id: string; support: number; mood: number }
/** Résultat d'un arrondissement / quartier de la cité-État (entrée de `country.cities`). */
export interface DistrictResult { id: number; name: string; voters: number; shares: Record<PartyId, number>; winner: PartyId }
export interface ElectionResult { month: number; shares: Record<PartyId, number>; seats: Record<PartyId, number>; coalitionSeats: number; outcome: 'majorite' | 'coalition_elargie' | 'cohabitation' | 'defaite'; text: string; anticipated: boolean; districts?: DistrictResult[] }

export interface PoliticsState {
  parties: PartyState[];
  seatsTotal: number;
  leader: PartyId; // parti du joueur
  coalition: PartyId[]; // partis du camp gouvernemental du joueur
  /** camp avec lequel le joueur se présente aux élections (les partenaires ajoutés en cours de législature n'en font pas partie) */
  core?: PartyId[];
  /** bilan : résultats engrangés (missions réussies, jalons climat) qui compensent l'usure du pouvoir (voir governmentWear) */
  record?: number;
  majority: PartyId[]; // coalition majoritaire au parlement (différente du camp du joueur en cohabitation)
  mode: 'majorite' | 'minorite' | 'cohabitation';
  discipline: number; // 0..1, discipline de vote de la coalition
  confidenceBonus: number; // bonus temporaire après une question de confiance gagnée
  lastElection: number;
  nextElection: number;
  elections: ElectionResult[];
  electionsWon: number;
  bills: Bill[];
  billSeq: number;
  adopted: number;
  rejected: number;
  groups: InterestGroupState[];
  lowTrustMonths: number;
  lastMotion: number;
  motions: { month: number; kind: 'censure' | 'confiance'; yes: number; no: number; passed: boolean }[];
  ref: { sat: Record<string, number>; factors: Record<string, number>; trust: number; u: number };
  defeated: null | { month: number; reason: string };
}

export const SEATS_TOTAL = 350;
export const ELECTION_INTERVAL = 48; // mois
export const ELECTORAL_THRESHOLD = 0.05;
/**
 * Usure du pouvoir : chaque année de mandat retire `WEAR_PER_YEAR` au logarithme du poids électoral du camp du chef du
 * gouvernement, diminué du bilan (`record` : missions réussies, jalons climat atteints ; les échecs le réduisent), le tout
 * borné à [0, WEAR_MAX]. Sans résultats, une majorité s'érode et perd les élections au bout de deux ou trois mandats ;
 * un bilan solide la compense en grande partie.
 */
export const WEAR_PER_YEAR = 0.04;
export const WEAR_MAX = 0.5;
/** Une coalition battue ne peut s'élargir à un partenaire que si elle garde au moins cette part des sièges. */
export const ENLARGE_MIN_SHARE = 0.44;
export function governmentWear(S: Pick<GameState, 'month' | 'politics'>) {
  return clamp((WEAR_PER_YEAR * Math.max(0, S.month)) / 12 - (S.politics?.record ?? 0), 0, WEAR_MAX);
}
/** Ajoute (ou retire) au bilan du gouvernement. */
export function addRecord(S: GameState, d: number) {
  const P = S.politics;
  if (P) P.record = clamp((P.record ?? 0) + d, -0.5, 2);
}

// ---------- Outils ----------
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const norm = (v: Axes) => Math.hypot(v[0], v[1], v[2]);
const dist = (a: Axes, b: Axes) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Adhésion d'un acteur (position `pos`) à un texte d'orientation `v` : produit scalaire avec la direction du texte. */
export function stance(pos: Axes, v: Axes): number {
  const n = norm(v);
  if (n < 1e-9) return 0;
  return (pos[0] * v[0] + pos[1] * v[1] + pos[2] * v[2]) / n;
}
const partyDef = (id: PartyId) => PARTIES[PARTY_INDEX[id]];
const pushNote = (S: GameState, kind: 'info' | 'warn' | 'good' | 'bad', title: string, text: string) => {
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind, title, text });
  if (S.notices.length > 80) S.notices.shift();
};
const pctf = (v: number, d = 1) => `${(v * 100).toFixed(d).replace('.', ',')} %`;
const unemploymentOf = (S: GameState) => S.demography.unemployed / Math.max(1, S.demography.labourForce);

function rngFor(S: GameState, tag: string) {
  return mulberry32(hashString(`${S.country.seed}|${tag}`));
}

/** Répartition des sièges à la proportionnelle (plus forte moyenne, méthode d'Hondt) avec seuil de 5 %. */
export function allocateSeats(shares: Record<PartyId, number>, total = SEATS_TOTAL, threshold = ELECTORAL_THRESHOLD): Record<PartyId, number> {
  const seats = Object.fromEntries(PARTY_IDS.map((p) => [p, 0])) as Record<PartyId, number>;
  const eligible = PARTY_IDS.filter((p) => shares[p] >= threshold);
  const list = eligible.length ? eligible : [...PARTY_IDS];
  for (let k = 0; k < total; k++) {
    let best = list[0];
    let bestQ = -1;
    for (const p of list) {
      const q = shares[p] / (seats[p] + 1);
      if (q > bestQ + 1e-12) { bestQ = q; best = p; }
    }
    seats[best]++;
  }
  return seats;
}

export function seatsOf(P: PoliticsState, ids: PartyId[]) {
  return P.parties.filter((p) => ids.includes(p.id)).reduce((s, p) => s + p.seats, 0);
}

/** Forme une coalition autour d'un parti en ajoutant les partis les plus proches jusqu'à la majorité absolue. */
export function formCoalition(seats: Record<PartyId, number>, leader: PartyId, total = SEATS_TOTAL, maxDistance = 1.25): PartyId[] {
  const coal: PartyId[] = [leader];
  let s = seats[leader];
  const others = PARTY_IDS.filter((p) => p !== leader && seats[p] > 0)
    .map((p) => ({ p, d: dist(partyDef(leader).pos, partyDef(p).pos) }))
    .sort((a, b) => a.d - b.d);
  for (const o of others) {
    if (s > total / 2) break;
    if (o.d > maxDistance) break;
    coal.push(o.p);
    s += seats[o.p];
  }
  return coal;
}

// ---------- Popularité ----------
/**
 * Intentions de vote (parts, somme = 1) calculées à partir :
 * - de la satisfaction de chaque catégorie (écart à la référence initiale) pondérée par ses effectifs : une catégorie
 *   satisfaite renforce les partis du camp gouvernemental, une catégorie mécontente renforce l'opposition ;
 * - des indicateurs économiques (croissance, inflation, chômage) imputés au gouvernement ;
 * - des enjeux saillants (environnement → écologistes, inégalités/emploi → sociaux-démocrates, impôts → libéraux,
 *   sécurité/stabilité → conservateurs, confiance → centristes) ;
 * - des décisions du gouvernement (humeur `mood` de chaque électorat, modifiée par les lois adoptées).
 */
export function computePopularity(S: GameState): Record<PartyId, number> {
  const P = S.politics!;
  const sat = S.satisfaction.byCategory;
  const f = S.satisfaction.factors;
  const n = S.demography.categories;
  const gov = new Set(P.coalition);
  const growth = S.history.growth?.at(-1) ?? 0.012;
  const infl = S.macro.inflation;
  const u = unemploymentOf(S);
  const econ = 3 * (growth - 0.012) - 4 * Math.max(0, infl - 0.03) - 3 * (u - P.ref.u);
  const raw = PARTY_IDS.map(() => 0);
  for (const c of CATEGORY_IDS) {
    const aff = AFFINITY[c];
    if (!aff) continue;
    const count = n[c] || 0;
    const d = ((sat[c] ?? 55) - (P.ref.sat[c] ?? 55)) / 15 + econ;
    const w = aff.map((a, k) => a * Math.exp(gov.has(PARTY_IDS[k]) ? 0.5 * d : -0.25 * d));
    const ws = w.reduce((s, v) => s + v, 0);
    w.forEach((v, k) => (raw[k] += (count * v) / ws));
  }
  const fr = (k: string) => (P.ref.factors[k] ?? 55) - (f[k] ?? P.ref.factors[k] ?? 55);
  const issue: Record<PartyId, number> = {
    ecologistes: fr('environnement') / 25,
    sociaux_democrates: fr('inegalites') / 30 + fr('emploi') / 40,
    centristes: (S.satisfaction.trust - P.ref.trust) / 40,
    liberaux: fr('fiscalite') / 30,
    conservateurs: fr('securite') / 30 + fr('stabilite') / 40 + fr('pouvoirAchat') / 60,
  };
  // l'usure frappe le camp du chef du gouvernement (les partenaires de législature n'en portent pas la responsabilité)
  const wear = governmentWear(S);
  const camp = new Set(P.core ?? P.coalition);
  PARTY_IDS.forEach((p, k) => { raw[k] *= Math.exp(issue[p] + 0.6 * P.parties[k].mood - (camp.has(p) ? wear : 0)); });
  const tot = raw.reduce((s, v) => s + v, 0) || 1;
  return Object.fromEntries(PARTY_IDS.map((p, k) => [p, raw[k] / tot])) as Record<PartyId, number>;
}

export function initPolitics(S: GameState): PoliticsState {
  const ref = { sat: { ...S.satisfaction.byCategory }, factors: { ...S.satisfaction.factors }, trust: S.satisfaction.trust, u: unemploymentOf(S) };
  const P: PoliticsState = {
    parties: PARTY_IDS.map((id) => ({ id, popularity: 0.2, seats: 0, mood: 0 })),
    seatsTotal: SEATS_TOTAL, leader: 'centristes', coalition: [], majority: [], mode: 'majorite', discipline: 0.8, confidenceBonus: 0,
    lastElection: 0, nextElection: ELECTION_INTERVAL, elections: [], electionsWon: 0, bills: [], billSeq: 1, adopted: 0, rejected: 0,
    groups: INTEREST_GROUPS.map((g) => ({ id: g.id, support: 50, mood: 0 })),
    lowTrustMonths: 0, lastMotion: -999, motions: [], ref, defeated: null,
  };
  S.politics = P;
  const shares = computePopularity(S);
  const seats = allocateSeats(shares);
  P.parties.forEach((p) => { p.popularity = shares[p.id]; p.seats = seats[p.id]; });
  P.coalition = formCoalition(seats, P.leader);
  P.core = [...P.coalition];
  P.majority = [...P.coalition];
  P.mode = seatsOf(P, P.coalition) > SEATS_TOTAL / 2 ? 'majorite' : 'minorite';
  P.discipline = disciplineOf(S, P);
  updateGroups(S, P);
  return P;
}

function disciplineOf(S: GameState, P: PoliticsState) {
  return clamp(0.55 + 0.012 * (S.satisfaction.trust - 40) + P.confidenceBonus, 0.25, 1);
}

function updateGroups(S: GameState, P: PoliticsState) {
  const sat = S.satisfaction.byCategory;
  for (const g of P.groups) {
    const def = INTEREST_GROUPS.find((d) => d.id === g.id)!;
    let d = 0;
    let w = 0;
    for (const [c, k] of Object.entries(def.base) as [CategoryId, number][]) { d += k * ((sat[c] ?? 55) - (P.ref.sat[c] ?? 55)); w += k; }
    d /= Math.max(1e-9, w);
    if (g.id === 'climat') d += 0.5 * ((S.satisfaction.factors.environnement ?? 0) - (P.ref.factors.environnement ?? 0));
    g.support = clamp(50 + 1.5 * d + 40 * g.mood, 0, 100);
    g.mood *= 0.985;
  }
}

export function groupSupport(S: GameState, id: string): number {
  return S.politics?.groups.find((g) => g.id === id)?.support ?? 50;
}
export function bumpGroup(S: GameState, id: string, d: number) {
  const g = S.politics?.groups.find((x) => x.id === id);
  if (g) g.mood = clamp(g.mood + d, -1, 1);
}
export function bumpParty(S: GameState, id: PartyId, d: number) {
  const p = S.politics?.parties.find((x) => x.id === id);
  if (p) p.mood = clamp(p.mood + d, -1, 1);
}

// ---------- Classification des réformes ----------
/** Seuils au-delà desquels un changement est une réforme majeure (projet de loi soumis au parlement). */
export const LAW_THRESHOLDS: { group: string; text: string }[] = [
  { group: 'TVA', text: 'un taux (normal, réduit, spécial) varie d\'au moins 2 points, ou au moins 2 catégories changent de taux' },
  { group: 'Impôt sur le revenu', text: 'un taux de tranche varie d\'au moins 3 points, le nombre de tranches change, un seuil bouge de 10 % ou plus, le prélèvement sur le capital de 5 points, un crédit d\'impôt de 500 € ou plus' },
  { group: 'Impôt sur les sociétés', text: 'taux normal ou PME ±3 points, crédits d\'impôt ±5 points, surtaxe polluante ±3 points' },
  { group: 'Impôt sur le patrimoine', text: 'création ou suppression de l\'impôt, taux ±0,5 point, seuil ±30 %' },
  { group: 'Fiscalité immobilière', text: 'taxe foncière ±0,2 point, droits de mutation ±2 points, taxe sur les logements vacants ±2 points, taxes locales ±25 %' },
  { group: 'Fiscalité écologique', text: 'création d\'une taxe, carbone ou émissions industrielles ±30 €/t, carburants ±10 points, déchets ±30 €/t, véhicules ±200 €' },
  { group: 'Cotisations sociales', text: 'un taux de cotisation varie d\'au moins 2 points' },
  { group: 'Retraites', text: 'tout changement de l\'âge légal (≥ 6 mois) ou du taux de remplacement ±3 points' },
  { group: 'Droit du travail', text: 'SMIC ±5 %, durée légale ±1 h, allocations chômage ±5 points ou ±6 mois, aide à l\'embauche ±1 000 €, allocations familiales ±25 %' },
  { group: 'Budget', text: 'une ligne budgétaire varie d\'au moins 10 %' },
  { group: 'Droits de douane', text: 'création de droits de douane ou variation d\'au moins 3 points' },
];

interface ChangeGroup {
  id: string;
  label: string;
  category: (a: Policy, b: Policy) => LawCategory;
  get: (p: Policy) => unknown;
  set: (p: Policy, v: unknown) => void;
  major: (a: Policy, b: Policy) => boolean;
  vector: (a: Policy, b: Policy) => Axes;
  describe: (a: Policy, b: Policy) => string[];
}

const sgn = (v: number) => (v > 1e-12 ? 1 : v < -1e-12 ? -1 : 0);
const rel = (a: number, b: number) => Math.abs(b - a) / Math.max(1e-9, Math.abs(a));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function deepEq(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-9);
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
const fmtP = (v: number) => pctf(v, 1);
const fmtE = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} €`;
const arrow = (label: string, a: string, b: string) => `${label} : ${a} → ${b}`;

const BUDGET_LAW: Record<BudgetLine, { cat: LawCategory; v: Axes; name: string }> = {
  sante: { cat: 'sante', v: [0.6, 0, 0], name: 'Budget de la santé' },
  education: { cat: 'budget', v: [0.4, 0, 0], name: 'Budget de l\'éducation' },
  securite: { cat: 'budget', v: [-0.2, 0, 0.5], name: 'Budget sécurité & justice' },
  defense: { cat: 'budget', v: [-0.3, 0, 0.6], name: 'Budget de la défense' },
  transports: { cat: 'transports', v: [0.3, 0.6, 0], name: 'Budget des transports publics' },
  infrastructures: { cat: 'transports', v: [0.2, 0, 0.1], name: 'Budget des infrastructures' },
  environnement: { cat: 'climat', v: [0.1, 1, 0], name: 'Budget de l\'environnement' },
  administration: { cat: 'budget', v: [0.3, 0, 0], name: 'Budget de l\'administration' },
  logement: { cat: 'logement', v: [0.6, 0, 0], name: 'Aides au logement' },
  subventions: { cat: 'budget', v: [0, 0, 0.4], name: 'Subventions aux entreprises' },
  recherche: { cat: 'budget', v: [0.1, 0.2, 0], name: 'Budget de la recherche' },
  formation: { cat: 'budget', v: [0.3, 0, 0], name: 'Budget de la formation' },
};

const scale = (v: Axes, k: number): Axes => [v[0] * k, v[1] * k, v[2] * k];

const RET_KEYS = ['retirementAge', 'pensionRate'] as const;
const WORK_KEYS = ['minWage', 'hours', 'hiringAid', 'benefitRate', 'benefitMonths', 'familyAllowance'] as const;

export const CHANGE_GROUPS: ChangeGroup[] = [
  {
    id: 'tva', label: 'TVA', category: () => 'fiscal',
    get: (p) => p.vat, set: (p, v) => { p.vat = clone(v as Policy['vat']); },
    major: (a, b) => {
      const dr = Math.max(Math.abs(b.vat.normal - a.vat.normal), Math.abs(b.vat.reduit - a.vat.reduit), Math.abs(b.vat.special - a.vat.special));
      const cls = Object.keys(a.vat.classes).filter((k) => a.vat.classes[k as keyof Policy['vat']['classes']] !== b.vat.classes[k as keyof Policy['vat']['classes']]).length;
      return dr >= 0.02 - 1e-9 || cls >= 2;
    },
    vector: (a, b) => [-0.3 * sgn(b.vat.normal - a.vat.normal + 0.5 * (b.vat.reduit - a.vat.reduit) + 0.5 * (b.vat.special - a.vat.special)), 0, 0],
    describe: (a, b) => {
      const out: string[] = [];
      if (a.vat.normal !== b.vat.normal) out.push(arrow('TVA normale', fmtP(a.vat.normal), fmtP(b.vat.normal)));
      if (a.vat.reduit !== b.vat.reduit) out.push(arrow('TVA réduite', fmtP(a.vat.reduit), fmtP(b.vat.reduit)));
      if (a.vat.special !== b.vat.special) out.push(arrow('TVA spéciale', fmtP(a.vat.special), fmtP(b.vat.special)));
      if (!deepEq(a.vat.classes, b.vat.classes)) out.push('Reclassement de catégories de TVA');
      return out;
    },
  },
  {
    id: 'impot_revenu', label: 'Impôt sur le revenu', category: () => 'fiscal',
    get: (p) => p.incomeTax, set: (p, v) => { p.incomeTax = clone(v as Policy['incomeTax']); },
    major: (a, b) => {
      const A = a.incomeTax, B = b.incomeTax;
      if (A.brackets.length !== B.brackets.length) return true;
      for (let i = 0; i < A.brackets.length; i++) {
        if (Math.abs(A.brackets[i].rate - B.brackets[i].rate) >= 0.03 - 1e-9) return true;
        const ua = A.brackets[i].upTo, ub = B.brackets[i].upTo;
        if ((ua === null) !== (ub === null)) return true;
        if (ua !== null && ub !== null && rel(ua, ub) >= 0.1) return true;
      }
      return Math.abs(A.capitalRate - B.capitalRate) >= 0.05 - 1e-9 || Math.abs(A.taxCredit - B.taxCredit) >= 500 || Math.abs(A.activityCredit - B.activityCredit) >= 500
        || Math.abs(A.deductionRate - B.deductionRate) >= 0.05 - 1e-9 || Math.abs(A.childDeduction - B.childDeduction) >= 1000;
    },
    vector: (a, b) => {
      const A = a.incomeTax, B = b.incomeTax;
      let d = 0;
      for (let i = 0; i < Math.min(A.brackets.length, B.brackets.length); i++) d += B.brackets[i].rate - A.brackets[i].rate;
      d += B.capitalRate - A.capitalRate - (B.taxCredit - A.taxCredit + B.activityCredit - A.activityCredit) / 5000 - (B.deductionRate - A.deductionRate);
      return [0.8 * sgn(d), 0, 0];
    },
    describe: (a, b) => {
      const out: string[] = [];
      const A = a.incomeTax, B = b.incomeTax;
      if (A.brackets.length !== B.brackets.length) out.push(`Barème : ${A.brackets.length} → ${B.brackets.length} tranches`);
      else A.brackets.forEach((br, i) => { if (Math.abs(br.rate - B.brackets[i].rate) > 1e-9) out.push(arrow(`Taux de la tranche ${i + 1}`, fmtP(br.rate), fmtP(B.brackets[i].rate))); });
      if (A.capitalRate !== B.capitalRate) out.push(arrow('Prélèvement sur le capital', fmtP(A.capitalRate), fmtP(B.capitalRate)));
      if (A.taxCredit !== B.taxCredit) out.push(arrow('Crédit d\'impôt', fmtE(A.taxCredit), fmtE(B.taxCredit)));
      if (A.activityCredit !== B.activityCredit) out.push(arrow('Crédit d\'activité', fmtE(A.activityCredit), fmtE(B.activityCredit)));
      if (!out.length) out.push('Ajustement du barème de l\'impôt sur le revenu');
      return out;
    },
  },
  {
    id: 'impot_societes', label: 'Impôt sur les sociétés', category: () => 'fiscal',
    get: (p) => p.corporate, set: (p, v) => { p.corporate = clone(v as Policy['corporate']); },
    major: (a, b) => {
      const A = a.corporate, B = b.corporate;
      return Math.abs(A.rate - B.rate) >= 0.03 - 1e-9 || Math.abs(A.smeRate - B.smeRate) >= 0.03 - 1e-9 || Math.abs(A.investCredit - B.investCredit) >= 0.05 - 1e-9
        || Math.abs(A.greenCredit - B.greenCredit) >= 0.05 - 1e-9 || Math.abs(A.pollutingSurtax - B.pollutingSurtax) >= 0.03 - 1e-9;
    },
    vector: (a, b) => {
      const A = a.corporate, B = b.corporate;
      const d = B.rate - A.rate + 0.3 * (B.smeRate - A.smeRate) + (B.pollutingSurtax - A.pollutingSurtax) - (B.investCredit - A.investCredit);
      return [0.7 * sgn(d), 0.4 * sgn(B.greenCredit - A.greenCredit + B.pollutingSurtax - A.pollutingSurtax), 0];
    },
    describe: (a, b) => {
      const out: string[] = [];
      const A = a.corporate, B = b.corporate;
      if (A.rate !== B.rate) out.push(arrow('Taux normal d\'IS', fmtP(A.rate), fmtP(B.rate)));
      if (A.smeRate !== B.smeRate) out.push(arrow('Taux PME', fmtP(A.smeRate), fmtP(B.smeRate)));
      if (A.investCredit !== B.investCredit) out.push(arrow('Crédit d\'impôt investissement', fmtP(A.investCredit), fmtP(B.investCredit)));
      if (A.greenCredit !== B.greenCredit) out.push(arrow('Crédit d\'impôt vert', fmtP(A.greenCredit), fmtP(B.greenCredit)));
      if (A.pollutingSurtax !== B.pollutingSurtax) out.push(arrow('Surtaxe des secteurs polluants', fmtP(A.pollutingSurtax), fmtP(B.pollutingSurtax)));
      return out;
    },
  },
  {
    id: 'patrimoine', label: 'Impôt sur le patrimoine', category: () => 'fiscal',
    get: (p) => p.wealth, set: (p, v) => { p.wealth = clone(v as Policy['wealth']); },
    major: (a, b) => (a.wealth.rate <= 1e-9) !== (b.wealth.rate <= 1e-9) || Math.abs(a.wealth.rate - b.wealth.rate) >= 0.005 - 1e-9 || rel(a.wealth.threshold, b.wealth.threshold) >= 0.3,
    vector: (a, b) => [sgn(b.wealth.rate - a.wealth.rate - (b.wealth.threshold - a.wealth.threshold) / 1e8), 0, 0],
    describe: (a, b) => [a.wealth.rate <= 1e-9 && b.wealth.rate > 0 ? `Création d'un impôt sur le patrimoine à ${pctf(b.wealth.rate, 2)}` : b.wealth.rate <= 1e-9 && a.wealth.rate > 0 ? 'Suppression de l\'impôt sur le patrimoine' : arrow('Impôt sur le patrimoine', pctf(a.wealth.rate, 2), pctf(b.wealth.rate, 2))],
  },
  {
    id: 'immobilier', label: 'Fiscalité immobilière', category: () => 'logement',
    get: (p) => p.property, set: (p, v) => { p.property = clone(v as Policy['property']); },
    major: (a, b) => {
      const A = a.property, B = b.property;
      return Math.abs(A.landRate - B.landRate) >= 0.002 - 1e-9 || Math.abs(A.transferRate - B.transferRate) >= 0.02 - 1e-9 || Math.abs(A.vacancyRate - B.vacancyRate) >= 0.02 - 1e-9 || rel(A.localTax, B.localTax) >= 0.25;
    },
    vector: (a, b) => {
      const A = a.property, B = b.property;
      return [0.5 * sgn((B.landRate - A.landRate) * 100 + (B.transferRate - A.transferRate) * 10 + (B.vacancyRate - A.vacancyRate) * 20 + (B.localTax - A.localTax) / 400), 0, 0];
    },
    describe: (a, b) => {
      const out: string[] = [];
      const A = a.property, B = b.property;
      if (A.landRate !== B.landRate) out.push(arrow('Taxe foncière', pctf(A.landRate, 2), pctf(B.landRate, 2)));
      if (A.transferRate !== B.transferRate) out.push(arrow('Droits de mutation', fmtP(A.transferRate), fmtP(B.transferRate)));
      if (A.vacancyRate !== B.vacancyRate) out.push(arrow('Taxe sur les logements vacants', fmtP(A.vacancyRate), fmtP(B.vacancyRate)));
      if (A.localTax !== B.localTax) out.push(arrow('Taxes locales', fmtE(A.localTax), fmtE(B.localTax)));
      return out;
    },
  },
  {
    id: 'fiscalite_eco', label: 'Fiscalité écologique', category: () => 'climat',
    get: (p) => p.eco, set: (p, v) => { p.eco = clone(v as Policy['eco']); },
    major: (a, b) => {
      const A = a.eco, B = b.eco;
      const created = (Object.keys(A) as (keyof Policy['eco'])[]).some((k) => A[k] <= 1e-9 && B[k] > 1e-9);
      return created || Math.abs(A.carbon - B.carbon) >= 30 || Math.abs(A.industrial - B.industrial) >= 30 || Math.abs(A.fuel - B.fuel) >= 0.1 - 1e-9
        || Math.abs(A.waste - B.waste) >= 30 || Math.abs(A.vehicle - B.vehicle) >= 200 || Math.abs(A.energyIntensive - B.energyIntensive) >= 0.005 - 1e-9;
    },
    vector: (a, b) => {
      const A = a.eco, B = b.eco;
      const d = (B.carbon - A.carbon) / 100 + (B.industrial - A.industrial) / 100 + (B.fuel - A.fuel) * 2 + (B.waste - A.waste) / 100 + (B.vehicle - A.vehicle) / 500 + (B.energyIntensive - A.energyIntensive) * 50;
      return [-0.15 * sgn(d), sgn(d), 0];
    },
    describe: (a, b) => {
      const out: string[] = [];
      const A = a.eco, B = b.eco;
      if (A.carbon !== B.carbon) out.push(arrow('Taxe carbone', `${Math.round(A.carbon)} €/t`, `${Math.round(B.carbon)} €/t`));
      if (A.industrial !== B.industrial) out.push(arrow('Taxe sur les émissions industrielles', `${Math.round(A.industrial)} €/t`, `${Math.round(B.industrial)} €/t`));
      if (A.fuel !== B.fuel) out.push(arrow('Accise sur les carburants', fmtP(A.fuel), fmtP(B.fuel)));
      if (A.waste !== B.waste) out.push(arrow('Taxe sur les déchets', `${Math.round(A.waste)} €/t`, `${Math.round(B.waste)} €/t`));
      if (A.vehicle !== B.vehicle) out.push(arrow('Taxe sur les véhicules thermiques', fmtE(A.vehicle), fmtE(B.vehicle)));
      if (A.energyIntensive !== B.energyIntensive) out.push(arrow('Taxe sur les activités énergivores', pctf(A.energyIntensive, 2), pctf(B.energyIntensive, 2)));
      return out;
    },
  },
  {
    id: 'cotisations', label: 'Cotisations sociales', category: () => 'travail',
    get: (p) => p.contributions, set: (p, v) => { p.contributions = clone(v as Policy['contributions']); },
    major: (a, b) => (Object.keys(a.contributions) as (keyof Policy['contributions'])[]).some((k) => Math.abs(a.contributions[k].employer - b.contributions[k].employer) >= 0.02 - 1e-9 || Math.abs(a.contributions[k].employee - b.contributions[k].employee) >= 0.02 - 1e-9),
    vector: (a, b) => {
      let d = 0;
      for (const k of Object.keys(a.contributions) as (keyof Policy['contributions'])[]) d += b.contributions[k].employer - a.contributions[k].employer + b.contributions[k].employee - a.contributions[k].employee;
      return [0.4 * sgn(d), 0, 0];
    },
    describe: () => ['Modification des taux de cotisations sociales'],
  },
  {
    id: 'retraites', label: 'Retraites', category: () => 'retraites',
    get: (p) => ({ retirementAge: p.labour.retirementAge, pensionRate: p.labour.pensionRate }),
    set: (p, v) => { const o = v as Record<string, number>; for (const k of RET_KEYS) p.labour[k] = o[k]; },
    major: (a, b) => Math.abs(a.labour.retirementAge - b.labour.retirementAge) >= 0.5 - 1e-9 || Math.abs(a.labour.pensionRate - b.labour.pensionRate) >= 0.03 - 1e-9,
    vector: (a, b) => [sgn(-0.5 * (b.labour.retirementAge - a.labour.retirementAge) + 8 * (b.labour.pensionRate - a.labour.pensionRate)), 0, 0],
    describe: (a, b) => {
      const out: string[] = [];
      if (a.labour.retirementAge !== b.labour.retirementAge) out.push(arrow('Âge légal de départ', `${a.labour.retirementAge} ans`, `${b.labour.retirementAge} ans`));
      if (a.labour.pensionRate !== b.labour.pensionRate) out.push(arrow('Taux de remplacement des pensions', fmtP(a.labour.pensionRate), fmtP(b.labour.pensionRate)));
      return out;
    },
  },
  {
    id: 'travail', label: 'Droit du travail', category: () => 'travail',
    get: (p) => Object.fromEntries(WORK_KEYS.map((k) => [k, p.labour[k]])),
    set: (p, v) => { const o = v as Record<string, number>; for (const k of WORK_KEYS) p.labour[k] = o[k]; },
    major: (a, b) => {
      const A = a.labour, B = b.labour;
      return rel(A.minWage, B.minWage) >= 0.05 || Math.abs(A.hours - B.hours) >= 1 || Math.abs(A.benefitRate - B.benefitRate) >= 0.05 - 1e-9 || Math.abs(A.benefitMonths - B.benefitMonths) >= 6
        || Math.abs(A.hiringAid - B.hiringAid) >= 1000 || rel(A.familyAllowance, B.familyAllowance) >= 0.25;
    },
    vector: (a, b) => {
      const A = a.labour, B = b.labour;
      const g = rel(A.minWage, B.minWage) * sgn(B.minWage - A.minWage) * 10 - (B.hours - A.hours) / 2 + (B.benefitRate - A.benefitRate) * 10 + (B.benefitMonths - A.benefitMonths) / 12 - (B.hiringAid - A.hiringAid) / 3000 + rel(A.familyAllowance, B.familyAllowance) * sgn(B.familyAllowance - A.familyAllowance) * 2;
      return [0.9 * sgn(g), 0, 0.2 * sgn(B.familyAllowance - A.familyAllowance)];
    },
    describe: (a, b) => {
      const out: string[] = [];
      const A = a.labour, B = b.labour;
      if (A.minWage !== B.minWage) out.push(arrow('SMIC brut mensuel', fmtE(A.minWage), fmtE(B.minWage)));
      if (A.hours !== B.hours) out.push(arrow('Durée légale', `${A.hours} h`, `${B.hours} h`));
      if (A.benefitRate !== B.benefitRate) out.push(arrow('Taux des allocations chômage', fmtP(A.benefitRate), fmtP(B.benefitRate)));
      if (A.benefitMonths !== B.benefitMonths) out.push(arrow('Durée d\'indemnisation', `${A.benefitMonths} mois`, `${B.benefitMonths} mois`));
      if (A.hiringAid !== B.hiringAid) out.push(arrow('Aide à l\'embauche', fmtE(A.hiringAid), fmtE(B.hiringAid)));
      if (A.familyAllowance !== B.familyAllowance) out.push(arrow('Allocation par enfant', fmtE(A.familyAllowance), fmtE(B.familyAllowance)));
      return out;
    },
  },
  ...BUDGET_LINES.map((line): ChangeGroup => ({
    id: `budget:${line}`, label: BUDGET_LAW[line].name, category: () => BUDGET_LAW[line].cat,
    get: (p) => p.budget[line], set: (p, v) => { p.budget[line] = v as number; },
    major: (a, b) => rel(a.budget[line], b.budget[line]) >= 0.1,
    vector: (a, b) => scale(BUDGET_LAW[line].v, sgn(b.budget[line] - a.budget[line])),
    describe: (a, b) => [`${BUDGET_LAW[line].name} : ${b.budget[line] >= a.budget[line] ? '+' : '−'}${pctf(rel(a.budget[line], b.budget[line]), 0)} (${(b.budget[line] / 1e9).toFixed(1).replace('.', ',')} Md€/an)`],
  })),
  {
    id: 'commerce', label: 'Droits de douane', category: () => 'commerce',
    get: (p) => p.trade ?? { tariff: 0 }, set: (p, v) => { p.trade = clone(v as NonNullable<Policy['trade']>); },
    major: (a, b) => {
      const ta = a.trade?.tariff ?? 0, tb = b.trade?.tariff ?? 0;
      return (ta <= 1e-9 && tb > 1e-9) || Math.abs(ta - tb) >= 0.03 - 1e-9;
    },
    vector: (a, b) => scale([0.1, 0, 1], sgn((b.trade?.tariff ?? 0) - (a.trade?.tariff ?? 0))),
    describe: (a, b) => [arrow('Droits de douane moyens', fmtP(a.trade?.tariff ?? 0), fmtP(b.trade?.tariff ?? 0))],
  },
];

export interface PolicyChange { group: string; label: string; category: LawCategory; major: boolean; vector: Axes; summary: string[] }

/** Compare deux politiques et classe chaque groupe de mesures modifié (décret ou projet de loi). */
export function classifyChanges(a: Policy, b: Policy): PolicyChange[] {
  const out: PolicyChange[] = [];
  for (const g of CHANGE_GROUPS) {
    if (deepEq(g.get(a), g.get(b))) continue;
    out.push({ group: g.id, label: g.label, category: g.category(a, b), major: g.major(a, b), vector: g.vector(a, b), summary: g.describe(a, b) });
  }
  return out;
}

const groupById = (id: string) => CHANGE_GROUPS.find((g) => g.id === id)!;

/**
 * Sépare une proposition en décrets (petits ajustements, programmés au mois suivant) et projets de loi (un par catégorie),
 * votés au début du mois suivant. Renvoie la politique « décret » et les projets de loi créés.
 */
export function splitReform(S: GameState, base: Policy, proposal: Policy): { decree: Policy; bills: Bill[]; decreeChanges: PolicyChange[] } {
  const changes = classifyChanges(base, proposal);
  const decree = clone(base);
  decree.finance = clone(proposal.finance);
  const decreeChanges: PolicyChange[] = [];
  const byCat = new Map<LawCategory, PolicyChange[]>();
  for (const c of changes) {
    if (!c.major) {
      groupById(c.group).set(decree, clone(groupById(c.group).get(proposal)));
      decreeChanges.push(c);
    } else {
      if (!byCat.has(c.category)) byCat.set(c.category, []);
      byCat.get(c.category)!.push(c);
    }
  }
  const bills: Bill[] = [];
  const P = S.politics;
  for (const [cat, list] of byCat) {
    const vector = list.reduce<Axes>((v, c) => [v[0] + c.vector[0], v[1] + c.vector[1], v[2] + c.vector[2]], [0, 0, 0]);
    const patch: Record<string, unknown> = {};
    for (const c of list) patch[c.group] = clone(groupById(c.group).get(proposal));
    bills.push({
      id: P ? P.billSeq++ : 0, title: `${LAW_CATEGORY_NAMES[cat]} — ${list.map((c) => c.label.toLowerCase()).join(', ')}`, category: cat,
      groups: list.map((c) => c.group), summary: list.flatMap((c) => c.summary), patch, vector, submitted: S.month, voteMonth: S.month + 1, status: 'en_debat',
    });
  }
  return { decree, bills, decreeChanges };
}

export function submitBills(S: GameState, bills: Bill[]) {
  const P = S.politics;
  if (!P) return;
  for (const b of bills) {
    // un nouveau texte sur les mêmes mesures remplace le précédent encore en débat
    for (const o of P.bills) if (o.status === 'en_debat' && o.groups.some((g) => b.groups.includes(g))) o.status = 'retiree';
    P.bills.push(b);
    pushNote(S, 'info', 'Projet de loi déposé', `${b.title}. Vote du parlement au 1er du mois prochain. ${b.summary.slice(0, 3).join(' ; ')}.`);
  }
  if (P.bills.length > 40) P.bills.splice(0, P.bills.length - 40);
}

// ---------- Votes ----------
/**
 * Décompte déterministe d'un vote : pour chaque parti, part de « pour » = sigmoïde de
 *   3 × adhésion (position du parti · orientation du texte)
 *   + 2,2 × discipline (partis de la coalition du joueur) ou −1 (réflexe d'opposition, −1,6 pour la majorité de cohabitation)
 *   + 0,03 × (confiance − 55) pour l'opposition (un gouvernement populaire rallie des voix),
 * plus un aléa de ±5 points tiré de la graine. Les abstentions croissent avec l'indécision. Adopté si pour > contre.
 */
export function tallyVote(S: GameState, vector: Axes, tag: string, P = S.politics!): { votes: PartyVote[]; yes: number; no: number; abstention: number; passed: boolean } {
  const rnd = rngFor(S, `vote|${tag}`);
  const trust = S.satisfaction.trust;
  const votes: PartyVote[] = [];
  let yes = 0, no = 0, abst = 0;
  for (const p of P.parties) {
    const def = partyDef(p.id);
    const inCoal = P.coalition.includes(p.id);
    let z = 3 * stance(def.pos, vector);
    if (inCoal) z += 2.2 * P.discipline;
    else z += (P.mode === 'cohabitation' && P.majority.includes(p.id) ? -1.6 : -1) + 0.03 * (trust - 55);
    const frac = clamp(sig(z) + (rnd() - 0.5) * 0.1, 0, 1);
    const a = Math.round(p.seats * 0.12 * (1 - Math.abs(2 * frac - 1)));
    const y = Math.round((p.seats - a) * frac);
    const nn = p.seats - a - y;
    votes.push({ party: p.id, yes: y, no: nn, abstention: a });
    yes += y; no += nn; abst += a;
  }
  return { votes, yes, no, abstention: abst, passed: yes > no };
}

/** Votes des projets de loi arrivés à échéance ; une loi adoptée s'applique immédiatement à la politique en vigueur. */
export function legislativeStep(S: GameState) {
  const P = S.politics;
  if (!P) return;
  for (const b of P.bills) {
    if (b.status !== 'en_debat' || b.voteMonth > S.month) continue;
    const r = tallyVote(S, b.vector, `bill${b.id}`);
    b.votes = r.votes; b.yes = r.yes; b.no = r.no; b.abstention = r.abstention;
    if (r.passed) {
      b.status = 'adoptee';
      P.adopted++;
      for (const [g, v] of Object.entries(b.patch)) {
        groupById(g).set(S.policy, clone(v));
        if (S.pending) groupById(g).set(S.pending.policy, clone(v));
      }
      reactToLaw(S, b.vector);
      pushNote(S, 'good', 'Loi adoptée', `${b.title} : adoptée par ${r.yes} voix contre ${r.no} (${r.abstention} abstentions). Entrée en vigueur immédiate.`);
    } else {
      b.status = 'rejetee';
      P.rejected++;
      S.satisfaction.trust = clamp(S.satisfaction.trust - 1, 0, 100);
      pushNote(S, 'bad', 'Loi rejetée', `${b.title} : rejetée par ${r.no} voix contre ${r.yes} (${r.abstention} abstentions). Les mesures n'entrent pas en vigueur.`);
    }
  }
}

/** Réaction des électorats et des groupes d'intérêt à une loi adoptée. */
function reactToLaw(S: GameState, v: Axes) {
  const P = S.politics!;
  for (const p of P.parties) {
    const st = stance(partyDef(p.id).pos, v);
    // l'électorat d'un parti de la coalition juge son gouvernement ; l'opposition se mobilise contre les textes qu'elle combat
    if (P.coalition.includes(p.id)) p.mood = clamp(p.mood + 0.12 * st, -1, 1);
    else p.mood = clamp(p.mood + 0.08 * Math.max(0, -st), -1, 1);
  }
  for (const g of P.groups) {
    const def = INTEREST_GROUPS.find((d) => d.id === g.id)!;
    g.mood = clamp(g.mood + 0.2 * stance(def.pos, v), -1, 1);
  }
}

// ---------- Pas mensuel : popularité, groupes, censure, élections ----------
export function politicsStep(S: GameState) {
  const P = S.politics;
  if (!P || P.defeated) return;
  const target = computePopularity(S);
  for (const p of P.parties) {
    p.popularity += (target[p.id] - p.popularity) * 0.2;
    p.mood *= 0.985;
  }
  P.confidenceBonus *= 0.94;
  P.discipline = disciplineOf(S, P);
  updateGroups(S, P);
  // hostilité du patronat : la confiance des entreprises s'érode
  if (groupSupport(S, 'patronat') < 30) S.macro.confidence = clamp(S.macro.confidence - 0.002, 0.05, 0.95);
  // motion de censure déposée par l'opposition quand la confiance s'effondre durablement
  P.lowTrustMonths = S.satisfaction.trust < 35 ? P.lowTrustMonths + 1 : 0;
  if (P.lowTrustMonths >= 3 && S.month - P.lastMotion >= 12 && P.mode !== 'cohabitation') censureMotion(S);
  if (S.month >= P.nextElection) holdElection(S);
}

function defectionRate(S: GameState) {
  return clamp((40 - S.satisfaction.trust) / 40, 0, 0.6);
}

/** Motion de censure : l'opposition vote pour (95 %), une partie de la coalition fait défection quand la confiance est basse. */
export function censureMotion(S: GameState) {
  const P = S.politics!;
  const rnd = rngFor(S, `censure|${S.month}`);
  const def = defectionRate(S) * (1.2 - P.discipline) + (rnd() - 0.5) * 0.04;
  let yes = 0;
  for (const p of P.parties) yes += Math.round(p.seats * (P.coalition.includes(p.id) ? clamp(def, 0, 1) : 0.95));
  const no = P.seatsTotal - yes;
  const passed = yes > P.seatsTotal / 2;
  P.lastMotion = S.month;
  P.motions.push({ month: S.month, kind: 'censure', yes, no, passed });
  if (passed) {
    P.nextElection = S.month + 2;
    P.discipline = 0.3;
    pushNote(S, 'bad', 'Motion de censure adoptée', `Le gouvernement est renversé par ${yes} voix sur ${P.seatsTotal}. Élections législatives anticipées dans 2 mois.`);
  } else {
    pushNote(S, 'warn', 'Motion de censure rejetée', `La motion de censure ne recueille que ${yes} voix sur ${P.seatsTotal} (majorité requise : ${Math.floor(P.seatsTotal / 2) + 1}).`);
  }
  return passed;
}

/** Élections législatives : parts de voix = popularité ± aléa (1,5 pt), sièges à la proportionnelle, puis règle de majorité. */
export function holdElection(S: GameState, anticipated = S.month - S.politics!.lastElection < ELECTION_INTERVAL) {
  const P = S.politics!;
  const rnd = rngFor(S, `election|${S.month}`);
  const raw = P.parties.map((p) => Math.max(0.005, p.popularity + (rnd() - 0.5) * 0.03));
  const tot = raw.reduce((s, v) => s + v, 0);
  const shares = Object.fromEntries(P.parties.map((p, k) => [p.id, raw[k] / tot])) as Record<PartyId, number>;
  const seats = allocateSeats(shares, P.seatsTotal);
  P.parties.forEach((p) => { p.seats = seats[p.id]; p.popularity = shares[p.id]; });
  const half = P.seatsTotal / 2;
  // les accords de coalition valent pour une législature : on se présente avec son camp d'origine, les partenaires
  // ajoutés en cours de route (ou lors de l'élection précédente) doivent être reconquis
  P.core = (P.core ?? P.coalition).filter((p) => PARTY_IDS.includes(p));
  if (!P.core.includes(P.leader)) P.core.unshift(P.leader);
  P.coalition = [...P.core];
  let coalSeats = seatsOf(P, P.coalition);
  let outcome: ElectionResult['outcome'];
  let text: string;
  const wasCohab = P.mode === 'cohabitation';
  if (coalSeats > half) {
    outcome = 'majorite';
    P.mode = 'majorite';
    P.majority = [...P.coalition];
    P.electionsWon++;
    text = `La coalition gouvernementale conserve la majorité avec ${coalSeats} sièges sur ${P.seatsTotal}.`;
  } else {
    // règle 1 : élargissement à un parti compatible (distance idéologique ≤ 1,25 au parti du joueur, moins de sièges que la
    // coalition, et coalition sortante encore proche de la majorité : au moins ENLARGE_MIN_SHARE des sièges)
    const cand = PARTY_IDS.filter((p) => !P.coalition.includes(p) && seats[p] > 0)
      .map((p) => ({ p, d: dist(partyDef(P.leader).pos, partyDef(p).pos) }))
      // un parti plus fort que toute la coalition sortante gouvernerait lui-même : il ne la rejoint pas
      .filter((o) => o.d <= 1.25 && seats[o.p] < coalSeats && coalSeats + seats[o.p] > half && coalSeats >= ENLARGE_MIN_SHARE * P.seatsTotal)
      .sort((a, b) => a.d - b.d);
    if (cand.length) {
      P.coalition.push(cand[0].p);
      coalSeats += seats[cand[0].p];
      outcome = 'coalition_elargie';
      P.mode = 'majorite';
      P.majority = [...P.coalition];
      P.electionsWon++;
      text = `La coalition perd sa majorité mais s'élargit à « ${partyDef(cand[0].p).name} » : ${coalSeats} sièges sur ${P.seatsTotal}.`;
    } else if (seats[P.leader] >= Math.max(...PARTY_IDS.map((p) => seats[p])) * 0.6 && coalSeats >= P.seatsTotal * 0.35 && !wasCohab) {
      // règle 2 : cohabitation si le camp du joueur garde au moins 35 % des sièges et que son parti reste une force majeure
      const largest = PARTY_IDS.filter((p) => !P.coalition.includes(p)).sort((a, b) => seats[b] - seats[a])[0];
      P.majority = formCoalition(seats, largest, P.seatsTotal, 2);
      P.mode = 'cohabitation';
      outcome = 'cohabitation';
      text = `La coalition n'a que ${coalSeats} sièges : cohabitation avec une majorité menée par « ${partyDef(largest).name} ». Vos projets de loi devront convaincre l'opposition.`;
    } else {
      // règle 3 : fin de mandat
      outcome = 'defaite';
      P.defeated = { month: S.month, reason: 'elections' };
      text = `Défaite électorale : la coalition ne recueille que ${coalSeats} sièges sur ${P.seatsTotal}. Votre mandat prend fin.`;
    }
  }
  if (outcome !== 'defaite' && seatsOf(P, P.coalition) <= half && P.mode !== 'cohabitation') P.mode = 'minorite';
  P.elections.push({ month: S.month, shares, seats, coalitionSeats: coalSeats, outcome, text, anticipated, districts: districtResults(S, shares) });
  // seuls les résultats détaillés des 3 dernières élections sont conservés (taille de l'instantané)
  P.elections.slice(0, -3).forEach((e) => { delete e.districts; });
  P.lastElection = S.month;
  P.nextElection = S.month + ELECTION_INTERVAL;
  P.lowTrustMonths = 0;
  P.discipline = disciplineOf(S, P);
  const ranking = [...PARTY_IDS].sort((a, b) => shares[b] - shares[a]).map((p) => `${partyDef(p).short} ${pctf(shares[p])} (${seats[p]})`).join(', ');
  pushNote(S, outcome === 'defaite' ? 'bad' : outcome === 'cohabitation' ? 'warn' : 'good', anticipated ? 'Élections législatives anticipées' : 'Élections législatives', `${text} Résultats : ${ranking}.`);
  return P.elections[P.elections.length - 1];
}

/**
 * Résultats par arrondissement : la part nationale de chaque parti est modulée par la satisfaction locale (écart à la
 * moyenne, au profit ou au détriment du camp gouvernemental), le revenu relatif (libéraux, centristes, écologistes dans
 * les quartiers aisés), le chômage local (sociaux-démocrates, conservateurs) et une tradition locale fixe tirée de la graine.
 */
export function districtResults(S: GameState, national: Record<PartyId, number>): DistrictResult[] {
  const defs = S.country?.cities ?? [];
  const P = S.politics!;
  const pop = S.cities.reduce((s, c) => s + c.population, 0);
  const avgIncome = S.cities.reduce((s, c) => s + c.income * c.population, 0) / Math.max(1, pop);
  const u = unemploymentOf(S);
  return defs.map((d, k) => {
    const cs = S.cities[k];
    if (!cs) return null;
    const rnd = rngFor(S, `quartier|${d.id}`);
    const dSat = (cs.satisfaction - S.satisfaction.overall) / 15;
    const inc = avgIncome > 0 ? cs.income / avgIncome - 1 : 0;
    const du = cs.unemployment - u;
    const raw = PARTY_IDS.map((p) => {
      let m = Math.exp(P.coalition.includes(p) ? 0.5 * dSat : -0.25 * dSat);
      if (p === 'liberaux' || p === 'centristes') m *= Math.exp(0.8 * inc);
      if (p === 'ecologistes') m *= Math.exp(0.5 * inc);
      if (p === 'sociaux_democrates' || p === 'conservateurs') m *= Math.exp(4 * du - 0.3 * inc);
      m *= 0.85 + 0.3 * rnd(); // tradition politique locale
      return national[p] * m;
    });
    const tot = raw.reduce((s, v) => s + v, 0) || 1;
    const shares = Object.fromEntries(PARTY_IDS.map((p, i) => [p, raw[i] / tot])) as Record<PartyId, number>;
    const winner = [...PARTY_IDS].sort((a, b) => shares[b] - shares[a])[0];
    return { id: d.id, name: d.name, voters: Math.round(cs.population * 0.75), shares, winner };
  }).filter((x): x is DistrictResult => x !== null);
}

// ---------- Actions du joueur ----------
export type PoliticalAction =
  | { type: 'confiance' }
  | { type: 'dissolution' }
  | { type: 'coalition'; party: PartyId; join: boolean }
  | { type: 'retirerLoi'; bill: number };

export function applyPoliticalAction(S: GameState, a: PoliticalAction): { ok: boolean; msg: string } {
  const P = S.politics;
  if (!P) return { ok: false, msg: 'Module politique indisponible' };
  if (P.defeated) return { ok: false, msg: 'Votre mandat a pris fin' };
  if (a.type === 'confiance') {
    if (S.month - P.lastMotion < 6) return { ok: false, msg: 'Un vote de confiance a eu lieu il y a moins de 6 mois' };
    const rnd = rngFor(S, `confiance|${S.month}`);
    const def = defectionRate(S) * (1.2 - P.discipline) * 0.8 + (rnd() - 0.5) * 0.04;
    let yes = 0;
    for (const p of P.parties) {
      if (P.coalition.includes(p.id)) yes += Math.round(p.seats * (1 - clamp(def, 0, 1)));
      else yes += Math.round(p.seats * clamp(0.03 * (S.satisfaction.trust - 50) / 10, 0, 0.3));
    }
    const no = P.seatsTotal - yes;
    const passed = yes > P.seatsTotal / 2;
    P.lastMotion = S.month;
    P.motions.push({ month: S.month, kind: 'confiance', yes, no, passed });
    if (passed) {
      P.confidenceBonus = 0.25;
      P.discipline = disciplineOf(S, P);
      pushNote(S, 'good', 'Confiance accordée', `Le parlement accorde sa confiance au gouvernement (${yes} voix sur ${P.seatsTotal}). La discipline de la majorité est renforcée.`);
      return { ok: true, msg: `Confiance accordée : ${yes} voix sur ${P.seatsTotal}` };
    }
    P.nextElection = S.month + 2;
    pushNote(S, 'bad', 'Confiance refusée', `Le parlement refuse sa confiance (${yes} voix sur ${P.seatsTotal}). Élections anticipées dans 2 mois.`);
    return { ok: true, msg: `Confiance refusée (${yes} voix) : élections anticipées dans 2 mois` };
  }
  if (a.type === 'dissolution') {
    if (S.month - P.lastElection < 12) return { ok: false, msg: 'Dissolution impossible moins d\'un an après une élection' };
    P.nextElection = S.month + 2;
    pushNote(S, 'warn', 'Dissolution du parlement', 'Élections législatives anticipées dans 2 mois.');
    return { ok: true, msg: 'Parlement dissous : élections dans 2 mois' };
  }
  if (a.type === 'coalition') {
    if (!PARTY_IDS.includes(a.party)) return { ok: false, msg: 'Parti inconnu' };
    if (a.party === P.leader) return { ok: false, msg: 'Le parti du chef du gouvernement reste dans la coalition' };
    if (a.join) {
      if (P.coalition.includes(a.party)) return { ok: false, msg: 'Ce parti fait déjà partie de la coalition' };
      if (P.mode === 'cohabitation' && P.majority.includes(a.party)) return { ok: false, msg: 'Ce parti dirige la majorité de cohabitation' };
      const d = dist(partyDef(P.leader).pos, partyDef(a.party).pos);
      const need = seatsOf(P, P.coalition) <= P.seatsTotal / 2;
      if (d > (need ? 1.3 : 1.1)) return { ok: false, msg: `${partyDef(a.party).name} refuse : programmes trop éloignés` };
      P.coalition.push(a.party);
      pushNote(S, 'info', 'Coalition élargie', `${partyDef(a.party).name} rejoint la coalition gouvernementale.`);
    } else {
      if (!P.coalition.includes(a.party)) return { ok: false, msg: 'Ce parti n\'est pas dans la coalition' };
      P.coalition = P.coalition.filter((p) => p !== a.party);
      if (P.core) P.core = P.core.filter((p) => p !== a.party);
      pushNote(S, 'warn', 'Rupture de coalition', `${partyDef(a.party).name} quitte la coalition gouvernementale.`);
    }
    if (P.mode !== 'cohabitation') {
      P.mode = seatsOf(P, P.coalition) > P.seatsTotal / 2 ? 'majorite' : 'minorite';
      P.majority = [...P.coalition];
    }
    return { ok: true, msg: `Coalition : ${seatsOf(P, P.coalition)} sièges sur ${P.seatsTotal}` };
  }
  if (a.type === 'retirerLoi') {
    const b = P.bills.find((x) => x.id === a.bill && x.status === 'en_debat');
    if (!b) return { ok: false, msg: 'Projet de loi introuvable' };
    b.status = 'retiree';
    return { ok: true, msg: `Projet de loi retiré : ${b.title}` };
  }
  return { ok: false, msg: 'Action inconnue' };
}

/** Prévision de vote (sans aléa) pour l'interface. */
export function forecastVote(S: Pick<GameState, 'politics' | 'satisfaction'>, vector: Axes) {
  const P = S.politics!;
  let yes = 0;
  for (const p of P.parties) {
    const def = partyDef(p.id);
    let z = 3 * stance(def.pos, vector);
    if (P.coalition.includes(p.id)) z += 2.2 * P.discipline;
    else z += (P.mode === 'cohabitation' && P.majority.includes(p.id) ? -1.6 : -1) + 0.03 * (S.satisfaction.trust - 55);
    yes += p.seats * sig(z);
  }
  return yes / P.seatsTotal;
}

