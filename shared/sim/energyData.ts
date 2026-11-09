// Données de référence du module énergie : filières de production, stockage, vecteurs d'énergie finale,
// profils saisonniers, facteurs d'émission. Montants en euros constants de 2030 (prix initiaux),
// puissances en MW, énergies en MWh, émissions en t CO₂e.
import type { SectorId } from './data';

// ---------- Filières de production d'électricité ----------
export const TECH_IDS = ['charbon', 'gaz', 'petrole', 'nucleaire', 'solaire', 'eolien', 'eolienMer', 'hydraulique', 'geothermie', 'biomasse'] as const;
export type TechId = (typeof TECH_IDS)[number];
/** Capacités constructibles : filières de production + batteries (stockage). */
export type BuildId = TechId | 'batteries';
export const BUILD_IDS: BuildId[] = [...TECH_IDS, 'batteries'];

export interface TechDef {
  id: TechId;
  name: string;
  icon: string;
  renewable: boolean;
  fossil: boolean;
  /** pilotable : production modulable à la demande (thermique, hydraulique de lac) */
  dispatchable: boolean;
  /** facteur de charge moyen annuel (production / (puissance × 8 760 h)) pour les filières fatales ; disponibilité pour les pilotables */
  cf: number;
  /** contribution garantie à la pointe (part de la puissance installée disponible avec confiance à la pointe d'hiver) */
  firm: number;
  co2: number; // t CO₂ directes (combustion) par MWh électrique
  co2Biogenic: number; // t CO₂ biogénique par MWh (non comptée dans les émissions fossiles)
  lifecycle: number; // t CO₂e amont / cycle de vie par MWh (extraction, fabrication, construction) — émissions indirectes
  fuel: number; // coût du combustible €/MWh électrique (prix mondiaux initiaux)
  varOM: number; // exploitation variable €/MWh
  fixedOM: number; // exploitation et maintenance fixes €/kW/an
  capex: number; // coût d'investissement €/kW (overnight)
  buildMonths: number; // durée de construction (mois)
  lifetime: number; // durée de vie économique (années)
  jobsBuild: number; // emplois-années de construction par MW
  jobsOp: number; // emplois permanents d'exploitation par MW
  decommission: number; // coût de démantèlement / fermeture €/kW
  landKm2PerMW: number; // emprise au sol artificialisée (km²/MW)
  airPollution: number; // polluants locaux (t éq. PM2,5 par GWh électrique produit)
}

export const TECHS: Record<TechId, TechDef> = {
  charbon: { id: 'charbon', name: 'Charbon', icon: '🏭', renewable: false, fossil: true, dispatchable: true, cf: 0.86, firm: 0.88, co2: 0.95, co2Biogenic: 0, lifecycle: 0.05, fuel: 32, varOM: 4, fixedOM: 40, capex: 2000, buildMonths: 60, lifetime: 40, jobsBuild: 3.5, jobsOp: 0.37, decommission: 80, landKm2PerMW: 0.0004, airPollution: 0.15 },
  gaz: { id: 'gaz', name: 'Gaz (cycle combiné)', icon: '🔥', renewable: false, fossil: true, dispatchable: true, cf: 0.9, firm: 0.92, co2: 0.37, co2Biogenic: 0, lifecycle: 0.06, fuel: 60, varOM: 3, fixedOM: 20, capex: 900, buildMonths: 36, lifetime: 30, jobsBuild: 1.5, jobsOp: 0.15, decommission: 40, landKm2PerMW: 0.0001, airPollution: 0.01 },
  petrole: { id: 'petrole', name: 'Fioul (turbines de pointe)', icon: '🛢️', renewable: false, fossil: true, dispatchable: true, cf: 0.9, firm: 0.92, co2: 0.75, co2Biogenic: 0, lifecycle: 0.07, fuel: 140, varOM: 5, fixedOM: 15, capex: 700, buildMonths: 24, lifetime: 30, jobsBuild: 1, jobsOp: 0.08, decommission: 30, landKm2PerMW: 0.0001, airPollution: 0.1 },
  nucleaire: { id: 'nucleaire', name: 'Nucléaire', icon: '⚛️', renewable: false, fossil: false, dispatchable: true, cf: 0.83, firm: 0.85, co2: 0, co2Biogenic: 0, lifecycle: 0.012, fuel: 8, varOM: 2, fixedOM: 120, capex: 6500, buildMonths: 120, lifetime: 60, jobsBuild: 8, jobsOp: 0.5, decommission: 700, landKm2PerMW: 0.0003, airPollution: 0 },
  solaire: { id: 'solaire', name: 'Solaire photovoltaïque', icon: '☀️', renewable: true, fossil: false, dispatchable: false, cf: 0.14, firm: 0, co2: 0, co2Biogenic: 0, lifecycle: 0.035, fuel: 0, varOM: 0, fixedOM: 12, capex: 750, buildMonths: 12, lifetime: 30, jobsBuild: 2, jobsOp: 0.08, decommission: 20, landKm2PerMW: 0.0006, airPollution: 0 }, // surtout en toiture : faible emprise au sol
  eolien: { id: 'eolien', name: 'Éolien terrestre', icon: '🌬️', renewable: true, fossil: false, dispatchable: false, cf: 0.26, firm: 0.1, co2: 0, co2Biogenic: 0, lifecycle: 0.011, fuel: 0, varOM: 0, fixedOM: 35, capex: 1400, buildMonths: 24, lifetime: 25, jobsBuild: 2.5, jobsOp: 0.12, decommission: 50, landKm2PerMW: 0.0005, airPollution: 0 },
  eolienMer: { id: 'eolienMer', name: 'Éolien en mer', icon: '🌊', renewable: true, fossil: false, dispatchable: false, cf: 0.42, firm: 0.15, co2: 0, co2Biogenic: 0, lifecycle: 0.012, fuel: 0, varOM: 0, fixedOM: 80, capex: 3000, buildMonths: 48, lifetime: 25, jobsBuild: 4, jobsOp: 0.15, decommission: 120, landKm2PerMW: 0, airPollution: 0 },
  hydraulique: { id: 'hydraulique', name: 'Hydraulique', icon: '💧', renewable: true, fossil: false, dispatchable: true, cf: 0.4, firm: 0.7, co2: 0, co2Biogenic: 0, lifecycle: 0.024, fuel: 0, varOM: 1, fixedOM: 30, capex: 3500, buildMonths: 72, lifetime: 80, jobsBuild: 5, jobsOp: 0.1, decommission: 200, landKm2PerMW: 0.01, airPollution: 0 },
  geothermie: { id: 'geothermie', name: 'Géothermie', icon: '🌋', renewable: true, fossil: false, dispatchable: true, cf: 0.85, firm: 0.9, co2: 0.04, co2Biogenic: 0, lifecycle: 0.038, fuel: 0, varOM: 5, fixedOM: 100, capex: 4500, buildMonths: 48, lifetime: 30, jobsBuild: 4, jobsOp: 0.3, decommission: 100, landKm2PerMW: 0.0005, airPollution: 0 },
  biomasse: { id: 'biomasse', name: 'Biomasse durable', icon: '🌿', renewable: true, fossil: false, dispatchable: true, cf: 0.85, firm: 0.88, co2: 0, co2Biogenic: 1.1, lifecycle: 0.05, fuel: 45, varOM: 6, fixedOM: 90, capex: 3000, buildMonths: 36, lifetime: 30, jobsBuild: 3, jobsOp: 0.6, decommission: 60, landKm2PerMW: 0.0004, airPollution: 0.06 },
};

export interface StorageDef { name: string; icon: string; hours: number; efficiency: number; capex: number; fixedOM: number; buildMonths: number; lifetime: number; jobsBuild: number; jobsOp: number; decommission: number; lifecycle: number }
/** Batteries stationnaires lithium-ion de 4 h. capex en €/kW (4 kWh par kW). */
export const STORAGE: StorageDef = { name: 'Batteries (4 h)', icon: '🔋', hours: 4, efficiency: 0.88, capex: 1000, fixedOM: 10, buildMonths: 12, lifetime: 15, jobsBuild: 1, jobsOp: 0.03, decommission: 20, lifecycle: 0.02 };

/** Cité-État : capacité d'interconnexion initiale (part de la charge moyenne) et turbines de pointe (part de la pointe). */
export const INTERCONNECT_SHARE = 0.32;
export const PEAKERS_SHARE = 0.06;
/** Marge de capacité visée par le parc initial (puissance garantie / pointe d'hiver − 1). */
export const INITIAL_MARGIN = 0.12;
/**
 * Potentiels exploitables d'une cité-État (bornés par les surfaces disponibles) :
 * solaire sur 6 % des surfaces bâties (170 MW/km² de panneaux) + 3 % des terres agricoles et naturelles (60 MW/km²) ;
 * éolien terrestre 0,6 MW/km² de terres non bâties ; éolien en mer 3 MW/km² de mer sur la carte + 10 GW dans la zone
 * économique exclusive ; hydraulique limitée à la rivière ; géothermie profonde ; biomasse durable importable limitée ;
 * thermique et nucléaire limités par les terrains industrialo-portuaires.
 */
export const POTENTIAL = {
  roofShare: 0.06, roofMWkm2: 170, groundShare: 0.03, groundMWkm2: 60, windMWkm2: 0.6, seaMWkm2: 3, offshoreEEZ: 10000,
  hydroExtra: 150, geothermie: 600, biomasse: 500, nucleaire: 6000, thermal: 8000, batteries: 20000,
};

// ---------- Marché et réseau ----------
export const HOURS_MONTH = 730; // heures par mois (8 760 / 12)
export const DAYS_MONTH = 30.42;
export const MARKET_RATE = 0.07; // coût du capital des opérateurs privés
export const PUBLIC_RATE = 0.04; // coût du capital public
export const VOLL = 3000; // valeur de l'énergie non distribuée (prix plafond en pénurie, €/MWh)
export const NEIGHBOUR_PRICE = 66; // prix moyen de gros chez les voisins (€/MWh) — parcs nucléaires et hydrauliques voisins
export const NEIGHBOUR_CO2 = 0.3; // intensité carbone de l'électricité importée (t/MWh, baisse 2 %/an)
export const NETWORK_COST = 48; // coût d'acheminement (TURPE) €/MWh
export const SUPPLY_MARGIN = 10; // coûts commerciaux des fournisseurs €/MWh
export const BASE_LOSSES = 0.06; // pertes en ligne initiales (part de la production injectée)
export const OFFSET_PRICE = 12; // prix d'un crédit carbone international (€/t)
export const CHARGER_COST = 25000; // coût d'une borne publique (€)
export const CARS_PER_PERSON = 0.55;
export const KM_PER_CAR = 13000;
export const ICE_KWH_KM = 0.65; // consommation d'un véhicule thermique (kWh de carburant par km)
export const EV_KWH_KM = 0.19; // consommation d'un véhicule électrique (kWh électrique par km)
export const RENOV_MWH_PER_MEUR = 180; // économies de chauffage obtenues par M€ de rénovation (MWh/an)

/** Blocs horaires du mois : pointe (soirées d'hiver), jour, nuit. */
export const BLOCKS = [
  { id: 'pointe', name: 'Pointe', hours: 0.12, load: 1.32, solar: 0.06, price: 1.5 },
  { id: 'jour', name: 'Jour', hours: 0.38, load: 1.07, solar: 0.94, price: 1.0 },
  { id: 'nuit', name: 'Nuit', hours: 0.5, load: 0.85, solar: 0, price: 0.8 },
] as const;

// ---------- Profils saisonniers (janvier → décembre, moyenne normalisée à 1 dans le moteur) ----------
export const SEASON = {
  solar: [0.45, 0.65, 0.95, 1.2, 1.35, 1.45, 1.5, 1.35, 1.1, 0.8, 0.5, 0.4],
  wind: [1.3, 1.25, 1.15, 1.0, 0.85, 0.75, 0.7, 0.72, 0.85, 1.05, 1.2, 1.3],
  windSea: [1.2, 1.18, 1.1, 1.0, 0.9, 0.82, 0.8, 0.82, 0.9, 1.05, 1.13, 1.2],
  hydro: [0.95, 1.0, 1.25, 1.4, 1.45, 1.15, 0.85, 0.65, 0.6, 0.75, 0.95, 1.0],
  nuclear: [1.1, 1.1, 1.06, 0.96, 0.89, 0.87, 0.89, 0.92, 0.96, 1.04, 1.08, 1.1], // disponibilité (arrêts de maintenance l'été)
  heating: [1.9, 1.7, 1.3, 0.8, 0.4, 0.15, 0.1, 0.1, 0.35, 0.85, 1.45, 1.9],
  base: [1.05, 1.04, 1.0, 0.98, 0.97, 0.97, 0.98, 0.95, 0.98, 1.0, 1.03, 1.05],
  neighbour: [1.15, 1.12, 1.0, 0.92, 0.85, 0.85, 0.9, 0.88, 0.95, 1.02, 1.1, 1.16],
};

// ---------- Énergie finale ----------
export const CARRIERS = ['elec', 'petrole', 'gaz', 'charbon', 'chaleur', 'biomasse'] as const;
export type Carrier = (typeof CARRIERS)[number];
export const CARRIER_NAMES: Record<Carrier, string> = {
  elec: 'Électricité', petrole: 'Produits pétroliers (carburants, fioul)', gaz: 'Gaz naturel', charbon: 'Charbon', chaleur: 'Réseaux de chaleur', biomasse: 'Biomasse (bois, biogaz)',
};
/** Prix hors taxes initiaux de l'énergie finale (€/MWh) ; l'électricité est calculée par le moteur. */
export const CARRIER_PRICE: Record<Exclude<Carrier, 'elec'>, number> = { petrole: 65, gaz: 40, charbon: 15, chaleur: 70, biomasse: 35 };
/** Facteurs d'émission directs à la combustion (t CO₂/MWh final) et amont (extraction, transport, fuites). */
export const CARRIER_CO2: Record<Carrier, number> = { elec: 0, petrole: 0.267, gaz: 0.205, charbon: 0.34, chaleur: 0, biomasse: 0 };
export const CARRIER_UPSTREAM: Record<Carrier, number> = { elec: 0, petrole: 0.06, gaz: 0.04, charbon: 0.05, chaleur: 0.02, biomasse: 0.03 };
export const BIOMASS_CO2_BIOGENIC = 0.39; // t CO₂ biogénique par MWh de bois brûlé (non compté si gestion durable)
export const HEAT_FOSSIL_CO2 = 0.25; // t CO₂ par MWh de chaleur fossile livrée par les réseaux
/** Polluants locaux (t éq. PM2,5 / GWh final). */
export const CARRIER_AIR: Record<Carrier, number> = { elec: 0, petrole: 0.03, gaz: 0.004, charbon: 0.12, chaleur: 0.005, biomasse: 0.4 };

export type ElecGroup = 'industrie' | 'machines' | 'tertiaire' | 'transport';
export const ELEC_GROUPS: ElecGroup[] = ['industrie', 'machines', 'tertiaire', 'transport'];
export const ELEC_GROUP_NAMES: Record<ElecGroup, string> = { industrie: 'Industrie et énergie', machines: 'Agriculture et chantiers', tertiaire: 'Bâtiments tertiaires', transport: 'Transport de marchandises' };
/** Paramètres d'électrification des usages : gain d'efficacité de l'électricité (MWh fossiles remplacés par MWh électrique), tendance annuelle, effet maximal d'un prix du carbone élevé. */
export const ELEC_GROUP_DEF: Record<ElecGroup, { gain: number; trend: number; carbon: number; max: number }> = {
  industrie: { gain: 1.3, trend: 0.004, carbon: 0.4, max: 0.8 },
  machines: { gain: 2.5, trend: 0.005, carbon: 0.35, max: 0.85 },
  tertiaire: { gain: 2.8, trend: 0.006, carbon: 0.45, max: 0.95 },
  transport: { gain: 3.0, trend: 0.007, carbon: 0.5, max: 0.9 },
};

export interface SectorEnergyDef { group: ElecGroup; mix: Record<Carrier, number>; ownUse?: number }
const TERTIAIRE: SectorEnergyDef = { group: 'tertiaire', mix: { elec: 0.55, petrole: 0.07, gaz: 0.28, charbon: 0, chaleur: 0.06, biomasse: 0.04 } };
/** Structure de la consommation d'énergie finale de chaque secteur (parts de SectorDef.energyIntensity). */
export const SECTOR_ENERGY: Record<SectorId, SectorEnergyDef> = {
  agriculture: { group: 'machines', mix: { elec: 0.18, petrole: 0.62, gaz: 0.1, charbon: 0, chaleur: 0, biomasse: 0.1 } },
  industrie: { group: 'industrie', mix: { elec: 0.36, petrole: 0.08, gaz: 0.36, charbon: 0.12, chaleur: 0.03, biomasse: 0.05 } },
  construction: { group: 'machines', mix: { elec: 0.2, petrole: 0.7, gaz: 0.1, charbon: 0, chaleur: 0, biomasse: 0 } },
  commerce: TERTIAIRE, tourisme: TERTIAIRE, technologie: TERTIAIRE, finance: TERTIAIRE, services: TERTIAIRE, sante: TERTIAIRE, education: TERTIAIRE,
  // l'intensité du secteur de l'énergie comprend les intrants de transformation : seule sa consommation propre (8 %) est de l'énergie finale
  energie: { group: 'industrie', mix: { elec: 0.45, petrole: 0.1, gaz: 0.45, charbon: 0, chaleur: 0, biomasse: 0 }, ownUse: 0.08 },
  transport: { group: 'transport', mix: { elec: 0.04, petrole: 0.93, gaz: 0.03, charbon: 0, chaleur: 0, biomasse: 0 } },
};
/** Consommation moyenne d'un ménage hors voiture (MWh/an). */
export const HOUSEHOLD_ENERGY = { elecAppliances: 3.0, elecHeat: 1.0, gaz: 6.5, fioul: 2.0, bois: 1.6, chaleur: 0.5 };
export const HEAT_PUMP_GAIN = 3.0; // une pompe à chaleur consomme 1 MWh électrique pour remplacer 3 MWh de combustible
/** Part initiale des émissions « autres » (hors combustion) qui est du CO₂ fossile (procédés), le reste étant CH₄, N₂O, gaz fluorés. */
export const OTHER_CO2_SHARE: Partial<Record<SectorId | 'menages', number>> = { industrie: 0.85, energie: 1, construction: 0.5, transport: 1 };
export const IMPORT_CO2_INTENSITY = 280; // t CO₂e par M€ de biens importés (baisse 1,2 %/an)

/** Politique énergétique et environnementale (décisions du joueur). */
export interface EnergyPolicy {
  autoInvest: boolean; // les opérateurs privés investissent selon la rentabilité et la sécurité d'approvisionnement
  renewableSupport: number; // complément de rémunération des nouvelles capacités renouvelables (€/MWh)
  evSubsidy: number; // bonus à l'achat d'un véhicule électrique (€ par véhicule)
  heatPumpSubsidy: number; // aide à l'installation d'une pompe à chaleur (€ par logement)
  chargingBudget: number; // déploiement public de bornes de recharge (€/an)
  renovationBudget: number; // rénovation énergétique des bâtiments (€/an)
  gridBudget: number; // investissement additionnel dans les réseaux et interconnexions (€/an)
  biofuelMandate: number; // taux d'incorporation obligatoire de biocarburants (part des carburants)
  offsets: number; // achat de crédits carbone internationaux (t CO₂/an) — ne réduit jamais les émissions brutes
  waterBudget: number; // assainissement et protection de la ressource en eau (€/an)
  zan: number; // sévérité de l'objectif « zéro artificialisation nette » (0 = aucun, 1 = strict)
}

export const DEFAULT_ENERGY_POLICY: EnergyPolicy = {
  autoInvest: true, renewableSupport: 0, evSubsidy: 0, heatPumpSubsidy: 0, chargingBudget: 0, renovationBudget: 0, gridBudget: 0,
  biofuelMandate: 0.07, offsets: 0, waterBudget: 0, zan: 0,
};

/** Facteur d'annuité (remboursement constant d'un capital sur n années au taux r). */
export function annuity(r: number, years: number) {
  return r / (1 - Math.pow(1 + r, -years));
}
