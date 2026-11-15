/**
 * Économie vivante — réglages et constantes (loyers, difficultés des ménages, entreprises, éducation).
 * Formules propres au jeu (docs/ECONOMIE_VIVANTE.md) ; toutes les valeurs sont modifiables par `living.tuning`.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

export interface LivingTuning {
  /** Loyer mensuel d'un logement de niveau 1 pour une valeur foncière de référence (indice 1), crédits. */
  loyerBase: number;
  /** Supplément de loyer par niveau de bâtiment au-delà du premier (logements plus grands, mieux équipés). */
  loyerParNiveau: number;
  /** Effet du marché : multiplicateur = 1 + sensibilité × (vacance cible − vacance réelle), borné. */
  vacanceCible: number;
  sensibiliteMarche: number;
  marcheMin: number;
  marcheMax: number;
  /** Part soutenable des ressources d'un ménage consacrée au loyer. */
  partSoutenable: number;
  /** Allocation mensuelle d'un adulte sans emploi (comptée dans les ressources, pas dans l'impôt). */
  allocationChomage: number;
  /** Jours de difficulté avant de chercher un logement moins cher, puis avant de quitter la ville. */
  joursAvantDemenagement: number;
  joursAvantDepart: number;
  /** Plafonds quotidiens (coût CPU et douceur de la pression). */
  maxDemenagementsParJour: number;
  maxDepartsParJour: number;
  /** Loyer mensuel par poste de travail (capacité) d'un local d'activité, valeur foncière de référence. */
  loyerParPoste: number;
  /** Frais généraux d'une entreprise (part du chiffre d'affaires), comme avant l'économie vivante. */
  fraisGeneraux: number;
  /** Mois déficitaires avant fermeture ; âge minimal d'une entreprise avant de compter ses pertes (jours). */
  moisAvantFermeture: number;
  ageMinEntrepriseJours: number;
  /** Fermetures au plus par mois (part des entreprises, au moins 1). */
  partFermeturesParMois: number;
  /** Jours de vacance d'un local fermé avant qu'une nouvelle entreprise puisse s'y installer. */
  joursAvantReprise: number;
  /** Productivité d'un employé sous-qualifié (par rapport à un employé qualifié). */
  productiviteSousQualifie: number;
  /** Chance d'obtenir un diplôme du supérieur à 21 ans (bachelier, quartier couvert par l'éducation). */
  probaSuperieur: number;
  /** Chance annuelle de formation continue d'un adulte sans emploi de moins de 45 ans (quartier couvert). */
  probaFormationAn: number;
}

export const DEFAULT_LIVING_TUNING: Readonly<LivingTuning> = Object.freeze({
  loyerBase: 360,
  loyerParNiveau: 0.12,
  vacanceCible: 0.06,
  sensibiliteMarche: 2.5,
  marcheMin: 0.8,
  marcheMax: 1.2,
  partSoutenable: 0.4,
  allocationChomage: 650,
  joursAvantDemenagement: 20,
  joursAvantDepart: 60,
  maxDemenagementsParJour: 30,
  maxDepartsParJour: 30,
  loyerParPoste: 70,
  fraisGeneraux: 0.1,
  moisAvantFermeture: 4,
  ageMinEntrepriseJours: 60,
  partFermeturesParMois: 0.05,
  joursAvantReprise: 45,
  productiviteSousQualifie: 0.65,
  probaSuperieur: 0.45,
  probaFormationAn: 0.25,
});

/** Niveaux d'éducation simplifiés (3) à partir des 5 niveaux de la population. */
export const EDU_TIERS_FR = ['Sans diplôme', 'Secondaire', 'Supérieur'] as const;
/** Niveau simplifié : 0 sans diplôme (aucun, primaire), 1 secondaire (brevet/CAP, bac), 2 supérieur. */
export const eduTier = (education: number): number => (education >= 4 ? 2 : education >= 2 ? 1 : 0);

/** Raisons des difficultés et des fermetures d'entreprise (index = code sauvegardé ; 0 = aucune). */
export const CLOSURE_REASONS = [
  ['', ''],
  ['main-doeuvre', 'Manque de main-d’œuvre'],
  ['clients', 'Manque de clients'],
  ['qualification', 'Main-d’œuvre peu qualifiée'],
  ['loyer', 'Loyer trop élevé'],
  ['charges', 'Salaires et charges trop lourds'],
] as const;
export const Reason = { None: 0, Labor: 1, Customers: 2, Qualification: 3, Rent: 4, Costs: 5 } as const;

/** États d'une entreprise (colonne `status`). */
export const CompanyStatus = { Active: 0, Difficulty: 1, Closed: 2 } as const;

/** Secteurs (mêmes codes que `Sector` de la démographie) et libellés. */
export const SECTOR_FR: Record<number, string> = { 1: 'Commerce', 2: 'Industrie', 3: 'Bureaux', 4: 'Service public' };

/**
 * Niveau d'un bâtiment (1 à 3) d'après sa catégorie et sa capacité : maisons 1, petits immeubles 2, grands 3 ;
 * locaux d'activité selon le nombre de postes.
 */
export function buildingLevel(category: string, residents: number, jobs: number): number {
  switch (category) {
    case 'house': case 'townhouse': return 1;
    case 'apartment_low': case 'apartment_mid': return 2;
    case 'apartment_high': case 'skyscraper': return 3;
    default: {
      const n = Math.max(residents, jobs);
      return n >= 150 ? 3 : n >= 40 ? 2 : 1;
    }
  }
}

/** Multiplicateur de loyer du marché du logement (vacance réelle, 0..1). */
export function marketFactor(t: LivingTuning, vacancy: number): number {
  const m = 1 + t.sensibiliteMarche * (t.vacanceCible - vacancy);
  return m < t.marcheMin ? t.marcheMin : m > t.marcheMax ? t.marcheMax : m;
}

/** Facteur de taille du logement occupé par un ménage (personne seule 0,85 ; famille de quatre 1,15). */
export const householdSizeFactor = (size: number): number => 0.75 + 0.1 * Math.min(6, Math.max(1, size));

/**
 * Valeur foncière (indice, 1 = référence) : services publics couvrant le bâtiment, équipements remarquables proches,
 * pollution subie, décalage de la grille municipale `valeur_fonciere` (nuisances des déchets, bruit des pôles).
 */
export function landValueIndex(servicesCovered: number, attract: number, pollution: number, gridOffset: number): number {
  const v = 0.75 + 0.06 * servicesCovered + Math.min(0.2, 0.05 * attract) - Math.min(0.35, 0.07 * pollution) + gridOffset;
  return v < 0.4 ? 0.4 : v > 1.6 ? 1.6 : v;
}

/** Loyer mensuel d'un logement (avant facteur de taille du ménage). */
export function dwellingRent(t: LivingTuning, land: number, level: number, market: number): number {
  return t.loyerBase * land * (1 + t.loyerParNiveau * (Math.max(1, level) - 1)) * market;
}

/** Loyer mensuel d'un local d'activité (par poste de capacité, occupé ou non). */
export function businessRent(t: LivingTuning, land: number, level: number, jobCapacity: number): number {
  return t.loyerParPoste * land * (1 + t.loyerParNiveau * (Math.max(1, level) - 1)) * jobCapacity;
}

/**
 * Seuil de difficulté appliqué (part des ressources) : pendant la montée en charge (rampe 0..1), le seuil part de
 * part soutenable + 0,6 et descend jusqu'à la part soutenable.
 */
export const distressThreshold = (t: LivingTuning, ramp: number): number => t.partSoutenable + (1 - ramp) * 0.6;

/** Effet du coût du logement sur la satisfaction (points) selon l'effort (loyer / ressources). */
export function rentSatisfaction(t: LivingTuning, burden: number, ramp: number): number {
  if (ramp <= 0) return 0;
  if (burden > t.partSoutenable) return -Math.min(12, 30 * (burden - t.partSoutenable)) * ramp;
  if (burden < t.partSoutenable / 2) return 1.5 * ramp;
  return 0;
}
