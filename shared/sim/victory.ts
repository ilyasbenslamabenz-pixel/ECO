// Conditions de victoire et de défaite (section 30). Chaque victoire se compose de critères mesurables qui doivent être
// tenus simultanément pendant une durée minimale ; l'avancement est publié pour l'interface.
import { clamp } from './economy';
import type { GameState } from './types';

export type VictoryId = 'ecologique' | 'economique' | 'sociale' | 'politique' | 'totale';
export type DefeatReason = 'defaut' | 'elections' | 'troubles';

export interface Criterion { id: string; label: string; value: number; target: number; dir: 'max' | 'min'; ok: boolean; progress: number; available: boolean; fmt: 'pct' | 'num' | 'ratio' | 'mt' }
export interface VictoryCondition { id: VictoryId; name: string; description: string; criteria: Criterion[]; held: number; required: number; achieved: number | null; progress: number }

export interface VictoryState {
  conditions: VictoryCondition[];
  ref: { emissions: number; lifeExpectancy: number };
  status: 'en_cours' | 'defaite';
  defeat: null | { reason: DefeatReason; month: number; text: string };
  sandbox: boolean; // le joueur a choisi de continuer après une défaite
  risk: { defaut: number; troubles: number; marketMonths: number; unrestMonths: number };
}

export const VICTORY_INFO: Record<VictoryId, { name: string; description: string; required: number }> = {
  ecologique: { name: 'Victoire écologique', description: 'Émissions réduites de 55 % par rapport à 2030 (ou neutralité nette si le bilan est disponible), électricité à 80 % renouvelable et énergie finale à 50 % renouvelable (si mesurées), environnement jugé satisfaisant, tenus 24 mois.', required: 24 },
  economique: { name: 'Victoire économique', description: 'Croissance ≥ 1,5 %, chômage ≤ 5 %, inflation entre 0 et 3 %, dette ≤ 60 % du PIB et déficit ≤ 3 %, tenus 36 mois.', required: 36 },
  sociale: { name: 'Victoire sociale', description: 'Satisfaction ≥ 70/100, pauvreté ≤ 10 %, Gini ≤ 0,27, espérance de vie +1 an et risque d\'émeutes < 5 %, tenus 24 mois.', required: 24 },
  politique: { name: 'Victoire politique', description: 'Deux élections gagnées, majorité au parlement et confiance ≥ 70/100, tenues 12 mois.', required: 12 },
  totale: { name: 'Victoire totale', description: 'Obtenir les victoires écologique, économique, sociale et politique.', required: 1 },
};

function crit(id: string, label: string, value: number | undefined, target: number, dir: 'max' | 'min', fmt: Criterion['fmt'], start?: number): Criterion {
  if (value === undefined || !Number.isFinite(value)) return { id, label, value: NaN, target, dir, ok: true, progress: 1, available: false, fmt };
  const ok = dir === 'max' ? value >= target : value <= target;
  let progress: number;
  if (ok) progress = 1;
  else if (start !== undefined && Math.abs(target - start) > 1e-12) progress = clamp((value - start) / (target - start), 0, 1);
  else progress = dir === 'max' ? clamp(value / Math.max(1e-9, target), 0, 1) : clamp(target / Math.max(1e-9, value), 0, 1);
  return { id, label, value, target, dir, ok, progress, available: true, fmt };
}

export function initVictory(S: GameState): VictoryState {
  const V: VictoryState = {
    conditions: (Object.keys(VICTORY_INFO) as VictoryId[]).map((id) => ({ id, name: VICTORY_INFO[id].name, description: VICTORY_INFO[id].description, criteria: [], held: 0, required: VICTORY_INFO[id].required, achieved: null, progress: 0 })),
    ref: { emissions: S.accounts.emissions, lifeExpectancy: S.demography.lifeExpectancy },
    status: 'en_cours', defeat: null, sandbox: false, risk: { defaut: 0, troubles: 0, marketMonths: 0, unrestMonths: 0 },
  };
  S.victory = V;
  evaluate(S);
  return V;
}

/** Calcule les critères de chaque condition dans l'état courant (sans faire avancer les compteurs). */
export function evaluate(S: GameState) {
  const V = S.victory!;
  const A = S.accounts as GameState['accounts'] & { renewableShareElec?: number; renewableShareFinal?: number; netEmissions?: number };
  const u = S.demography.unemployed / Math.max(1, S.demography.labourForce);
  const growth = S.history.growth?.at(-1) ?? 0;
  const debtRatio = S.finance.debt / Math.max(1, A.gdp);
  const deficit = -A.balance / Math.max(1, A.gdp);
  const P = S.politics;
  const byId = Object.fromEntries(V.conditions.map((c) => [c.id, c])) as Record<VictoryId, VictoryCondition>;
  const net = A.netEmissions;
  byId.ecologique.criteria = [
    net !== undefined
      ? crit('neutralite', 'Émissions nettes (Mt CO₂)', net / 1e6, 0, 'min', 'mt', V.ref.emissions / 1e6)
      : crit('emissions', 'Baisse des émissions depuis 2030', 1 - A.emissions / Math.max(1, V.ref.emissions), 0.55, 'max', 'pct', 0),
    crit('elec', 'Électricité renouvelable', A.renewableShareElec, 0.8, 'max', 'pct'),
    crit('finale', 'Énergie finale renouvelable', A.renewableShareFinal, 0.5, 'max', 'pct'),
    crit('env', 'Satisfaction environnementale', S.satisfaction.factors.environnement, 65, 'max', 'num'),
  ];
  byId.economique.criteria = [
    crit('croissance', 'Croissance annuelle', growth, 0.015, 'max', 'pct'),
    crit('chomage', 'Chômage', u, 0.05, 'min', 'pct'),
    crit('inflation_max', 'Inflation ≤ 3 %', S.macro.inflation, 0.03, 'min', 'pct'),
    crit('inflation_min', 'Inflation ≥ 0 %', S.macro.inflation, 0, 'max', 'pct'),
    crit('dette', 'Dette publique / PIB', debtRatio, 0.6, 'min', 'pct'),
    crit('deficit', 'Déficit / PIB', Math.max(0, deficit), 0.03, 'min', 'pct'),
  ];
  // l'inflation minimale ne doit pas pénaliser l'avancement si elle est positive (progression binaire)
  const im = byId.economique.criteria[3];
  im.progress = im.ok ? 1 : 0;
  byId.sociale.criteria = [
    crit('satisfaction', 'Satisfaction générale', S.satisfaction.overall, 70, 'max', 'num'),
    crit('pauvrete', 'Taux de pauvreté', A.poverty, 0.1, 'min', 'pct'),
    crit('gini', 'Indice de Gini', A.gini, 0.27, 'min', 'ratio'),
    crit('esperance', 'Gain d\'espérance de vie (ans)', S.demography.lifeExpectancy - V.ref.lifeExpectancy, 1, 'max', 'num', 0),
    crit('emeutes', 'Risque d\'émeutes', S.satisfaction.unrestRisk, 0.05, 'min', 'pct'),
  ];
  const seats = P ? P.parties.filter((p) => P.coalition.includes(p.id)).reduce((s, p) => s + p.seats, 0) : 0;
  byId.politique.criteria = [
    crit('elections', 'Élections gagnées', P?.electionsWon ?? 0, 2, 'max', 'num'),
    crit('majorite', 'Sièges de la coalition (part)', P ? seats / P.seatsTotal : 0, 0.5001, 'max', 'pct'),
    crit('confiance', 'Confiance', S.satisfaction.trust, 70, 'max', 'num'),
  ];
  const four: VictoryId[] = ['ecologique', 'economique', 'sociale', 'politique'];
  byId.totale.criteria = four.map((id) => crit(id, VICTORY_INFO[id].name, byId[id].achieved !== null ? 1 : byId[id].progress * 0.99, 1, 'max', 'pct'));
  for (const c of V.conditions) {
    const avail = c.criteria.filter((k) => k.available);
    const crit01 = avail.length ? avail.reduce((s, k) => s + k.progress, 0) / avail.length : 0;
    const allOk = avail.every((k) => k.ok);
    c.progress = c.achieved !== null ? 1 : clamp(0.75 * crit01 + 0.25 * (allOk ? c.held / c.required : 0), 0, 1);
  }
}

/** Pas mensuel : compteurs de maintien, victoires, défaites. */
export function victoryStep(S: GameState) {
  const V = S.victory;
  if (!V) return;
  evaluate(S);
  for (const c of V.conditions) {
    if (c.achieved !== null) continue;
    const ok = c.criteria.filter((k) => k.available).every((k) => k.ok);
    c.held = ok ? c.held + 1 : 0;
    if (c.held >= c.required) {
      c.achieved = S.month;
      c.progress = 1;
      S.notices.push({ id: S.noticeSeq++, month: S.month, kind: 'good', title: `🏆 ${c.name} !`, text: `Objectifs tenus pendant ${c.required} mois. ${c.description}` });
    }
  }
  evaluate(S); // la victoire totale tient compte des victoires obtenues ce mois-ci
  const tot = V.conditions.find((c) => c.id === 'totale')!;
  if (tot.achieved === null && tot.criteria.every((k) => k.ok)) {
    tot.achieved = S.month;
    tot.held = 1;
    S.notices.push({ id: S.noticeSeq++, month: S.month, kind: 'good', title: '🏆 Victoire totale !', text: 'Vous avez mené le pays à la réussite écologique, économique, sociale et politique.' });
  }
  // ---- défaites ----
  const debtRatio = S.finance.debt / Math.max(1, S.accounts.gdp);
  V.risk.marketMonths = S.finance.marketRate >= 0.12 ? V.risk.marketMonths + 1 : 0;
  V.risk.unrestMonths = S.satisfaction.unrestRisk >= 0.5 || S.satisfaction.overall < 25 ? V.risk.unrestMonths + 1 : 0;
  V.risk.defaut = clamp(Math.max((debtRatio - 1) / 1, V.risk.marketMonths / 6, (S.finance.marketRate - 0.05) / 0.07), 0, 1);
  V.risk.troubles = clamp(Math.max(V.risk.unrestMonths / 12, S.satisfaction.unrestRisk), 0, 1);
  if (V.status === 'defaite' || V.sandbox) return;
  if (debtRatio >= 2 || V.risk.marketMonths >= 6) defeat(S, 'defaut', `Défaut de paiement : les marchés refusent de prêter à l'État (dette ${(debtRatio * 100).toFixed(0)} % du PIB, taux ${(S.finance.marketRate * 100).toFixed(1).replace('.', ',')} %).`);
  else if (V.risk.unrestMonths >= 12) defeat(S, 'troubles', 'Troubles sociaux prolongés : après un an d\'émeutes et de blocages, le gouvernement est contraint à la démission.');
  else if (S.politics?.defeated) defeat(S, 'elections', 'Perte des élections : votre coalition n\'a plus de majorité et ne peut gouverner. Votre mandat prend fin.');
}

function defeat(S: GameState, reason: DefeatReason, text: string) {
  const V = S.victory!;
  V.status = 'defaite';
  V.defeat = { reason, month: S.month, text };
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind: 'bad', title: '⛔ Fin de mandat', text });
}

/** Permet de poursuivre la partie en mode libre après une défaite (sans nouvelle défaite possible). */
export function continueAfterDefeat(S: GameState): { ok: boolean; msg: string } {
  const V = S.victory;
  if (!V || V.status !== 'defaite') return { ok: false, msg: 'Aucune défaite à lever' };
  V.sandbox = true;
  V.status = 'en_cours';
  if (S.politics?.defeated) {
    S.politics.defeated = null;
    S.politics.mode = 'minorite';
  }
  return { ok: true, msg: 'Partie poursuivie en mode libre' };
}
