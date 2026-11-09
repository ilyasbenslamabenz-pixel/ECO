// Moteur des déchets et du recyclage : production par catégorie (ménages et industrie), filières (tri, recyclage,
// compostage, méthanisation, incinération, enfouissement, export), capacités des installations, coûts de traitement,
// émissions (tCO2e) et énergie récupérée. La taxe sur les déchets (policy.eco.waste) réduit la production
// (même règle que l'économie) et oriente les flux vers le tri ; les capacités se construisent (coût, délai).
import { SECTOR_INDEX } from './data';
import { addEmissions, addRevenue, advanceProjects, placeSite, clamp, newProject, popOf, type Built, type Project, type Site } from './sectors';
import type { GameState, Policy } from './types';

export const WASTE_CATS = ['menagers', 'industriels', 'organiques', 'plastiques', 'metaux', 'papier', 'electroniques'] as const;
export type WasteCat = (typeof WASTE_CATS)[number];
export const WASTE_CAT_NAMES: Record<WasteCat, string> = { menagers: 'Ordures ménagères résiduelles', industriels: 'Déchets industriels banals', organiques: 'Biodéchets', plastiques: 'Plastiques', metaux: 'Métaux', papier: 'Papiers-cartons', electroniques: 'Électroniques (DEEE)' };
const HH_MIX: Record<WasteCat, number> = { menagers: 0.3, industriels: 0, organiques: 0.33, plastiques: 0.12, metaux: 0.04, papier: 0.18, electroniques: 0.03 };
const IND_MIX: Record<WasteCat, number> = { menagers: 0, industriels: 0.55, organiques: 0.05, plastiques: 0.08, metaux: 0.2, papier: 0.12, electroniques: 0 };
const RECYCLABLE: WasteCat[] = ['plastiques', 'metaux', 'papier', 'electroniques'];
const RECYCLING_YIELD: Partial<Record<WasteCat, number>> = { plastiques: 0.6, metaux: 0.92, papier: 0.85, electroniques: 0.65 };
// facteurs d'émission (tCO2e par tonne traitée)
const EF_LANDFILL: Record<WasteCat, number> = { menagers: 0.35, industriels: 0.05, organiques: 0.9, plastiques: 0.03, metaux: 0.01, papier: 0.55, electroniques: 0.05 };
const EF_INCINERATION: Record<WasteCat, number> = { menagers: 0.45, industriels: 0.3, organiques: 0.03, plastiques: 2.3, metaux: 0.01, papier: 0.03, electroniques: 0.5 };
const EF = { tri: 0.005, recyclage: 0.02, compostage: 0.05, methanisation: 0.02, export: 0.4 };
// coûts de traitement (€ de 2030 par tonne), recettes de valorisation
const COST = { tri: 140, recyclage: 60, compostage: 55, methanisation: 75, incineration: 120, enfouissement: 65, export: 180 };
const MATERIAL_VALUE: Partial<Record<WasteCat, number>> = { plastiques: 120, metaux: 220, papier: 70, electroniques: 300 };
const MWH_PER_T = { incineration: 0.55, methanisation: 0.3 };

export type WasteRoute = 'tri' | 'recyclage' | 'compostage' | 'methanisation' | 'incineration' | 'enfouissement' | 'export';
export const WASTE_ROUTE_NAMES: Record<WasteRoute, string> = { tri: 'Tri', recyclage: 'Recyclage', compostage: 'Compostage', methanisation: 'Méthanisation', incineration: 'Incinération', enfouissement: 'Enfouissement', export: 'Export (saturation)' };

export interface WastePolicy {
  sortingIncentive: number; // tarification incitative et consignes de tri (0..1)
  organicCollection: number; // couverture de la collecte séparée des biodéchets (0..1)
  prevention: number; // prévention : consigne, réemploi, emballages (réduction des déchets ménagers, 0..0,4)
}
export const DEFAULT_WASTE_POLICY: WastePolicy = { sortingIncentive: 0, organicCollection: 0.25, prevention: 0 };
export function sanitizeWastePolicy(i: Partial<WastePolicy> | undefined, c: WastePolicy = DEFAULT_WASTE_POLICY): WastePolicy {
  const n = (v: unknown, a: number, b: number, d: number) => (Number.isFinite(Number(v)) ? clamp(Number(v), a, b) : d);
  return { sortingIncentive: n(i?.sortingIncentive, 0, 1, c.sortingIncentive), organicCollection: n(i?.organicCollection, 0, 1, c.organicCollection), prevention: n(i?.prevention, 0, 0.4, c.prevention) };
}

export interface WasteState {
  generated: Record<WasteCat, number>; // t/an
  household: number; // t/an
  industrial: number; // t/an
  perCapita: number; // kg/hab/an (ménages)
  flows: Record<WasteRoute, number>; // t/an
  capacity: { tri: number; recyclage: number; compostage: number; methanisation: number; incineration: number }; // t/an
  landfillRemaining: number; // t de capacité de stockage restante
  sortingRate: number; // part des recyclables triés (ménages)
  recyclingRate: number; // part recyclée ou valorisée en matière/organique du total
  landfillRate: number;
  cost: number; // coût net de traitement (€/an, prix courants)
  costPerCapita: number;
  energyMWh: number; // électricité récupérée (MWh/an) — pour le moteur énergie
  emissions: number; // tCO2e/an
  emissionsByRoute: Record<WasteRoute, number>;
  projects: Project[];
  built: Built[];
  projectSeq: number;
  sites: Site[]; // installations localisées (parc initial proportionné à la population + chantiers)
  siteSeq: number;
}

const taxEff = (t: number) => 1 - Math.exp(-t / 100);
/** Réduction de la production induite par la taxe déchets (même règle que economy.ts). */
const taxFactor = (t: number) => 1 - 0.25 * (1 - Math.exp(-t / 60));

function generate(S: GameState, P: Policy) {
  const WP = P.waste ?? DEFAULT_WASTE_POLICY;
  const wf = taxFactor(P.eco.waste);
  const pop = popOf(S);
  const household = pop * 0.5 * wf * (1 - WP.prevention);
  const indReal = S.sectors[SECTOR_INDEX.industrie].output / S.macro.priceLevel / 1e6;
  const industrial = indReal * 6 * wf * (S.industry?.wasteFactor ?? 1);
  const econ = pop * 0.5 * wf + indReal * 6 * wf; // valeur retenue par economy.ts
  const gen = {} as Record<WasteCat, number>;
  for (const c of WASTE_CATS) gen[c] = household * HH_MIX[c] + industrial * IND_MIX[c];
  return { gen, household, industrial, econ, pop };
}

function route(S: GameState, P: Policy, W: Pick<WasteState, 'capacity' | 'landfillRemaining'>, g: ReturnType<typeof generate>, unlimited: boolean) {
  const WP = P.waste ?? DEFAULT_WASTE_POLICY;
  const tax = P.eco.waste;
  const recyc = S.industry?.adoption.recyclage ?? 0;
  const partHH = clamp(0.42 + 0.3 * WP.sortingIncentive + 0.3 * (taxEff(tax) - taxEff(25)), 0.05, 0.95);
  const partInd = clamp(0.6 + 0.3 * (taxEff(tax) - taxEff(25)) + 0.2 * recyc, 0.05, 0.98);
  const cap = (k: keyof WasteState['capacity']) => (unlimited ? Infinity : W.capacity[k]);
  const residual = {} as Record<WasteCat, number>;
  for (const c of WASTE_CATS) residual[c] = 0;
  // 1. tri des recyclables
  const want = {} as Record<WasteCat, number>;
  let wantTot = 0;
  for (const c of RECYCLABLE) {
    const hh = g.household * HH_MIX[c];
    const ind = g.industrial * IND_MIX[c];
    want[c] = hh * partHH + ind * partInd;
    wantTot += want[c];
    residual[c] += hh + ind - want[c];
  }
  const triK = Math.min(1, cap('tri') / Math.max(1, wantTot));
  let sorted = 0;
  let recyclable = 0;
  const sortedC = {} as Record<WasteCat, number>;
  for (const c of RECYCLABLE) {
    sortedC[c] = want[c] * triK;
    residual[c] += want[c] - sortedC[c];
    sorted += sortedC[c];
    recyclable += sortedC[c] * (RECYCLING_YIELD[c] ?? 0);
  }
  // 2. recyclage (refus de tri et dépassement de capacité → résiduel)
  const recK = Math.min(1, cap('recyclage') / Math.max(1, recyclable));
  let recycled = 0;
  let materialValue = 0;
  for (const c of RECYCLABLE) {
    const r = sortedC[c] * (RECYCLING_YIELD[c] ?? 0) * recK;
    recycled += r;
    materialValue += r * (MATERIAL_VALUE[c] ?? 0);
    residual[c] += sortedC[c] - r;
  }
  // 3. biodéchets : méthanisation puis compostage
  const orgHH = g.household * HH_MIX.organiques;
  const orgInd = g.industrial * IND_MIX.organiques;
  const collected = orgHH * WP.organicCollection * clamp(0.75 + 0.2 * WP.sortingIncentive, 0, 1) + orgInd * 0.6;
  const meth = Math.min(collected, cap('methanisation'));
  const comp = Math.min(collected - meth, cap('compostage'));
  residual.organiques += orgHH + orgInd - meth - comp;
  residual.menagers += g.household * HH_MIX.menagers;
  residual.industriels += g.industrial * IND_MIX.industriels;
  residual.electroniques += 0;
  // 4. résiduel : incinération (avec valorisation énergétique) puis enfouissement, export si les sites sont pleins
  const resTot = WASTE_CATS.reduce((t, c) => t + residual[c], 0);
  const inc = Math.min(resTot, unlimited ? resTot * 0.55 : W.capacity.incineration);
  const rest = resTot - inc;
  const land = unlimited ? rest : Math.min(rest, Math.max(0, W.landfillRemaining) * 12);
  const exp = rest - land;
  const fInc = resTot > 0 ? inc / resTot : 0;
  const fLand = resTot > 0 ? land / resTot : 0;
  const fExp = resTot > 0 ? exp / resTot : 0;
  const em: Record<WasteRoute, number> = { tri: sorted * EF.tri, recyclage: recycled * EF.recyclage, compostage: comp * EF.compostage, methanisation: meth * EF.methanisation, incineration: 0, enfouissement: 0, export: exp * EF.export };
  for (const c of WASTE_CATS) { em.incineration += residual[c] * fInc * EF_INCINERATION[c]; em.enfouissement += residual[c] * fLand * EF_LANDFILL[c]; }
  void fExp;
  const flows: Record<WasteRoute, number> = { tri: sorted, recyclage: recycled, compostage: comp, methanisation: meth, incineration: inc, enfouissement: land, export: exp };
  const Pl = S.macro.priceLevel;
  const cost = (sorted * COST.tri + recycled * COST.recyclage + comp * COST.compostage + meth * COST.methanisation + inc * COST.incineration + land * COST.enfouissement + exp * COST.export - materialValue) * Pl
    + (land + exp) * tax;
  return { flows, em, cost, partHH, collected };
}

export function initWaste(S: GameState): WasteState {
  const g = generate(S, S.policy);
  const r = route(S, S.policy, { capacity: { tri: 0, recyclage: 0, compostage: 0, methanisation: 0, incineration: 0 }, landfillRemaining: 0 }, g, true);
  const headroom = 1.08;
  const W: WasteState = {
    generated: g.gen, household: g.household, industrial: g.industrial, perCapita: (g.household / g.pop) * 1000, flows: r.flows,
    capacity: { tri: r.flows.tri * headroom, recyclage: r.flows.recyclage * headroom, compostage: Math.max(1, r.flows.compostage) * headroom, methanisation: Math.max(1, r.flows.methanisation) * headroom, incineration: r.flows.incineration },
    landfillRemaining: r.flows.enfouissement * 18, sortingRate: r.partHH, recyclingRate: 0, landfillRate: 0, cost: r.cost, costPerCapita: r.cost / g.pop, energyMWh: 0,
    emissions: 0, emissionsByRoute: r.em, projects: [], built: [], projectSeq: 1, sites: [], siteSeq: 1,
  };
  // répartition initiale entre méthanisation et compostage : 30 % / 70 % des biodéchets collectés
  const org = r.flows.methanisation + r.flows.compostage;
  W.capacity.methanisation = org * 0.3 * headroom;
  W.capacity.compostage = org * 0.7 * headroom;
  finish(S, W, route(S, S.policy, W, g, false), g);
  // parc initial d'installations : nombre proportionné aux capacités, réparti entre les villes par taille décroissante
  const ranked = S.country.cities.map((c) => c.id).sort((p, q) => S.cities[q].population - S.cities[p].population);
  const unit: Record<WasteFacility, number> = { tri: 60_000, recyclage: 50_000, compostage: 15_000, methanisation: 25_000, incineration: 200_000, enfouissement: 3_000_000 };
  for (const k of Object.keys(unit) as WasteFacility[]) {
    const total = k === 'enfouissement' ? W.landfillRemaining : W.capacity[k];
    const n = Math.max(1, Math.round(total / unit[k]));
    // les grosses installations dans les grandes villes ; enfouissement et compostage plutôt en périphérie rurale
    const pool = k === 'enfouissement' || k === 'compostage' ? [...ranked].reverse() : ranked.filter((id) => S.country.cities[id].kind !== 'commune');
    for (let j = 0; j < n; j++) {
      const cid = (pool.length ? pool : ranked)[j % (pool.length || ranked.length)];
      const [x, z] = placeSite(S, cid, 500 + W.siteSeq, undefined, W.sites);
      W.sites.push({ id: W.siteSeq++, kind: k, label: `${WASTE_FACILITIES[k].name} de ${S.country.cities[cid].name}`, cityId: cid, x, z, size: total / n, status: 'service', since: 0 });
    }
  }
  return W;
}

function finish(S: GameState, W: WasteState, r: ReturnType<typeof route>, g: ReturnType<typeof generate>) {
  W.generated = g.gen;
  W.household = g.household;
  W.industrial = g.industrial;
  W.perCapita = (g.household / g.pop) * 1000;
  W.flows = r.flows;
  W.emissionsByRoute = r.em;
  W.emissions = Object.values(r.em).reduce((t, v) => t + v, 0);
  W.sortingRate = r.partHH;
  const total = g.household + g.industrial;
  W.recyclingRate = (r.flows.recyclage + r.flows.compostage + r.flows.methanisation) / Math.max(1, total);
  W.landfillRate = r.flows.enfouissement / Math.max(1, total);
  W.cost = r.cost;
  W.costPerCapita = r.cost / g.pop;
  W.energyMWh = r.flows.incineration * MWH_PER_T.incineration + r.flows.methanisation * MWH_PER_T.methanisation;
}

/** Pas mensuel : production, orientation des flux, émissions, recettes de la taxe sur la production simulée. */
export function wasteStep(S: GameState, P: Policy) {
  const W = S.waste!;
  for (const p of advanceProjects(S, W.projects, W.built, W.sites)) completeWasteProject(S, W, p);
  const g = generate(S, P);
  const r = route(S, P, W, g, false);
  const before = W.landfillRemaining / Math.max(1, r.flows.enfouissement); // années restantes
  W.landfillRemaining = Math.max(0, W.landfillRemaining - r.flows.enfouissement / 12);
  const after = W.landfillRemaining / Math.max(1, r.flows.enfouissement);
  if (before > 2 && after <= 2) {
    S.notices.push({ id: S.noticeSeq++, month: S.month, kind: 'warn', title: 'Déchets : stockage bientôt saturé', text: 'Moins de deux ans de capacité d\'enfouissement : au-delà, les déchets devront être exportés à grand coût. Développez le tri, le recyclage ou l\'incinération.' });
    if (S.notices.length > 80) S.notices.shift();
  }
  finish(S, W, r, g);
  const A = S.accounts;
  // la taxe porte sur les déchets réellement produits (prévention, économie circulaire)
  addRevenue(S, 'dechets', P.eco.waste * (g.household + g.industrial - g.econ));
  A.waste = g.household + g.industrial;
  addEmissions(A, W.emissions);
}

export type WasteFacility = 'tri' | 'recyclage' | 'compostage' | 'methanisation' | 'incineration' | 'enfouissement';
export const WASTE_FACILITIES: Record<WasteFacility, { name: string; capacity: number; unit: string; cost: number; months: number; maintenance: number }> = {
  tri: { name: 'Centre de tri', capacity: 100_000, unit: 't/an', cost: 40e6, months: 18, maintenance: 1.5e6 },
  recyclage: { name: 'Usine de recyclage', capacity: 80_000, unit: 't/an', cost: 60e6, months: 24, maintenance: 2e6 },
  compostage: { name: 'Plateforme de compostage', capacity: 30_000, unit: 't/an', cost: 6e6, months: 9, maintenance: 0.3e6 },
  methanisation: { name: 'Unité de méthanisation', capacity: 40_000, unit: 't/an', cost: 25e6, months: 18, maintenance: 1e6 },
  incineration: { name: 'Incinérateur avec valorisation énergétique', capacity: 200_000, unit: 't/an', cost: 250e6, months: 48, maintenance: 8e6 },
  enfouissement: { name: 'Extension d\'installation de stockage', capacity: 2_000_000, unit: 't de capacité', cost: 30e6, months: 12, maintenance: 1e6 },
};

export type WasteAction = { type: 'waste:build'; facility: WasteFacility; count: number };

export function wasteAction(S: GameState, a: WasteAction): { ok: boolean; msg: string } {
  const W = S.waste;
  if (!W) return { ok: false, msg: 'Module déchets indisponible' };
  const d = WASTE_FACILITIES[a.facility];
  if (!d) return { ok: false, msg: 'Installation inconnue' };
  const n = Math.round(Number(a.count));
  if (!Number.isFinite(n) || n < 1 || n > 10) return { ok: false, msg: 'Quantité invalide (1 à 10)' };
  // placement automatique : villes où la production de déchets est la moins couverte par ce type d'installation
  const pool = S.country.cities.filter((c) => (a.facility === 'incineration' || a.facility === 'recyclage' || a.facility === 'tri' ? c.kind !== 'commune' : true));
  const cover = new Map<number, number>();
  for (const x of W.sites) if (x.kind === a.facility && x.cityId !== null) cover.set(x.cityId, (cover.get(x.cityId) ?? 0) + x.size);
  const p = newProject(S, W, { kind: a.facility, label: `${n} × ${d.name}`, size: n, cost: d.cost * n, months: d.months, maintenance: d.maintenance * n, line: 'environnement' });
  const names: string[] = [];
  for (let k = 0; k < n; k++) {
    let best = pool[0];
    let bs = -Infinity;
    for (const c of pool) { const sc = S.cities[c.id].population / (1 + (cover.get(c.id) ?? 0) / 10000); if (sc > bs) { bs = sc; best = c; } }
    cover.set(best.id, (cover.get(best.id) ?? 0) + d.capacity);
    const [x, z] = placeSite(S, best.id, 500 + W.siteSeq);
    W.sites.push({ id: W.siteSeq++, kind: a.facility, label: `${d.name} de ${best.name}`, cityId: best.id, x, z, size: d.capacity, status: 'construction', since: S.month, projectId: p.id });
    names.push(best.name);
  }
  p.label += ` (${[...new Set(names)].join(', ')})`;
  W.projects.push(p);
  return { ok: true, msg: `${p.label} lancé : ${(p.cost / 1e6).toFixed(0)} M€ sur ${p.months} mois` };
}

function completeWasteProject(S: GameState, W: WasteState, p: Project) {
  for (const x of W.sites) if (x.projectId === p.id) { x.status = 'service'; x.since = S.month; }
  const d = WASTE_FACILITIES[p.kind as WasteFacility];
  if (!d) return;
  if (p.kind === 'enfouissement') W.landfillRemaining += d.capacity * p.size;
  else W.capacity[p.kind as keyof WasteState['capacity']] += d.capacity * p.size;
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind: 'good', title: 'Déchets : mise en service', text: `${p.label} : en service.` });
  if (S.notices.length > 80) S.notices.shift();
}
