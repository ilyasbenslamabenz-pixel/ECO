// Données de référence du modèle : secteurs, catégories, TVA, budget, démographie.
// Toutes les valeurs monétaires sont en euros courants ; les flux sont annuels sauf mention.

export const SECTOR_IDS = [
  'agriculture', 'industrie', 'construction', 'commerce', 'tourisme', 'technologie',
  'finance', 'services', 'energie', 'transport', 'sante', 'education',
] as const;
export type SectorId = (typeof SECTOR_IDS)[number];

export const OCCUPATIONS = ['cadres', 'employes', 'ouvriers', 'independants', 'entrepreneurs'] as const;
export type Occupation = (typeof OCCUPATIONS)[number];

export interface SectorDef {
  id: SectorId;
  name: string;
  icon: string;
  employmentShare: number; // part initiale de l'emploi
  productivity: number; // valeur ajoutée par emploi (€/an, prix initiaux), recalibrée
  wage: number; // salaire brut moyen (€/an)
  exportShare: number; // part de la production exportée
  importShare: number; // part de la demande intérieure importée
  energyShare: number; // coût de l'énergie en part de la valeur ajoutée
  emissionIntensity: number; // tCO2 directes par million d'€ de valeur ajoutée (prix initiaux)
  energyIntensity: number; // MWh par million d'€ de valeur ajoutée
  occupations: [number, number, number, number, number]; // cadres, employés, ouvriers, indépendants, entrepreneurs
  avgFirmSize: number; // employés par entreprise
  polluting: boolean;
  public: number; // part du secteur financée par l'État (indicatif)
}

export const SECTORS: SectorDef[] = [
  { id: 'agriculture', name: 'Agriculture', icon: '🌾', employmentShare: 0.025, productivity: 55000, wage: 28400, exportShare: 0.28, importShare: 0.22, energyShare: 0.06, emissionIntensity: 605, energyIntensity: 420, occupations: [0.05, 0.08, 0.37, 0.4, 0.1], avgFirmSize: 3, polluting: true, public: 0 },
  { id: 'industrie', name: 'Industrie', icon: '🏭', employmentShare: 0.12, productivity: 104000, wage: 49400, exportShare: 0.5, importShare: 0.42, energyShare: 0.08, emissionIntensity: 231, energyIntensity: 900, occupations: [0.2, 0.16, 0.56, 0.03, 0.05], avgFirmSize: 22, polluting: true, public: 0 },
  { id: 'construction', name: 'Construction', icon: '🏗️', employmentShare: 0.07, productivity: 63000, wage: 39900, exportShare: 0.03, importShare: 0.06, energyShare: 0.04, emissionIntensity: 61, energyIntensity: 220, occupations: [0.1, 0.1, 0.62, 0.13, 0.05], avgFirmSize: 6, polluting: false, public: 0 },
  { id: 'commerce', name: 'Commerce', icon: '🛒', employmentShare: 0.14, productivity: 60000, wage: 33600, exportShare: 0.06, importShare: 0.12, energyShare: 0.03, emissionIntensity: 14, energyIntensity: 110, occupations: [0.12, 0.6, 0.12, 0.11, 0.05], avgFirmSize: 7, polluting: false, public: 0 },
  { id: 'tourisme', name: 'Tourisme & restauration', icon: '🏖️', employmentShare: 0.06, productivity: 46000, wage: 28400, exportShare: 0.32, importShare: 0.05, energyShare: 0.04, emissionIntensity: 22, energyIntensity: 160, occupations: [0.06, 0.66, 0.1, 0.12, 0.06], avgFirmSize: 6, polluting: false, public: 0 },
  { id: 'technologie', name: 'Technologies & numérique', icon: '💻', employmentShare: 0.05, productivity: 136000, wage: 65100, exportShare: 0.38, importShare: 0.3, energyShare: 0.02, emissionIntensity: 3, energyIntensity: 90, occupations: [0.62, 0.22, 0.04, 0.07, 0.05], avgFirmSize: 14, polluting: false, public: 0 },
  { id: 'finance', name: 'Finance & assurance', icon: '🏦', employmentShare: 0.04, productivity: 167000, wage: 69300, exportShare: 0.25, importShare: 0.1, energyShare: 0.01, emissionIntensity: 2, energyIntensity: 40, occupations: [0.55, 0.38, 0.01, 0.03, 0.03], avgFirmSize: 25, polluting: false, public: 0 },
  { id: 'services', name: 'Services & administration', icon: '🏢', employmentShare: 0.225, productivity: 70000, wage: 39900, exportShare: 0.12, importShare: 0.07, energyShare: 0.02, emissionIntensity: 6, energyIntensity: 70, occupations: [0.3, 0.52, 0.08, 0.07, 0.03], avgFirmSize: 9, polluting: false, public: 0.35 },
  { id: 'energie', name: 'Énergie', icon: '⚡', employmentShare: 0.015, productivity: 246000, wage: 60900, exportShare: 0.08, importShare: 0.25, energyShare: 0.28, emissionIntensity: 1265, energyIntensity: 4000, occupations: [0.32, 0.2, 0.44, 0.01, 0.03], avgFirmSize: 60, polluting: true, public: 0.3 },
  { id: 'transport', name: 'Transport & logistique', icon: '🚚', employmentShare: 0.05, productivity: 72000, wage: 41000, exportShare: 0.18, importShare: 0.1, energyShare: 0.12, emissionIntensity: 358, energyIntensity: 1300, occupations: [0.1, 0.3, 0.52, 0.05, 0.03], avgFirmSize: 15, polluting: true, public: 0.2 },
  { id: 'sante', name: 'Santé', icon: '🏥', employmentShare: 0.11, productivity: 60000, wage: 43000, exportShare: 0.02, importShare: 0.08, energyShare: 0.03, emissionIntensity: 10, energyIntensity: 120, occupations: [0.3, 0.55, 0.05, 0.08, 0.02], avgFirmSize: 30, polluting: false, public: 0.8 },
  { id: 'education', name: 'Éducation', icon: '🎓', employmentShare: 0.09, productivity: 55000, wage: 41000, exportShare: 0.02, importShare: 0.02, energyShare: 0.02, emissionIntensity: 5, energyIntensity: 80, occupations: [0.62, 0.32, 0.03, 0.02, 0.01], avgFirmSize: 40, polluting: false, public: 0.9 },
];
export const SECTOR_INDEX = Object.fromEntries(SECTORS.map((s, i) => [s.id, i])) as Record<SectorId, number>;

// Multiplicateurs de salaire par profession (normalisés par secteur dans le moteur) et dispersion log-normale.
export const OCC_WAGE_MULT: Record<Occupation, number> = { cadres: 1.75, employes: 0.82, ouvriers: 0.8, independants: 1.0, entrepreneurs: 1.55 };
export const OCC_SIGMA: Record<Occupation, number> = { cadres: 0.38, employes: 0.24, ouvriers: 0.22, independants: 0.65, entrepreneurs: 0.75 };
export const OCC_NAMES: Record<Occupation, string> = { cadres: 'Cadres', employes: 'Employés', ouvriers: 'Ouvriers', independants: 'Indépendants', entrepreneurs: 'Entrepreneurs' };

// ---------- Consommation et TVA ----------
export const VAT_CATEGORIES = ['alimentation', 'logement', 'energie', 'transport', 'sante', 'loisirs', 'restauration', 'biens', 'services'] as const;
export type VatCategory = (typeof VAT_CATEGORIES)[number];
export type VatClass = 'normal' | 'reduit' | 'special' | 'exonere';

export interface VatCategoryDef {
  id: VatCategory;
  name: string;
  share: number; // part du budget des ménages
  essential: boolean; // produit de première nécessité
  sectors: Partial<Record<SectorId, number>>;
  defaultClass: VatClass;
  elasticity: number; // élasticité-prix du volume (négative)
}

export const VAT_CATS: VatCategoryDef[] = [
  { id: 'alimentation', name: 'Alimentation', share: 0.15, essential: true, sectors: { agriculture: 0.35, industrie: 0.35, commerce: 0.3 }, defaultClass: 'reduit', elasticity: -0.2 },
  { id: 'logement', name: 'Loyers & logement', share: 0.2, essential: true, sectors: { services: 0.6, construction: 0.3, finance: 0.1 }, defaultClass: 'exonere', elasticity: -0.1 },
  { id: 'energie', name: 'Énergie domestique', share: 0.07, essential: true, sectors: { energie: 0.85, commerce: 0.15 }, defaultClass: 'normal', elasticity: -0.25 },
  { id: 'transport', name: 'Transports & carburants', share: 0.11, essential: false, sectors: { transport: 0.45, industrie: 0.35, energie: 0.2 }, defaultClass: 'normal', elasticity: -0.4 },
  { id: 'sante', name: 'Santé & médicaments', share: 0.04, essential: true, sectors: { sante: 0.8, industrie: 0.2 }, defaultClass: 'exonere', elasticity: -0.1 },
  { id: 'loisirs', name: 'Loisirs & culture', share: 0.09, essential: false, sectors: { tourisme: 0.4, services: 0.4, technologie: 0.2 }, defaultClass: 'normal', elasticity: -0.9 },
  { id: 'restauration', name: 'Restauration & hôtels', share: 0.07, essential: false, sectors: { tourisme: 0.8, agriculture: 0.2 }, defaultClass: 'special', elasticity: -0.8 },
  { id: 'biens', name: 'Biens manufacturés', share: 0.17, essential: false, sectors: { industrie: 0.45, commerce: 0.4, technologie: 0.15 }, defaultClass: 'normal', elasticity: -0.7 },
  { id: 'services', name: 'Services aux ménages', share: 0.1, essential: false, sectors: { services: 0.5, finance: 0.3, technologie: 0.2 }, defaultClass: 'normal', elasticity: -0.6 },
];

// ---------- Budget de l'État ----------
export const BUDGET_LINES = [
  'sante', 'education', 'securite', 'defense', 'transports', 'infrastructures', 'environnement',
  'administration', 'logement', 'subventions', 'recherche', 'formation',
] as const;
export type BudgetLine = (typeof BUDGET_LINES)[number];

export interface BudgetLineDef {
  id: BudgetLine;
  name: string;
  icon: string;
  gdpShare: number; // part du PIB à l'état initial
  sectors?: Partial<Record<SectorId, number>>; // achats publics (absent = transfert)
  transfer?: 'menages' | 'entreprises';
  refPerCapita: number; // dépense de référence par habitant (€/an, prix initiaux) pour un service de qualité
}

export const BUDGET_DEFS: BudgetLineDef[] = [
  { id: 'sante', name: 'Santé', icon: '🏥', gdpShare: 0.07, sectors: { sante: 0.88, industrie: 0.12 }, refPerCapita: 2900 },
  { id: 'education', name: 'Éducation', icon: '🎓', gdpShare: 0.048, sectors: { education: 1 }, refPerCapita: 2000 },
  { id: 'securite', name: 'Sécurité & justice', icon: '🚓', gdpShare: 0.014, sectors: { services: 1 }, refPerCapita: 580 },
  { id: 'defense', name: 'Défense', icon: '🛡️', gdpShare: 0.018, sectors: { industrie: 0.5, services: 0.5 }, refPerCapita: 740 },
  { id: 'transports', name: 'Transports publics', icon: '🚆', gdpShare: 0.013, sectors: { transport: 0.6, construction: 0.4 }, refPerCapita: 540 },
  { id: 'infrastructures', name: 'Infrastructures', icon: '🛣️', gdpShare: 0.014, sectors: { construction: 0.8, industrie: 0.2 }, refPerCapita: 580 },
  { id: 'environnement', name: 'Environnement', icon: '🌳', gdpShare: 0.005, sectors: { services: 0.5, agriculture: 0.2, construction: 0.3 }, refPerCapita: 210 },
  { id: 'administration', name: 'Administration', icon: '🏛️', gdpShare: 0.028, sectors: { services: 1 }, refPerCapita: 1150 },
  { id: 'logement', name: 'Aides au logement', icon: '🏠', gdpShare: 0.007, transfer: 'menages', refPerCapita: 290 },
  { id: 'subventions', name: 'Subventions aux entreprises', icon: '💼', gdpShare: 0.012, transfer: 'entreprises', refPerCapita: 500 },
  { id: 'recherche', name: 'Recherche publique', icon: '🔬', gdpShare: 0.008, sectors: { technologie: 0.7, education: 0.3 }, refPerCapita: 330 },
  { id: 'formation', name: 'Formation professionnelle', icon: '🧰', gdpShare: 0.004, sectors: { education: 1 }, refPerCapita: 165 },
];
export const BUDGET_INDEX = Object.fromEntries(BUDGET_DEFS.map((b, i) => [b.id, i])) as Record<BudgetLine, number>;

// Répartition des subventions entre secteurs.
export const SUBSIDY_SPLIT: Partial<Record<SectorId, number>> = { agriculture: 0.3, industrie: 0.35, energie: 0.15, transport: 0.2 };
// Répartition de l'investissement privé (demande adressée).
export const INVEST_SPLIT: Partial<Record<SectorId, number>> = { construction: 0.45, industrie: 0.35, technologie: 0.2 };

// ---------- Cotisations sociales ----------
export const BRANCHES = ['maladie', 'chomage', 'retraite', 'accidents', 'famille'] as const;
export type Branch = (typeof BRANCHES)[number];
export const BRANCH_NAMES: Record<Branch, string> = { maladie: 'Assurance maladie', chomage: 'Assurance chômage', retraite: 'Retraite', accidents: 'Accidents du travail', famille: 'Prestations familiales' };

// ---------- Démographie ----------
export const AGE_BANDS = 21; // 0-4, 5-9, ..., 100+
export const INITIAL_AGE_PROFILE = [5.0, 5.3, 5.6, 5.7, 5.5, 5.9, 6.2, 6.4, 6.3, 6.6, 6.7, 6.6, 6.3, 5.9, 5.3, 4.4, 3.0, 1.8, 0.8, 0.25, 0.05];
export const BASE_MORTALITY = [0.0008, 0.0001, 0.0001, 0.0003, 0.0005, 0.0006, 0.0007, 0.001, 0.0014, 0.002, 0.003, 0.0045, 0.007, 0.0105, 0.016, 0.026, 0.043, 0.075, 0.14, 0.27, 0.5];

// Profils de population (catégories affichées).
export const CATEGORY_IDS = [
  'enfants', 'etudiants', 'cadres', 'employes', 'ouvriers', 'independants', 'entrepreneurs', 'retraites', 'chomeurs', 'inactifs',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];
export const CATEGORY_NAMES: Record<CategoryId, string> = {
  enfants: 'Enfants', etudiants: 'Étudiants', cadres: 'Cadres', employes: 'Employés', ouvriers: 'Ouvriers',
  independants: 'Indépendants', entrepreneurs: 'Entrepreneurs', retraites: 'Retraités', chomeurs: 'Sans emploi', inactifs: 'Autres inactifs',
};
