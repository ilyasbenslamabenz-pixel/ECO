// Construction et urbanisme : programmes d'investissement décidés depuis les ministères (« construire 2 hôpitaux dans
// <quartier> »). Le moteur choisit lui-même l'emplacement dans ou près du quartier ciblé et le valide (terre ferme, pente,
// lacs, rivières, espacement, accès routier). Les chantiers apparaissent aussitôt dans `country.infra` avec
// `status: 'chantier'` (et `progress` 0..1), sont payés chaque mois sur la trésorerie puis mis en service.
// Également : amélioration, rénovation, démolition, état des équipements, comptabilisation dans les comptes publics.
import { SECTOR_INDEX, type BudgetLine } from './data';
import { makeHeightFn } from './country';
import { clamp } from './economy';
import { addHousingUnits } from './housing';
import type { GameState, Infra, InfraType } from './types';
import { priceRel } from './workforce';

export type BuildCategory = 'sante' | 'education' | 'securite' | 'logement' | 'zones' | 'energie' | 'transport' | 'loisirs';

export interface BuildingDef {
  type: InfraType;
  name: string; // nom générique (« Hôpital »)
  icon: string;
  category: BuildCategory;
  description: string;
  cost: number; // coût de construction (€, prix de base)
  months: number; // durée du chantier (mois)
  maintenance: number; // entretien du bâtiment (€/an, prix de base) — hors personnel, payé par les ministères
  capacity: number; // capacité au niveau 1
  capacityUnit: string;
  employees: number; // emplois sur site
  energyMWh: number; // consommation annuelle (négatif = production)
  emissions: number; // tCO2/an
  revenue: number; // recettes publiques annuelles éventuelles (€/an, prix de base : redevances, loyers, fiscalité locale)
  footprint: number; // rayon d'emprise (km)
  maxRoad: number; // distance maximale à une route (km)
  maxSlope: number; // pente maximale (km/km)
  maintLine: BudgetLine | 'logement' | null; // ministère dont l'investissement entretient l'état du bâtiment
  hidden?: boolean; // équipement présent sur la carte mais construit par un autre ministère (énergie, secteurs)
  requires?: string; // technologie requise
  needsCoast?: boolean; // littoral obligatoire (ports)
  needsWater?: boolean; // proximité d'un cours d'eau ou d'un lac (barrages, centrales nucléaires)
  nearCity?: number; // distance maximale au bord d'un quartier habité (km) : opérations rattachées à un quartier
  housing?: { units: number; social?: boolean; efficient?: boolean };
}

const M = 1e6;
const D = (type: InfraType, name: string, icon: string, category: BuildCategory, description: string, cost: number, months: number, maintenance: number,
  capacity: number, capacityUnit: string, employees: number, energyMWh: number, emissions: number, revenue: number, footprint: number, maxRoad: number, maxSlope: number,
  maintLine: BuildingDef['maintLine'], extra: Partial<BuildingDef> = {}): BuildingDef =>
  ({ type, name, icon, category, description, cost, months, maintenance, capacity, capacityUnit, employees, energyMWh, emissions, revenue, footprint, maxRoad, maxSlope, maintLine, ...extra });

/** Catalogue des équipements constructibles (montants en € de 2030). */
export const BUILDINGS: Record<InfraType, BuildingDef> = {
  hopital: D('hopital', 'Hôpital', '🏥', 'sante', 'Lits d\'hospitalisation et urgences. Le personnel est financé par le budget santé.', 450 * M, 48, 9 * M, 400, 'lits', 1600, 14000, 1800, 0, 0.15, 0.5, 0.08, 'sante'),
  clinique: D('clinique', 'Clinique', '🩺', 'sante', 'Établissement de soins de taille moyenne : lits supplémentaires et chirurgie ambulatoire.', 120 * M, 30, 2.5 * M, 120, 'lits', 350, 3500, 450, 0, 0.08, 0.5, 0.1, 'sante'),
  centre_medical: D('centre_medical', 'Centre médical', '⚕️', 'sante', 'Maison de santé pluridisciplinaire : améliore l\'accès aux soins et la couverture.', 15 * M, 12, 0.4 * M, 25000, 'patients/an', 40, 400, 50, 0, 0.04, 0.4, 0.12, 'sante'),
  ecole: D('ecole', 'École', '🏫', 'education', 'École primaire : places d\'accueil des élèves.', 12 * M, 18, 0.3 * M, 300, 'élèves', 22, 350, 45, 0, 0.05, 0.4, 0.1, 'education'),
  college: D('college', 'Collège', '🏫', 'education', 'Collège : places pour les 11-14 ans.', 30 * M, 24, 0.7 * M, 600, 'élèves', 50, 700, 90, 0, 0.07, 0.4, 0.1, 'education'),
  lycee: D('lycee', 'Lycée', '🎒', 'education', 'Lycée général, technologique et professionnel.', 55 * M, 30, 1.2 * M, 1200, 'élèves', 100, 1300, 170, 0, 0.09, 0.4, 0.1, 'education'),
  universite: D('universite', 'Université', '🎓', 'education', 'Campus universitaire : places d\'étudiants, recherche.', 400 * M, 48, 9 * M, 15000, 'étudiants', 1500, 18000, 2400, 0, 0.4, 0.5, 0.08, 'education'),
  centre_formation: D('centre_formation', 'Centre de formation', '🧰', 'education', 'Formation professionnelle et apprentissage.', 20 * M, 18, 0.5 * M, 800, 'stagiaires/an', 40, 500, 60, 0, 0.05, 0.5, 0.12, 'formation'),
  laboratoire: D('laboratoire', 'Centre de recherche', '🔬', 'education', 'Laboratoires publics : +4 % d\'efficacité de la recherche par niveau.', 150 * M, 36, 4 * M, 400, 'chercheurs', 450, 9000, 900, 0, 0.12, 0.5, 0.1, 'recherche'),
  commissariat: D('commissariat', 'Commissariat', '🚓', 'securite', 'Hôtel de police : améliore l\'état des moyens et les délais d\'intervention.', 25 * M, 18, 0.6 * M, 250, 'agents', 250, 900, 110, 0, 0.05, 0.3, 0.12, 'securite'),
  caserne_pompiers: D('caserne_pompiers', 'Caserne de pompiers', '🚒', 'securite', 'Centre d\'incendie et de secours, protection civile.', 18 * M, 15, 0.5 * M, 120, 'pompiers', 120, 600, 80, 0, 0.06, 0.3, 0.12, 'securite'),
  tribunal: D('tribunal', 'Tribunal', '⚖️', 'securite', 'Palais de justice : salles d\'audience et greffes.', 60 * M, 30, 1.2 * M, 6000, 'affaires/an', 200, 1500, 180, 0, 0.06, 0.4, 0.1, 'securite'),
  prison: D('prison', 'Centre pénitentiaire', '🏛️', 'securite', 'Places de détention : réduit la surpopulation carcérale.', 180 * M, 36, 4 * M, 700, 'places', 400, 6000, 700, 0, 0.25, 0.5, 0.08, 'securite'),
  zone_residentielle: D('zone_residentielle', 'Quartier résidentiel', '🏘️', 'logement', 'Zone d\'aménagement : l\'État viabilise, 2 500 logements livrés à la fin du chantier.', 160 * M, 36, 1.5 * M, 2500, 'logements', 150, 12500, 2500, 2.5 * M, 0.5, 0.5, 0.1, 'logement', { nearCity: 1.5, housing: { units: 2500 } }),
  eco_quartier: D('eco_quartier', 'Éco-quartier', '🌿', 'logement', '1 800 logements passifs, mobilités douces, faible consommation d\'énergie.', 240 * M, 42, 2 * M, 1800, 'logements', 150, 4500, 400, 1.8 * M, 0.45, 0.5, 0.1, 'logement', { nearCity: 1.5, housing: { units: 1800, efficient: true } }),
  logements_sociaux: D('logements_sociaux', 'Résidence sociale', '🏢', 'logement', '400 logements sociaux (loyers perçus par l\'État).', 75 * M, 24, 0.6 * M, 400, 'logements', 15, 2000, 400, 2.2 * M, 0.1, 0.4, 0.12, 'logement', { nearCity: 0.8, housing: { units: 400, social: true } }),
  zone_industrielle: D('zone_industrielle', 'Zone industrielle', '🏭', 'zones', 'Accueille des industriels exportateurs : emplois et recettes fiscales locales.', 120 * M, 30, 3 * M, 60, 'entreprises', 4000, 250000, 90000, 6 * M, 0.6, 0.5, 0.06, 'infrastructures'),
  zone_commerciale: D('zone_commerciale', 'Zone commerciale', '🛍️', 'zones', 'Commerces et services : emplois et fiscalité locale.', 70 * M, 24, 1.5 * M, 120, 'commerces', 2500, 35000, 4000, 4 * M, 0.35, 0.5, 0.08, 'infrastructures', { nearCity: 2 }),
  gare: D('gare', 'Gare', '🚉', 'transport', 'Gare voyageurs.', 90 * M, 30, 6 * M, 15000, 'voyageurs/jour', 150, 3000, 150, 4 * M, 0.15, 0.3, 0.06, 'transports'),
  aeroport: D('aeroport', 'Aéroport', '✈️', 'transport', 'Aéroport régional.', 2500 * M, 60, 40 * M, 8e6, 'passagers/an', 3500, 60000, 25000, 60 * M, 1.5, 0.8, 0.04, 'transports'),
  port: D('port', 'Port', '⚓', 'transport', 'Port de commerce (sur le littoral).', 900 * M, 48, 25 * M, 6e6, 't/an', 800, 12000, 8000, 30 * M, 0.5, 0.5, 0.2, 'infrastructures', { needsCoast: true }),
  stade: D('stade', 'Stade', '🏟️', 'loisirs', 'Grand équipement sportif.', 250 * M, 36, 8 * M, 30000, 'places', 150, 3000, 300, 6 * M, 0.25, 0.5, 0.08, 'infrastructures'),
  parc_solaire: D('parc_solaire', 'Centrale solaire', '🔆', 'energie', 'Panneaux photovoltaïques au sol.', 110 * M, 18, 2 * M, 100, 'MW', 10, -1.4e5, 0, 0, 0.4, 0.8, 0.15, 'infrastructures'),
  parc_eolien: D('parc_eolien', 'Parc éolien', '🌬️', 'energie', 'Éoliennes terrestres (les reliefs ventés sont autorisés).', 240 * M, 24, 6 * M, 150, 'MW', 15, -3.3e5, 0, 0, 0.5, 1, 0.3, 'infrastructures'),
  centrale_gaz: D('centrale_gaz', 'Centrale à gaz', '🔥', 'energie', 'Cycle combiné gaz : pilotable mais émetteur.', 600 * M, 36, 30 * M, 800, 'MW', 120, -3.5e6, 1.3e6, 0, 0.25, 0.6, 0.08, 'infrastructures'),
  centrale_charbon: D('centrale_charbon', 'Centrale à charbon', '🏭', 'energie', 'Très émettrice.', 1500 * M, 48, 60 * M, 1200, 'MW', 450, -6.6e6, 6.3e6, 0, 0.35, 0.6, 0.08, 'infrastructures'),
  centrale_nucleaire: D('centrale_nucleaire', 'Centrale nucléaire', '⚛️', 'energie', 'Réacteurs de grande puissance (refroidissement : cours d\'eau ou lac).', 12000 * M, 120, 400 * M, 3600, 'MW', 1800, -2.6e7, 0, 0, 0.8, 1, 0.06, 'infrastructures', { needsWater: true }),
  centrale_smr: D('centrale_smr', 'Petit réacteur modulaire', '🔋', 'energie', 'SMR de 300 MW (nécessite la technologie « réacteurs nucléaires avancés »).', 2200 * M, 54, 60 * M, 300, 'MW', 250, -2.3e6, 0, 0, 0.25, 0.6, 0.08, 'infrastructures', { requires: 'nucleaire_avance' }),
  barrage: D('barrage', 'Barrage hydroélectrique', '💧', 'energie', 'Retenue sur un cours d\'eau ou un lac.', 1800 * M, 72, 15 * M, 600, 'MW', 60, -2.1e6, 0, 0, 0.4, 1, 0.4, 'infrastructures', { needsWater: true }),
  // équipements gérés par d'autres ministères : connus du catalogue pour l'entretien et l'affichage, non proposés ici
  caserne: D('caserne', 'Centre de secours', '🚒', 'securite', 'Centre d\'incendie et de secours.', 18 * M, 15, 0.5 * M, 120, 'pompiers', 120, 600, 80, 0, 0.06, 0.3, 0.12, 'securite', { hidden: true }),
  usine: D('usine', 'Usine', '🏭', 'zones', 'Site de production industrielle (ministère de l\'Industrie).', 150 * M, 24, 0, 1000, 'salariés', 1000, 140000, 70000, 0, 0.15, 0.6, 0.1, null, { hidden: true }),
  ferme: D('ferme', 'Exploitation agricole', '🌾', 'zones', 'Exploitation maraîchère (ministère de l\'Agriculture).', 3 * M, 12, 0, 120, 'ha', 8, 200, 500, 0, 0.3, 1, 0.2, null, { hidden: true }),
  centrale_fioul: D('centrale_fioul', 'Turbine à fioul', '🛢️', 'energie', 'Moyen de pointe (ministère de l\'Énergie).', 300 * M, 24, 10 * M, 300, 'MW', 40, -2e5, 1.5e5, 0, 0.1, 0.6, 0.1, 'infrastructures', { hidden: true }),
  centrale_geothermique: D('centrale_geothermique', 'Centrale géothermique', '♨️', 'energie', 'Géothermie profonde (ministère de l\'Énergie).', 500 * M, 48, 12 * M, 100, 'MW', 30, -7.4e5, 0, 0, 0.1, 0.6, 0.15, 'infrastructures', { hidden: true }),
  centrale_biomasse: D('centrale_biomasse', 'Centrale biomasse', '🌲', 'energie', 'Biomasse durable (ministère de l\'Énergie).', 400 * M, 36, 15 * M, 150, 'MW', 60, -9e5, 0, 0, 0.15, 0.6, 0.12, 'infrastructures', { hidden: true }),
  parc_eolien_mer: D('parc_eolien_mer', 'Parc éolien en mer', '🌊', 'energie', 'Éolien en mer (ministère de l\'Énergie).', 1500 * M, 48, 40 * M, 500, 'MW', 40, -1.8e6, 0, 0, 1.5, 3, 1, 'infrastructures', { hidden: true }),
  stockage_batteries: D('stockage_batteries', 'Stockage par batteries', '🔋', 'energie', 'Batteries stationnaires (ministère de l\'Énergie).', 250 * M, 12, 4 * M, 200, 'MW', 10, 0, 0, 0, 0.05, 0.6, 0.12, 'infrastructures', { hidden: true }),
};
// la production d'électricité se décide au ministère de l'Énergie : elle n'est pas proposée dans le catalogue des équipements
export const BUILD_TYPES = (Object.keys(BUILDINGS) as InfraType[]).filter((t) => !BUILDINGS[t].hidden && BUILDINGS[t].category !== 'energie');
export const MAX_LEVEL = 3;
export const MAX_SITES = 40;
export const MIN_GAP = 0.1; // écart libre minimal entre les emprises de deux équipements (km)

export interface Site {
  id: number;
  kind: 'construction' | 'amelioration' | 'renovation';
  type: InfraType;
  name: string;
  x: number; z: number; rot: number;
  cityId: number | null;
  infraId: number | null; // équipement concerné (amélioration, rénovation)
  started: number; // mois de début
  months: number; // durée totale
  elapsed: number; // mois écoulés
  cost: number; // coût total (€ courants au lancement)
  paid: number; // montant déjà payé
}

export interface ConstructionState {
  sites: Site[];
  nextSiteId: number;
  infraVersion: number; // incrémenté à chaque modification de `country.infra` (le serveur renvoie alors la liste)
  pendingOneOff: number; // dépenses ponctuelles à payer au prochain mois (démolitions), € courants
  ref: { infrastructures: number };
  // comptes du dernier mois (€/an courants)
  spend: { chantiers: number; entretien: number; logement: number; ponctuel: number; total: number };
  revenue: number;
  completed: number; // équipements mis en service depuis le début
}

export function initConstruction(S: GameState): ConstructionState {
  for (const i of S.country.infra) i.condition ??= 1;
  return { sites: [], nextSiteId: 1, infraVersion: 0, pendingOneOff: 0, ref: { infrastructures: S.policy.budget.infrastructures }, spend: { chantiers: 0, entretien: 0, logement: 0, ponctuel: 0, total: 0 }, revenue: 0, completed: 0 };
}

// ---------- Validation des emplacements ----------
export type PlacementCode =
  | 'TYPE_INCONNU' | 'COORDONNEES' | 'HORS_CARTE' | 'MER' | 'LAC' | 'RIVIERE' | 'PENTE' | 'TROP_PROCHE' | 'LOIN_ROUTE'
  | 'LOIN_QUARTIER' | 'COTE' | 'EAU' | 'TECHNOLOGIE' | 'FINANCEMENT' | 'TROP_DE_CHANTIERS';

export interface PlacementCheck {
  ok: boolean;
  code?: PlacementCode;
  msg: string;
  cityId: number | null;
  height: number; // km
  slope: number; // km/km
  roadDistance: number; // km
  cost: number; // coût total (€ courants)
  months: number;
}

function distSeg(px: number, pz: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / l2, 0, 1) : 0;
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz);
}
function distPolyline(x: number, z: number, pts: [number, number][], cutoff = Infinity) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (Math.min(a[0], b[0]) - x > cutoff || x - Math.max(a[0], b[0]) > cutoff || Math.min(a[1], b[1]) - z > cutoff || z - Math.max(a[1], b[1]) > cutoff) continue;
    d = Math.min(d, distSeg(x, z, a, b));
  }
  return d;
}

/** Distance (km) à la route la plus proche (autoroutes, nationales ; l'intérieur d'un quartier est desservi par ses rues). */
export function roadDistance(S: GameState, x: number, z: number) {
  for (const c of S.country.cities) if (Math.hypot(c.x - x, c.z - z) <= c.radius) return 0;
  let d = Infinity;
  for (const l of S.country.links) if (l.kind !== 'rail') d = Math.min(d, distPolyline(x, z, l.points, Math.min(d, 60)));
  return d;
}

/** Coût total d'un chantier en € courants. */
export function buildCost(S: GameState, def: BuildingDef) {
  const tech = def.housing ? (S.research?.effects.housing.buildCost ?? 1) : 1;
  return def.cost * priceRel(S) * tech;
}

/**
 * Vérifie qu'un équipement peut être construit en (x, z) (coordonnées en km, origine au centre de la carte).
 * Règles : terre ferme (hauteur > 0,02 km), hors lac et lit de rivière, pente ≤ `maxSlope`, distance aux autres
 * équipements ≥ somme des emprises, distance à une route ≤ `maxRoad`, technologie requise, contraintes propres
 * (littoral, cours d'eau, proximité d'un quartier habité), financement possible et nombre de chantiers simultanés.
 */
export function validatePlacement(S: GameState, type: string, x: number, z: number): PlacementCheck {
  const def = BUILDINGS[type as InfraType];
  const base: PlacementCheck = { ok: false, msg: '', cityId: null, height: 0, slope: 0, roadDistance: Infinity, cost: 0, months: 0 };
  const fail = (code: PlacementCode, msg: string): PlacementCheck => ({ ...base, ok: false, code, msg });
  if (!def) return fail('TYPE_INCONNU', 'Type d\'équipement inconnu');
  base.cost = buildCost(S, def);
  base.months = def.months;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return fail('COORDONNEES', 'Coordonnées invalides');
  const C = S.country;
  const margin = 0.2 + def.footprint;
  if (Math.abs(x) > C.width / 2 - margin || Math.abs(z) > C.depth / 2 - margin) return fail('HORS_CARTE', 'Emplacement hors du territoire de la cité');
  if (def.requires && !S.research?.unlocked.includes(def.requires)) return fail('TECHNOLOGIE', `Technologie requise : ${def.requires.replace(/_/g, ' ')}`);
  const h = makeHeightFn(C);
  const h0 = h(x, z);
  base.height = h0;
  const water = Math.min(
    ...C.rivers.map((r) => distPolyline(x, z, r.points, 20) - r.width),
    ...C.lakes.map((l) => Math.hypot(l.x - x, l.z - z) - l.r),
  );
  if (def.needsCoast) {
    let sea = false;
    for (let a = 0; a < 12 && !sea; a++) for (const d of [0.3, 0.6, 1]) if (h(x + Math.cos(a * Math.PI / 6) * d, z + Math.sin(a * Math.PI / 6) * d) <= 0) sea = true;
    if (!sea || h0 < -0.08) return fail('COTE', 'Un port doit être construit sur le littoral');
  } else if (h0 <= 0.02) {
    return fail('MER', 'Emplacement dans la mer : choisissez la terre ferme');
  }
  for (const l of C.lakes) if (Math.hypot(l.x - x, l.z - z) < l.r * 1.05 + (def.needsWater ? 0 : def.footprint)) {
    if (!def.needsWater || Math.hypot(l.x - x, l.z - z) < l.r * 0.8) return fail('LAC', 'Emplacement dans un lac');
  }
  if (!def.needsWater) for (const r of C.rivers) if (distPolyline(x, z, r.points, 10) < r.width * 1.5 + def.footprint * 0.5) return fail('RIVIERE', 'Emplacement dans le lit d\'une rivière');
  if (def.needsWater && water > 1) return fail('EAU', 'Cet équipement doit être à moins de 1 km d\'un cours d\'eau ou d\'un lac');
  const d = Math.max(0.1, def.footprint);
  if (!def.needsCoast) {
    const slope = Math.max(...[[d, 0], [-d, 0], [0, d], [0, -d]].map(([dx, dz]) => Math.abs(h(x + dx, z + dz) - h0) / d));
    base.slope = slope;
    if (slope > def.maxSlope) return fail('PENTE', `Terrain trop pentu (${Math.round(slope * 100)} % pour ${Math.round(def.maxSlope * 100)} % maximum)`);
  }
  for (const o of C.infra) {
    const min = def.footprint + (BUILDINGS[o.type]?.footprint ?? 0.1) + MIN_GAP;
    if (Math.hypot(o.x - x, o.z - z) < min) return fail('TROP_PROCHE', `Trop près d'un autre équipement (${km(Math.hypot(o.x - x, o.z - z))}, minimum ${km(min)})`);
  }
  const road = roadDistance(S, x, z);
  base.roadDistance = road;
  if (road > def.maxRoad) return fail('LOIN_ROUTE', `Trop loin d'une voie (${road === Infinity ? '∞' : km(road)}, maximum ${km(def.maxRoad)})`);
  let best: { id: number; d: number } | null = null;
  for (const c of C.cities) {
    const e = Math.hypot(c.x - x, c.z - z) - c.radius;
    if (!best || e < best.d) best = { id: c.id, d: e };
  }
  if (def.nearCity !== undefined && (!best || best.d > def.nearCity)) return fail('LOIN_QUARTIER', `Doit être à moins de ${km(def.nearCity)} d'un quartier habité`);
  base.cityId = best && best.d <= Math.max(1.5, def.nearCity ?? 0) ? best.id : null;
  if ((S.construction?.sites.length ?? 0) >= MAX_SITES) return fail('TROP_DE_CHANTIERS', `Trop de chantiers simultanés (${MAX_SITES} au maximum)`);
  if (!S.policy.finance.autoBorrow && S.finance.cash < (base.cost / def.months) * 2) return fail('FINANCEMENT', 'Trésorerie insuffisante : activez l\'emprunt automatique ou levez des fonds');
  return { ...base, ok: true, msg: `Emplacement valide — ${def.name} : ${fmtMoney(base.cost)}, ${def.months} mois de chantier` };
}

// ---------- Actions ----------
export type BuildAction =
  | { type: 'programme'; building: InfraType; cityId: number; count?: number } // programme d'investissement (placement automatique)
  | { type: 'construire'; building: InfraType; x: number; z: number; rot?: number; name?: string } // bas niveau : emplacement imposé (tests, outils)
  | { type: 'ameliorer'; infraId: number }
  | { type: 'renover'; infraId: number }
  | { type: 'demolir'; infraId: number }
  | { type: 'annulerChantier'; siteId: number };

export type BuildCode = PlacementCode | 'QUARTIER_INCONNU' | 'AUCUN_EMPLACEMENT' | 'INTROUVABLE' | 'NIVEAU_MAX' | 'EN_CHANTIER' | 'BON_ETAT' | 'ACTION_INCONNUE' | 'INDISPONIBLE';
export interface BuildResult { ok: boolean; code?: BuildCode; msg: string; siteId?: number; infraId?: number; cost?: number; months?: number; siteIds?: number[]; infraIds?: number[] }

const hasWorks = (S: GameState, infraId: number) => !!S.construction?.sites.some((s) => s.infraId === infraId);

/** Ouvre un chantier : l'équipement apparaît dans `country.infra` avec `status: 'chantier'` (aucun effet avant sa mise en service). */
function openSite(S: GameState, def: BuildingDef, name: string, x: number, z: number, rot: number, cityId: number | null, cost: number) {
  const K = S.construction!;
  const id = S.country.infra.reduce((m, i) => Math.max(m, i.id), -1) + 1;
  const infra: Infra = {
    id, type: def.type, name, cityId, x, z, rot,
    capacity: def.capacity, capacityUnit: def.capacityUnit, employees: def.employees, maintenance: def.maintenance, energyMWh: def.energyMWh, emissions: def.emissions,
    level: 1, builtYear: S.startYear + Math.floor((S.month + def.months) / 12), condition: 1, custom: true, revenue: def.revenue, renovated: true,
    status: 'chantier', progress: 0,
  };
  S.country.infra.push(infra);
  const site: Site = { id: K.nextSiteId++, kind: 'construction', type: def.type, name, x, z, rot, cityId, infraId: id, started: S.month, months: def.months, elapsed: 0, cost, paid: 0 };
  K.sites.push(site);
  K.infraVersion++;
  return { site, infra };
}

/**
 * Placement automatique : explore de façon déterministe des anneaux autour du centre du quartier ciblé (`c.x`, `c.z`),
 * du centre vers la périphérie, jusqu'au rayon du quartier + 1,5 km (davantage si le type l'exige : littoral,
 * cours d'eau), par pas de l'ordre de l'emprise, et renvoie le premier emplacement valide.
 */
export function findSite(S: GameState, def: BuildingDef, cityId: number): { ok: true; x: number; z: number; rot: number; check: PlacementCheck } | { ok: false; check: PlacementCheck | null } {
  const c = S.country.cities[cityId];
  if (!c) return { ok: false, check: null };
  const maxR = c.radius + Math.max(1.5, def.nearCity ?? 0, def.needsWater ? 3 : 0, def.needsCoast ? 8 : 0);
  let first: PlacementCheck | null = null;
  const step = Math.max(0.12, def.footprint * 1.2);
  const seedAngle = (cityId * 2.399 + S.country.infra.length * 0.7) % (Math.PI * 2);
  for (let r = Math.min(c.radius * 0.3, 0.3); r <= maxR; r += step) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
    for (let k = 0; k < n; k++) {
      const a = seedAngle + (k / n) * Math.PI * 2;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const chk = validatePlacement(S, def.type, x, z);
      if (chk.ok) return { ok: true, x, z, rot: a, check: chk };
      if (chk.code === 'TECHNOLOGIE' || chk.code === 'FINANCEMENT' || chk.code === 'TROP_DE_CHANTIERS' || chk.code === 'TYPE_INCONNU') return { ok: false, check: chk };
      first ??= chk;
    }
  }
  return { ok: false, check: first };
}

const BLOCKING: PlacementCode[] = ['TECHNOLOGIE', 'FINANCEMENT', 'TROP_DE_CHANTIERS', 'TYPE_INCONNU'];

export function applyBuildAction(S: GameState, a: BuildAction, notify?: (kind: 'info' | 'good', title: string, text: string) => void): BuildResult {
  const K = S.construction;
  if (!K) return { ok: false, code: 'INDISPONIBLE', msg: 'Module de construction indisponible' };
  const pr = priceRel(S);
  if (a.type === 'construire') {
    const x = Number(a.x);
    const z = Number(a.z);
    const chk = validatePlacement(S, String(a.building), x, z);
    if (!chk.ok) return { ok: false, code: chk.code, msg: chk.msg };
    const def = BUILDINGS[a.building];
    const city = chk.cityId !== null ? S.country.cities[chk.cityId] : null;
    const custom = typeof a.name === 'string' ? a.name.replace(/[<>]/g, '').trim().slice(0, 48) : '';
    let name = custom || (city ? `${def.name} de ${city.name}` : def.name);
    const same = [...S.country.infra, ...K.sites].filter((i) => i.name === name || i.name.startsWith(name + ' n°')).length;
    if (same) name = `${name} n°${same + 1}`;
    const rot = Number.isFinite(Number(a.rot)) ? Number(a.rot) : 0;
    const { site, infra } = openSite(S, def, name, x, z, rot, chk.cityId, chk.cost);
    notify?.('info', 'Chantier lancé', `${def.icon} ${name} : ${fmtMoney(chk.cost)} sur ${def.months} mois.`);
    return { ok: true, msg: `Chantier lancé : ${name} (${fmtMoney(chk.cost)}, ${def.months} mois)`, siteId: site.id, infraId: infra.id, cost: chk.cost, months: def.months };
  }
  if (a.type === 'programme') {
    const def = BUILDINGS[a.building as InfraType];
    if (!def) return { ok: false, code: 'TYPE_INCONNU', msg: 'Type d\'équipement inconnu' };
    const city = S.country.cities[Number(a.cityId)];
    if (!city) return { ok: false, code: 'QUARTIER_INCONNU', msg: 'Quartier inconnu' };
    const count = clamp(Math.floor(Number(a.count) || 1), 1, 10);
    const siteIds: number[] = [];
    const infraIds: number[] = [];
    let total = 0;
    let fail: PlacementCheck | null = null;
    for (let n = 0; n < count; n++) {
      const spot = findSite(S, def, city.id);
      if (!spot.ok) { fail = spot.check; break; }
      let name = `${def.name} de ${city.name}`;
      const same = S.country.infra.filter((i) => i.name === name || i.name.startsWith(name + ' n°')).length;
      if (same) name = `${name} n°${same + 1}`;
      const { site, infra } = openSite(S, def, name, spot.x, spot.z, spot.rot, spot.check.cityId ?? city.id, spot.check.cost);
      siteIds.push(site.id);
      infraIds.push(infra.id);
      total += spot.check.cost;
    }
    if (!siteIds.length) {
      if (fail?.code && BLOCKING.includes(fail.code)) return { ok: false, code: fail.code, msg: fail.msg };
      return { ok: false, code: 'AUCUN_EMPLACEMENT', msg: `Aucun emplacement constructible trouvé près de ${city.name}${fail ? ` (${fail.msg})` : ''}` };
    }
    const msg = `Programme lancé : ${siteIds.length} × ${def.name} — quartier ${city.name} (${fmtMoney(total)}, ${def.months} mois)` + (siteIds.length < count ? ` — seulement ${siteIds.length} emplacement(s) disponible(s)` : '');
    notify?.('info', 'Programme d\'investissement', `${def.icon} ${msg}.`);
    return { ok: true, msg, siteIds, infraIds, siteId: siteIds[0], infraId: infraIds[0], cost: total, months: def.months };
  }
  if (a.type === 'annulerChantier') {
    const i = K.sites.findIndex((s) => s.id === Number(a.siteId));
    if (i < 0) return { ok: false, code: 'INTROUVABLE', msg: 'Chantier introuvable' };
    const s = K.sites[i];
    K.sites.splice(i, 1);
    if (s.kind === 'construction' && s.infraId !== null) { S.country.infra = S.country.infra.filter((x) => x.id !== s.infraId); K.infraVersion++; }
    return { ok: true, msg: `Chantier annulé : ${s.name} (${fmtMoney(s.paid)} déjà engagés ne sont pas récupérables)` };
  }
  const inf = S.country.infra.find((i) => i.id === Number((a as { infraId: number }).infraId));
  if (!inf) return { ok: false, code: a.type === 'ameliorer' || a.type === 'renover' || a.type === 'demolir' ? 'INTROUVABLE' : 'ACTION_INCONNUE', msg: a.type === 'ameliorer' || a.type === 'renover' || a.type === 'demolir' ? 'Équipement introuvable' : 'Action inconnue' };
  const def = BUILDINGS[inf.type];
  if (hasWorks(S, inf.id)) return { ok: false, code: 'EN_CHANTIER', msg: 'Des travaux sont déjà en cours sur cet équipement' };
  if (a.type === 'ameliorer') {
    if (inf.level >= MAX_LEVEL) return { ok: false, code: 'NIVEAU_MAX', msg: `Niveau maximal atteint (${MAX_LEVEL})` };
    const cost = def.cost * 0.45 * inf.level * pr;
    const months = Math.max(3, Math.ceil(def.months * 0.5));
    if (!S.policy.finance.autoBorrow && S.finance.cash < (cost / months) * 2) return { ok: false, code: 'FINANCEMENT', msg: 'Trésorerie insuffisante' };
    const site: Site = { id: K.nextSiteId++, kind: 'amelioration', type: inf.type, name: inf.name, x: inf.x, z: inf.z, rot: inf.rot, cityId: inf.cityId, infraId: inf.id, started: S.month, months, elapsed: 0, cost, paid: 0 };
    K.sites.push(site);
    return { ok: true, msg: `Amélioration lancée : ${inf.name} → niveau ${inf.level + 1} (${fmtMoney(cost)}, ${months} mois)`, siteId: site.id, cost, months };
  }
  if (a.type === 'renover') {
    if ((inf.condition ?? 1) > 0.97 && inf.renovated) return { ok: false, code: 'BON_ETAT', msg: 'Équipement déjà rénové et en bon état' };
    const cost = def.cost * 0.25 * pr;
    const months = Math.max(2, Math.ceil(def.months * 0.4));
    if (!S.policy.finance.autoBorrow && S.finance.cash < (cost / months) * 2) return { ok: false, code: 'FINANCEMENT', msg: 'Trésorerie insuffisante' };
    const site: Site = { id: K.nextSiteId++, kind: 'renovation', type: inf.type, name: inf.name, x: inf.x, z: inf.z, rot: inf.rot, cityId: inf.cityId, infraId: inf.id, started: S.month, months, elapsed: 0, cost, paid: 0 };
    K.sites.push(site);
    return { ok: true, msg: `Rénovation lancée : ${inf.name} (${fmtMoney(cost)}, ${months} mois ; capacité réduite de 30 % pendant les travaux)`, siteId: site.id, cost, months };
  }
  if (a.type === 'demolir') {
    const cost = def.cost * 0.08 * pr;
    S.country.infra = S.country.infra.filter((i) => i.id !== inf.id);
    removeEffects(S, inf);
    K.pendingOneOff += cost;
    K.infraVersion++;
    notify?.('info', 'Démolition', `${inf.name} a été démoli (${fmtMoney(cost)}).`);
    return { ok: true, msg: `${inf.name} démoli (coût ${fmtMoney(cost)}, payé le mois prochain)`, infraId: inf.id, cost };
  }
  return { ok: false, code: 'ACTION_INCONNUE', msg: 'Action inconnue' };
}

// ---------- Effets des équipements sur les autres moteurs ----------
function zoneEffect(S: GameState, inf: Pick<Infra, 'type' | 'employees' | 'capacity'>, sign: 1 | -1) {
  if (inf.type === 'zone_industrielle') {
    const s = S.sectors[SECTOR_INDEX.industrie];
    s.firms = Math.max(10, s.firms + sign * inf.capacity);
    s.baseExport = Math.max(0, s.baseExport + sign * inf.employees * s.productivity * 0.45);
  } else if (inf.type === 'zone_commerciale') {
    const s = S.sectors[SECTOR_INDEX.commerce];
    s.firms = Math.max(10, s.firms + sign * inf.capacity);
  }
}

function removeEffects(S: GameState, inf: Infra) {
  zoneEffect(S, inf, -1);
  const def = BUILDINGS[inf.type];
  const L = S.housing;
  if (def?.housing && L && inf.custom) {
    const units = inf.capacity;
    L.stock = Math.max(1, L.stock - units);
    if (def.housing.social) L.social = Math.max(0, L.social - units);
    if (inf.cityId !== null && L.extraByCity[inf.cityId]) L.extraByCity[inf.cityId] = Math.max(0, L.extraByCity[inf.cityId] - units);
  }
}

function complete(S: GameState, site: Site, notify?: (kind: 'info' | 'good', title: string, text: string) => void) {
  const K = S.construction!;
  const def = BUILDINGS[site.type];
  const E = S.research?.effects;
  if (site.kind === 'construction') {
    let energy = def.energyMWh;
    if (site.type === 'parc_solaire') energy *= E?.energy.solarYield ?? 1;
    if (site.type === 'parc_eolien') energy *= E?.energy.windYield ?? 1;
    if (def.housing?.efficient && S.research?.unlocked.includes('batiments_passifs')) energy *= 0.5;
    const inf = S.country.infra.find((i) => i.id === site.infraId);
    if (!inf) return;
    delete inf.status;
    delete inf.progress;
    inf.energyMWh = energy;
    inf.builtYear = S.startYear + Math.floor(S.month / 12);
    inf.condition = 1;
    zoneEffect(S, inf, 1);
    if (def.housing) addHousingUnits(S, def.housing.units, { social: def.housing.social, efficient: def.housing.efficient, cityId: site.cityId });
    K.completed++;
    notify?.('good', 'Mise en service', `${def.icon} ${site.name} est en service (${fmtCap(def.capacity)} ${def.capacityUnit}).`);
  } else {
    const inf = S.country.infra.find((i) => i.id === site.infraId);
    if (!inf) return;
    if (site.kind === 'amelioration') {
      const added = inf.capacity * 0.3;
      zoneEffect(S, { type: inf.type, employees: inf.employees * 0.25, capacity: added }, 1);
      if (def.housing && inf.custom) addHousingUnits(S, added, { social: def.housing.social, efficient: def.housing.efficient, cityId: inf.cityId });
      inf.level += 1;
      inf.capacity += added;
      inf.employees *= 1.25;
      inf.maintenance *= 1.2;
      inf.energyMWh *= 1.15;
      inf.emissions *= 1.15;
      if (inf.revenue) inf.revenue *= 1.3;
      notify?.('good', 'Amélioration terminée', `${inf.name} passe au niveau ${inf.level}.`);
    } else {
      inf.condition = 1;
      if (!inf.renovated) {
        if (inf.energyMWh > 0) inf.energyMWh *= 0.8;
        inf.emissions *= 0.8;
        inf.renovated = true;
      }
      notify?.('good', 'Rénovation terminée', `${inf.name} est remis à neuf (consommation d'énergie réduite).`);
    }
  }
  K.infraVersion++;
}

/** Ratio d'entretien (1 = référence) du ministère qui entretient un type d'équipement. */
function maintenanceRatio(S: GameState, line: BuildingDef['maintLine']) {
  const pr = priceRel(S);
  if (line === 'sante' && S.health) return (S.policy.budget.sante * S.policy.health.investment / pr) / Math.max(1, S.health.ref.invest);
  if (line === 'education' && S.education) return (S.policy.budget.education * S.policy.education.investment / pr) / Math.max(1, S.education.ref.invest);
  if (line === 'securite' && S.security) return (S.policy.budget.securite * S.policy.security.investment / pr) / Math.max(1, S.security.ref.invest);
  if (line === 'logement' || line === null) return 1;
  return S.policy.budget.infrastructures / pr / Math.max(1, S.construction?.ref.infrastructures ?? 1);
}

/** Avance les chantiers d'un mois, met en service les équipements terminés, fait évoluer l'état du bâti. */
export function constructionProgress(S: GameState, notify?: (kind: 'info' | 'good', title: string, text: string) => void) {
  const K = S.construction!;
  let installments = 0;
  const done: Site[] = [];
  for (const s of K.sites) {
    const pay = Math.min(s.cost - s.paid, s.cost / s.months);
    s.paid += pay;
    installments += pay;
    s.elapsed += 1;
    if (s.kind === 'construction') {
      const inf = S.country.infra.find((i) => i.id === s.infraId);
      if (inf) inf.progress = Math.min(1, s.elapsed / s.months);
    }
    if (s.elapsed >= s.months) done.push(s);
  }
  K.sites = K.sites.filter((s) => !done.includes(s));
  for (const s of done) complete(S, s, notify);
  // état des équipements : converge lentement vers le niveau d'entretien financé (les équipements construits par le joueur sont entretenus)
  const ratios = new Map<string, number>();
  for (const i of S.country.infra) {
    const def = BUILDINGS[i.type];
    const line = def?.maintLine ?? 'infrastructures';
    if (!ratios.has(String(line))) ratios.set(String(line), maintenanceRatio(S, line));
    const target = i.custom ? 1 : clamp(ratios.get(String(line))!, 0.3, 1);
    i.condition = clamp((i.condition ?? 1) + (target - (i.condition ?? 1)) * 0.0015, 0.2, 1);
  }
  return installments;
}

/**
 * Comptabilise les dépenses d'équipement (chantiers, entretien des équipements construits, programmes de logement,
 * démolitions) et les recettes des équipements dans les comptes du mois et la trésorerie.
 */
export function constructionAccounts(S: GameState, installments: number, housingSpend: number) {
  const K = S.construction!;
  const A = S.accounts;
  const pr = priceRel(S);
  let maint = 0;
  let rev = 0;
  for (const i of S.country.infra) if (i.custom && i.status !== 'chantier') { maint += i.maintenance * pr; rev += (i.revenue ?? 0) * pr; }
  const oneOff = K.pendingOneOff;
  K.pendingOneOff = 0;
  const spendYear = installments * 12 + maint + housingSpend + oneOff * 12;
  K.spend = { chantiers: installments * 12, entretien: maint, logement: housingSpend, ponctuel: oneOff * 12, total: spendYear };
  K.revenue = rev;
  A.spending.equipements = spendYear;
  A.revenue.infrastructures = (A.revenue.infrastructures ?? 0) + rev;
  A.spendingTotal += spendYear;
  A.revenueTotal += rev;
  A.balance += rev - spendYear;
  A.primaryBalance += rev - spendYear;
  S.finance.cash += (rev - spendYear) / 12;
}

const km = (v: number) => (v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1).replace('.', ',')} km`);
const fmtMoney = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2).replace('.', ',')} Md€` : `${(v / 1e6).toFixed(0)} M€`);
const fmtCap = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.', ',')} M` : Math.round(v).toLocaleString('fr-FR'));
