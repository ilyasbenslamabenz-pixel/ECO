// Moteur de l'industrie et des entreprises : usines, zones industrielles, centres logistiques, production, exportations,
// programmes de transformation (modernisation, électrification, hydrogène bas carbone, récupération de chaleur,
// recyclage et économie circulaire, technologies propres). Les effets s'appliquent réellement au secteur « industrie »
// de l'économie : productivité (donc emploi et compétitivité), intensité d'émission, exportations de référence.
import { SECTOR_INDEX, SECTORS } from './data';
import { addSpending, advanceProjects, applyTechFactor, placeSite, clamp, newProject, newTechFactor, type Built, type Project, type Site, type TechFactor } from './sectors';
import type { GameState, Policy } from './types';

export type IndustryProgram = 'modernisation' | 'electrification' | 'hydrogene' | 'chaleur' | 'recyclage' | 'proprete';
export const INDUSTRY_PROGRAMS: IndustryProgram[] = ['modernisation', 'electrification', 'hydrogene', 'chaleur', 'recyclage', 'proprete'];

interface ProgramDef {
  name: string;
  desc: string;
  trancheCost: number; // coût d'une tranche (€ de 2030)
  months: number; // délai de réalisation
  step: number; // gain d'adoption par tranche (part de l'industrie concernée, avec rendements décroissants)
  productivity: number; // effet sur la productivité à adoption complète (part)
  emission: number; // réduction de l'intensité d'émission directe à adoption complète
  energy: number; // réduction de la consommation d'énergie finale à adoption complète
  electricity: number; // hausse de la part électrique de l'énergie (points) à adoption complète
  waste: number; // réduction des déchets industriels à adoption complète
}
/** Hypothèses chiffrées des programmes (à adoption complète du parc industriel). */
export const PROGRAM_DEFS: Record<IndustryProgram, ProgramDef> = {
  modernisation: { name: 'Modernisation & automatisation', desc: 'Robotisation, numérique, procédés : forte hausse de productivité, un peu moins d\'énergie.', trancheCost: 400e6, months: 18, step: 0.05, productivity: 0.2, emission: 0.05, energy: 0.1, electricity: 0.03, waste: 0.05 },
  electrification: { name: 'Électrification des procédés', desc: 'Fours, chaudières et engins électriques : supprime la combustion directe (les émissions dépendent alors du mix électrique).', trancheCost: 300e6, months: 24, step: 0.05, productivity: -0.01, emission: 0.45, energy: 0.2, electricity: 0.45, waste: 0 },
  hydrogene: { name: 'Hydrogène bas carbone', desc: 'Acier et chimie (ammoniac) à l\'hydrogène électrolytique : décarbonation lourde, coûteuse en électricité.', trancheCost: 500e6, months: 36, step: 0.04, productivity: -0.04, emission: 0.3, energy: -0.05, electricity: 0.15, waste: 0 },
  chaleur: { name: 'Récupération de chaleur fatale', desc: 'Échangeurs, pompes à chaleur industrielles, réseaux de chaleur : économies d\'énergie rapides.', trancheCost: 150e6, months: 12, step: 0.06, productivity: 0.02, emission: 0.08, energy: 0.12, electricity: 0.02, waste: 0 },
  recyclage: { name: 'Recyclage & économie circulaire', desc: 'Matières recyclées, écoconception, réemploi : moins de déchets et de matières premières.', trancheCost: 200e6, months: 18, step: 0.05, productivity: 0.03, emission: 0.12, energy: 0.06, electricity: 0, waste: 0.35 },
  proprete: { name: 'Technologies propres (captage du CO₂)', desc: 'Captage et stockage du carbone, procédés sans émissions : efficace mais coûteux à exploiter.', trancheCost: 600e6, months: 36, step: 0.04, productivity: -0.03, emission: 0.35, energy: -0.04, electricity: 0.02, waste: 0 },
};

export type IndustryFacility = 'zone' | 'logistique';
export const INDUSTRY_FACILITIES: Record<IndustryFacility, { name: string; cost: number; months: number; maintenance: number; desc: string }> = {
  zone: { name: 'Zone industrielle (60 entreprises)', cost: 180e6, months: 24, maintenance: 4e6, desc: '+60 entreprises, +2 % d\'exportations industrielles' },
  logistique: { name: 'Centre logistique', cost: 90e6, months: 18, maintenance: 2e6, desc: '+1 % de productivité du transport, +0,8 % d\'exportations industrielles' },
};

export interface IndustryPolicy {
  greenSubsidy: number; // part de l'investissement industriel propre subventionnée par l'État (0..0,5)
}
export const DEFAULT_INDUSTRY_POLICY: IndustryPolicy = { greenSubsidy: 0 };
export function sanitizeIndustryPolicy(i: Partial<IndustryPolicy> | undefined, c: IndustryPolicy = DEFAULT_INDUSTRY_POLICY): IndustryPolicy {
  const v = Number(i?.greenSubsidy);
  return { greenSubsidy: Number.isFinite(v) ? clamp(v, 0, 0.5) : c.greenSubsidy };
}

export interface IndustryState {
  adoption: Record<IndustryProgram, number>; // part du parc industriel transformée (0..1)
  factories: number; // usines (entreprises industrielles)
  zones: number; // zones industrielles
  zoneCapacity: number; // entreprises accueillies
  logisticsCenters: number;
  production: number; // production réelle (VA en € de 2030 / an)
  exports: number; // exportations industrielles estimées (€/an)
  employees: number;
  productivityIndex: number; // facteur technologique appliqué (1 = initial)
  emissionIndex: number; // facteur appliqué à l'intensité d'émission
  exportIndex: number;
  energyMWh: number; // consommation d'énergie finale (MWh/an)
  electricityShare: number;
  electricityMWh: number; // demande électrique (MWh/an) — pour le moteur énergie
  hydrogenT: number; // hydrogène bas carbone consommé (t/an)
  wasteFactor: number; // facteur sur les déchets industriels (1 = initial)
  recycledShare: number; // part de matières recyclées dans les intrants
  emissions: number; // émissions directes du secteur (tCO2/an)
  privateGreenInvestment: number; // investissement propre privé déclenché par la subvention (€/an)
  subsidyCost: number; // coût budgétaire de la subvention (€/an)
  projects: Project[];
  built: Built[];
  projectSeq: number;
  sites: Site[]; // centres logistiques et nouvelles zones (les zones initiales figurent dans country.infra)
  siteSeq: number;
  tech: TechFactor;
  transportTech: TechFactor; // centres logistiques → productivité du secteur transport
  base: { energyMWh: number; output: number };
}

export function initIndustry(S: GameState): IndustryState {
  const I = buildIndustry(S);
  // centres logistiques existants : dans les quartiers les plus proches du port et des zones industrielles
  const towns = industrialQuarters(S);
  for (let k = 0; k < I.logisticsCenters && towns.length; k++) {
    const c = towns[k % towns.length];
    const [x, z] = placeSite(S, c.id, 200 + k, ['autoroute', 'nationale'], I.sites);
    I.sites.push({ id: I.siteSeq++, kind: 'logistique', label: `Centre logistique — ${c.name}${k >= towns.length ? ` n°${Math.floor(k / towns.length) + 1}` : ''}`, cityId: c.id, x, z, size: 1, status: 'service', since: 0 });
  }
  return I;
}

/** Quartiers classés par proximité du port et des zones industrielles existantes (les 6 premiers). */
function industrialQuarters(S: GameState) {
  const hubs = S.country.infra.filter((i) => i.type === 'port' || i.type === 'zone_industrielle');
  const dist = (c: { x: number; z: number }) => (hubs.length ? Math.min(...hubs.map((h) => Math.hypot(h.x - c.x, h.z - c.z))) : 0);
  const sorted = [...S.country.cities].sort((p, q) => dist(p) - dist(q) || S.cities[q.id].population - S.cities[p.id].population);
  return sorted.slice(0, Math.max(1, Math.min(6, sorted.length)));
}

function buildIndustry(S: GameState): IndustryState {
  const s = S.sectors[SECTOR_INDEX.industrie];
  const zones = S.country.infra.filter((i) => i.type === 'zone_industrielle');
  const real = s.output / S.macro.priceLevel;
  const energy = (real / 1e6) * SECTORS[SECTOR_INDEX.industrie].energyIntensity;
  const adoption = Object.fromEntries(INDUSTRY_PROGRAMS.map((p) => [p, 0])) as Record<IndustryProgram, number>;
  return {
    adoption, factories: s.firms, zones: zones.length, zoneCapacity: zones.reduce((t, z) => t + z.capacity, 0),
    logisticsCenters: Math.round(S.sectors[SECTOR_INDEX.transport].employees / 8000), production: real, exports: s.baseExport * S.macro.worldPrice * S.macro.worldDemand, employees: s.employees,
    productivityIndex: 1, emissionIndex: 1, exportIndex: 1, energyMWh: energy, electricityShare: 0.38, electricityMWh: energy * 0.38, hydrogenT: 0,
    wasteFactor: 1, recycledShare: 0.2, emissions: S.accounts.emissionsBySector[SECTOR_INDEX.industrie] ?? 0, privateGreenInvestment: 0, subsidyCost: 0,
    projects: [], built: [], projectSeq: 1, sites: [], siteSeq: 1, tech: newTechFactor(s), transportTech: newTechFactor(S.sectors[SECTOR_INDEX.transport]),
    base: { energyMWh: energy, output: real },
  };
}

/** Effets combinés des programmes (facteurs multiplicatifs). */
export function industryFactors(a: Record<IndustryProgram, number>) {
  let prod = 1, em = 1, en = 1, elec = 0, waste = 1;
  for (const p of INDUSTRY_PROGRAMS) {
    const d = PROGRAM_DEFS[p];
    prod *= 1 + d.productivity * a[p];
    em *= 1 - d.emission * a[p];
    en *= 1 - d.energy * a[p];
    elec += d.electricity * a[p];
    waste *= 1 - d.waste * a[p];
  }
  return { prod, em: Math.max(0.05, em), en: Math.max(0.2, en), elec, waste: Math.max(0.2, waste) };
}

const grow = (a: number, step: number) => clamp(a + step * (1 - a), 0, 1);

export function industryStep(S: GameState, P: Policy) {
  const I = S.industry!;
  const IP = P.industry ?? DEFAULT_INDUSTRY_POLICY;
  const s = S.sectors[SECTOR_INDEX.industrie];
  const Pl = S.macro.priceLevel;
  for (const p of advanceProjects(S, I.projects, I.built, I.sites)) completeIndustryProject(S, I, p);

  // investissement propre privé déclenché par la subvention : jusqu'à 30 % de l'investissement industriel
  const extra = s.investment * 0.6 * IP.greenSubsidy; // €/an
  I.privateGreenInvestment = extra;
  I.subsidyCost = extra * IP.greenSubsidy;
  addSpending(S, 'subventions', I.subsidyCost);
  if (extra > 0) {
    // réparti entre électrification, chaleur et recyclage, au prorata du coût d'une tranche
    for (const p of ['electrification', 'chaleur', 'recyclage'] as IndustryProgram[]) {
      const d = PROGRAM_DEFS[p];
      const tranches = (extra / 3 / 12) / (d.trancheCost * Pl); // tranches financées ce mois
      I.adoption[p] = grow(I.adoption[p], d.step * tranches);
    }
  }

  const f = industryFactors(I.adoption);
  const portUtil = S.transport?.ports.utilisation ?? 0;
  const portF = portUtil > 0.95 ? clamp(1 - 0.5 * (portUtil - 0.95), 0.85, 1) : 1; // saturation portuaire
  const built = (k: string) => I.built.filter((b) => b.kind === k).reduce((t, b) => t + b.size, 0);
  const exportF = (1 + 0.02 * built('zone')) * (1 + 0.008 * built('logistique')) * portF;
  applyTechFactor(s, I.tech, f.em, f.prod, exportF);
  applyTechFactor(S.sectors[SECTOR_INDEX.transport], I.transportTech, I.transportTech.emission, 1 + 0.01 * built('logistique'));

  I.productivityIndex = f.prod;
  I.emissionIndex = f.em;
  I.exportIndex = exportF;
  I.factories = s.firms;
  I.employees = s.employees;
  I.production = s.output / Pl;
  I.exports = s.baseExport * S.macro.worldPrice * S.macro.worldDemand;
  I.energyMWh = (I.production / 1e6) * SECTORS[SECTOR_INDEX.industrie].energyIntensity * f.en;
  I.electricityShare = clamp(0.38 + f.elec * (1 - 0.38), 0, 1);
  I.hydrogenT = I.adoption.hydrogene * 600_000 * (I.production / I.base.output); // 600 kt/an à adoption complète
  I.electricityMWh = I.energyMWh * I.electricityShare + I.hydrogenT * 52; // 52 MWh par tonne d'H2 électrolytique
  I.wasteFactor = f.waste;
  I.recycledShare = clamp(0.2 + 0.5 * I.adoption.recyclage, 0, 0.9);
  I.emissions = S.accounts.emissionsBySector[SECTOR_INDEX.industrie];
}

export type IndustryAction =
  | { type: 'industry:program'; program: IndustryProgram; tranches: number }
  | { type: 'industry:build'; facility: IndustryFacility; count: number };

export function industryAction(S: GameState, a: IndustryAction): { ok: boolean; msg: string } {
  const I = S.industry;
  if (!I) return { ok: false, msg: 'Module industrie indisponible' };
  if (a.type === 'industry:program') {
    const d = PROGRAM_DEFS[a.program];
    if (!d) return { ok: false, msg: 'Programme inconnu' };
    const n = Math.round(Number(a.tranches));
    if (!Number.isFinite(n) || n < 1 || n > 10) return { ok: false, msg: 'Nombre de tranches invalide (1 à 10)' };
    const p = newProject(S, I, { kind: `prog:${a.program}`, label: `${d.name} (${n} tranche${n > 1 ? 's' : ''})`, size: n, cost: d.trancheCost * n, months: d.months, maintenance: 0, line: 'subventions' });
    I.projects.push(p);
    return { ok: true, msg: `${p.label} engagé : ${(p.cost / 1e6).toFixed(0)} M€ sur ${p.months} mois` };
  }
  if (a.type === 'industry:build') {
    const d = INDUSTRY_FACILITIES[a.facility];
    if (!d) return { ok: false, msg: 'Équipement inconnu' };
    const n = Math.round(Number(a.count));
    if (!Number.isFinite(n) || n < 1 || n > 5) return { ok: false, msg: 'Quantité invalide (1 à 5)' };
    // placement automatique : quartiers de la zone portuaire et des zones industrielles, tour à tour
    const towns = industrialQuarters(S);
    const already = I.sites.filter((x) => x.kind === a.facility).length;
    const names: string[] = [];
    for (let k = 0; k < n; k++) {
      const c = towns[(already + k) % towns.length];
      names.push(c.name);
    }
    const p = newProject(S, I, { kind: a.facility, label: `${n} × ${d.name} (${[...new Set(names)].join(', ')})`, size: n, cost: d.cost * n, months: d.months, maintenance: d.maintenance * n, line: 'infrastructures' });
    // chaque équipement est un élément de la carte « en construction » ; le premier porte le chantier
    for (let k = 0; k < n; k++) {
      const c = towns[(already + k) % towns.length];
      const [x, z] = placeSite(S, c.id, 300 + I.siteSeq, ['autoroute', 'nationale']);
      const site: Site = { id: I.siteSeq++, kind: a.facility, label: `${a.facility === 'zone' ? 'Zone industrielle' : 'Centre logistique'} — ${c.name} (projet)`, cityId: c.id, x, z, size: 1, status: 'construction', since: S.month };
      I.sites.push(site);
      if (k === 0) p.siteId = site.id;
      else site.projectId = p.id;
    }
    I.projects.push(p);
    return { ok: true, msg: `${p.label} lancé : ${(p.cost / 1e6).toFixed(0)} M€ sur ${p.months} mois` };
  }
  return { ok: false, msg: 'Action inconnue' };
}

function completeIndustryProject(S: GameState, I: IndustryState, p: Project) {
  for (const x of I.sites) if (x.projectId === p.id) { x.status = 'service'; x.since = S.month; }
  for (const x of I.sites) if (x.status === 'service') x.label = x.label.replace(' (projet)', '');
  if (p.kind.startsWith('prog:')) {
    const prog = p.kind.slice(5) as IndustryProgram;
    I.adoption[prog] = grow(I.adoption[prog], PROGRAM_DEFS[prog].step * p.size);
  } else if (p.kind === 'zone') {
    I.zones += p.size;
    I.zoneCapacity += 60 * p.size;
    S.sectors[SECTOR_INDEX.industrie].firms += 60 * p.size;
  } else if (p.kind === 'logistique') {
    I.logisticsCenters += p.size;
  }
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind: 'good', title: 'Industrie : réalisation', text: `${p.label} : terminé.` });
  if (S.notices.length > 80) S.notices.shift();
}
