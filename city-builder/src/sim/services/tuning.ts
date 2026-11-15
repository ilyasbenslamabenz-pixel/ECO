/**
 * Services qui comptent (vague 2) : réglages et formules PURES de la criminalité, des incendies et de la santé.
 * Mécaniques inspirées des city-builders modernes ; formules et valeurs propres au jeu (docs/SERVICES.md).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

export interface ServicesTuning {
  /* --- Criminalité (0..100 par bâtiment) --- */
  /** Points de base d'un logement, d'un commerce, d'une industrie, de bureaux. */
  crimeBaseLogement: number;
  crimeBaseCommerce: number;
  crimeBaseIndustrie: number;
  crimeBaseBureaux: number;
  /** Points à 100 % de chômeurs parmi les actifs du logement. */
  crimeChomage: number;
  /** Points à 100 % de ménages en difficulté de loyer (économie vivante). */
  crimePauvrete: number;
  /** Points par niveau de densité au-dessus de 1 (petits immeubles 2, tours 3). */
  crimeDensite: number;
  /** Part du voisinage (îlot de `crimeIlotM` m) dans la cible : la délinquance déborde sur les rues voisines. */
  crimeVoisinage: number;
  crimeIlotM: number;
  /** Réduction maximale sous la couverture d'un commissariat (qualité 1 : tout près). */
  crimePolice: number;
  /** Part de l'écart à la cible rattrapée chaque jour (inertie). */
  crimeInertie: number;
  /** Satisfaction retirée aux habitants d'un logement à 100 de criminalité. */
  crimeSatisfaction: number;
  /** Baisse de l'indice de valeur foncière à 100 de criminalité. */
  crimeFoncier: number;
  /** Baisse de l'attractivité de la ville à 100 de criminalité moyenne. */
  crimeAttractivite: number;
  /** Délits par jour et par occupant (habitants + employés) à 100 de criminalité. */
  delitsParOccupant: number;
  /** Seuil « criminalité élevée » (icône au-dessus du bâtiment, compte du rapport). */
  crimeEleve: number;

  /* --- Incendies --- */
  /** Probabilité horaire de départ de feu d'un bâtiment de risque 1 (à pleine pression). */
  feuProbaHeure: number;
  /** Réduction du risque sous la couverture d'une caserne (prévention, visites). */
  feuPrevention: number;
  /** Âge (ans) qui double le risque d'un bâtiment. */
  feuAgeAns: number;
  /** Heures pour qu'un feu non secouru détruise une maison (×(1 + 0,3·(niveau − 1)) pour les grands bâtiments). */
  feuDureeH: number;
  /** Délai d'arrivée des pompiers (h) = base + (1 − qualité de couverture) × distance. */
  feuDelaiBaseH: number;
  feuDelaiDistanceH: number;
  /** Heures d'extinction une fois les pompiers sur place. */
  feuExtinctionH: number;
  /** Dégâts (0..1) au-delà desquels le bâtiment est « endommagé » (sinon dégâts légers). */
  feuSeuilDegats: number;
  /** Jours de réparation d'un bâtiment endommagé (pas de nouveaux habitants pendant ce temps). */
  feuReparationJours: number;
  /** Probabilité horaire d'embrasement d'un voisin proche (≤ `feuVoisinM`) par un feu non maîtrisé avancé. */
  feuPropagation: number;
  feuVoisinM: number;
  /** Coût d'une reconstruction (part du coût du modèle) ; les lots privés sont reconstruits par leur promoteur. */
  reconstructionPart: number;
  reconstructionPriveeJours: number;
  /** Satisfaction retirée aux habitants d'un bâtiment endommagé par le feu. */
  feuSatisfaction: number;

  /* --- Santé (0..100 par logement, maladies individuelles) --- */
  santeBase: number;
  /** Points retirés par unité de pollution subie (borné à `santePollutionMax`). */
  santePollution: number;
  santePollutionMax: number;
  /** Points retirés par année d'âge moyen des habitants au-dessus de 40 ans. */
  santeAge: number;
  /** Bonus sous la couverture d'un centre de santé / hôpital (× qualité) et malus sans soins. */
  santeSoins: number;
  santeSansSoins: number;
  /** Probabilité quotidienne de tomber malade (adulte, santé 100, pleine pression). */
  maladieProba: number;
  /** Durée d'une maladie (jours) avec et sans soins. */
  maladieDureeSoins: number;
  maladieDureeSans: number;
  /** Multiplicateur de mortalité d'un malade soigné / non soigné. */
  maladieMortaliteSoins: number;
  maladieMortaliteSans: number;
  /** Satisfaction retirée à un malade, et par point de santé du logement sous 60. */
  maladieSatisfaction: number;
  santeSatisfaction: number;
  /** Baisse de l'attractivité à 100 % de malades. */
  maladieAttractivite: number;

  /** Jours de montée propres aux services après le chargement d'une sauvegarde antérieure (aucun service bâti). */
  rampeChargementJours: number;
}

export const DEFAULT_SERVICES_TUNING: ServicesTuning = {
  crimeBaseLogement: 6, crimeBaseCommerce: 10, crimeBaseIndustrie: 7, crimeBaseBureaux: 4,
  crimeChomage: 45, crimePauvrete: 30, crimeDensite: 7, crimeVoisinage: 0.35, crimeIlotM: 128,
  crimePolice: 0.75, crimeInertie: 0.12, crimeSatisfaction: 14, crimeFoncier: 0.25, crimeAttractivite: 0.15,
  delitsParOccupant: 0.003, crimeEleve: 45,

  feuProbaHeure: 0.0000015, feuPrevention: 0.6, feuAgeAns: 25, feuDureeH: 6,
  feuDelaiBaseH: 0.3, feuDelaiDistanceH: 1.6, feuExtinctionH: 1, feuSeuilDegats: 0.35, feuReparationJours: 10,
  feuPropagation: 0.03, feuVoisinM: 24, reconstructionPart: 0.3, reconstructionPriveeJours: 20, feuSatisfaction: 8,

  santeBase: 84, santePollution: 6, santePollutionMax: 30, santeAge: 0.5, santeSoins: 12, santeSansSoins: 12,
  maladieProba: 0.0015, maladieDureeSoins: 4, maladieDureeSans: 9, maladieMortaliteSoins: 2.5, maladieMortaliteSans: 6,
  maladieSatisfaction: 10, santeSatisfaction: 0.25, maladieAttractivite: 0.3,

  rampeChargementJours: 30,
};

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Secteur d'un bâtiment pour la criminalité de base : 0 aucun, 1 logement, 2 commerce, 3 industrie, 4 bureaux. */
export const CrimeKind = { None: 0, Housing: 1, Commerce: 2, Industry: 3, Office: 4 } as const;

/**
 * Criminalité propre d'un bâtiment (avant voisinage, police et pression) : base du secteur + chômage + pauvreté +
 * densité. `unemployment` et `poverty` sont des parts (0..1) parmi les actifs / ménages du logement.
 */
export function crimeOwn(t: ServicesTuning, kind: number, level: number, unemployment: number, poverty: number): number {
  if (kind === CrimeKind.None) return 0;
  const base = kind === CrimeKind.Housing ? t.crimeBaseLogement : kind === CrimeKind.Commerce ? t.crimeBaseCommerce
    : kind === CrimeKind.Industry ? t.crimeBaseIndustrie : t.crimeBaseBureaux;
  const social = kind === CrimeKind.Housing ? t.crimeChomage * clamp(unemployment, 0, 1) + t.crimePauvrete * clamp(poverty, 0, 1) : 0;
  return base + social + t.crimeDensite * Math.max(0, level - 1);
}

/** Cible finale : mélange avec le voisinage, réduction par la police (qualité 0..1), pression progressive. */
export function crimeTarget(t: ServicesTuning, own: number, neighborhood: number, policeQ: number, ramp: number): number {
  const mixed = (1 - t.crimeVoisinage) * own + t.crimeVoisinage * neighborhood;
  return clamp(mixed * (1 - t.crimePolice * clamp(policeQ, 0, 1)) * clamp(ramp, 0, 1), 0, 100);
}

/**
 * Facteur de risque d'incendie d'un bâtiment (catégorie du catalogue) : logement 1, commerce 1,2, industrie 2,2 (process
 * lourd 3), bureaux 0,8, public 0,5. Appelé seulement pour les catégories de bâtiment.
 */
export function fireBaseRisk(category: string, tags: readonly string[]): number {
  if (category === 'industrial') return tags.includes('usine') || tags.includes('energie') || tags.includes('chimie') || tags.includes('raffinerie') ? 3 : 2.2;
  if (category === 'commercial') return tags.includes('bureaux') || tags.includes('tertiaire') ? 0.8 : 1.2;
  if (category === 'skyscraper') return 0.8;
  if (category === 'public') return 0.5;
  // Logements : maisons, maisons mitoyennes, immeubles (toutes les autres catégories de bâtiment).
  return 1;
}

/**
 * Risque d'incendie (multiplicateur de la probabilité horaire, ≈ 0..6) : secteur, densité, âge, prévention de la
 * caserne (qualité de couverture 0..1).
 */
export function fireRisk(t: ServicesTuning, base: number, level: number, ageYears: number, fireQ: number): number {
  if (base <= 0) return 0;
  return base * (1 + 0.25 * Math.max(0, level - 1)) * (1 + Math.max(0, ageYears) / t.feuAgeAns) * (1 - t.feuPrevention * clamp(fireQ, 0, 1));
}

/** Risque affiché (0..100). */
export const fireRiskDisplay = (risk: number): number => Math.round(clamp(risk * 25, 0, 100));

/** Délai d'arrivée des pompiers (h) selon la qualité de couverture (> 0 : couvert). */
export const fireResponseHours = (t: ServicesTuning, fireQ: number): number => t.feuDelaiBaseH + (1 - clamp(fireQ, 0, 1)) * t.feuDelaiDistanceH;

/** Heures pour qu'un feu non maîtrisé détruise le bâtiment. */
export const fireBurnHours = (t: ServicesTuning, level: number): number => t.feuDureeH * (1 + 0.3 * Math.max(0, level - 1));

/** Santé (0..100) d'un logement : pollution subie, âge moyen des habitants, accès aux soins (qualité 0..1, 0 = aucun). */
export function healthTarget(t: ServicesTuning, pollution: number, meanAge: number, careQ: number): number {
  const care = careQ > 0 ? t.santeSoins * clamp(careQ, 0, 1) : -t.santeSansSoins;
  return clamp(t.santeBase - Math.min(t.santePollutionMax, t.santePollution * Math.max(0, pollution)) - t.santeAge * Math.max(0, meanAge - 40) + care, 5, 100);
}

/** Multiplicateur d'âge du risque de maladie. */
export function sicknessAgeFactor(age: number): number {
  if (age < 5) return 1.5;
  if (age < 50) return 1;
  if (age < 65) return 1.6;
  if (age < 80) return 2.6;
  return 3.6;
}

/** Probabilité quotidienne de tomber malade (santé du logement 0..100, pression 0..1). */
export function sicknessChance(t: ServicesTuning, health: number, age: number, ramp: number): number {
  return t.maladieProba * sicknessAgeFactor(age) * (1 + (100 - clamp(health, 0, 100)) / 35) * clamp(ramp, 0, 1);
}

/**
 * Tirage déterministe 0..1 à partir de deux entiers et d'un sel (hachage de type murmur) : les services n'utilisent
 * PAS le PRNG de la partie (aucun tirage pendant la période de grâce, simulation de base inchangée) et une partie
 * rechargée reproduit les mêmes événements sans état aléatoire à sauvegarder.
 */
export function hash01(a: number, b: number, salt: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77) ^ Math.imul(salt | 0, 0xc2b2ae3d)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
