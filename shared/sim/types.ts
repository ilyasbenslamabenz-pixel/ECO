// Types centraux de la simulation (partagés client / serveur).
import type { Branch, BudgetLine, CategoryId, Occupation, SectorId, VatCategory, VatClass } from './data';
import type { PoliticsState } from './politics';
import type { InternationalState } from './international';
import type { EventsState } from './events';
import type { VictoryState } from './victory';
import type { EnergyPolicy } from './energyData';
import type { EnergyState } from './energy';
import type { EnvironmentState } from './environment';
import type { TransportPolicy, TransportState } from './transport';
import type { IndustryPolicy, IndustryState } from './industry';
import type { AgriculturePolicy, AgricultureState } from './agriculture';
import type { WastePolicy, WasteState } from './waste';
// --- modules services publics/recherche/construction ---
import type { HealthPolicy, HealthState } from './health';
import type { EducationPolicy, EducationState } from './education';
import type { HousingPolicy, HousingState } from './housing';
import type { SecurityPolicy, SecurityState } from './security';
import type { ResearchPolicy, ResearchState } from './research';
import type { ConstructionState } from './construction';
import type { MissionsState } from './missions'; // --- missions et progression du joueur ---
import type { ClimateState } from './climate'; // --- plan climat ---

// ---------- Décisions du joueur ----------
export interface Bracket { upTo: number | null; rate: number }

export interface Policy {
  incomeTax: {
    brackets: Bracket[]; // barème progressif par contribuable (€/an de revenu imposable)
    deductionRate: number; // abattement forfaitaire pour frais (part du revenu)
    deductionCap: number; // plafond de l'abattement (€/an)
    childDeduction: number; // déduction par enfant à charge (€/an)
    taxCredit: number; // crédit d'impôt forfaitaire par contribuable (€/an, non remboursable)
    activityCredit: number; // crédit d'impôt pour les bas revenus (€/an, remboursable, dégressif jusqu'à 1,6 SMIC)
    capitalRate: number; // prélèvement forfaitaire sur les revenus du capital
  };
  corporate: {
    rate: number; // taux normal de l'impôt sur les sociétés
    smeRate: number; // taux réduit PME (s'applique à 30 % des bénéfices)
    investCredit: number; // crédit d'impôt investissement (part de l'investissement)
    greenCredit: number; // crédit d'impôt pour investissements verts (part de l'investissement vert)
    pollutingSurtax: number; // surtaxe d'IS sur les secteurs polluants (points)
  };
  vat: { normal: number; reduit: number; special: number; classes: Record<VatCategory, VatClass> };
  wealth: { rate: number; threshold: number };
  property: { landRate: number; transferRate: number; vacancyRate: number; localTax: number };
  eco: {
    carbon: number; // €/tCO2 (hors secteur de l'énergie soumis au marché carbone)
    fuel: number; // accise sur les carburants (part du prix hors TVA)
    industrial: number; // €/tCO2 sur les émissions industrielles et énergétiques
    waste: number; // €/tonne de déchets
    vehicle: number; // €/an par véhicule thermique
    energyIntensive: number; // taxe sur la valeur ajoutée des activités énergivores
  };
  contributions: Record<Branch, { employer: number; employee: number }>;
  labour: {
    minWage: number; // salaire minimum brut mensuel (€)
    hours: number; // durée légale hebdomadaire (h)
    hiringAid: number; // aide annuelle par emploi peu qualifié (€)
    benefitRate: number; // taux de remplacement des allocations chômage
    benefitMonths: number; // durée maximale d'indemnisation (mois)
    retirementAge: number; // âge légal de départ
    pensionRate: number; // taux de remplacement des pensions (part du salaire moyen)
    familyAllowance: number; // allocation par enfant (€/mois)
  };
  budget: Record<BudgetLine, number>; // dépenses discrétionnaires annuelles (€)
  finance: { indexBudgets: boolean; autoBorrow: boolean; minCash: number };
  /** Politique commerciale (module international). Optionnelle pour la compatibilité des anciennes sauvegardes. */
  trade?: {
    tariff: number; // droits de douane moyens sur les importations (0..0,5) : renchérissent les importations, provoquent des représailles
  };
  energy: EnergyPolicy; // module énergie et environnement (energyData.ts)
  // --- politiques sectorielles (phase 4b) ---
  transport?: TransportPolicy;
  industry?: IndustryPolicy;
  agriculture?: AgriculturePolicy;
  waste?: WastePolicy;
  // --- modules services publics/recherche/construction ---
  health: HealthPolicy;
  education: EducationPolicy;
  housing: HousingPolicy;
  security: SecurityPolicy;
  research: ResearchPolicy;
}

// ---------- Pays (géographie, statique) ----------
export type CityKind = 'metropole' | 'ville' | 'commune';

export interface CityDef {
  id: number;
  name: string;
  kind: CityKind;
  x: number; // km
  z: number; // km
  radius: number; // km
  coastal: boolean;
  capital: boolean;
  sectorWeights: number[]; // poids relatifs d'emploi par secteur
}

export type InfraType =
  | 'hopital' | 'universite' | 'ecole' | 'aeroport' | 'port' | 'gare'
  | 'centrale_charbon' | 'centrale_gaz' | 'centrale_nucleaire' | 'barrage' | 'parc_eolien' | 'parc_solaire'
  | 'zone_industrielle' | 'zone_commerciale' | 'commissariat' | 'stade' | 'caserne' | 'usine' | 'ferme'
  // module énergie : sites ajoutés automatiquement par le moteur
  | 'centrale_fioul' | 'centrale_geothermique' | 'centrale_biomasse' | 'parc_eolien_mer' | 'stockage_batteries'

  // --- modules services publics/recherche/construction ---
  | 'clinique' | 'centre_medical' | 'college' | 'lycee' | 'centre_formation' | 'laboratoire' | 'caserne_pompiers' | 'tribunal' | 'prison'
  | 'zone_residentielle' | 'eco_quartier' | 'logements_sociaux' | 'centrale_smr';

export interface Infra {
  id: number;
  type: InfraType;
  name: string;
  cityId: number | null;
  x: number;
  z: number;
  rot: number;
  capacity: number; // capacité dans l'unité du type (lits, places, MW, passagers/an...)
  capacityUnit: string;
  employees: number;
  maintenance: number; // €/an
  energyMWh: number; // consommation (ou production si négatif) MWh/an
  emissions: number; // tCO2/an
  level: number;
  builtYear: number;
  status?: 'construction' | 'active' | 'closed' | 'chantier'; // absent = en service ; 'construction' (énergie, secteurs) ou 'chantier' (équipements publics) = en travaux
  serviceMonth?: number; // mois de mise en service prévue ou effective
  progress?: number; // avancement du chantier 0..1
  condition?: number; // état du bâti 0..1 (entretien financé par le ministère de tutelle)
  custom?: boolean; // construit pendant la partie (entretien et recettes comptés en « équipements »)
  revenue?: number; // recettes publiques annuelles (€/an, prix de base)
  renovated?: boolean; // rénovation énergétique déjà réalisée
}

export interface Link { a: number; b: number; kind: 'autoroute' | 'nationale' | 'rail'; points: [number, number][] }

export interface RiverDef { points: [number, number][]; width: number }
export interface LakeDef { x: number; z: number; r: number; level: number }

export interface CountryDef {
  name: string;
  seed: number;
  width: number; // km (axe x)
  depth: number; // km (axe z)
  seaLevel: number;
  cities: CityDef[];
  links: Link[];
  rivers: RiverDef[];
  lakes: LakeDef[];
  infra: Infra[];
}

export interface CountryConfig {
  name: string;
  seed: number;
  metropoles: number;
  villes: number;
  communes: number;
  population: number; // population initiale
}

// ---------- État dynamique ----------
export interface SectorState {
  employees: number;
  productivity: number; // VA réelle par emploi (€/an, prix de base)
  wage: number; // salaire de base brut (€/an)
  firms: number;
  baseExport: number; // exportations réelles de référence (€/an, prix de base)
  emissionIntensity: number; // tCO2 / M€ réels
  output: number; // VA nominale (€/an)
  demand: number; // demande nominale adressée (€/an)
  profit: number; // bénéfice avant impôt (€/an)
  investment: number; // investissement privé (€/an)
  failures: number; // faillites cumulées sur 12 mois glissants (approximation lissée)
  creations: number;
  vacancies: number;
}

export interface CityState {
  popShare: number;
  population: number;
  unemployment: number;
  income: number; // revenu disponible moyen par habitant (€/an)
  satisfaction: number; // 0..100
  housingUnits: number;
  localRevenue: number; // €/an
}

export interface Macro {
  priceLevel: number;
  inflation: number; // annualisée
  expectedInflation: number;
  policyRate: number;
  worldPrice: number;
  worldDemand: number;
  energyPrice: number; // indice
  confidence: number; // 0..1
  productivityGrowth: number; // annuelle
  consTaxRate: number; // taux moyen des taxes à la consommation (pour la répercussion)
  outputGap: number;
}

export interface Finance {
  cash: number; // trésorerie (€)
  reserve: number; // fonds de réserve (€)
  debt: number; // dette publique brute (€)
  avgRate: number; // taux moyen apparent de la dette
  marketRate: number; // taux d'emprunt à 10 ans
  bondsIssued: { month: number; amount: number; rate: number; auto: boolean }[];
}

export interface Services { sante: number; education: number; securite: number; transports: number; infrastructures: number; environnement: number; administration: number; formation: number; recherche: number; logement: number }

export interface Notice { id: number; month: number; kind: 'info' | 'warn' | 'good' | 'bad'; title: string; text: string }

/** Comptes du dernier mois (montants annualisés, €/an). */
export interface Accounts {
  revenue: Record<RevenueKey, number> & { energiePublique?: number }; // energiePublique : marge des centrales publiques (module énergie)
  spending: Record<SpendingKey, number>;
  revenueTotal: number;
  spendingTotal: number;
  primaryBalance: number;
  balance: number;
  gdp: number;
  gdpReal: number;
  consumption: number; // dépense des ménages TTC
  consumptionNet: number; // hors taxes
  investment: number;
  publicPurchases: number;
  exports: number;
  imports: number;
  wages: number;
  employerContrib: number;
  employeeContrib: number;
  pensions: number;
  unemploymentBenefits: number;
  familyBenefits: number;
  housingAid: number;
  activityCredit: number;
  capitalIncome: number;
  disposableIncome: number;
  savings: number;
  emissions: number; // tCO2/an territoriales directes
  emissionsBySector: number[];
  emissionsHouseholds: number;
  waste: number; // t/an
  taxByCategory: Record<string, { people: number; grossIncome: number; incomeTax: number; contributions: number; effectiveRate: number }>;
  vatByCategory: Record<VatCategory, number>;
  gini: number;
  poverty: number; // part sous 60 % du revenu médian
  medianIncome: number;
  meanWage: number;
  medianWage: number;
  failures: number; // faillites annualisées
  creations: number;
  // Champs optionnels renseignés par le module énergie / environnement s'il existe (lus par victory.ts et events.ts).
  renewableShareElec?: number; // part renouvelable de la production électrique (0..1)
  renewableShareFinal?: number; // part renouvelable de la consommation finale d'énergie (0..1)
  netEmissions?: number; // émissions nettes (émissions − absorptions), tCO2/an
  energyImportDependence?: number; // part de l'énergie consommée importée (0..1)
}

export type RevenueKey =
  | 'impotRevenu' | 'impotCapital' | 'impotSocietes' | 'tva' | 'cotisationsPatronales' | 'cotisationsSalariales'
  | 'patrimoine' | 'foncier' | 'transactions' | 'vacance' | 'taxesLocales'
  | 'carbone' | 'carburants' | 'emissionsIndustrielles' | 'dechets' | 'vehicules' | 'energivores'
  | 'entreprisesPubliques' | 'infrastructures' | 'divers' | 'douanes';

export type SpendingKey = BudgetLine | 'retraites' | 'chomage' | 'allocations' | 'creditActivite' | 'interets'
  | 'energie' | 'ecologie' // module énergie
  | 'equipements'; // équipements publics construits pendant la partie

export interface Demography {
  cohorts: number[]; // population par tranche de 5 ans
  births: number; // annualisées
  deaths: number;
  migration: number;
  fertility: number; // indicateur conjoncturel de fécondité
  lifeExpectancy: number;
  categories: Record<CategoryId, number>;
  labourForce: number;
  employed: number;
  unemployed: number;
  households: number;
}

export interface Satisfaction {
  overall: number;
  byCategory: Record<CategoryId, number>;
  factors: Record<string, number>; // composantes 0..100
  trust: number;
  protestRisk: number; // 0..1
  strikeRisk: number;
  unrestRisk: number;
}

export interface GameState {
  version: number;
  id: string;
  name: string;
  config: CountryConfig;
  country: CountryDef;
  startYear: number;
  month: number; // mois écoulés depuis le début
  policy: Policy;
  pending: { month: number; policy: Policy } | null;
  sectors: SectorState[];
  cities: CityState[];
  macro: Macro;
  finance: Finance;
  services: Services;
  demography: Demography;
  satisfaction: Satisfaction;
  accounts: Accounts;
  baseline: { realIncomePerCap: number; taxRate: number; gdpReal: number; emissionsPerCap: number; ulc: number; wageCost: number[]; margin: number; invBase: number; catTaxRate: Record<string, number>; catIncome: Record<string, number>; meanWage: number };
  history: Record<string, number[]>;
  notices: Notice[];
  noticeSeq: number;
  // --- modules politique / international / événements / victoire (optionnels : anciennes sauvegardes) ---
  politics?: PoliticsState;
  international?: InternationalState;
  events?: EventsState;
  victory?: VictoryState;
  energy?: EnergyState; // module énergie (energy.ts)
  environment?: EnvironmentState; // module environnement et biodiversité (environment.ts)
  // --- moteurs transports/industrie/agriculture/déchets (phase 4b) ---
  transport?: TransportState;
  industry?: IndustryState;
  agriculture?: AgricultureState;
  waste?: WasteState;
  // --- modules services publics/recherche/construction ---
  health?: HealthState;
  education?: EducationState;
  housing?: HousingState;
  security?: SecurityState;
  research?: ResearchState;
  construction?: ConstructionState;
  missions?: MissionsState; // --- missions, trophées, retours et bilan annuel (missions.ts) ---
  climate?: ClimateState; // --- plan climat --- facteur 4, jauges de soutien, cartes-actions (climate.ts)
}

export type Occ = Occupation;
export type { SectorId };
