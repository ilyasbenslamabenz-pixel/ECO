// Moteur environnement et biodiversité d'une cité-État : occupation des sols (forêts périurbaines, terres agricoles,
// milieux naturels, zones humides littorales, sols artificialisés, parcs et espaces verts urbains), puits de carbone, émissions nettes, qualité de l'air et de l'eau,
// indice de biodiversité, indice de qualité environnementale, programmes publics (reboisement, aires protégées,
// parcs, restauration d'écosystèmes) et objectifs climatiques. Un appel = un mois.
// Surfaces en km² (1 km² = 100 ha), flux de carbone en t CO₂/an, montants en € courants.
import { mulberry32 } from '../noise';
import { SECTOR_INDEX } from './data';
import { SEA_MARGIN, measureLand, terrain } from './energySites';
import { clamp } from './economy';
import { addPublicFlow, energyPolicyOf, type Goal } from './energy';
import { TECHS, TECH_IDS } from './energyData';
import type { GameState, Policy } from './types';

export const LAND_CLASSES = ['foret', 'jeuneForet', 'agricole', 'naturel', 'zonesHumides', 'artificialise', 'espacesVerts', 'eau'] as const;
export type LandClass = (typeof LAND_CLASSES)[number];
export const LAND_NAMES: Record<LandClass, string> = {
  foret: 'Forêts périurbaines', jeuneForet: 'Jeunes boisements', agricole: 'Terres agricoles et maraîchères', naturel: 'Prairies, friches et collines', zonesHumides: 'Zones humides littorales',
  artificialise: 'Sols artificialisés', espacesVerts: 'Espaces verts urbains', eau: 'Lacs et cours d\'eau',
};
/** Occupation initiale des terres d'une cité-État (parts de la surface terrestre). */
const INITIAL_LAND: Record<LandClass, number> = { foret: 0.12, jeuneForet: 0, agricole: 0.11, naturel: 0.07, zonesHumides: 0.03, artificialise: 0.53, espacesVerts: 0.09, eau: 0.05 };
const INITIAL_PROTECTED = 0.08; // part de la surface terrestre en aires protégées
const URBAN_GROWTH = 0.0015; // artificialisation tendancielle (part de la surface par an)
/** Absorptions nettes annuelles par type de sol (t CO₂/km²/an). Une compensation ne réduit jamais ces bilans territoriaux. */
export const SINK: Record<LandClass, number> = { foret: 450, jeuneForet: 700, agricole: 0, naturel: 50, zonesHumides: 250, artificialise: 0, espacesVerts: 150, eau: 0 };
/** Carbone libéré lors de l'artificialisation (t CO₂/km² converti). */
const LAND_RELEASE = { foret: 15000, autre: 6000 };
const MATURITY_MONTHS = 240; // une jeune forêt devient une forêt adulte au bout de 20 ans

export type EnvProjectKind = 'reboisement' | 'aireProtegee' | 'parc' | 'restauration';
export interface EnvProjectDef { name: string; icon: string; costPerKm2: number; months: number; description: string; managementPerKm2?: number }
/** Coûts (€ de 2030 par km²) et délais des programmes environnementaux. */
export const ENV_PROJECTS: Record<EnvProjectKind, EnvProjectDef> = {
  reboisement: { name: 'Reboisement périurbain', icon: '🌲', costPerKm2: 8e5, months: 24, description: 'Plantation de forêts périurbaines diversifiées sur des friches ou des terres agricoles (8 000 €/ha). Absorbe 7 t CO₂/ha/an en croissance, forêt adulte après 20 ans.' },
  aireProtegee: { name: 'Aire protégée', icon: '🛡️', costPerKm2: 2e4, months: 6, managementPerKm2: 5000, description: 'Classement de milieux naturels (200 €/ha puis 50 €/ha/an de gestion) : interdiction d\'artificialiser, biodiversité accrue.' },
  parc: { name: 'Parc urbain', icon: '🌳', costPerKm2: 1.5e8, months: 18, description: 'Désimperméabilisation et création d\'espaces verts en ville (150 €/m²) : air, îlots de fraîcheur, qualité de vie.' },
  restauration: { name: 'Restauration de zones humides littorales', icon: '🦆', costPerKm2: 2e6, months: 36, description: 'Restauration de marais, mangroves et vasières littorales sur d\'anciennes terres drainées (20 000 €/ha) : puits de carbone, protection contre la submersion, épuration de l\'eau, biodiversité.' },
};

export interface EnvProject { id: number; kind: EnvProjectKind; km2: number; start: number; done: number; cost: number; paid: number; name: string; x: number; z: number }

export interface EnvironmentState {
  landTotal: number; // surface terrestre (km²)
  seaKm2: number; // surface maritime de la carte (km²) — potentiel de l'éolien en mer
  land: Record<LandClass, number>; // km²
  protectedKm2: number; // aires protégées (km²)
  plantings: { km2: number; month: number }[]; // cohortes de jeunes forêts
  artificialisationRate: number; // km²/an (dernier mois annualisé)
  energyLand: number; // emprise des installations énergétiques déjà comptée (km²)
  absorptionsBy: Record<LandClass, number>; // t CO₂/an
  absorptions: number; // t CO₂/an
  landUseEmissions: number; // t CO₂/an
  airQuality: number; // 0..1 (1 = air pur)
  waterQuality: number; // 0..1
  biodiversity: number; // indice 0..100 (100 = écosystèmes intacts)
  quality: number; // indice de qualité environnementale 0..100
  greenPerCapita: number; // m² d'espaces verts par habitant
  projects: EnvProject[];
  projectSeq: number;
  finance: { projects: number; management: number; water: number };
  calib: { air0: number; water0: number; biodiv0: number; agri0: number; ind0: number; constr0: number; land0: Record<LandClass, number>; protected0: number; net0: number; fossil0: number; green0: number; pop0: number };
}

export type EnvAction = { type: 'envProject'; kind: EnvProjectKind; km2: number } | { type: 'envCancel'; id: number };
export const ENV_ACTION_TYPES = ['envProject', 'envCancel'] as const;
export function isEnvAction(a: { type?: unknown }): a is EnvAction {
  return (ENV_ACTION_TYPES as readonly unknown[]).includes(a?.type);
}

const popOf = (S: GameState) => S.demography.cohorts.reduce((s, v) => s + v, 0);
const real = (S: GameState, id: keyof typeof SECTOR_INDEX) => S.sectors[SECTOR_INDEX[id]].output / S.macro.priceLevel;
const energyFootprint = (S: GameState) => (S.energy ? TECH_IDS.reduce((s, t) => s + S.energy!.fleet[t].mw * TECHS[t].landKm2PerMW, 0) : 0);

export function initEnvironment(S: GameState): EnvironmentState {
  const measured = measureLand(S.country);
  const landTotal = Math.max(1, Math.round(measured.land));
  const land = Object.fromEntries(LAND_CLASSES.map((k) => [k, INITIAL_LAND[k] * landTotal])) as Record<LandClass, number>;
  const pop = popOf(S);
  const env: EnvironmentState = {
    landTotal, seaKm2: Math.round(measured.sea), land, protectedKm2: INITIAL_PROTECTED * landTotal, plantings: [], artificialisationRate: 0, energyLand: energyFootprint(S),
    absorptionsBy: {} as Record<LandClass, number>, absorptions: 0, landUseEmissions: 0,
    airQuality: 0.65, waterQuality: 0.68, biodiversity: 58, quality: 0, greenPerCapita: (land.espacesVerts * 1e6) / Math.max(1, pop),
    projects: [], projectSeq: 1, finance: { projects: 0, management: 0, water: 0 },
    calib: {
      air0: S.energy?.airPollutants ?? 1, water0: 0.68, biodiv0: 58, agri0: real(S, 'agriculture'), ind0: real(S, 'industrie'), constr0: real(S, 'construction'),
      land0: { ...land }, protected0: INITIAL_PROTECTED * landTotal, net0: 0, fossil0: 0, green0: 0, pop0: pop,
    },
  };
  env.calib.green0 = env.greenPerCapita;
  S.environment = env;
  computeSinks(S, env, 0);
  env.quality = qualityIndex(env);
  if (S.energy) {
    const em = S.energy.emissions;
    em.absorptions = env.absorptions;
    em.landUse = 0;
    em.net = em.territorialGross - em.absorptions;
    em.netAfterOffsets = em.net - em.offsets;
    env.calib.net0 = Math.max(1, em.net);
    env.calib.fossil0 = Math.max(1, em.fossilCO2);
    updateGoals(S);
  }
  return env;
}

function computeSinks(S: GameState, env: EnvironmentState, landUse: number) {
  let total = 0;
  for (const k of LAND_CLASSES) {
    env.absorptionsBy[k] = env.land[k] * SINK[k];
    total += env.absorptionsBy[k];
  }
  env.absorptions = total;
  env.landUseEmissions = landUse;
}

function qualityIndex(env: EnvironmentState) {
  const green = clamp(env.greenPerCapita / 50, 0, 1); // 50 m²/hab. : niveau de référence
  return 100 * (0.3 * env.airQuality + 0.25 * env.waterQuality + 0.25 * (env.biodiversity / 100) + 0.2 * green);
}

/** Convertit `km2` d'occupation des sols, en puisant dans les sources par ordre de priorité ; renvoie la surface réellement convertie. */
function convert(env: EnvironmentState, to: LandClass, km2: number, sources: [LandClass, number][]): { done: number; fromForest: number } {
  let done = 0;
  let fromForest = 0;
  for (const [from, share] of sources) {
    const take = Math.min(env.land[from] - (from === 'foret' || from === 'naturel' || from === 'zonesHumides' ? protectedShareOf(env, from) : 0), km2 * share);
    if (take <= 0) continue;
    env.land[from] -= take;
    env.land[to] += take;
    done += take;
    if (from === 'foret') fromForest += take;
  }
  return { done, fromForest };
}

/** Part protégée d'une classe naturelle (les aires protégées sont réparties au prorata des milieux naturels). */
function protectedShareOf(env: EnvironmentState, k: LandClass) {
  const nat = env.land.foret + env.land.naturel + env.land.zonesHumides + env.land.jeuneForet;
  return nat > 0 ? (env.protectedKm2 * env.land[k]) / nat : 0;
}

export function environmentStep(S: GameState, P: Policy): void {
  const env = S.environment;
  if (!env) return;
  const EP = energyPolicyOf(P);
  const C = env.calib;
  const pop = popOf(S);
  const Pl = S.macro.priceLevel;
  // 1. Programmes : versements et achèvements
  let paid = 0;
  for (const p of env.projects) {
    if (p.paid < p.cost && S.month > p.start) {
      const pay = Math.min(p.cost - p.paid, p.cost / Math.max(1, p.done - p.start));
      p.paid += pay;
      paid += pay;
    }
    if (S.month >= p.done) completeProject(S, env, p);
  }
  env.projects = env.projects.filter((p) => S.month < p.done);
  // 2. Maturation des jeunes forêts
  for (const c of env.plantings) {
    if (S.month - c.month >= MATURITY_MONTHS) {
      const k = Math.min(c.km2, env.land.jeuneForet);
      env.land.jeuneForet -= k;
      env.land.foret += k;
      c.km2 = 0;
    }
  }
  env.plantings = env.plantings.filter((c) => c.km2 > 0);
  // 3. Artificialisation (construction, croissance démographique, installations énergétiques), limitée par le ZAN
  const constr = real(S, 'construction') / Math.max(1, C.constr0);
  const popF = clamp(pop / C.pop0, 0.5, 2);
  const urban = env.landTotal * URBAN_GROWTH * constr * popF * (1 - 0.9 * EP.zan); // km²/an
  const fp = energyFootprint(S);
  const energyNew = Math.max(0, fp - env.energyLand);
  env.energyLand = Math.max(env.energyLand, fp);
  const monthly = urban / 12 + energyNew;
  const r = convert(env, 'artificialise', monthly, [['agricole', 0.5], ['naturel', 0.35], ['foret', 0.15]]);
  if (r.done < monthly) convert(env, 'artificialise', monthly - r.done, [['agricole', 1]]); // à défaut, la ville cesse de s'étendre
  env.artificialisationRate = monthly * 12;
  const landUse = (r.fromForest * LAND_RELEASE.foret + (monthly - r.fromForest) * LAND_RELEASE.autre) * 12;
  // drainage agricole des zones humides (0,1 %/an, réduit par le ZAN)
  convert(env, 'agricole', (env.land.zonesHumides * 0.001 * (1 - 0.5 * EP.zan)) / 12, [['zonesHumides', 1]]);
  // 4. Puits de carbone
  computeSinks(S, env, landUse);
  // 5. Qualité de l'air : polluants locaux (énergie, transports, chauffage au bois, industrie, agriculture) + effet des espaces verts
  env.greenPerCapita = (env.land.espacesVerts * 1e6) / Math.max(1, pop);
  const pollution = (S.energy?.airPollutants ?? C.air0) / Math.max(1e-9, C.air0);
  const greenBonus = clamp(0.04 * (env.greenPerCapita / Math.max(1, C.green0) - 1), -0.04, 0.06);
  const airTarget = clamp(1 - 0.35 * pollution + greenBonus, 0, 1);
  env.airQuality += (airTarget - env.airQuality) * 0.3;
  // 6. Qualité de l'eau : nitrates et pesticides agricoles, rejets industriels, assainissement, zones humides épuratrices
  const agriP = real(S, 'agriculture') / Math.max(1, C.agri0);
  const indP = real(S, 'industrie') / Math.max(1, C.ind0);
  const treat = 0.12 * (1 - Math.exp(-EP.waterBudget / Math.max(1, 0.002 * S.accounts.gdp)));
  const waterTarget = clamp(C.water0 - 0.12 * (agriP - 1) - 0.06 * (indP - 1) + treat + 0.08 * (S.services.environnement - 0.8)
    + 0.08 * (env.land.zonesHumides / C.land0.zonesHumides - 1) + 0.04 * (env.land.foret / C.land0.foret - 1), 0, 1);
  env.waterQuality += (waterTarget - env.waterQuality) * 0.03;
  // 7. Biodiversité : habitats naturels, aires protégées, fragmentation (artificialisation), pollutions, pression agricole
  const L = env.landTotal;
  const natural = (l: Record<LandClass, number>) => (l.foret + 0.5 * l.jeuneForet + l.naturel + l.zonesHumides) / L;
  const bioTarget = clamp(C.biodiv0
    + 150 * (natural(env.land) - natural(C.land0))
    + 60 * (env.protectedKm2 - C.protected0) / L
    + 120 * (env.land.zonesHumides - C.land0.zonesHumides) / L
    - 120 * (env.land.artificialise - C.land0.artificialise) / L
    + 25 * (env.waterQuality - C.water0) + 15 * (env.airQuality - 0.65)
    - 6 * (agriP - 1) + 10 * (S.services.environnement - 0.8), 0, 100);
  env.biodiversity += (bioTarget - env.biodiversity) / 60;
  env.quality = qualityIndex(env);
  // 8. Finances : programmes, gestion des aires protégées créées, assainissement, compensation
  const extraProtected = Math.max(0, env.protectedKm2 - C.protected0);
  env.finance = { projects: paid * 12, management: extraProtected * (ENV_PROJECTS.aireProtegee.managementPerKm2 ?? 0) * Pl, water: EP.waterBudget };
  addPublicFlow(S, 'ecologie', env.finance.projects + env.finance.management + env.finance.water, 0);
  // 9. Émissions nettes et objectifs
  if (S.energy) {
    const em = S.energy.emissions;
    em.absorptions = env.absorptions;
    em.landUse = env.landUseEmissions;
    em.net = em.territorialGross + em.landUse - em.absorptions;
    em.netAfterOffsets = em.net - em.offsets;
    updateGoals(S);
  }
}

function completeProject(S: GameState, env: EnvironmentState, p: EnvProject) {
  if (p.kind === 'reboisement') {
    const r = convert(env, 'jeuneForet', p.km2, [['agricole', 0.8], ['naturel', 0.2]]);
    env.plantings.push({ km2: r.done, month: S.month });
  } else if (p.kind === 'aireProtegee') {
    const nat = env.land.foret + env.land.naturel + env.land.zonesHumides + env.land.jeuneForet;
    env.protectedKm2 = Math.min(nat, env.protectedKm2 + p.km2);
  } else if (p.kind === 'parc') {
    convert(env, 'espacesVerts', p.km2, [['artificialise', 1]]);
  } else if (p.kind === 'restauration') {
    convert(env, 'zonesHumides', p.km2, [['agricole', 1]]);
  }
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind: 'good', title: 'Programme environnemental achevé', text: `${p.name} est achevé.` });
  if (S.notices.length > 80) S.notices.shift();
}

/** Lieu indicatif (déterministe) d'un programme : parc dans un quartier, zone humide sur le littoral, boisement en périphérie. */
function locate(S: GameState, salt: number, kind: EnvProjectKind) {
  const C = S.country;
  const rnd = mulberry32(C.seed * 977 + salt * 31 + kind.length);
  const h = terrain(C);
  const sea = C.seaLevel + SEA_MARGIN;
  if (kind === 'parc' && C.cities.length) {
    const c = C.cities[Math.floor(rnd() * C.cities.length)];
    return { x: c.x + (rnd() - 0.5) * c.radius, z: c.z + (rnd() - 0.5) * c.radius };
  }
  const coastal = (x: number, z: number) => [0, 1, 2, 3, 4, 5, 6, 7].some((k) => h(x + Math.cos(k * Math.PI / 4) * 1, z + Math.sin(k * Math.PI / 4) * 1) < sea);
  for (let i = 0; i < 400; i++) {
    const x = -C.width / 2 + rnd() * C.width;
    const z = -C.depth / 2 + rnd() * C.depth;
    const hh = h(x, z);
    if (hh < sea) continue;
    const outside = !C.cities.some((c) => Math.hypot(c.x - x, c.z - z) < c.radius + 0.3);
    if (kind === 'restauration' ? coastal(x, z) && hh < sea + 0.03 : outside) return { x, z };
  }
  return { x: 0, z: 0 };
}

export function envQuote(S: GameState, kind: EnvProjectKind, km2: number) {
  const d = ENV_PROJECTS[kind];
  return { cost: d.costPerKm2 * km2 * S.macro.priceLevel, months: d.months, management: (d.managementPerKm2 ?? 0) * km2 * S.macro.priceLevel };
}

export function applyEnvAction(S: GameState, a: EnvAction): { ok: boolean; msg: string } {
  const env = S.environment;
  if (!env) return { ok: false, msg: 'Module environnement indisponible' };
  if (a.type === 'envCancel') {
    const p = env.projects.find((x) => x.id === Number(a.id));
    if (!p) return { ok: false, msg: 'Programme introuvable' };
    env.projects = env.projects.filter((x) => x !== p);
    return { ok: true, msg: `Programme abandonné : ${p.name}` };
  }
  const kind = a.kind;
  const def = ENV_PROJECTS[kind];
  if (!def) return { ok: false, msg: 'Programme inconnu' };
  const km2 = Math.round(Number(a.km2) * 100) / 100;
  if (!Number.isFinite(km2) || km2 < 0.01) return { ok: false, msg: 'Surface invalide' };
  const pendingOf = (k: EnvProjectKind) => env.projects.reduce((s, p) => s + (p.kind === k ? p.km2 : 0), 0);
  const L = env.land;
  const limits: Record<EnvProjectKind, number> = {
    reboisement: L.agricole * 0.3 + L.naturel * 0.2 - pendingOf('reboisement') - pendingOf('restauration'),
    aireProtegee: L.foret + L.naturel + L.zonesHumides + L.jeuneForet - env.protectedKm2 - pendingOf('aireProtegee'),
    parc: L.artificialise * 0.1 - pendingOf('parc'),
    restauration: L.agricole * 0.05 - pendingOf('restauration'),
  };
  if (km2 > limits[kind]) return { ok: false, msg: `Surface disponible insuffisante (${Math.max(0, Math.floor(limits[kind] * 100)).toLocaleString('fr-FR')} ha au maximum)` };
  const q = envQuote(S, kind, km2);
  if (q.cost > S.accounts.gdp * 0.05) return { ok: false, msg: 'Un programme ne peut dépasser 5 % du PIB' };
  const where = locate(S, env.projectSeq, kind);
  const ha = Math.round(km2 * 100).toLocaleString('fr-FR');
  const name = `${def.name} — ${ha} ha`;
  env.projects.push({ id: env.projectSeq++, kind, km2, start: S.month, done: S.month + q.months, cost: q.cost, paid: 0, name, x: where.x, z: where.z });
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind: 'info', title: 'Programme environnemental lancé', text: `${name} : ${(q.cost / 1e6).toFixed(0)} M€ sur ${q.months} mois.` });
  if (S.notices.length > 80) S.notices.shift();
  return { ok: true, msg: `${name} lancé (${q.months} mois)` };
}

/** Avancement des objectifs climatiques et énergétiques (utilisés par un futur module de victoires). */
export function updateGoals(S: GameState) {
  const E = S.energy;
  const env = S.environment;
  if (!E) return;
  const em = E.emissions;
  const net0 = env?.calib.net0 || Math.max(1, em.net);
  const fossil0 = env?.calib.fossil0 || Math.max(1, em.fossilCO2);
  const goals: Goal[] = [
    { id: 'elec100', name: '100 % d\'électricité renouvelable', value: E.elecRenShare, target: 1, progress: clamp(E.elecRenShare, 0, 1), achieved: E.elecRenShare >= 0.995, unit: '%', definition: 'Production d\'électricité renouvelable (hydraulique, solaire, éolien, géothermie, biomasse) rapportée à la consommation brute d\'électricité (production + importations − exportations), cumul des 12 derniers mois.' },
    { id: 'final100', name: '100 % d\'énergie finale renouvelable', value: E.final.renewableShare, target: 1, progress: clamp(E.final.renewableShare, 0, 1), achieved: E.final.renewableShare >= 0.995, unit: '%', definition: 'Énergie finale d\'origine renouvelable (électricité renouvelable, chaleur renouvelable, biomasse, biocarburants) rapportée à toute l\'énergie finale consommée (carburants, gaz, chaleur, électricité…), rythme annuel du mois.' },
    { id: 'netZero', name: 'Zéro émission territoriale nette', value: em.net, target: 0, progress: clamp(1 - Math.max(0, em.net) / net0, 0, 1), achieved: em.net <= 0, unit: 't CO₂e/an', definition: 'Émissions territoriales brutes + émissions liées à l\'usage des sols − absorptions des puits naturels du territoire. Les crédits de compensation achetés à l\'étranger ne sont pas déduits.' },
    { id: 'zeroFossil', name: 'Zéro CO₂ fossile brut', value: em.fossilCO2, target: 0, progress: clamp(1 - em.fossilCO2 / fossil0, 0, 1), achieved: em.fossilCO2 <= 0.01 * fossil0, unit: 't CO₂/an', definition: 'CO₂ émis par la combustion de charbon, pétrole et gaz et par les procédés industriels, sans déduction des absorptions ni de la compensation. Atteint sous 1 % du niveau initial.' },
  ];
  E.goals = goals;
}

export function environmentHistory(S: GameState): Record<string, number> {
  const env = S.environment;
  if (!env) return {};
  return {
    airQuality: env.airQuality, waterQuality: env.waterQuality, biodiversity: env.biodiversity, envQuality: env.quality,
    forestShare: (env.land.foret + env.land.jeuneForet) / env.landTotal, artifShare: env.land.artificialise / env.landTotal, protectedShare: env.protectedKm2 / env.landTotal,
  };
}
