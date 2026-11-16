/**
 * Électricité — modèle physique et économique (fonctions pures, déterministes) partagé par la simulation,
 * les outils (catalogue) et les tests. TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { CatalogAsset } from '../catalog';
import {
  type ConsumerClass, type FacilityKind, type PlantType, TAG_BATTERY, TAG_KW_PREFIX, TAG_KWH_PREFIX, TAG_PLANT_PREFIX,
  TAG_SUBSTATION,
} from './types';

/** Caractéristiques d'une installation (valeurs par défaut ; la puissance peut être surchargée au catalogue). */
export interface FacilitySpec {
  kind: FacilityKind;
  nameFr: string;
  /** Puissance nominale (kW) ; capacité de transformation pour un poste. */
  nominalKw: number;
  /** Rayon de distribution locale (m) : les bâtiments à portée sont raccordés à cette installation. */
  radius: number;
  /** Coût marginal (ordre de mérite de la répartition : le moins cher est appelé d'abord). */
  meritCost: number;
  /** Pannes par heure à financement nominal, durée de réparation nominale (h). */
  failurePerHour: number;
  repairHours: number;
  /** Pollution de l'air émise à pleine puissance (indice ajouté par heure au centre, rayon en m). */
  airPerHourAtFull: number;
  airRadius: number;
  /** Bruit (indice ajouté par heure à pleine puissance). */
  noisePerHourAtFull: number;
}

export const FACILITY_SPECS: Record<FacilityKind, FacilitySpec> = {
  thermique: { kind: 'thermique', nameFr: 'Centrale thermique (gaz)', nominalKw: 60_000, radius: 450, meritCost: 40, failurePerHour: 0.0012, repairHours: 18, airPerHourAtFull: 9, airRadius: 260, noisePerHourAtFull: 2 },
  eolien: { kind: 'eolien', nameFr: 'Éolienne', nominalKw: 2_300, radius: 250, meritCost: 2, failurePerHour: 0.0008, repairHours: 10, airPerHourAtFull: 0, airRadius: 0, noisePerHourAtFull: 1.5 },
  solaire: { kind: 'solaire', nameFr: 'Ferme solaire', nominalKw: 6_000, radius: 300, meritCost: 1, failurePerHour: 0.0004, repairHours: 6, airPerHourAtFull: 0, airRadius: 0, noisePerHourAtFull: 0 },
  hydro: { kind: 'hydro', nameFr: 'Barrage hydroélectrique', nominalKw: 30_000, radius: 400, meritCost: 3, failurePerHour: 0.0006, repairHours: 24, airPerHourAtFull: 0, airRadius: 0, noisePerHourAtFull: 0.5 },
  poste: { kind: 'poste', nameFr: 'Poste de transformation', nominalKw: 45_000, radius: 700, meritCost: 0, failurePerHour: 0.0005, repairHours: 8, airPerHourAtFull: 0, airRadius: 0, noisePerHourAtFull: 0.5 },
  // Batteries : puissance max de charge / décharge ; appelées APRÈS les centrales locales (thermique comprise) et
  // AVANT le réseau voisin (coût de mérite entre les deux).
  batterie: { kind: 'batterie', nameFr: 'Batteries de stockage', nominalKw: 2_000, radius: 300, meritCost: 50, failurePerHour: 0.0004, repairHours: 8, airPerHourAtFull: 0, airRadius: 0, noisePerHourAtFull: 0.2 },
};

/**
 * Batteries de stockage (lithium-fer-phosphate, conteneurs) : capacité (kWh), puissance max (kW, `FACILITY_SPECS`),
 * rendement aller-retour (85 % : la moitié des pertes à la charge, l'autre à la décharge, soit √0,85 ≈ 92 % par
 * sens). Chargées UNIQUEMENT par le surplus des centrales locales (pas par le réseau voisin), une heure de jeu à la fois.
 */
export const BATTERY_SPEC = { capacityKwh: 8_000, roundTrip: 0.85 } as const;
/** Rendement d'un sens (charge ou décharge). */
export const BATTERY_ONE_WAY = Math.sqrt(BATTERY_SPEC.roundTrip);

/** Capacité (kWh) d'un modèle de batteries (étiquette `elec:kwh:N`, sinon valeur par défaut). */
export function capacityKwhOf(asset: Pick<CatalogAsset, 'tags'>): number {
  for (const t of asset.tags) {
    if (t.startsWith(TAG_KWH_PREFIX)) {
      const v = Number(t.slice(TAG_KWH_PREFIX.length));
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return BATTERY_SPEC.capacityKwh;
}

/**
 * Un pas d'une heure d'une batterie : énergie stockée après échange de `kw` (> 0 charge, < 0 décharge) pendant
 * `hours` h, bornée à [0, capacité]. Les pertes s'appliquent à chaque sens (rendement aller-retour `BATTERY_SPEC`).
 */
export function batteryStep(storedKwh: number, capacityKwh: number, kw: number, hours = 1): number {
  const next = kw >= 0 ? storedKwh + kw * hours * BATTERY_ONE_WAY : storedKwh + (kw * hours) / BATTERY_ONE_WAY;
  return Math.min(capacityKwh, Math.max(0, next));
}

/** Lignes haute tension. */
export const LINE_SPEC = {
  /** Capacité de transport (kW). */
  capacityKw: 150_000,
  /** Pertes par km (part de la puissance transportée). */
  lossPerKm: 0.008,
  /** Coût de construction par mètre (¢) et entretien mensuel par km (¢). */
  costPerM: 450,
  upkeepPerKmMonth: 2_500,
  /** Pannes par km et par heure à financement nominal ; réparation (h). */
  failurePerKmHour: 0.00012,
  repairHours: 6,
  /** Longueur maximale d'une portée de ligne (m). */
  maxLengthM: 6_000,
  /** Espacement des pylônes (rendu) (m). */
  pylonSpacingM: 140,
};

/**
 * Câbles souterrains (16/11, demande joueur « raccorder les éoliennes avec des câbles sous terre ») : tracé point à
 * point entre une installation et une route (ou une autre installation), sans pylône, invisible hors du calque
 * Électricité. Plus cher au mètre que la ligne HT, capacité large (un parc éolien entier), pas de panne, passe sous
 * les routes, les bâtiments et l'eau (aucune collision).
 */
export const CABLE_SPEC = {
  /** Capacité de transport (kW) : non bloquante en pratique (un parc éolien, une centrale thermique). */
  capacityKw: 400_000,
  /** Pertes par km. */
  lossPerKm: 0.004,
  /** Coût de construction par mètre (¢, le double de la ligne HT) et entretien mensuel par km (¢). */
  costPerM: 900,
  upkeepPerKmMonth: 1_000,
  /** Longueur minimale et maximale d'un câble (m). */
  minLengthM: 8,
  maxLengthM: 3_000,
  /** Distance maximale entre l'extrémité « route » d'un câble et l'axe d'une route (m). */
  roadSnapM: 16,
};

export function cableCost(m: number): { cost: number; upkeepPerMonth: number } {
  return { cost: Math.round(m * CABLE_SPEC.costPerM), upkeepPerMonth: Math.round((m / 1000) * CABLE_SPEC.upkeepPerKmMonth) };
}

/** Toitures solaires : puissance crête par logement équipé (kW), coût d'installation (¢), logements équipés par jour. */
export const ROOFTOP_SPEC = { peakKwPerBuilding: 4, costPerBuilding: 9_000, installsPerDay: 6 };

/** Tarif de vente de l'électricité (¢ par kWh livré) — ligne de recette du service. */
export const TARIFF_CENTS_PER_KWH = 2;

/**
 * Raccordement au réseau extérieur (achat d'électricité à la commune voisine) : démarrer une ville sans centrale.
 * Puissance plafonnée (une ville qui grandit doit produire elle-même), appelé en DERNIER (coût de mérite le plus
 * élevé : les centrales locales servent d'abord), acheté plus cher que le tarif de revente (chaque kWh importé
 * coûte `priceCentsPerKwh − TARIFF_CENTS_PER_KWH` à la ville) et que la production locale (éolienne : entretien
 * ≈ 0,3 ¢/kWh). Frais de raccordement uniques en CHF.
 */
export const IMPORT_SPEC = { capacityKw: 3_000, priceCentsPerKwh: 4.5, connectionChf: 60_000, meritCost: 90, lossShare: 0.02 } as const;

/**
 * Vente du surplus aux villes voisines (docs/ELECTRICITE.md, « Vente d'électricité ») : chaque heure, la production
 * éolienne, solaire, hydraulique et des toitures réellement disponible mais ni consommée ni stockée (batteries
 * chargées d'abord) est vendue, dans la limite de `capacityKw`, si la ville est reliée à l'extérieur (raccordement
 * au réseau voisin OU connexion extérieure par route reliée). Prix de vente (¢/kWh) inférieur au prix d'achat
 * (`IMPORT_SPEC.priceCentsPerKwh`) et au tarif de revente local : acheter puis revendre fait toujours perdre.
 * Les centrales thermiques ne vendent pas leur capacité inutilisée (pilotables : elles ne brûlent que le gaz appelé).
 */
/**
 * Vente du surplus aux villes voisines : sans plafond de puissance ni condition de raccordement. Prix réglable par le
 * joueur (`minPrice`..`maxPrice`, défaut `priceCentsPerKwh`). Les voisins achètent tout le surplus jusqu'au prix de
 * référence (`refPrice`, leur propre prix d'achat), puis une part décroissante jusqu'à `maxPrice` (part nulle).
 */
export const EXPORT_SPEC = { priceCentsPerKwh: 1.5, minPrice: 0.5, maxPrice: 15, refPrice: 4.5 } as const;

/** Prix de vente borné (¢/kWh) ; valeur absente ou invalide → prix par défaut. */
export function clampExportPrice(p: number | undefined): number {
  if (typeof p !== 'number' || !Number.isFinite(p)) return EXPORT_SPEC.priceCentsPerKwh;
  return Math.min(EXPORT_SPEC.maxPrice, Math.max(EXPORT_SPEC.minPrice, Math.round(p * 10) / 10));
}

/** Part du surplus achetée par les voisins à ce prix : 1 jusqu'au prix de référence, puis décroissance linéaire. */
export function exportDemandShare(price: number): number {
  const { refPrice, maxPrice } = EXPORT_SPEC;
  if (price <= refPrice) return 1;
  return Math.max(0, (maxPrice - price) / (maxPrice - refPrice));
}

/**
 * Conversion centimes (unité des montants du module électricité : tarifs, coûts, entretien) -> CHF (unité de la
 * trésorerie et du grand livre municipal). Arrondi au centime. Toute écriture budgétaire du module passe par ici :
 * le panneau Énergie affiche `centimes / 100`, la trésorerie doit recevoir le même montant.
 */
export const centsToChf = (cents: number): number => Math.round(cents) / 100;

/** Lit l'installation électrique d'un modèle du catalogue (undefined si ce n'en est pas une). */
export function facilityKindOf(asset: Pick<CatalogAsset, 'tags'> | undefined): FacilityKind | undefined {
  if (!asset) return undefined;
  for (const t of asset.tags) {
    if (t === TAG_SUBSTATION) return 'poste';
    if (t === TAG_BATTERY) return 'batterie';
    if (t.startsWith(TAG_PLANT_PREFIX)) {
      const k = t.slice(TAG_PLANT_PREFIX.length);
      if (k === 'thermique' || k === 'eolien' || k === 'solaire' || k === 'hydro') return k;
    }
  }
  return undefined;
}

/** Puissance nominale d'un modèle (étiquette `elec:kw:N` sinon valeur par défaut du type). */
export function nominalKwOf(asset: Pick<CatalogAsset, 'tags'>, kind: FacilityKind): number {
  for (const t of asset.tags) {
    if (t.startsWith(TAG_KW_PREFIX)) {
      const v = Number(t.slice(TAG_KW_PREFIX.length));
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return FACILITY_SPECS[kind].nominalKw;
}

/* ------------------------------ Consommation ------------------------------ */

/** Classe d'un bâtiment consommateur (d'après sa catégorie et ses étiquettes). */
export function consumerClassOf(asset: Pick<CatalogAsset, 'category' | 'tags'>): ConsumerClass {
  const tags = asset.tags;
  if (asset.category === 'public') {
    return tags.includes('service:sante') || tags.includes('hopital') || tags.includes('sante') ? 'sante' : 'services';
  }
  if (asset.category === 'commercial') return 'commerce';
  if (asset.category === 'industrial') return 'industrie';
  return 'residentiel';
}

/** Facteur horaire de charge (1 = moyenne journalière) par classe, interpolé linéairement à l'heure décimale. */
const HOURLY: Record<ConsumerClass, readonly number[]> = {
  //            0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16   17   18   19   20   21   22   23
  residentiel: [0.6, 0.5, 0.45, 0.45, 0.45, 0.55, 0.85, 1.2, 1.1, 0.85, 0.8, 0.85, 0.95, 0.9, 0.8, 0.8, 0.9, 1.15, 1.5, 1.7, 1.65, 1.45, 1.1, 0.8],
  commerce:    [0.3, 0.3, 0.3, 0.3, 0.3, 0.35, 0.5, 0.8, 1.25, 1.45, 1.5, 1.5, 1.45, 1.45, 1.5, 1.5, 1.45, 1.35, 1.2, 1.0, 0.8, 0.55, 0.4, 0.35],
  industrie:   [0.7, 0.7, 0.7, 0.7, 0.7, 0.75, 1.0, 1.2, 1.25, 1.25, 1.25, 1.25, 1.2, 1.2, 1.25, 1.25, 1.2, 1.1, 1.0, 0.9, 0.85, 0.8, 0.75, 0.7],
  services:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.55, 0.75, 1.05, 1.35, 1.4, 1.4, 1.4, 1.3, 1.35, 1.4, 1.4, 1.3, 1.15, 0.95, 0.8, 0.7, 0.6, 0.55, 0.5],
  sante:       [0.85, 0.8, 0.8, 0.8, 0.8, 0.85, 0.95, 1.05, 1.15, 1.2, 1.2, 1.2, 1.15, 1.15, 1.15, 1.15, 1.1, 1.05, 1.0, 1.0, 0.95, 0.9, 0.9, 0.85],
};

export function hourlyFactor(cls: ConsumerClass, hourOfDay: number): number {
  const t = ((hourOfDay % 24) + 24) % 24;
  const h0 = Math.floor(t), f = t - h0;
  const row = HOURLY[cls];
  return row[h0]! * (1 - f) + row[(h0 + 1) % 24]! * f;
}

/** Facteur saisonnier de la demande (chauffage d'hiver, climatisation d'été). */
export function seasonDemandFactor(season: string): number {
  return season === 'hiver' ? 1.18 : season === 'ete' ? 1.08 : 1;
}

/**
 * Demande moyenne (kW) d'un bâtiment, avant facteurs horaire et saisonnier : selon la classe, la taille
 * (cases d'emprise), les habitants présents et les emplois occupés (bâtiment vide = veille).
 */
export function baseDemandKw(cls: ConsumerClass, tiles: number, residents: number, workers: number, jobs: number): number {
  const standby = 0.4 * tiles;
  switch (cls) {
    case 'residentiel': return standby + 0.55 * residents;
    case 'commerce': return standby + 1.1 * workers + 0.2 * jobs;
    case 'industrie': return standby + 3.2 * workers + 0.6 * jobs;
    case 'sante': return 2 * tiles + 3.5 * Math.max(workers, jobs * 0.5);
    case 'services': return standby + 1.4 * workers + 0.2 * jobs;
  }
}

/* ------------------------------- Production ------------------------------- */

/** Courbe de puissance d'une éolienne (part de la puissance nominale) selon le vent à hauteur de moyeu (m/s). */
export function windPowerShare(ms: number): number {
  if (!(ms >= 3) || ms >= 25) return 0;      // démarrage à 3 m/s, arrêt de sécurité à 25 m/s
  if (ms >= 12) return 1;                      // puissance nominale
  // Courbe en v³ entre le démarrage et la vitesse nominale (facteur de charge annuel ≈ 28 % sur le profil de vent).
  return (ms * ms * ms - 27) / (12 * 12 * 12 - 27);
}

/**
 * Profil de vent sans module météo (m/s) : régimes de plusieurs jours + brise thermique de l'après-midi,
 * déterministe (graine de partie). Moyenne ≈ 7 m/s, de 1 à 14 m/s environ.
 */
export function windProfile(totalMinutes: number, seed: number): number {
  const d = totalMinutes / 1440;
  const ph = ((seed >>> 0) % 1000) / 1000 * Math.PI * 2;
  const synoptic = 3.4 * Math.sin(2 * Math.PI * d / 3.7 + ph) + 1.6 * Math.sin(2 * Math.PI * d / 1.9 + ph * 1.7);
  const hour = (totalMinutes / 60) % 24;
  const breeze = 1.3 * Math.sin(2 * Math.PI * (hour - 9) / 24);
  return Math.max(0, 7 + synoptic + breeze);
}

/** Durée du jour (h) par saison (latitude moyenne). */
export function dayLengthHours(season: string): number {
  return season === 'hiver' ? 9.5 : season === 'ete' ? 15 : 12.2;
}

/**
 * Ensoleillement (0..1) : part de la puissance crête d'un champ solaire, selon l'heure (course du soleil
 * centrée sur 13 h), la saison (durée du jour, hauteur) et la nébulosité (0..1).
 */
export function solarShare(hourOfDay: number, season: string, cloud = 0): number {
  const L = dayLengthHours(season);
  const noon = 13;
  const x = (hourOfDay - (noon - L / 2)) / L;
  if (x <= 0 || x >= 1) return 0;
  const height = season === 'hiver' ? 0.55 : season === 'ete' ? 1 : 0.8;
  const clear = Math.pow(Math.sin(Math.PI * x), 1.3) * height;
  return Math.max(0, clear * (1 - 0.75 * Math.min(1, Math.max(0, cloud))));
}

/** Débit relatif d'un cours d'eau par saison (part de la puissance nominale d'un barrage). */
export function hydroShare(season: string): number {
  return season === 'printemps' ? 1 : season === 'hiver' ? 0.85 : season === 'automne' ? 0.7 : 0.5;
}

/**
 * Centrale au pied d'un barrage (src/sim/hydro) : la puissance dépend de la HAUTEUR DE CHUTE (retenue − aval) et du
 * DÉBIT entrant (rivière barrée + sources). Physique : P = ρ·g·η·Q·H ; facteur de jeu choisi pour qu'à la référence
 * (HYDRO_REF_FLOW m³/s, HYDRO_REF_HEAD m) une centrale produise sa puissance nominale × débit saisonnier, comme une
 * centrale au fil de l'eau ; au-delà, plafond HYDRO_MAX_FACTOR × nominale (turbines). Chute nulle : rien.
 */
export const HYDRO_REF_HEAD = 10;
export const HYDRO_REF_FLOW = 60;
export const HYDRO_MAX_FACTOR = 4;

export function hydroDamKw(nominalKw: number, headM: number, flowM3s: number, season: string): number {
  if (!(headM > 0) || !(flowM3s > 0)) return 0;
  const k = (flowM3s / HYDRO_REF_FLOW) * (headM / HYDRO_REF_HEAD) * hydroShare(season);
  return nominalKw * Math.min(HYDRO_MAX_FACTOR, k);
}

/** Site d'une centrale au pied d'un barrage : raison affichée (chute, débit) ; non valide si la retenue est vide. */
export function hydroDamSiteCheck(dam: { headM: number; flowM3s: number; full: boolean }): { ok: boolean; reason: string } {
  if (!(dam.flowM3s > 0)) return { ok: false, reason: 'Barrage sans arrivée d\'eau : posez une source en amont ou barrez une rivière' };
  if (!(dam.headM > 0)) return { ok: true, reason: `Au pied d'un barrage : retenue en remplissage (débit ${Math.round(dam.flowM3s)} m³/s)` };
  return { ok: true, reason: `Au pied d'un barrage : chute ${dam.headM.toLocaleString('fr-FR')} m, débit ${Math.round(dam.flowM3s)} m³/s${dam.full ? '' : ' (retenue en remplissage)'}` };
}

/**
 * Validation du site d'un barrage : part des points d'un anneau autour de l'ouvrage qui sont dans l'eau.
 * Un barrage doit être au BORD d'un cours d'eau : ni en plein champ (aucune eau), ni entouré d'eau.
 */
export function hydroSiteCheck(x: number, z: number, halfSize: number, isWet: (x: number, z: number) => boolean): { ok: boolean; wetShare: number; reason: string } {
  const N = 32;
  let wet = 0;
  let n = 0;
  for (const r of [halfSize + 10, halfSize + 28]) {
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      n++;
      if (isWet(x + Math.cos(a) * r, z + Math.sin(a) * r)) wet++;
    }
  }
  const s = wet / n;
  if (s < 0.08) return { ok: false, wetShare: s, reason: 'Aucun cours d\'eau au bord du barrage : il ne produira rien' };
  if (s > 0.9) return { ok: false, wetShare: s, reason: 'Ouvrage isolé au milieu de l\'eau : raccordement impossible' };
  return { ok: true, wetShare: s, reason: 'Site au bord de l\'eau : barrage productif' };
}

/* ------------------------------- Fiabilité -------------------------------- */

/**
 * Multiplicateur du taux de panne selon le financement de l'entretien (1 = nominal) : sous-financer augmente
 * fortement les pannes (×4 à 50 %, ×16 à 25 %), sur-financer les réduit (×0,44 à 150 %).
 */
export function failureMultiplier(funding: number): number {
  const f = Math.min(1.5, Math.max(0.25, funding));
  return 1 / (f * f);
}

/** Multiplicateur de la durée de réparation selon le financement (×2 à 50 %). */
export function repairMultiplier(funding: number): number {
  const f = Math.min(1.5, Math.max(0.25, funding));
  return 1 / f;
}

/** Coût et entretien d'une ligne de longueur `m` (¢). */
export function lineCost(m: number): { cost: number; upkeepPerMonth: number } {
  return { cost: Math.round(m * LINE_SPEC.costPerM), upkeepPerMonth: Math.round((m / 1000) * LINE_SPEC.upkeepPerKmMonth) };
}

/** Hachage entier 32 bits (ordre de délestage tournant, sans PRNG). */
export function hash32(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
