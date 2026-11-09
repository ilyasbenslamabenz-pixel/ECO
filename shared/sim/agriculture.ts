// Moteur de l'agriculture et de l'alimentation : terres, exploitations, cultures et élevage, pratiques
// (conventionnel, biologique, précision), intrants (pesticides, engrais azotés), irrigation et eau, santé des sols,
// biodiversité, climat (sécheresses), production, autosuffisance, échanges, prix alimentaires, émissions (CH4, N2O, CO2).
// Les effets s'appliquent au secteur « agriculture » (productivité, intensité d'émission) et à l'indice des prix.
import { mulberry32 } from '../noise';
import { SECTOR_INDEX } from './data';
import { addSpending, advanceProjects, applyTechFactor, approach, placeSite, clamp, newProject, newTechFactor, popOf, type Built, type Project, type Site, type TechFactor } from './sectors';
import type { GameState, Policy } from './types';

export type Practice = 'conventionnel' | 'bio' | 'precision';
export const PRACTICES: Practice[] = ['conventionnel', 'bio', 'precision'];
/** Hypothèses par pratique : rendement relatif, usage de pesticides (indice), azote minéral (kg N/ha), énergie (indice), coût de production relatif. */
export const PRACTICE_DEFS: Record<Practice, { name: string; yield: number; pesticide: number; nitrogen: number; energy: number; cost: number }> = {
  conventionnel: { name: 'Conventionnel', yield: 1, pesticide: 1, nitrogen: 140, energy: 1, cost: 1 },
  bio: { name: 'Biologique', yield: 0.72, pesticide: 0.08, nitrogen: 35, energy: 1.1, cost: 1.12 },
  precision: { name: 'Agriculture de précision', yield: 1.04, pesticide: 0.7, nitrogen: 110, energy: 0.88, cost: 0.97 },
};
const GWP_CH4 = 28; // pouvoir de réchauffement global à 100 ans
const GWP_N2O = 265;
const CROP_VALUE = 0.55; // part des cultures dans la valeur de la production (le reste : élevage)
const IRRIGATED_BONUS = 0.35; // surcroît de rendement des surfaces irriguées
const WATER_M3_PER_HA = 2200; // irrigation moyenne (m³/ha/an)
const LIVESTOCK_CH4_T_PER_LU = 0.09; // méthane entérique + effluents (t CH4 / UGB / an)
const N2O_PER_KG_N = 0.0157e-3 * 1.4; // t N2O par kg N appliqué (facteur d'émission direct + indirect)
const SELF_SUFFICIENCY0 = 0.1; // cité-État : 10 % de l'alimentation produite sur place, le reste importé

export interface AgriculturePolicy {
  bioAid: number; // aide à la conversion et au maintien en bio (€/ha/an)
  precisionAid: number; // aide à l'équipement de précision (€/ha/an)
  pesticideReduction: number; // réduction réglementaire des pesticides (0..0,8)
  fertilizerReduction: number; // réduction des engrais azotés (0..0,6)
  soilProtection: number; // couverts, haies, rotations : part des terres couvertes (0..1), aidée à 80 €/ha
  waterEfficiency: number; // irrigation économe (goutte-à-goutte, réutilisation) : 0..1, aidée à 400 €/ha irrigué
  herdReduction: number; // réduction aidée du cheptel bovin (0..0,4), 250 €/UGB/an
}
export const DEFAULT_AGRICULTURE_POLICY: AgriculturePolicy = { bioAid: 0, precisionAid: 0, pesticideReduction: 0, fertilizerReduction: 0, soilProtection: 0, waterEfficiency: 0, herdReduction: 0 };
export function sanitizeAgriculturePolicy(i: Partial<AgriculturePolicy> | undefined, c: AgriculturePolicy = DEFAULT_AGRICULTURE_POLICY): AgriculturePolicy {
  const n = (v: unknown, a: number, b: number, d: number) => (Number.isFinite(Number(v)) ? clamp(Number(v), a, b) : d);
  return {
    bioAid: n(i?.bioAid, 0, 1500, c.bioAid), precisionAid: n(i?.precisionAid, 0, 600, c.precisionAid),
    pesticideReduction: n(i?.pesticideReduction, 0, 0.8, c.pesticideReduction), fertilizerReduction: n(i?.fertilizerReduction, 0, 0.6, c.fertilizerReduction),
    soilProtection: n(i?.soilProtection, 0, 1, c.soilProtection), waterEfficiency: n(i?.waterEfficiency, 0, 1, c.waterEfficiency), herdReduction: n(i?.herdReduction, 0, 0.4, c.herdReduction),
  };
}

export interface AgricultureState {
  landHa: number; // surface agricole utile
  cropHa: number; // cultures
  grassHa: number; // prairies
  farms: number; // exploitations
  livestock: number; // cheptel (unités de gros bétail)
  practices: Record<Practice, number>; // parts des surfaces
  irrigatedShare: number; // part des cultures irriguées
  pesticideApplied: number; // effort de réduction des pesticides effectivement appliqué (0..0,8)
  fertilizerApplied: number;
  soilHealth: number; // 0..1
  biodiversity: number; // 0..1
  drought: number; // intensité de sécheresse du mois (0..1)
  droughtResistance: number; // réduction de sensibilité (semences, recherche) 0..0,5
  yieldIndex: number; // rendement des cultures (1 = initial)
  production: number; // indice de production agricole (1 = initial)
  consumption: number; // indice de la demande alimentaire (1 = initial)
  selfSufficiency: number; // production / consommation (en valeur)
  imports: number; // importations alimentaires (indice de valeur, 1 = initial)
  exports: number;
  farmPrice: number; // prix agricoles à la production (1 = initial)
  foodPrice: number; // prix alimentaires relatifs à la consommation (1 = initial), répercutés sur l'indice des prix
  foodInflation: number; // glissement annuel des prix alimentaires à la consommation
  pesticideKg: number; // kg de substances actives / an
  nitrogenT: number; // t d'azote minéral / an
  waterM3: number; // prélèvements d'eau agricoles (m³/an)
  emissions: { ch4: number; n2o: number; co2: number; total: number; ch4t: number; n2ot: number }; // tCO2e/an (et tonnes de gaz)
  aidCost: number; // coût budgétaire des aides (€/an)
  projects: Project[];
  built: Built[];
  projectSeq: number;
  sites: Site[]; // périmètres irrigués et programmes localisés (placés automatiquement près des communes agricoles)
  siteSeq: number;
  droughtEvent: { intensity: number; months: number } | null; // sécheresse imposée (crise, scénario)
  tech: TechFactor;
  base: { yield: number; production: number; ch4: number; n2o: number; co2: number; outputReal: number; pop: number; ss: number; prodValue: number; soil: number; bio: number; precision: number; irrigated: number; cost: number; livestock: number; biodiv: number };
}

/** Climat déterministe : sécheresse estivale (juin–septembre) certaines années, tirée de la graine du pays. */
export function climateDrought(seed: number, month: number): number {
  if (month < 12) return 0; // première année : climat normal (état de référence)
  const m = month % 12;
  if (m < 5 || m > 8) return 0;
  const r = mulberry32(seed * 7919 + Math.floor(month / 12) * 104729)();
  return r > 0.85 ? ((r - 0.85) / 0.15) * 0.6 : 0;
}

export function initAgriculture(S: GameState): AgricultureState {
  const C = S.country;
  const landHa = C.width * C.depth * 100 * 0.2; // ceinture maraîchère et céréalière périurbaine : 20 % du territoire
  const s = S.sectors[SECTOR_INDEX.agriculture];
  const A: AgricultureState = {
    landHa, cropHa: landHa * 0.85, grassHa: landHa * 0.15, farms: s.firms, livestock: landHa * 0.15 * 1.1,
    practices: { conventionnel: 0.8, bio: 0.11, precision: 0.09 }, irrigatedShare: 0.07, pesticideApplied: 0, fertilizerApplied: 0,
    soilHealth: 0.6, biodiversity: 0.5, drought: 0, droughtResistance: 0, yieldIndex: 1, production: 1, consumption: 1, selfSufficiency: SELF_SUFFICIENCY0,
    imports: 1, exports: 1, farmPrice: 1, foodPrice: 1, foodInflation: 0, pesticideKg: 0, nitrogenT: 0, waterM3: 0,
    emissions: { ch4: 0, n2o: 0, co2: 0, total: 0, ch4t: 0, n2ot: 0 }, aidCost: 0, projects: [], built: [], projectSeq: 1, sites: [], siteSeq: 1, droughtEvent: null,
    tech: newTechFactor(s),
    base: { yield: 1, production: 1, ch4: 0, n2o: 0, co2: 0, outputReal: s.output / S.macro.priceLevel, pop: popOf(S), ss: SELF_SUFFICIENCY0, prodValue: 1, soil: 0.6, bio: 0.11, precision: 0.09, irrigated: 0.07, cost: 1, livestock: landHa * 0.15 * 1.1, biodiv: 0.5 },
  };
  computeAgriculture(S, S.policy, A, true);
  return A;
}

function computeAgriculture(S: GameState, P: Policy, G: AgricultureState, init: boolean) {
  const AP = P.agriculture ?? DEFAULT_AGRICULTURE_POLICY;
  const B = G.base;
  const pr = G.practices;
  // 1. Rendement des cultures
  const pestR = G.pesticideApplied;
  const fertR = G.fertilizerApplied;
  const penalty = (p: Practice) => (p === 'bio' ? 1 : 1 - (p === 'precision' ? 0.1 : 0.18) * pestR - (p === 'precision' ? 0.08 : 0.15) * fertR);
  const practiceYield = PRACTICES.reduce((t, p) => t + pr[p] * PRACTICE_DEFS[p].yield * penalty(p), 0);
  const d = G.drought * (1 - G.droughtResistance);
  const waterOk = 1 - 0.5 * Math.max(0, d - 0.5); // restrictions d'irrigation en sécheresse sévère
  const irrigation = 1 + G.irrigatedShare * IRRIGATED_BONUS;
  const droughtLoss = (1 - G.irrigatedShare) * 0.45 * d + G.irrigatedShare * 0.1 * d / waterOk;
  const soilF = (0.7 + 0.5 * G.soilHealth) / (0.7 + 0.5 * B.soil);
  const rawYield = practiceYield * irrigation * soilF * (1 - droughtLoss);
  if (init) B.yield = rawYield;
  G.yieldIndex = rawYield / B.yield;
  // 2. Élevage (les prairies souffrent aussi de la sécheresse : achats de fourrage, abattages)
  const livestockYield = 1 - 0.2 * d;
  G.production = CROP_VALUE * G.yieldIndex + (1 - CROP_VALUE) * (G.livestock / B.livestock) * livestockYield;
  // 3. Demande, autosuffisance, échanges
  const pop = popOf(S);
  G.consumption = pop / B.pop;
  G.selfSufficiency = (B.ss * G.production) / G.consumption;
  // importations = besoins non couverts par la production locale (indice 1 = initial) ; exportations de spécialités ∝ production
  G.imports = Math.max(0, G.consumption - B.ss * G.production) / Math.max(0.01, 1 - B.ss);
  G.exports = G.production;
  // 4. Prix : rareté relative (amortie par les importations) et coûts de production (pratiques, énergie, eau)
  const cost = PRACTICES.reduce((t, p) => t + pr[p] * PRACTICE_DEFS[p].cost, 0) + 0.15 * (S.macro.energyPrice - 1);
  if (init) B.cost = cost;
  // prix à l'achat des produits agricoles : production locale (part = autosuffisance initiale, rareté d'élasticité 0,7)
  // et importations (prix mondiaux, renchéris lors des sécheresses régionales qui touchent aussi les fournisseurs proches)
  const scarcity = Math.pow(clamp(G.consumption / Math.max(0.05, G.production), 0.3, 4), 0.7);
  const dom = Math.min(1, B.ss);
  const importPrice = 1 + 0.25 * G.drought;
  const farmTarget = (dom * scarcity * (cost / B.cost) + (1 - dom) * importPrice);
  if (!init) G.farmPrice = approach(G.farmPrice, farmTarget, 0.25);
  G.foodPrice = 0.4 * G.farmPrice + 0.6; // prix agricole ≈ 40 % du prix alimentaire de détail
  // 5. Intrants, eau
  G.pesticideKg = G.cropHa * 2.4 * PRACTICES.reduce((t, p) => t + pr[p] * PRACTICE_DEFS[p].pesticide * (p === 'bio' ? 1 : 1 - pestR), 0);
  const nPerHa = PRACTICES.reduce((t, p) => t + pr[p] * PRACTICE_DEFS[p].nitrogen * (p === 'bio' ? 1 : 1 - fertR), 0);
  G.nitrogenT = (G.cropHa * nPerHa) / 1000;
  G.waterM3 = G.cropHa * G.irrigatedShare * WATER_M3_PER_HA * (1 + 0.5 * G.drought) * (1 - 0.3 * AP.waterEfficiency) + G.livestock * 20;
  // 6. Émissions (tCO2e)
  const ch4t = G.livestock * LIVESTOCK_CH4_T_PER_LU;
  const n2ot = G.cropHa * nPerHa * N2O_PER_KG_N + G.livestock * 0.012; // engrais + effluents
  const energyIdx = PRACTICES.reduce((t, p) => t + pr[p] * PRACTICE_DEFS[p].energy, 0) * (1 + 0.3 * (G.irrigatedShare - B.irrigated));
  const em = { ch4: ch4t * GWP_CH4, n2o: n2ot * GWP_N2O, co2: energyIdx };
  if (init) { B.ch4 = em.ch4; B.n2o = em.n2o; B.co2 = em.co2; }
  return { em, ch4t, n2ot };
}

/** Sécheresse imposée (crise climatique, scénario, tests). */
export function triggerDrought(S: GameState, intensity: number, months: number) {
  if (!S.agriculture) return;
  S.agriculture.droughtEvent = { intensity: clamp(intensity, 0, 1), months: Math.max(1, Math.round(months)) };
}

export function agricultureStep(S: GameState, P: Policy) {
  const G = S.agriculture!;
  const AP = P.agriculture ?? DEFAULT_AGRICULTURE_POLICY;
  const B = G.base;
  for (const p of advanceProjects(S, G.projects, G.built, G.sites)) completeAgricultureProject(S, G, p);
  // climat
  let drought = climateDrought(S.country.seed, S.month);
  if (G.droughtEvent) { drought = Math.max(drought, G.droughtEvent.intensity); if (--G.droughtEvent.months <= 0) G.droughtEvent = null; }
  G.drought = drought;
  // pratiques : la conversion au bio prend ~3 ans, l'équipement de précision ~2 ans
  const bioT = clamp(B.bio + 0.45 * (1 - Math.exp(-AP.bioAid / 350)), 0, 0.8);
  const precT = clamp(B.precision + 0.5 * (1 - Math.exp(-AP.precisionAid / 150)), 0, 0.8);
  G.practices.bio = approach(G.practices.bio, bioT, 1 / 36);
  G.practices.precision = approach(G.practices.precision, Math.min(precT, 0.95 - G.practices.bio), 1 / 24);
  G.practices.conventionnel = Math.max(0, 1 - G.practices.bio - G.practices.precision);
  G.pesticideApplied = approach(G.pesticideApplied, AP.pesticideReduction, 1 / 12);
  G.fertilizerApplied = approach(G.fertilizerApplied, AP.fertilizerReduction, 1 / 12);
  G.livestock = approach(G.livestock, B.livestock * (1 - AP.herdReduction), 1 / 24);
  // sols et biodiversité (évolution lente)
  const hedges = G.built.filter((b) => b.kind === 'haies').reduce((t, b) => t + b.size, 0);
  const soilT = clamp(B.soil + 0.01 * hedges + 0.3 * (G.practices.bio - B.bio) + 0.12 * (G.practices.precision - B.precision) + 0.22 * AP.soilProtection + 0.08 * G.pesticideApplied + 0.05 * G.fertilizerApplied - 0.15 * drought, 0.05, 1);
  G.soilHealth = approach(G.soilHealth, soilT, 0.008);
  const bioDivT = clamp(B.biodiv + 0.015 * hedges + 0.35 * (G.practices.bio - B.bio) + 0.25 * G.pesticideApplied + 0.12 * AP.soilProtection + 0.05 * G.fertilizerApplied - 0.1 * (G.irrigatedShare - B.irrigated) * 5, 0.05, 1);
  G.biodiversity = approach(G.biodiversity, bioDivT, 0.006);

  const prevFood = G.foodPrice;
  const res = computeAgriculture(S, P, G, false);
  // aides (€ courants) imputées aux subventions
  const Pl = S.macro.priceLevel;
  G.aidCost = (AP.bioAid * G.practices.bio * G.landHa + AP.precisionAid * G.practices.precision * G.landHa) * Pl
    + (AP.soilProtection * G.cropHa * 80 + AP.waterEfficiency * G.cropHa * G.irrigatedShare * 400 + (B.livestock - G.livestock) * 250) * Pl;
  addSpending(S, 'subventions', G.aidCost);
  // prix alimentaires → indice des prix à la consommation (poids de l'alimentation : 15 %)
  const foodShare = 0.15;
  S.macro.priceLevel *= 1 + foodShare * (G.foodPrice / prevFood - 1);
  const h = S.history.foodCPI ?? [];
  const cpi = S.macro.priceLevel * G.foodPrice;
  G.foodInflation = h.length >= 12 ? cpi / h[h.length - 12] - 1 : S.macro.inflation;
  // secteur agricole : productivité (rendements) et intensité d'émission (CH4 + N2O + énergie)
  const s = S.sectors[SECTOR_INDEX.agriculture];
  const w = { ch4: 0.48, n2o: 0.38, co2: 0.14 }; // poids des gaz dans les émissions agricoles initiales
  const rel = w.ch4 * res.em.ch4 / B.ch4 + w.n2o * res.em.n2o / B.n2o + w.co2 * res.em.co2 / B.co2;
  const act = clamp(s.output / Pl / Math.max(1, B.outputReal), 0.05, 20);
  applyTechFactor(s, G.tech, rel / act, valueProductivity(G));
  const tot = S.accounts.emissionsBySector[SECTOR_INDEX.agriculture];
  const sum = w.ch4 * res.em.ch4 / B.ch4 + w.n2o * res.em.n2o / B.n2o + w.co2 * res.em.co2 / B.co2;
  G.emissions = { ch4: tot * (w.ch4 * res.em.ch4 / B.ch4) / sum, n2o: tot * (w.n2o * res.em.n2o / B.n2o) / sum, co2: tot * (w.co2 * res.em.co2 / B.co2) / sum, total: tot, ch4t: 0, n2ot: 0 };
  G.emissions.ch4t = G.emissions.ch4 / GWP_CH4;
  G.emissions.n2ot = G.emissions.n2o / GWP_N2O;
  G.farms = s.firms;
}

/** Productivité physique du secteur (production par exploitant), relative à l'état initial. */
function valueProductivity(G: AgricultureState) {
  return clamp(G.production, 0.3, 2);
}

export type AgricultureProject = 'irrigation' | 'haies' | 'semences';
export const AGRI_PROJECTS: Record<AgricultureProject, { name: string; cost: number; months: number; maintenance: number; desc: string; max: number }> = {
  irrigation: { name: 'Réseau d\'irrigation (+20 000 ha)', cost: 120e6, months: 24, maintenance: 3e6, desc: '+20 000 ha irrigués : rendements +35 % sur ces terres et forte résistance aux sécheresses, mais plus d\'eau prélevée.', max: 10 },
  haies: { name: 'Plantation de haies et agroforesterie (5 000 km)', cost: 60e6, months: 12, maintenance: 1e6, desc: 'Biodiversité et santé des sols en hausse.', max: 10 },
  semences: { name: 'Programme de semences résistantes à la sécheresse', cost: 200e6, months: 36, maintenance: 5e6, desc: '−15 % de sensibilité des rendements à la sécheresse par programme.', max: 3 },
};

export type AgricultureAction = { type: 'agriculture:build'; project: AgricultureProject; count: number };

export function agricultureAction(S: GameState, a: AgricultureAction): { ok: boolean; msg: string } {
  const G = S.agriculture;
  if (!G) return { ok: false, msg: 'Module agriculture indisponible' };
  const d = AGRI_PROJECTS[a.project];
  if (!d) return { ok: false, msg: 'Projet inconnu' };
  const n = Math.round(Number(a.count));
  if (!Number.isFinite(n) || n < 1 || n > d.max) return { ok: false, msg: `Quantité invalide (1 à ${d.max})` };
  const p = newProject(S, G, { kind: a.project, label: `${n} × ${d.name}`, size: n, cost: d.cost * n, months: d.months, maintenance: d.maintenance * n, line: a.project === 'semences' ? 'recherche' : 'environnement' });
  if (a.project !== 'semences') {
    // placement automatique : communes les plus agricoles, tour à tour
    const ai = SECTOR_INDEX.agriculture;
    const rural = S.country.cities.filter((c) => c.kind === 'commune').sort((x, y) => y.sectorWeights[ai] - x.sectorWeights[ai]);
    const pool = rural.length ? rural : S.country.cities;
    const already = G.sites.filter((x) => x.kind === a.project).length;
    for (let k = 0; k < n; k++) {
      const c = pool[(already + k) % pool.length];
      const [x, z] = placeSite(S, c.id, 700 + G.siteSeq);
      G.sites.push({ id: G.siteSeq++, kind: a.project, label: `${a.project === 'irrigation' ? 'Périmètre irrigué' : 'Haies et agroforesterie'} de ${c.name}`, cityId: c.id, x, z, size: a.project === 'irrigation' ? 20000 : 5000, status: 'construction', since: S.month, projectId: p.id });
    }
  }
  G.projects.push(p);
  return { ok: true, msg: `${p.label} lancé : ${(p.cost / 1e6).toFixed(0)} M€ sur ${p.months} mois` };
}

function completeAgricultureProject(S: GameState, G: AgricultureState, p: Project) {
  if (p.kind === 'irrigation') G.irrigatedShare = clamp(G.irrigatedShare + (20000 * p.size) / G.cropHa, 0, 0.6);
  if (p.kind === 'haies') { G.soilHealth = clamp(G.soilHealth + 0.01 * p.size, 0, 1); G.biodiversity = clamp(G.biodiversity + 0.015 * p.size, 0, 1); }
  if (p.kind === 'semences') G.droughtResistance = clamp(G.droughtResistance + 0.15 * p.size, 0, 0.5);
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind: 'good', title: 'Agriculture : réalisation', text: `${p.label} : terminé.` });
  if (S.notices.length > 80) S.notices.shift();
}
