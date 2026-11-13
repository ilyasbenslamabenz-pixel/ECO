/**
 * Zonage — modèle de DEMANDE par secteur (R résidentiel, C commerces, B bureaux, I industrie), -1..1.
 *
 * Modèle volontairement simple, en attendant le branchement sur l'économie (docs/ZONAGE.md §3) :
 * il équilibre LOGEMENTS et EMPLOIS à partir de quatre grandeurs lues dans la simulation de base
 * (population, actifs, emplois par secteur, logements libres) et des taux d'imposition.
 *
 *   écart d'emploi  G = actifs − emplois                     (> 0 : chômage ; < 0 : postes vacants)
 *   R = baseR + attraitEmploiR · (−G) / max(échelleMin, actifs)
 *            − pousséeVacanceR · (logements libres / max(échelleVacance, capacité) − vacanceCible) − sensibilitéImpôt · (tauxR − tauxRéf)
 *       (l'échelle minimale évite qu'un hameau de trois maisons, dont une encore vide, bloque toute croissance)
 *   C = (cibleC − emploisC) / max(échelleMinC, cibleC · 0,5)        cibleC = commercesParHabitant · population
 *   I = baseI + partIndustrie · G / max(échelleMin, actifs · 0,3)
 *   B = rampe · (baseB + partBureaux · G / max(échelleMin, actifs · 0,3))   rampe = min(1, population / popMinBureaux)
 *       (la rampe ne s'applique qu'à une demande positive : pas de bureaux dans un village)
 * Chaque valeur est bornée à [−1, 1] puis LISSÉE heure par heure (moyenne exponentielle `lissage`).
 *
 * Boucle obtenue : au départ, R et I sont positifs (logements et premiers emplois) ; les habitants créent la
 * demande de commerces ; le chômage relance l'industrie et les bureaux ; les postes vacants relancent le logement.
 * Tous les coefficients sont dans `DEFAULT_DEMAND_TUNING` (réglables en partie par la commande `tuning`).
 *
 * Branchement futur : un module (économie) peut publier le service `zonage:demande` (`DemandProvider`) ;
 * sa demande remplace alors ce modèle (voir src/sim/plugins/zonage.ts).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { DemandSector, ZonageDemand } from '../../shared/protocol-ext/zonage';

export interface DemandTuning {
  baseR: number;
  attraitEmploiR: number;
  pousseeVacanceR: number;
  vacanceCible: number;
  echelleVacance: number;
  commercesParHabitant: number;
  echelleMinC: number;
  baseI: number;
  partIndustrie: number;
  baseB: number;
  partBureaux: number;
  popMinBureaux: number;
  echelleMin: number;
  sensibiliteImpot: number;
  tauxRef: number;
  /** Part de la nouvelle valeur intégrée à chaque heure (0..1). */
  lissage: number;
}

export const DEFAULT_DEMAND_TUNING: Readonly<DemandTuning> = Object.freeze({
  baseR: 0.35,
  attraitEmploiR: 0.9,
  pousseeVacanceR: 2,
  vacanceCible: 0.06,
  echelleVacance: 80,
  commercesParHabitant: 0.08,
  echelleMinC: 10,
  baseI: 0.25,
  partIndustrie: 0.6,
  baseB: 0.1,
  partBureaux: 0.45,
  popMinBureaux: 300,
  echelleMin: 40,
  sensibiliteImpot: 3,
  tauxRef: 0.09,
  lissage: 0.25,
});

/** Entrées du modèle (lues dans la simulation de base, ou fournies par un test). */
export interface DemandInputs {
  population: number;
  workforce: number;
  jobsBySector: Record<DemandSector | 'public', number>;
  housingCapacity: number;
  housingFree: number;
  /** Taux d'imposition par secteur (facultatif : taux de référence sinon). */
  tax?: Partial<Record<DemandSector, number>>;
}

/** Service facultatif publié par un autre module (économie) pour remplacer ce modèle. */
export interface DemandProvider {
  /** Demande brute -1..1 par secteur, ou null pour laisser le modèle du zonage décider. */
  demand(inputs: DemandInputs): ZonageDemand | null;
}
export const DEMAND_PROVIDER_SERVICE = 'zonage:demande';

const clampS = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

export function totalJobs(j: DemandInputs['jobsBySector']): number {
  return j.R + j.C + j.B + j.I + j.public;
}

/** Demande instantanée (non lissée), bornée à [−1, 1]. */
export function computeDemand(inp: DemandInputs, t: Readonly<DemandTuning> = DEFAULT_DEMAND_TUNING): ZonageDemand {
  const L = Math.max(0, inp.workforce);
  const J = totalJobs(inp.jobsBySector);
  const G = L - J;
  const tax = (s: DemandSector): number => (inp.tax?.[s] ?? t.tauxRef) - t.tauxRef;
  const vacancy = inp.housingFree / Math.max(t.echelleVacance, inp.housingCapacity, 1);
  const R = t.baseR + (t.attraitEmploiR * -G) / Math.max(t.echelleMin, L) - t.pousseeVacanceR * (vacancy - t.vacanceCible) - t.sensibiliteImpot * tax('R');
  const targetC = t.commercesParHabitant * Math.max(0, inp.population);
  const C = (targetC - inp.jobsBySector.C) / Math.max(t.echelleMinC, targetC * 0.5) - t.sensibiliteImpot * tax('C');
  const scale = Math.max(t.echelleMin, L * 0.3);
  const I = t.baseI + (t.partIndustrie * G) / scale - t.sensibiliteImpot * tax('I');
  const ramp = Math.min(1, Math.max(0, inp.population) / Math.max(1, t.popMinBureaux));
  const rawB = t.baseB + (t.partBureaux * G) / scale - t.sensibiliteImpot * tax('B');
  const B = rawB > 0 ? rawB * ramp : rawB;
  return { R: clampS(R), C: clampS(C), B: clampS(B), I: clampS(I) };
}

/** Lissage exponentiel de `prev` vers `next` (modifie et renvoie `prev`). */
export function smoothDemand(prev: ZonageDemand, next: ZonageDemand, alpha: number): ZonageDemand {
  const a = Math.max(0, Math.min(1, alpha));
  for (const k of ['R', 'C', 'B', 'I'] as const) prev[k] = clampS(prev[k] + (next[k] - prev[k]) * a);
  return prev;
}

export const zeroDemand = (): ZonageDemand => ({ R: 0, C: 0, B: 0, I: 0 });
