/**
 * Politiques publiques et recherche municipale (phase 2C) : définitions et effets combinés.
 * Mécaniques originales : chaque politique a un coût mensuel et des effets mesurables ; chaque projet de recherche
 * coûte des points (produits par l'éducation et le budget de recherche) et donne un effet permanent.
 * Les systèmes (démographie, économie, électricité, déchets, eau, zonage) lisent les MODIFICATEURS combinés.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Effets combinés appliqués par les systèmes de la ville (valeurs neutres : 0 ou 1). */
export interface Modifiers {
  /** Points de bonheur ajoutés à chaque habitant (cible journalière). */
  happiness: number;
  /** Multiplicateur de la pollution industrielle subie. */
  pollutionFactor: number;
  /** Multiplicateur de la demande électrique. */
  powerDemandFactor: number;
  /** Multiplicateur de la production éolienne et solaire. */
  renewableFactor: number;
  /** Multiplicateurs d'entretien (routes, bâtiments). */
  roadUpkeepFactor: number;
  buildingUpkeepFactor: number;
  /** Multiplicateur des recettes de recyclage. */
  recyclingFactor: number;
  /** Multiplicateur de la consommation d'eau. */
  waterDemandFactor: number;
  /** Bonus de demande par secteur de zonage (R, C, I, B). */
  demand: { R: number; C: number; I: number; B: number };
}

export const NEUTRAL_MODIFIERS: Modifiers = {
  happiness: 0, pollutionFactor: 1, powerDemandFactor: 1, renewableFactor: 1, roadUpkeepFactor: 1, buildingUpkeepFactor: 1,
  recyclingFactor: 1, waterDemandFactor: 1, demand: { R: 0, C: 0, I: 0, B: 0 },
};

export type ModifierDelta = Partial<Omit<Modifiers, 'demand'>> & { demand?: Partial<Modifiers['demand']> };

export interface PolicyDef {
  id: string;
  nameFr: string;
  descFr: string;
  /** Coût mensuel fixe (CHF) et coût par habitant (CHF/mois). */
  costPerMonth: number;
  costPerResident: number;
  effect: ModifierDelta;
}

export const POLICIES: readonly PolicyDef[] = [
  { id: 'aide_logement', nameFr: 'Aide au logement', descFr: 'Allocation aux ménages : +4 points de bonheur pour tous les habitants.', costPerMonth: 0, costPerResident: 2, effect: { happiness: 4, demand: { R: 0.08 } } },
  { id: 'filtres_industriels', nameFr: 'Filtres industriels obligatoires', descFr: 'Pollution industrielle −40 %, mais l’industrie s’installe un peu moins volontiers.', costPerMonth: 3000, costPerResident: 0, effect: { pollutionFactor: 0.6, demand: { I: -0.06 } } },
  { id: 'sobriete_energie', nameFr: 'Sobriété énergétique', descFr: 'Demande d’électricité −12 % (éclairage réduit la nuit, chauffage modéré) ; −1 point de bonheur.', costPerMonth: 1500, costPerResident: 0, effect: { powerDemandFactor: 0.88, happiness: -1 } },
  { id: 'tri_obligatoire', nameFr: 'Tri des déchets obligatoire', descFr: 'Recettes de recyclage +30 % ; −1 point de bonheur (contrainte du tri).', costPerMonth: 0, costPerResident: 0, effect: { recyclingFactor: 1.3, happiness: -1 } },
  { id: 'restrictions_eau', nameFr: 'Restrictions d’eau', descFr: 'Arrosage et lavage limités : consommation d’eau −20 % ; −2 points de bonheur.', costPerMonth: 0, costPerResident: 0, effect: { waterDemandFactor: 0.8, happiness: -2 } },
  { id: 'ville_verte', nameFr: 'Plan « ville verte »', descFr: 'Plantations et îlots de fraîcheur : pollution ressentie −20 %, +2 points de bonheur.', costPerMonth: 2500, costPerResident: 0, effect: { pollutionFactor: 0.8, happiness: 2 } },
  { id: 'soutien_commerce', nameFr: 'Soutien au commerce local', descFr: 'Aides aux commerces et aux bureaux : demande commerciale et de bureaux en hausse.', costPerMonth: 2000, costPerResident: 0, effect: { demand: { C: 0.15, B: 0.08 } } },
];

export interface ResearchDef {
  id: string;
  nameFr: string;
  descFr: string;
  /** Points nécessaires. */
  cost: number;
  /** Projets à terminer avant. */
  requires: string[];
  effect: ModifierDelta;
}

export const RESEARCH: readonly ResearchDef[] = [
  { id: 'bitume_recycle', nameFr: 'Bitume recyclé', descFr: 'Entretien des routes −15 %.', cost: 120, requires: [], effect: { roadUpkeepFactor: 0.85 } },
  { id: 'eclairage_led', nameFr: 'Éclairage public LED', descFr: 'Demande d’électricité −8 %.', cost: 160, requires: [], effect: { powerDemandFactor: 0.92 } },
  { id: 'isolation', nameFr: 'Isolation des bâtiments', descFr: 'Entretien des bâtiments −10 %, demande d’électricité −5 %.', cost: 260, requires: ['eclairage_led'], effect: { buildingUpkeepFactor: 0.9, powerDemandFactor: 0.95 } },
  { id: 'tri_optique', nameFr: 'Tri optique des déchets', descFr: 'Recettes de recyclage +25 %.', cost: 220, requires: [], effect: { recyclingFactor: 1.25 } },
  { id: 'renouvelables', nameFr: 'Éoliennes et panneaux de nouvelle génération', descFr: 'Production éolienne et solaire +20 %.', cost: 340, requires: ['eclairage_led'], effect: { renewableFactor: 1.2 } },
  { id: 'urbanisme_durable', nameFr: 'Urbanisme durable', descFr: 'Quartiers mieux conçus : +2 points de bonheur, demande résidentielle en hausse.', cost: 380, requires: ['bitume_recycle'], effect: { happiness: 2, demand: { R: 0.06 } } },
  { id: 'logistique', nameFr: 'Logistique optimisée', descFr: 'Demande industrielle en hausse, pollution industrielle −10 %.', cost: 300, requires: ['bitume_recycle'], effect: { demand: { I: 0.1 }, pollutionFactor: 0.9 } },
  { id: 'ville_numerique', nameFr: 'Ville numérique', descFr: 'Services en ligne et télétravail : demande de bureaux en hausse, +1 point de bonheur.', cost: 520, requires: ['urbanisme_durable', 'isolation'], effect: { demand: { B: 0.12 }, happiness: 1 } },
];

/** Combine des effets (additifs pour bonheur et demande, multiplicatifs pour les facteurs). */
export function combine(deltas: readonly ModifierDelta[]): Modifiers {
  const m: Modifiers = { ...NEUTRAL_MODIFIERS, demand: { ...NEUTRAL_MODIFIERS.demand } };
  for (const d of deltas) {
    if (d.happiness) m.happiness += d.happiness;
    for (const k of ['pollutionFactor', 'powerDemandFactor', 'renewableFactor', 'roadUpkeepFactor', 'buildingUpkeepFactor', 'recyclingFactor', 'waterDemandFactor'] as const) if (d[k] !== undefined) m[k] *= d[k]!;
    if (d.demand) for (const s of ['R', 'C', 'I', 'B'] as const) m.demand[s] += d.demand[s] ?? 0;
  }
  return m;
}

/** Points de recherche par mois : écoles et équipements d'enseignement, population, budget de recherche. */
export function researchPointsPerMonth(schools: number, population: number, budgetPerMonth: number): number {
  return Math.round(schools * 12 + Math.min(60, population / 250) + budgetPerMonth / 500);
}

/** Budgets de recherche proposés (CHF / mois). */
export const RESEARCH_BUDGETS = [0, 5000, 15000, 30000] as const;

/** Service publié par les modules `politiques` et `recherche` (lu par les systèmes de la ville). */
export interface GovernanceService { modifiers(): ModifierDelta }
export const POLICY_SERVICE = 'politiques';
export const RESEARCH_SERVICE = 'recherche';

/** Modificateurs combinés à partir des services publiés (absents = neutre). */
export function governanceModifiers(use: <T>(name: string) => T | undefined): Modifiers {
  const deltas: ModifierDelta[] = [];
  for (const id of [POLICY_SERVICE, RESEARCH_SERVICE]) { const s = use<GovernanceService>(id); if (s) deltas.push(s.modifiers()); }
  return combine(deltas);
}
