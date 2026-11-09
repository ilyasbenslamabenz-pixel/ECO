// Relations internationales de la cité-État (très ouverte : port, place financière, énergie et alimentation importées) :
// États voisins à économie simplifiée (PIB, croissance, demande, prix de l'énergie),
// relations diplomatiques, accords (commerce, énergie, climat, investissement), droits de douane et représailles.
// Les effets passent par les variables existantes du moteur économique :
//  - `macro.worldDemand` (demande adressée aux exportations), `macro.energyPrice`, `macro.worldPrice` : ajustés par des
//    facteurs multiplicatifs appliqués en différentiel (rapport cible / facteur déjà appliqué), ce qui préserve la tendance
//    propre du moteur et l'équilibre initial (facteurs = 1 au départ) ;
//  - `international.retaliation` : lu par economy.ts, réduit les exportations ;
//  - `policy.trade.tariff` : lu par economy.ts, renchérit et réduit les importations (recette « douanes »).
import { hashString, mulberry32 } from '../noise';
import { SECTORS, SECTOR_INDEX, type SectorId } from './data';
import { clamp } from './economy';
import { addExtraBudget, modifierSum, productivityFactor } from './events';
import type { GameState } from './types';

export type AgreementKind = 'commerce' | 'energie' | 'climat' | 'investissement';
export const AGREEMENT_NAMES: Record<AgreementKind, string> = {
  commerce: 'Accord de libre-échange', energie: 'Accord énergétique', climat: 'Coopération climatique', investissement: 'Accord d\'investissement',
};
/** Relation minimale exigée par le partenaire pour signer. */
export const AGREEMENT_MIN_RELATION: Record<AgreementKind, number> = { commerce: 45, energie: 50, climat: 40, investissement: 55 };
export const AGREEMENT_EFFECTS: Record<AgreementKind, string> = {
  commerce: 'Demande du partenaire pour nos produits +6 %. Exige des droits de douane ≤ 5 % (sinon suspendu).',
  energie: 'Prix de l\'énergie importée du partenaire −12 % (s\'il est exportateur), dépendance réduite.',
  climat: 'Transferts de technologies : intensité d\'émission des secteurs polluants −0,5 %/an. Contribution : 0,02 % du PIB/an.',
  investissement: 'Investissements étrangers : productivité de l\'industrie et du numérique +0,3 %/an, demande +1 %.',
};

export interface Neighbor {
  id: number;
  name: string;
  flag: string;
  gdp: number; // €/an
  baseGdp: number;
  trend: number; // croissance tendancielle annuelle
  amp: number; // amplitude du cycle (écart de production)
  period: number; // mois
  phase: number;
  ar: number; // composante aléatoire persistante
  gap: number; // écart de production
  growth: number; // croissance annuelle estimée
  exportWeight: number; // part de nos exportations vers ce pays
  energyExporter: boolean;
  energyPrice: number; // indice du prix de l'énergie qu'il exporte
  ePhase: number;
  relation: number; // 0..100
  baseRelation: number;
  tolerance: number; // droits de douane tolérés avant représailles
  retaliation: number; // droits de douane de rétorsion sur nos exportations
  agreements: AgreementKind[];
}

export interface InternationalState {
  neighbors: Neighbor[];
  applied: Record<string, number>; // facteurs multiplicatifs déjà appliqués aux variables du moteur
  ref: { demand: number; energy: number };
  appliedTariff: number;
  retaliation: number; // représailles moyennes pondérées par les exportations
  demandFactor: number;
  energyFactor: number;
  fdi: number; // facteur cumulé de productivité dû aux investissements étrangers
  avgGap: number;
  avgRelation: number;
  log: { month: number; text: string }[];
}

const NAMES: { name: string; flag: string }[] = [
  { name: 'Royaume de Norvalie', flag: '🟦' }, { name: 'Fédération d\'Austrie', flag: '🟥' }, { name: 'République de Méridia', flag: '🟩' },
  { name: 'Principauté d\'Estalie', flag: '🟨' }, { name: 'Confédération de Kessaly', flag: '🟪' }, { name: 'Union de Brévanie', flag: '🟧' },
];

const pushNote = (S: GameState, kind: 'info' | 'warn' | 'good' | 'bad', title: string, text: string) => {
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind, title, text });
  if (S.notices.length > 80) S.notices.shift();
};

export function initInternational(S: GameState): InternationalState {
  const rnd = mulberry32(hashString(`${S.country.seed}|voisins`));
  const count = 3 + Math.floor(rnd() * 3); // 3 à 5 États voisins
  const pool = [...NAMES];
  const neighbors: Neighbor[] = [];
  const weights: number[] = [];
  for (let i = 0; i < count; i++) {
    const k = Math.floor(rnd() * pool.length);
    const nm = pool.splice(k, 1)[0];
    const size = 0.4 + rnd() * 2.6;
    weights.push(size);
    const rel = Math.round(50 + rnd() * 25);
    neighbors.push({
      id: i, name: nm.name, flag: nm.flag, gdp: S.accounts.gdp * size, baseGdp: S.accounts.gdp * size,
      trend: 0.01 + rnd() * 0.012, amp: 0.008 + rnd() * 0.014, period: 60 + Math.floor(rnd() * 60), phase: rnd() * Math.PI * 2,
      ar: 0, gap: 0, growth: 0.015, exportWeight: 0, energyExporter: i === 0 || rnd() < 0.35, energyPrice: 1, ePhase: rnd() * Math.PI * 2,
      relation: rel, baseRelation: rel, tolerance: 0.03 + rnd() * 0.03, retaliation: 0, agreements: i === 0 ? ['commerce'] : [],
    });
  }
  const wsum = weights.reduce((s, v) => s + v, 0);
  neighbors.forEach((n, i) => (n.exportWeight = weights[i] / wsum));
  const I: InternationalState = {
    neighbors, applied: {}, ref: { demand: 1, energy: 1 }, appliedTariff: 0, retaliation: 0, demandFactor: 1, energyFactor: 1, fdi: 1, avgGap: 0, avgRelation: 60, log: [],
  };
  for (const n of neighbors) updateNeighborCycle(n, 0);
  I.ref = { demand: rawDemand(I), energy: rawEnergy(I) };
  I.avgRelation = neighbors.reduce((s, n) => s + n.relation * n.exportWeight, 0);
  return I;
}

function updateNeighborCycle(n: Neighbor, month: number) {
  const prev = n.gap;
  n.gap = n.amp * Math.sin((2 * Math.PI * month) / n.period + n.phase) + n.ar;
  n.gdp = n.baseGdp * Math.pow(1 + n.trend, month / 12) * (1 + n.gap);
  n.growth = month === 0 ? n.trend : 0.92 * n.growth + 0.08 * (n.trend + 12 * (n.gap - prev));
  n.energyPrice = n.energyExporter ? 1 + 0.08 * Math.sin((2 * Math.PI * month) / 84 + n.ePhase) : 1;
}

function rawDemand(I: InternationalState) {
  return I.neighbors.reduce((s, n) => s + n.exportWeight * Math.pow(1 + n.gap, 1.5) * (n.agreements.includes('commerce') ? 1.06 : 1) * (n.agreements.includes('investissement') ? 1.01 : 1), 0);
}
function rawEnergy(I: InternationalState) {
  const ex = I.neighbors.filter((n) => n.energyExporter);
  if (!ex.length) return 1;
  const w = ex.reduce((s, n) => s + n.exportWeight, 0);
  const regional = ex.reduce((s, n) => s + n.exportWeight * n.energyPrice * (n.agreements.includes('energie') ? 0.88 : 1), 0) / Math.max(1e-9, w);
  return 0.6 + 0.4 * regional; // 60 % du prix est fixé sur le marché mondial
}

/** Applique un facteur multiplicatif en différentiel sur une variable (préserve sa dynamique propre). */
function applyFactor(I: InternationalState, key: string, target: number, set: (k: number) => void) {
  const prev = I.applied[key] ?? 1;
  if (Math.abs(target - prev) > 1e-12) set(target / prev);
  I.applied[key] = target;
}

/** Pas mensuel (avant l'économie). */
export function internationalStep(S: GameState) {
  const I = S.international;
  if (!I) return;
  const tariff = S.policy.trade?.tariff ?? 0;
  for (const n of I.neighbors) {
    const rnd = mulberry32(hashString(`${S.country.seed}|voisin|${n.id}|${S.month}`));
    n.ar = 0.92 * n.ar + (rnd() - 0.5) * 0.006;
    updateNeighborCycle(n, S.month);
    // relations : retour lent vers la relation de base, dégradées par nos droits de douane, améliorées par les accords
    let drift = 0.03 * (n.baseRelation - n.relation) + 0.15 * n.agreements.length - 25 * Math.max(0, tariff - n.tolerance) - 0.4 * n.retaliation * 10;
    if (n.agreements.includes('climat')) drift += 0.1;
    n.relation = clamp(n.relation + drift / 3, 0, 100);
    // représailles : droits de rétorsion proportionnels à l'excès de nos droits de douane (délai de quelques mois)
    const target = tariff > n.tolerance ? clamp(1.2 * (tariff - n.tolerance) + (n.relation < 30 ? 0.03 : 0), 0, 0.5) : 0;
    n.retaliation += (target - n.retaliation) * 0.15;
    if (n.retaliation < 1e-4) n.retaliation = 0;
    if (n.agreements.includes('commerce') && tariff > 0.05) {
      n.agreements = n.agreements.filter((a) => a !== 'commerce');
      log(S, `${n.name} suspend l'accord de libre-échange en réponse à nos droits de douane (${(tariff * 100).toFixed(0)} %).`);
      pushNote(S, 'bad', 'Accord commercial suspendu', `${n.name} suspend l'accord de libre-échange en réponse à nos droits de douane.`);
    }
  }
  I.retaliation = I.neighbors.reduce((s, n) => s + n.exportWeight * n.retaliation, 0);
  I.avgGap = I.neighbors.reduce((s, n) => s + n.exportWeight * n.gap, 0);
  I.avgRelation = I.neighbors.reduce((s, n) => s + n.exportWeight * n.relation, 0);
  // investissements étrangers et coopération climatique
  const inv = I.neighbors.filter((n) => n.agreements.includes('investissement')).reduce((s, n) => s + n.exportWeight, 0);
  I.fdi *= 1 + (0.003 * Math.min(1, inv * 2)) / 12;
  const clim = I.neighbors.filter((n) => n.agreements.includes('climat')).length;
  if (clim > 0) {
    const k = 1 - (0.005 * Math.min(3, clim) / 3) / 12;
    SECTORS.forEach((d, i) => { if (d.polluting) S.sectors[i].emissionIntensity *= k; });
    addExtraBudget(S, 'environnement', 0.0002 * clim * Math.max(1, S.accounts.gdp), 1, 'Coopération climatique');
  }
  // facteurs macroéconomiques (voisins × accords × événements)
  I.demandFactor = (rawDemand(I) / I.ref.demand) * (1 + modifierSum(S, 'demand'));
  I.energyFactor = (rawEnergy(I) / I.ref.energy) * (1 + modifierSum(S, 'energy'));
  const priceF = 1 + modifierSum(S, 'worldPrice');
  const M = S.macro;
  applyFactor(I, 'demand', I.demandFactor, (k) => (M.worldDemand *= k));
  applyFactor(I, 'energy', I.energyFactor, (k) => (M.energyPrice *= k));
  applyFactor(I, 'worldPrice', priceF, (k) => (M.worldPrice *= k));
  for (const d of SECTORS) {
    const id = d.id as SectorId;
    const f = productivityFactor(S, id) * (id === 'industrie' || id === 'technologie' ? I.fdi : 1);
    applyFactor(I, `prod:${id}`, f, (k) => (S.sectors[SECTOR_INDEX[id]].productivity *= k));
  }
  // répercussion des droits de douane sur les prix (≈ 15 % de la consommation est importée)
  const dT = tariff - I.appliedTariff;
  if (Math.abs(dT) > 1e-9) {
    M.priceLevel *= 1 + 0.15 * dT;
    I.appliedTariff = tariff;
  }
}

function log(S: GameState, text: string) {
  const I = S.international!;
  I.log.push({ month: S.month, text });
  if (I.log.length > 30) I.log.shift();
}

export type DiplomaticAction =
  | { type: 'accord'; neighbor: number; kind: AgreementKind }
  | { type: 'rompreAccord'; neighbor: number; kind: AgreementKind }
  | { type: 'diplomatie'; neighbor: number };

export function applyDiplomaticAction(S: GameState, a: DiplomaticAction): { ok: boolean; msg: string } {
  const I = S.international;
  if (!I) return { ok: false, msg: 'Module international indisponible' };
  const n = I.neighbors.find((x) => x.id === Number(a.neighbor));
  if (!n) return { ok: false, msg: 'État inconnu' };
  if (a.type === 'diplomatie') {
    const last = I.log.filter((l) => l.text.startsWith(`Mission diplomatique : ${n.name}`)).at(-1);
    if (last && S.month - last.month < 6) return { ok: false, msg: 'Une mission a déjà eu lieu il y a moins de 6 mois' };
    n.relation = clamp(n.relation + 8, 0, 100);
    addExtraBudget(S, 'administration', 0.0001 * S.accounts.gdp * 12, 1, `Mission diplomatique (${n.name})`);
    log(S, `Mission diplomatique : ${n.name} (relations +8).`);
    return { ok: true, msg: `Mission diplomatique auprès de ${n.name} : relations +8` };
  }
  if (!(a.kind in AGREEMENT_NAMES)) return { ok: false, msg: 'Accord inconnu' };
  if (a.type === 'accord') {
    if (n.agreements.includes(a.kind)) return { ok: false, msg: 'Accord déjà en vigueur' };
    if (n.relation < AGREEMENT_MIN_RELATION[a.kind]) return { ok: false, msg: `${n.name} refuse : relations insuffisantes (${Math.round(n.relation)}/${AGREEMENT_MIN_RELATION[a.kind]})` };
    if (a.kind === 'commerce' && (S.policy.trade?.tariff ?? 0) > 0.05) return { ok: false, msg: `${n.name} refuse : vos droits de douane dépassent 5 %` };
    if (a.kind === 'energie' && !n.energyExporter) return { ok: false, msg: `${n.name} n'exporte pas d'énergie` };
    n.agreements.push(a.kind);
    n.relation = clamp(n.relation + 3, 0, 100);
    log(S, `${AGREEMENT_NAMES[a.kind]} signé avec ${n.name}.`);
    pushNote(S, 'good', AGREEMENT_NAMES[a.kind], `Accord signé avec ${n.name}. ${AGREEMENT_EFFECTS[a.kind]}`);
    return { ok: true, msg: `${AGREEMENT_NAMES[a.kind]} signé avec ${n.name}` };
  }
  if (a.type === 'rompreAccord') {
    if (!n.agreements.includes(a.kind)) return { ok: false, msg: 'Aucun accord de ce type' };
    n.agreements = n.agreements.filter((k) => k !== a.kind);
    n.relation = clamp(n.relation - 12, 0, 100);
    log(S, `${AGREEMENT_NAMES[a.kind]} avec ${n.name} dénoncé.`);
    pushNote(S, 'warn', 'Accord dénoncé', `${AGREEMENT_NAMES[a.kind]} avec ${n.name} dénoncé (relations −12).`);
    return { ok: true, msg: `Accord dénoncé avec ${n.name}` };
  }
  return { ok: false, msg: 'Action inconnue' };
}
