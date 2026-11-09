// Moteur des transports et de la mobilité : réseau, parcs de véhicules, demande de déplacements, choix modal (logit),
// congestion (fonction BPR), temps et coût des trajets, fret, aéroports, ports, émissions, satisfaction des usagers.
// Un appel = un mois. Distances en km, trafic en voyageurs-km (vkm) ou véhicules-km par an, émissions en tCO2/an.
import { SECTOR_INDEX, VAT_CATS, type BudgetLine } from './data';
import { addEmissions, addRevenue, addSpending, advanceProjects, applyTechFactor, approach, placeSite, urbanLine, clamp, newProject, newTechFactor, popOf, type Built, type Project, type Site, type TechFactor } from './sectors';

/** Élément localisé du réseau (ligne urbaine, liaison interurbaine, plateforme…) ; a/b = villes reliées. */
export type TransportSite = Site & { a?: number; b?: number };
import { vatRateOf } from './fiscal';
import type { GameState, Policy } from './types';

// ---------- Paramètres ----------
export type PtMode = 'bus' | 'tram' | 'metro' | 'train' | 'tgv';
export const PT_MODES: PtMode[] = ['bus', 'tram', 'metro', 'train', 'tgv'];

interface PtModeDef { name: string; seats: number; kmYear: number; opexPerVkm: number; speed: number; cost: number; delivery: number; kWhPerVkm: number }
/** Caractéristiques des matériels roulants (places, kilométrage annuel à fréquence nominale, coût d'exploitation €/véh-km, vitesse commerciale km/h, prix €, délai de livraison mois, kWh/véh-km). */
export const PT_DEFS: Record<PtMode, PtModeDef> = {
  bus: { name: 'Bus', seats: 90, kmYear: 50000, opexPerVkm: 5, speed: 18, cost: 450_000, delivery: 8, kWhPerVkm: 1.3 },
  tram: { name: 'Rames de tram', seats: 250, kmYear: 60000, opexPerVkm: 12, speed: 20, cost: 3_200_000, delivery: 18, kWhPerVkm: 4 },
  metro: { name: 'Rames de métro', seats: 700, kmYear: 70000, opexPerVkm: 18, speed: 32, cost: 9_000_000, delivery: 24, kWhPerVkm: 12 },
  train: { name: 'Trains régionaux', seats: 400, kmYear: 150000, opexPerVkm: 22, speed: 60, cost: 10_000_000, delivery: 24, kWhPerVkm: 15 },
  tgv: { name: 'Rames TGV', seats: 550, kmYear: 450000, opexPerVkm: 30, speed: 230, cost: 30_000_000, delivery: 30, kWhPerVkm: 22 },
};
const ELECTRIC_BUS_COST = 650_000; // € par bus électrique
const BUS_DIESEL_KG_PER_VKM = 1.1; // kgCO2 / véh-km
const TRAIN_DIESEL_SHARE = 0.3; // part des trains régionaux encore au diesel
const TRAIN_DIESEL_KG_PER_VKM = 3.2;
const CAR_THERMAL_KG_PER_KM = 0.13; // émissions moyennes du parc thermique (réelles)
const EV_KWH_PER_KM = 0.17;
const TRUCK_KG_PER_TKM = 0.085;
const AIR_KG_PER_PKM = 0.12;
const OCCUPANCY_URBAN = 1.25;
const OCCUPANCY_LONG = 1.8;
const CAR_LIFETIME = 14; // ans
const URBAN_TRIP_KM = 9; // trajet domicile-travail moyen (aller) dans la cité
const LAMBDA_URBAN = 3; // sensibilité du choix modal au coût généralisé (par €/km)
const LAMBDA_LONG = 2.5;
const MAX_FREQ_PER_VEHICLE = 1.25; // un véhicule ne peut rouler que 25 % de plus que son kilométrage nominal

export interface TransportPolicy {
  frequency: number; // multiplicateur des fréquences des transports publics (1 = actuel)
  fareLevel: number; // niveau des tarifs (1 = actuel, 0 = gratuité ; l'État compense les exploitants)
  evBonus: number; // bonus à l'achat d'un véhicule électrique (€)
  thermalMalus: number; // malus à l'achat d'un véhicule thermique neuf (€)
}
export const DEFAULT_TRANSPORT_POLICY: TransportPolicy = { frequency: 1, fareLevel: 1, evBonus: 0, thermalMalus: 0 };

export function sanitizeTransportPolicy(i: Partial<TransportPolicy> | undefined, c: TransportPolicy = DEFAULT_TRANSPORT_POLICY): TransportPolicy {
  const n = (v: unknown, a: number, b: number, d: number) => (Number.isFinite(Number(v)) ? clamp(Number(v), a, b) : d);
  return {
    frequency: n(i?.frequency, 0.5, 2.5, c.frequency),
    fareLevel: n(i?.fareLevel, 0, 2.5, c.fareLevel),
    evBonus: n(i?.evBonus, 0, 15000, c.evBonus),
    thermalMalus: n(i?.thermalMalus, 0, 30000, c.thermalMalus),
  };
}

type Shares<K extends string> = Record<K, number>;
export type UrbanMode = 'voiture' | 'transportsCommuns' | 'velo' | 'marche';
export type LongMode = 'voiture' | 'train' | 'avion';
const URBAN_MODES: UrbanMode[] = ['voiture', 'transportsCommuns', 'velo', 'marche'];
const LONG_MODES: LongMode[] = ['voiture', 'train', 'avion'];

export interface TransportState {
  network: { motorwayKm: number; roadKm: number; localKm: number; railKm: number; tgvKm: number; tramKm: number; metroKm: number; cycleKm: number; chargers: number; roadCondition: number; freightTerminals: number; intercitySeatKm: number };
  fleet: { cars: number; evShare: number; busDiesel: number; busElectric: number; tram: number; metro: number; train: number; tgv: number; truckElectric: number };
  airports: { count: number; capacity: number; passengers: number; utilisation: number };
  ports: { count: number; capacity: number; tonnage: number; utilisation: number };
  demand: { dailyPkm: number; longPkm: number; freightTkm: number; tripsPerDay: number }; // vkm/an, tkm/an, déplacements/jour
  modal: Shares<UrbanMode>; // parts modales des déplacements du quotidien (en voyageurs-km)
  modalLong: Shares<LongMode>; // parts modales des déplacements à longue distance
  pkmByPt: Record<PtMode, number>; // voyageurs-km/an par mode de transport public
  freightRailShare: number;
  ptLoad: number; // taux de remplissage moyen des transports publics urbains
  longLoad: number; // taux de remplissage des trains grandes lignes
  crowding: number; // pénalité d'inconfort (1 = aucune)
  congestion: number; // rapport volume / capacité du réseau routier
  roadSpeed: number; // km/h moyens en voiture au quotidien
  travelTime: number; // minutes, trajet domicile-travail moyen (aller)
  costPerKm: number; // €/voyageur-km moyen (prix de 2030)
  monthlyCost: number; // €/mois par ménage pour se déplacer (prix courants)
  evSalesShare: number;
  carSales: number; // véhicules neufs / an
  reliability: number; // fiabilité et qualité de service des transports publics (0..1)
  satisfaction: number; // satisfaction des usagers (0..100), utilisée par le facteur « transports »
  opex: number; // coût d'exploitation des transports publics (€/an)
  fareRevenue: number; // recettes tarifaires (€/an)
  extraCost: number; // surcoûts imputés au budget ce mois (€/an) : exploitation supplémentaire, compensation tarifaire, bonus
  malusRevenue: number;
  electricityMWh: number; // consommation électrique des transports (MWh/an) — pour le moteur énergie
  emissions: { voitures: number; fretRoutier: number; transportsCommuns: number; aviation: number; maritime: number; autres: number; secteur: number; total: number; aviationInternationale: number };
  projects: Project[];
  built: Built[];
  projectSeq: number;
  sites: TransportSite[]; // lignes et équipements localisés (réseau initial + chantiers placés automatiquement)
  siteSeq: number;
  tech: TechFactor;
  base: {
    ascUrban: Shares<UrbanMode>; ascLong: Shares<LongMode>; capacity: number; svc: number; opex: number; kCar: number; hhI: number;
    cycleKm: number; emissionsW: Record<'fret' | 'tc' | 'air' | 'mer' | 'autres', number>; comp: Record<'fret' | 'tc' | 'air', number>;
    sat: number; tt: number; cong: number; cost: number; crowd: number; c0: number; railKm: number; railShare: number; chargers: number; freightTkm: number; outputReal: number; truckCost: number; intlPax: number; trade: number; portTonnage: number; vehicleTaxK: number;
  };
}

// ---------- Outils ----------
const polyLen = (pts: [number, number][]) => { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return d; };
const sig = (x: number) => 1 / (1 + Math.exp(-x));

/** Taux d'efficacité carbone des ménages appliqué par economy.ts (sobriété induite par le prix du carbone). */
function hhIntensity(P: Policy) { return clamp(1 - 0.4 * (1 - Math.exp(-P.eco.carbon / 120)), 0.4, 1); }

/** Émissions des carburants des ménages telles que calculées par economy.ts (reproduction exacte). */
export function economyFuelEmissions(S: GameState, P: Policy): number {
  const Pl = S.macro.priceLevel;
  const hhI = hhIntensity(P);
  const excise: Record<string, number> = {};
  for (const c of VAT_CATS) excise[c.id] = 0;
  excise.energie = (P.eco.carbon * 1500 * hhI) / 1e6 / Pl;
  excise.transport = 0.35 * (P.eco.fuel + (P.eco.carbon * 2800 * hhI) / 1e6 / Pl);
  const w = VAT_CATS.map((c) => c.share * Math.pow(1 + vatRateOf(P, c.id) + excise[c.id], c.elasticity + 1) / Math.pow(1.15, c.elasticity + 1));
  const ws = w.reduce((s, v) => s + v, 0);
  const k = VAT_CATS.findIndex((c) => c.id === 'transport');
  const gross = (S.accounts.consumption * w[k]) / ws;
  const net = gross / (1 + vatRateOf(P, 'transport') + excise.transport);
  return ((net * 0.35) / Pl / 1e6) * 2800 * hhI;
}

/** Nombre de véhicules thermiques retenu par economy.ts pour la taxe annuelle (reproduction exacte). */
function economyThermalVehicles(S: GameState, P: Policy) {
  const share = clamp(0.88 - P.eco.vehicle / 2500 - Math.max(0, S.month) * 0.0004, 0.2, 0.95);
  return popOf(S) * 0.52 * share;
}

/** Prix réel (prix de 2030) d'un litre de carburant TTC et coûts au km. */
function carCosts(S: GameState, P: Policy) {
  const Pl = S.macro.priceLevel;
  const litre = (0.95 * S.macro.energyPrice * (1 + P.eco.fuel) + (P.eco.carbon * 2.3) / 1000 / Pl) * (1 + vatRateOf(P, 'transport'));
  const thermalKm = 0.065 * litre; // €/km
  const evKm = EV_KWH_PER_KM * 0.22 * S.macro.energyPrice * (1 + vatRateOf(P, 'energie'));
  return { litre, thermalKm, evKm };
}

function ptCapacity(T: TransportState, freq: number) {
  // véhicules exploitables : limités par la longueur des lignes (densité maximale de matériel)
  const usable: Record<PtMode, number> = {
    bus: T.fleet.busDiesel + T.fleet.busElectric,
    tram: Math.min(T.fleet.tram, T.network.tramKm * 3),
    metro: Math.min(T.fleet.metro, T.network.metroKm * 5),
    train: Math.min(T.fleet.train, T.network.railKm * 0.6),
    tgv: Math.min(T.fleet.tgv, T.network.tgvKm * 0.15),
  };
  const f = Math.min(freq, MAX_FREQ_PER_VEHICLE);
  const vkm = {} as Record<PtMode, number>;
  const seatKm = {} as Record<PtMode, number>;
  for (const m of PT_MODES) { vkm[m] = usable[m] * PT_DEFS[m].kmYear * f; seatKm[m] = vkm[m] * PT_DEFS[m].seats; }
  // les trains régionaux servent à 60 % les déplacements du quotidien, à 40 % les grandes lignes
  const urbanSeat = seatKm.bus + seatKm.tram + seatKm.metro + 0.6 * seatKm.train;
  const longSeat = 0.4 * seatKm.train + seatKm.tgv + T.network.intercitySeatKm;
  const urbanSpeed = (seatKm.bus * PT_DEFS.bus.speed + seatKm.tram * PT_DEFS.tram.speed + seatKm.metro * PT_DEFS.metro.speed + 0.6 * seatKm.train * PT_DEFS.train.speed) / Math.max(1, urbanSeat);
  const longSpeed = longSeat > 0 ? 1 / ((0.4 * seatKm.train / 95 + seatKm.tgv / 220 + T.network.intercitySeatKm / 160) / longSeat) : 95;
  const opex = PT_MODES.reduce((s, m) => s + vkm[m] * PT_DEFS[m].opexPerVkm, 0);
  return { usable, vkm, seatKm, urbanSeat, longSeat, urbanSpeed, longSpeed, opex };
}

// ---------- Initialisation ----------
export function initTransport(S: GameState): TransportState {
  const C = S.country;
  const pop = popOf(S);
  const P = S.policy;
  const km = (kind: string) => C.links.filter((l) => l.kind === kind).reduce((s, l) => s + polyLen(l.points), 0);
  // cité-État dense : réseau dimensionné sur la population (≈ grande métropole européenne)
  const metroKm = (pop / 1e6) * 20; // métro
  const tramKm = (pop / 1e6) * 10; // tramway
  const railKm = Math.max(km('rail') * 0.5, (pop / 1e6) * 25); // trains de banlieue (RER)
  const evShare = 1 - clamp(0.88 - P.eco.vehicle / 2500, 0.2, 0.95);
  const cars = pop * 0.35; // motorisation urbaine (voitures particulières / habitant)
  const airports = C.infra.filter((i) => i.type === 'aeroport');
  const ports = C.infra.filter((i) => i.type === 'port');
  const T: TransportState = {
    network: { motorwayKm: km('autoroute'), roadKm: km('nationale'), localKm: pop * 0.0009, railKm, tgvKm: 0, tramKm, metroKm, cycleKm: (pop / 1000) * 0.15, chargers: (cars * evShare) / 11, roadCondition: S.services.infrastructures, freightTerminals: 0, intercitySeatKm: 0 },
    fleet: { cars, evShare, busDiesel: (pop / 1000) * 0.5 * 0.9, busElectric: (pop / 1000) * 0.5 * 0.1, tram: tramKm * 1.2, metro: metroKm * 2.5, train: railKm * 0.25, tgv: 0, truckElectric: 0.03 },
    airports: { count: airports.length, capacity: airports.reduce((s, a) => s + a.capacity, 0), passengers: 0, utilisation: 0 },
    ports: { count: ports.length, capacity: ports.reduce((s, a) => s + a.capacity, 0), tonnage: 0, utilisation: 0 },
    demand: { dailyPkm: 0, longPkm: 0, freightTkm: 0, tripsPerDay: 0 },
    modal: { voiture: 0.45, transportsCommuns: 0.36, velo: 0.05, marche: 0.14 },
    modalLong: { voiture: 0.72, train: 0.2, avion: 0.08 },
    pkmByPt: { bus: 0, tram: 0, metro: 0, train: 0, tgv: 0 },
    freightRailShare: 0.1, ptLoad: 0, longLoad: 0, crowding: 1, congestion: 1, roadSpeed: 0, travelTime: 0, costPerKm: 0, monthlyCost: 0,
    evSalesShare: 0.25, carSales: cars / CAR_LIFETIME, reliability: S.services.transports, satisfaction: 0, opex: 0, fareRevenue: 0, extraCost: 0, malusRevenue: 0, electricityMWh: 0,
    emissions: { voitures: 0, fretRoutier: 0, transportsCommuns: 0, aviation: 0, maritime: 0, autres: 0, secteur: 0, total: 0, aviationInternationale: 0 },
    projects: [], built: [], projectSeq: 1, sites: [], siteSeq: 1,
    tech: newTechFactor(S.sectors[SECTOR_INDEX.transport]),
    base: {
      ascUrban: { voiture: 0, transportsCommuns: 0, velo: 0, marche: 0 }, ascLong: { voiture: 0, train: 0, avion: 0 }, capacity: 0, svc: 0, opex: 0, kCar: 1, hhI: hhIntensity(P),
      cycleKm: (pop / 1000) * 0.15, emissionsW: { fret: 0.62, tc: 0.08, air: 0.12, mer: 0.08, autres: 0.1 }, comp: { fret: 1, tc: 1, air: 1 },
      sat: 0, tt: 0, cong: 1, cost: 0, crowd: 1, c0: 0, railKm, railShare: 0.1, chargers: 0, freightTkm: 0, outputReal: 0, truckCost: 0, intlPax: 0, trade: 0, portTonnage: 0, vehicleTaxK: 1,
    },
  };
  // réseau urbain initial (placé de façon déterministe sur les voies existantes) :
  // un réseau de bus par quartier, lignes de métro (~12 km), de tramway (~10 km) et de RER (~30 km)
  // ancrées tour à tour dans les quartiers les plus peuplés.
  const ranked = C.cities.map((c) => c.id).sort((p, q) => S.cities[q].population - S.cities[p].population);
  const core = ranked.filter((id) => C.cities[id].kind !== 'commune');
  const anchors = core.length ? core : ranked;
  C.cities.forEach((c, i) => {
    const p = S.cities[i].population;
    T.sites.push({ id: T.siteSeq++, kind: 'bus', label: `Réseau de bus — ${c.name}`, cityId: i, x: c.x, z: c.z, size: Math.max(2, Math.round((p / 1000) * 0.5)), status: 'service', since: 0 });
  });
  const lines = (kind: 'metro' | 'tram' | 'rail', total: number, each: number, prefix: string, kinds: ('rail' | 'nationale' | 'autoroute')[], from: number[]) => {
    const n = Math.max(1, Math.round(total / each));
    for (let k = 0; k < n && from.length; k++) {
      const cid = from[k % from.length];
      const pts = urbanLine(S, cid, total / n, k + (kind === 'metro' ? 101 : kind === 'tram' ? 1 : 201), kinds);
      T.sites.push({ id: T.siteSeq++, kind, label: `${prefix}${k + 1} (${C.cities[cid].name})`, cityId: cid, x: C.cities[cid].x, z: C.cities[cid].z, points: pts, size: total / n, status: 'service', since: 0 });
    }
  };
  lines('metro', metroKm, 12, 'Métro ligne ', ['rail', 'nationale'], anchors);
  lines('tram', tramKm, 10, 'Tramway T', ['nationale', 'autoroute'], ranked);
  lines('rail', railKm, 30, 'RER ', ['rail', 'autoroute', 'nationale'], anchors);
  // grandes lignes au départ de la gare centrale (opérateurs extérieurs) : capacité calibrée pour un remplissage de 70 %
  const trainSeats = Math.min(T.fleet.train, railKm * 0.6) * PT_DEFS.train.kmYear * PT_DEFS.train.seats;
  T.network.intercitySeatKm = Math.max(0, (pop * 2000 * T.modalLong.train) / 0.7 - 0.4 * trainSeats);
  T.base.chargers = T.network.chargers;
  T.base.vehicleTaxK = economyThermalVehicles(S, P) / Math.max(1, cars * (1 - evShare));
  T.base.intlPax = T.airports.capacity * 0.7;
  computeTransport(S, P, T, true);
  return T;
}

// ---------- Calcul mensuel ----------
function computeTransport(S: GameState, P: Policy, T: TransportState, init: boolean) {
  const TP = P.transport ?? DEFAULT_TRANSPORT_POLICY;
  const B = T.base;
  const Pl = S.macro.priceLevel;
  const pop = popOf(S);
  const employed = S.demography.employed;
  const realWage = S.baseline.meanWage > 0 ? S.accounts.meanWage / Pl / S.baseline.meanWage : 1;
  const realIncome = S.baseline.realIncomePerCap > 0 ? S.accounts.disposableIncome / pop / Pl / S.baseline.realIncomePerCap : 1;
  const vot = 11 * clamp(realWage, 0.5, 3); // valeur du temps (€ de 2030 par heure)

  // 1. Demande de déplacements (voyageurs-km/an)
  const commute = employed * 225 * 2 * URBAN_TRIP_KM;
  const other = pop * 4000 * Math.pow(clamp(realIncome, 0.5, 2), 0.3);
  const dailyPkm = commute + other;
  const longPkm = pop * 2000 * Math.pow(clamp(realIncome, 0.5, 2), 0.8);
  T.demand.dailyPkm = dailyPkm;
  T.demand.longPkm = longPkm;
  T.demand.tripsPerDay = (employed * 225 * 2 + pop * 1.6 * 365) / 365;

  // 2. Offre de transports publics
  const cap = ptCapacity(T, TP.frequency);
  const svc = cap.urbanSeat / Math.max(1, pop);
  if (init) { B.svc = svc; B.opex = cap.opex; }
  // fiabilité : qualité du service public (budget « transports ») dégradée si l'exploitation dépasse le financement de base
  T.reliability = clamp(S.services.transports, 0.05, 1);

  // 3. Coûts unitaires (€ de 2030 / voyageur-km)
  const cc = carCosts(S, P);
  const ev = T.fleet.evShare;
  const carMoneyKm = (cc.thermalKm * (1 - ev) + cc.evKm * ev + 0.05 + ((P.eco.vehicle / Pl) / 12000) * (1 - ev));
  const fare = 0.11 * TP.fareLevel;
  // congestion : volume / capacité (BPR) ; les camions comptent pour 2,5 voitures
  const urbanCarVkm = (dailyPkm * T.modal.voiture) / OCCUPANCY_URBAN;
  const longCarVkm = (longPkm * T.modalLong.voiture) / OCCUPANCY_LONG;
  const outputReal = S.sectors[SECTOR_INDEX.transport].output / Pl;
  if (init) B.outputReal = outputReal;
  const freightTkm = (pop * 1500) * (outputReal / Math.max(1, B.outputReal || outputReal)); // fret urbain et desserte du port
  if (init) B.freightTkm = freightTkm;
  T.demand.freightTkm = freightTkm;
  const truckVkm = (freightTkm * (1 - T.freightRailShare)) / 10;
  const V = urbanCarVkm + longCarVkm + truckVkm * 2.5;
  const N = T.network;
  const condF = 0.85 + 0.15 * clamp(N.roadCondition / 0.8, 0, 1.25);
  const capIdx = (N.motorwayKm * 4 + N.roadKm * 2 + N.localKm * 0.6) * condF;
  if (init) B.capacity = V / (B.cong * capIdx);
  const vc = V / Math.max(1, B.capacity * capIdx);
  T.congestion = vc;
  T.roadSpeed = (30 * condF) / (1 + 0.8 * Math.pow(vc, 4)); // vitesse urbaine, congestion forte (BPR)
  // charge et inconfort des transports publics (à la part modale du mois précédent)
  const urbanPtPkm = dailyPkm * T.modal.transportsCommuns;
  const longTrainPkm = longPkm * T.modalLong.train;
  T.ptLoad = urbanPtPkm / Math.max(1, cap.urbanSeat);
  T.longLoad = longTrainPkm / Math.max(1, cap.longSeat);
  const crowd = 1 + 3 * Math.pow(Math.max(0, T.ptLoad - 0.45), 2) + 2 * Math.pow(Math.max(0, T.longLoad - 0.7), 2);
  T.crowding = crowd;

  // 4. Coûts généralisés (€/km) et choix modal — quotidien
  const time = {
    voiture: 1 / T.roadSpeed,
    transportsCommuns: 1 / Math.max(8, cap.urbanSpeed) + (0.035 * Math.sqrt(B.svc / Math.max(1e-9, svc))) / Math.max(0.2, T.reliability / 0.8),
    velo: 1 / 15,
    marche: 1 / 4.8,
  };
  const money = { voiture: carMoneyKm / OCCUPANCY_URBAN + 0.03, transportsCommuns: fare, velo: 0.02, marche: 0 };
  const gc = {} as Shares<UrbanMode>;
  for (const m of URBAN_MODES) gc[m] = money[m] + vot * time[m] * (m === 'transportsCommuns' ? crowd : 1);
  if (init) for (const m of URBAN_MODES) B.ascUrban[m] = Math.log(T.modal[m]) + LAMBDA_URBAN * gc[m];
  const cycleBoost = 0.6 * Math.log(Math.max(1e-6, N.cycleKm) / Math.max(1e-6, B.cycleKm)); // sécurité et maillage du réseau cyclable
  const uU = URBAN_MODES.map((m) => B.ascUrban[m] - LAMBDA_URBAN * gc[m] + (m === 'velo' ? cycleBoost : 0));
  const eU = uU.map((u) => Math.exp(u - Math.max(...uU)));
  const sU = eU.reduce((s, v) => s + v, 0);
  if (!init) URBAN_MODES.forEach((m, k) => (T.modal[m] = approach(T.modal[m], eU[k] / sU, 0.04))); // inertie des habitudes

  // longue distance
  const tgvShare = cap.seatKm.tgv / Math.max(1, cap.longSeat);
  const airSat = T.airports.capacity > 0 ? T.airports.passengers / T.airports.capacity : 1;
  const timeL = { voiture: (1 / 95) * (1 + 0.3 * Math.max(0, Math.pow(vc, 4) - Math.pow(B.cong, 4))), train: 1 / Math.max(40, cap.longSpeed) + 0.6 / 300, avion: 1 / 600 + 2.5 / 450 };
  const moneyL = { voiture: carMoneyKm / OCCUPANCY_LONG + 0.03, train: 0.1 * TP.fareLevel * (1 + 0.3 * tgvShare), avion: 0.13 + (P.eco.carbon / Pl) * AIR_KG_PER_PKM / 1000 + 0.2 * Math.max(0, airSat - 0.95) };
  const gcL = {} as Shares<LongMode>;
  for (const m of LONG_MODES) gcL[m] = moneyL[m] + vot * timeL[m] * (m === 'train' ? 1 + 2 * Math.pow(Math.max(0, T.longLoad - 0.7), 2) : 1);
  if (init) for (const m of LONG_MODES) B.ascLong[m] = Math.log(T.modalLong[m]) + LAMBDA_LONG * gcL[m];
  const uL = LONG_MODES.map((m) => B.ascLong[m] - LAMBDA_LONG * gcL[m]);
  const eL = uL.map((u) => Math.exp(u - Math.max(...uL)));
  const sL = eL.reduce((s, v) => s + v, 0);
  if (!init) LONG_MODES.forEach((m, k) => (T.modalLong[m] = approach(T.modalLong[m], eL[k] / sL, 0.04)));

  // 5. Répartition entre modes de transport public (capacité × attractivité de la vitesse)
  const wU = { bus: cap.seatKm.bus * Math.sqrt(PT_DEFS.bus.speed), tram: cap.seatKm.tram * Math.sqrt(PT_DEFS.tram.speed), metro: cap.seatKm.metro * Math.sqrt(PT_DEFS.metro.speed), train: 0.6 * cap.seatKm.train * Math.sqrt(PT_DEFS.train.speed) };
  const wUs = wU.bus + wU.tram + wU.metro + wU.train || 1;
  const longTrain = 0.4 * cap.seatKm.train;
  const wLs = longTrain + cap.seatKm.tgv * 1.5 || 1;
  T.pkmByPt = {
    bus: (urbanPtPkm * wU.bus) / wUs, tram: (urbanPtPkm * wU.tram) / wUs, metro: (urbanPtPkm * wU.metro) / wUs,
    train: (urbanPtPkm * wU.train) / wUs + (longTrainPkm * longTrain) / wLs,
    tgv: (longTrainPkm * cap.seatKm.tgv * 1.5) / wLs,
  };

  // 6. Temps, coûts, budget des ménages
  T.travelTime = URBAN_TRIP_KM * URBAN_MODES.reduce((s, m) => s + T.modal[m] * time[m], 0) * 60;
  T.costPerKm = URBAN_MODES.reduce((s, m) => s + T.modal[m] * money[m], 0);
  const households = pop / 2.2;
  const longMoney = LONG_MODES.reduce((s, m) => s + T.modalLong[m] * moneyL[m], 0);
  T.monthlyCost = ((dailyPkm * T.costPerKm + longPkm * longMoney) * Pl) / Math.max(1, households) / 12;

  // 7. Exploitation des transports publics
  T.opex = cap.opex * Pl;
  T.fareRevenue = (urbanPtPkm + longTrainPkm) * fare * Pl;

  // 8. Fret : report modal vers le rail selon le réseau, les plateformes multimodales et le coût du gazole
  const truckCost = cc.litre;
  if (init) { B.truckCost = truckCost; B.railShare = T.freightRailShare; }
  const railTarget = clamp(B.railShare * Math.pow(N.railKm / Math.max(1, B.railKm), 0.4) * (1 + 0.12 * N.freightTerminals) * Math.pow(truckCost / Math.max(0.01, B.truckCost), 0.5), 0.02, 0.6);
  if (!init) T.freightRailShare = approach(T.freightRailShare, railTarget, 0.01);
  const chargerRatio = N.chargers / Math.max(1, T.fleet.cars * T.fleet.evShare);
  // électrification des poids lourds : portée par le déploiement des bornes (recharge rapide sur les axes)
  const chargerGrowth = Math.max(0, N.chargers / Math.max(1, B.chargers) - 1);
  const truckTarget = clamp(0.03 + (0.35 * chargerGrowth) / (1 + chargerGrowth), 0, 0.6);
  if (!init) T.fleet.truckElectric = approach(T.fleet.truckElectric, truckTarget, 0.005);

  // 9. Aéroports et ports
  const intl = B.intlPax * S.macro.worldDemand * Math.pow(clamp(realIncome, 0.5, 2), 0.5);
  const domesticPax = (longPkm * T.modalLong.avion) / 400;
  T.airports.passengers = intl + domesticPax;
  T.airports.utilisation = T.airports.passengers / Math.max(1, T.airports.capacity);
  const tradeReal = (S.accounts.exports + S.accounts.imports) / Pl;
  if (init) { B.trade = tradeReal; B.portTonnage = 0.7 * T.ports.capacity; } // ports utilisés à 70 % au départ
  T.ports.tonnage = B.portTonnage * (tradeReal / Math.max(1, B.trade));
  T.ports.utilisation = T.ports.capacity > 0 ? T.ports.tonnage / T.ports.capacity : 0;

  // 10. Parc automobile : ventes, part de l'électrique (coût total de possession sur 6 ans)
  const years = S.month / 12;
  const premium = 7000 * Math.exp(-0.05 * years); // surcoût d'achat d'un véhicule électrique (€ de 2030), courbe d'apprentissage
  const fuelSavings = 6 * 12000 * (cc.thermalKm - cc.evKm);
  const taxSavings = 6 * (P.eco.vehicle / Pl);
  const rangePenalty = 4000 * Math.max(0, 1 - chargerRatio / 0.1);
  const x = (fuelSavings + taxSavings + (TP.evBonus + TP.thermalMalus) / Pl - premium - rangePenalty) / 2500;
  if (init) B.c0 = Math.log(0.25 / 0.75) - x;
  T.evSalesShare = sig(x + B.c0);
  const motor = 0.35 * Math.pow(clamp(realIncome, 0.5, 2), 0.2) * Math.pow(T.modal.voiture / 0.45, 0.4);
  const targetCars = pop * motor;
  const retire = T.fleet.cars / CAR_LIFETIME; // par an
  const sales = Math.max(0, retire + (targetCars - T.fleet.cars) * 0.2);
  T.carSales = sales;
  if (!init) {
    const evCars = T.fleet.cars * ev + (sales * T.evSalesShare - retire * ev) / 12;
    T.fleet.cars = Math.max(1, T.fleet.cars + (sales - retire) / 12);
    T.fleet.evShare = clamp(evCars / T.fleet.cars, 0, 1);
  }

  // 11. Émissions
  const carVkm = urbanCarVkm + longCarVkm;
  const carRaw = (carVkm * (1 - T.fleet.evShare) * CAR_THERMAL_KG_PER_KM) / 1000;
  const fuelEcon = economyFuelEmissions(S, P);
  if (init) B.kCar = fuelEcon / Math.max(1, carRaw);
  // l'efficacité des véhicules thermiques suit la sobriété induite par le prix du carbone (même règle que economy.ts)
  const cars = B.kCar * carRaw * (hhIntensity(P) / B.hhI);
  const busDiesel = (cap.vkm.bus * (T.fleet.busDiesel / Math.max(1, T.fleet.busDiesel + T.fleet.busElectric)) * BUS_DIESEL_KG_PER_VKM) / 1000;
  const trainDiesel = (cap.vkm.train * TRAIN_DIESEL_SHARE * TRAIN_DIESEL_KG_PER_VKM) / 1000;
  const comp = {
    fret: (freightTkm * (1 - T.freightRailShare) * TRUCK_KG_PER_TKM * (1 - T.fleet.truckElectric)) / 1000,
    tc: busDiesel + trainDiesel,
    air: (longPkm * T.modalLong.avion * AIR_KG_PER_PKM) / 1000,
  };
  if (init) B.comp = { ...comp };
  // le fret routier est rapporté à l'activité du secteur (l'intensité est par € de valeur ajoutée)
  const act = outputReal / Math.max(1, B.outputReal);
  const r = { fret: comp.fret / Math.max(1, B.comp.fret) / Math.max(0.05, act), tc: comp.tc / Math.max(1, B.comp.tc), air: comp.air / Math.max(1, B.comp.air) };
  const W = B.emissionsW;
  const factor = W.fret * r.fret + W.tc * r.tc + W.air * r.air + W.mer + W.autres;
  T.electricityMWh = (carVkm * T.fleet.evShare * EV_KWH_PER_KM) / 1000
    + PT_MODES.reduce((s, m) => s + cap.vkm[m] * PT_DEFS[m].kWhPerVkm * (m === 'bus' ? T.fleet.busElectric / Math.max(1, T.fleet.busDiesel + T.fleet.busElectric) : m === 'train' ? 1 - TRAIN_DIESEL_SHARE : 1), 0) / 1000
    + (freightTkm * (1 - T.freightRailShare) * T.fleet.truckElectric * 0.12) / 1000 + (freightTkm * T.freightRailShare * 0.03) / 1000;

  // 12. Satisfaction des usagers (continuité avec l'ancien indicateur fondé sur les services publics)
  const old = (S.services.transports * 0.7 + S.services.infrastructures * 0.3) * 100;
  if (init) { B.tt = T.travelTime; B.cong = vc; B.cost = T.costPerKm; B.crowd = crowd; }
  T.satisfaction = clamp(old - 45 * (T.travelTime / B.tt - 1) - 30 * (vc - B.cong) - 25 * (T.costPerKm / B.cost - 1) - 30 * (crowd - B.crowd) + 4 * Math.log(Math.max(0.05, N.cycleKm / B.cycleKm)) + 10 * (N.roadCondition - S.services.infrastructures), 0, 100);
  if (init) B.sat = T.satisfaction;

  return { factor, cars, fuelEcon, comp, W, r, cap };
}

/** Pas mensuel des transports (après economyStep). */
export function transportStep(S: GameState, P: Policy) {
  const T = S.transport!;
  const TP = P.transport ?? DEFAULT_TRANSPORT_POLICY;
  const Pl = S.macro.priceLevel;
  // chantiers
  const done = advanceProjects(S, T.projects, T.built, T.sites);
  for (const p of done) completeTransportProject(S, T, p);
  // état des routes : converge vers la qualité d'entretien (budget « infrastructures »)
  T.network.roadCondition = approach(T.network.roadCondition, S.services.infrastructures, 0.01);

  const res = computeTransport(S, P, T, false);
  const A = S.accounts;
  // émissions : voitures des ménages (remplace le calcul forfaitaire des carburants) et facteur du secteur
  addEmissions(A, res.cars - res.fuelEcon, undefined, true);
  const sector = S.sectors[SECTOR_INDEX.transport];
  applyTechFactor(sector, T.tech, res.factor, T.tech.productivity);
  const secEm = A.emissionsBySector[SECTOR_INDEX.transport];
  const share = (k: 'fret' | 'tc' | 'air' | 'mer' | 'autres', rr: number) => (secEm * res.W[k] * rr) / Math.max(1e-9, res.factor);
  T.emissions = {
    voitures: res.cars, fretRoutier: share('fret', res.r.fret), transportsCommuns: share('tc', res.r.tc), aviation: share('air', res.r.air), maritime: share('mer', 1), autres: share('autres', 1),
    secteur: secEm, total: secEm + res.cars, aviationInternationale: T.airports.passengers * 0.75 * 1500 * 0.09 / 1000,
  };
  // budget : surcoûts d'exploitation (fréquences, matériel supplémentaire), compensation tarifaire, bonus ; recettes : malus
  const baseOpex = T.base.opex * Pl;
  const extraOpex = T.opex - baseOpex;
  // compensation versée aux exploitants pour l'écart au tarif de référence (négative si les tarifs augmentent)
  const fareComp = (T.demand.dailyPkm * T.modal.transportsCommuns + T.demand.longPkm * T.modalLong.train) * 0.11 * Pl * (1 - TP.fareLevel);
  const bonus = T.carSales * T.evSalesShare * TP.evBonus;
  T.extraCost = extraOpex + fareComp + bonus;
  addSpending(S, 'transports', extraOpex + fareComp);
  addSpending(S, 'subventions', bonus);
  T.malusRevenue = T.carSales * (1 - T.evSalesShare) * TP.thermalMalus;
  addRevenue(S, 'vehicules', T.malusRevenue);
  // taxe annuelle sur les véhicules thermiques : assise sur le parc simulé
  // (assiette élargie aux utilitaires immatriculés : coefficient calibré pour égaler la recette initiale)
  addRevenue(S, 'vehicules', P.eco.vehicle * (T.fleet.cars * (1 - T.fleet.evShare) * T.base.vehicleTaxK - economyThermalVehicles(S, P)));
}

// ---------- Actions ----------
export type TransportProjectKind = 'tram' | 'metro' | 'rail' | 'tgv' | 'autoroute' | 'velo' | 'bornes' | 'renovation' | 'aeroport' | 'port' | 'fret';
interface ProjectDef { label: string; unit: string; costPerUnit: number; months: (size: number) => number; maintPerUnit: number; line: BudgetLine; max: number }
/** Coûts unitaires (€ de 2030), durées (mois) et entretien (€/an par unité). */
export const TRANSPORT_PROJECTS: Record<TransportProjectKind, ProjectDef> = {
  tram: { label: 'Ligne de tramway', unit: 'km', costPerUnit: 30e6, months: (k) => Math.min(60, Math.round(30 + 0.6 * k)), maintPerUnit: 0.6e6, line: 'transports', max: 60 },
  metro: { label: 'Ligne de métro', unit: 'km', costPerUnit: 150e6, months: (k) => Math.min(96, Math.round(48 + 1.2 * k)), maintPerUnit: 2e6, line: 'transports', max: 40 },
  rail: { label: 'Ligne de RER', unit: 'km', costPerUnit: 60e6, months: (k) => Math.min(96, Math.round(42 + 0.6 * k)), maintPerUnit: 0.4e6, line: 'transports', max: 80 },
  tgv: { label: 'Liaison express gare centrale – aéroport (grande vitesse)', unit: 'km', costPerUnit: 50e6, months: (k) => Math.min(96, Math.round(48 + 0.5 * k)), maintPerUnit: 0.3e6, line: 'transports', max: 60 },
  autoroute: { label: 'Voie rapide urbaine', unit: 'km', costPerUnit: 40e6, months: (k) => Math.min(72, Math.round(36 + 0.5 * k)), maintPerUnit: 0.3e6, line: 'infrastructures', max: 60 },
  velo: { label: 'Pistes cyclables', unit: 'km', costPerUnit: 0.5e6, months: (k) => Math.min(24, Math.round(6 + 0.02 * k)), maintPerUnit: 0.008e6, line: 'transports', max: 1000 },
  bornes: { label: 'Bornes de recharge', unit: 'centaines', costPerUnit: 1.2e6, months: () => 4, maintPerUnit: 0.08e6, line: 'transports', max: 500 },
  renovation: { label: 'Rénovation de la voirie', unit: 'centaines de km', costPerUnit: 60e6, months: (k) => Math.min(36, 12 + k), maintPerUnit: 0, line: 'infrastructures', max: 50 },
  aeroport: { label: 'Extension d\'aéroport (+5 M passagers/an)', unit: 'extensions', costPerUnit: 500e6, months: () => 48, maintPerUnit: 20e6, line: 'infrastructures', max: 4 },
  port: { label: 'Extension portuaire (+5 Mt/an)', unit: 'extensions', costPerUnit: 300e6, months: () => 36, maintPerUnit: 10e6, line: 'infrastructures', max: 4 },
  fret: { label: 'Plateforme logistique ferroviaire', unit: 'plateformes', costPerUnit: 120e6, months: () => 24, maintPerUnit: 3e6, line: 'transports', max: 10 },
};

export type VehicleKind = 'bus' | 'busElectrique' | 'tram' | 'metro' | 'train' | 'tgv';
export const VEHICLE_DEFS: Record<VehicleKind, { label: string; cost: number; delivery: number }> = {
  bus: { label: 'Bus diesel', cost: PT_DEFS.bus.cost, delivery: PT_DEFS.bus.delivery },
  busElectrique: { label: 'Bus électriques', cost: ELECTRIC_BUS_COST, delivery: 10 },
  tram: { label: PT_DEFS.tram.name, cost: PT_DEFS.tram.cost, delivery: PT_DEFS.tram.delivery },
  metro: { label: PT_DEFS.metro.name, cost: PT_DEFS.metro.cost, delivery: PT_DEFS.metro.delivery },
  train: { label: PT_DEFS.train.name, cost: PT_DEFS.train.cost, delivery: PT_DEFS.train.delivery },
  tgv: { label: PT_DEFS.tgv.name, cost: PT_DEFS.tgv.cost, delivery: PT_DEFS.tgv.delivery },
};

export type TransportAction =
  | { type: 'transport:build'; kind: TransportProjectKind; size: number; cityId?: number; a?: number; b?: number }
  | { type: 'transport:buy'; vehicle: VehicleKind; count: number; replace?: boolean };

const LINEAR: TransportProjectKind[] = ['rail', 'tgv', 'autoroute'];
const URBAN: TransportProjectKind[] = ['tram', 'metro', 'velo', 'bornes'];

/** Ville cible par défaut (déterministe) : la plus peuplée parmi les villes éligibles, la moins équipée par habitant. */
function defaultCity(S: GameState, T: TransportState, kind: TransportProjectKind): number | null {
  const elig = S.country.cities.filter((c) => (kind === 'metro' ? c.kind !== 'commune' : true));
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const c of elig) {
    const pop = S.cities[c.id].population;
    const have = T.sites.filter((x) => x.kind === kind && x.cityId === c.id).reduce((t, x) => t + x.size, 0);
    const score = pop / (1 + have * 50000);
    if (score > bestScore) { bestScore = score; best = c.id; }
  }
  return best;
}

/** Tracé d'une liaison entre deux villes : reprend une liaison existante de country.links, sinon ligne droite. */
function routeBetween(S: GameState, a: number, b: number, kind: TransportProjectKind): [number, number][] {
  const L = S.country.links;
  const pref = kind === 'autoroute' ? ['nationale', 'autoroute', 'rail'] : ['rail', 'autoroute', 'nationale'];
  for (const k of pref) {
    const l = L.find((x) => x.kind === k && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
    if (l) return (l.a === a ? l.points : [...l.points].reverse()).map((q) => [q[0], q[1]] as [number, number]);
  }
  const A = S.country.cities[a];
  const B = S.country.cities[b];
  return Array.from({ length: 11 }, (_, i) => [A.x + ((B.x - A.x) * i) / 10, A.z + ((B.z - A.z) * i) / 10] as [number, number]);
}

/** Liaison par défaut (déterministe) pour une nouvelle ligne interurbaine. */
function defaultPair(S: GameState, T: TransportState, kind: TransportProjectKind): [number, number] | null {
  const C = S.country;
  const has = (a: number, b: number, k: string) => T.sites.some((x) => x.kind === k && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
  const onRail = new Set<number>();
  for (const l of C.links) if (l.kind === 'rail') { onRail.add(l.a); onRail.add(l.b); }
  for (const x of T.sites) if (x.kind === 'rail' && x.a !== undefined && x.b !== undefined) { onRail.add(x.a); onRail.add(x.b); }
  if (kind === 'tgv') {
    // liaison express : du quartier le plus peuplé (gare centrale) au quartier le plus proche de l'aéroport
    const air = C.infra.find((i) => i.type === 'aeroport');
    const top = C.cities.map((c) => c.id).sort((p, q) => S.cities[q].population - S.cities[p].population)[0];
    if (!air || top === undefined) return null;
    const near = C.cities.reduce((m, c) => (Math.hypot(c.x - air.x, c.z - air.z) < Math.hypot(m.x - air.x, m.z - air.z) ? c : m), C.cities[0]);
    return near.id !== top && !has(top, near.id, 'tgv') ? [top, near.id] : null;
  }
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (const l of C.links) {
    const ca = C.cities[l.a];
    const cb = C.cities[l.b];
    let ok = false;
    if (kind === 'rail') ok = l.kind === 'nationale' && l.a !== l.b && (!onRail.has(l.a) || !onRail.has(l.b)) && !has(l.a, l.b, 'rail');
    if (kind === 'autoroute') ok = l.kind === 'nationale' && l.a !== l.b && !has(l.a, l.b, 'autoroute');
    if (!ok) continue;
    const score = S.cities[l.a].population * S.cities[l.b].population;
    if (score > bestScore) { bestScore = score; best = [l.a, l.b]; }
  }
  return best;
}

export function transportAction(S: GameState, a: TransportAction): { ok: boolean; msg: string } {
  const T = S.transport;
  if (!T) return { ok: false, msg: 'Module transports indisponible' };
  if (a.type === 'transport:build') {
    const d = TRANSPORT_PROJECTS[a.kind];
    if (!d) return { ok: false, msg: 'Projet inconnu' };
    if ((a.kind === 'aeroport' && T.airports.count === 0) || (a.kind === 'port' && T.ports.count === 0)) return { ok: false, msg: a.kind === 'port' ? 'Aucun port à agrandir' : 'Aucun aéroport à agrandir' };
    let size = Math.round(Number(a.size));
    let site: TransportSite | null = null;
    let where = '';
    const nC = S.country.cities.length;
    const validCity = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < nC;
    if (LINEAR.includes(a.kind)) {
      // liaison interurbaine : extrémités choisies ou liaison par défaut ; la longueur découle du tracé
      const pair: [number, number] | null = validCity(a.a) && validCity(a.b) && a.a !== a.b ? [a.a!, a.b!] : defaultPair(S, T, a.kind);
      if (!pair) return { ok: false, msg: 'Aucune liaison disponible pour ce type de ligne' };
      const pts = routeBetween(S, pair[0], pair[1], a.kind);
      size = Math.max(1, Math.round(polyLen(pts) * 1.05));
      if (size > d.max) return { ok: false, msg: `Liaison trop longue (${size} km, maximum ${d.max} km)` };
      where = ` ${S.country.cities[pair[0]].name} – ${S.country.cities[pair[1]].name}`;
      const mid = pts[Math.floor(pts.length / 2)];
      site = { id: 0, kind: a.kind, label: `${d.label}${where}`, cityId: null, a: pair[0], b: pair[1], x: mid[0], z: mid[1], points: pts, size, status: 'construction', since: S.month };
    } else {
      if (!Number.isFinite(size) || size < 1 || size > d.max) return { ok: false, msg: `Taille invalide (1 à ${d.max} ${d.unit})` };
      if (URBAN.includes(a.kind)) {
        const cid = validCity(a.cityId) ? a.cityId! : defaultCity(S, T, a.kind);
        if (cid === null) return { ok: false, msg: 'Aucune ville éligible' };
        const c = S.country.cities[cid];
        if (a.kind === 'metro' && c.kind === 'commune') return { ok: false, msg: 'Le métro dessert les grands quartiers et les arrondissements, pas les quartiers périphériques' };
        where = ` à ${c.name}`;
        const salt = T.sites.filter((x) => x.cityId === cid).length + 11;
        const pts = a.kind === 'tram' ? urbanLine(S, cid, size, salt, ['nationale', 'autoroute']) : a.kind === 'metro' ? urbanLine(S, cid, size, salt, ['rail', 'nationale', 'autoroute']) : undefined;
        site = { id: 0, kind: a.kind, label: `${d.label}${where}`, cityId: cid, x: c.x, z: c.z, points: pts, size, status: 'construction', since: S.month };
      } else if (a.kind === 'aeroport' || a.kind === 'port') {
        const inf = S.country.infra.filter((i) => i.type === a.kind).sort((p, q) => q.capacity - p.capacity)[0];
        if (inf) { where = ` (${inf.name})`; site = { id: 0, kind: a.kind, label: `${d.label}${where}`, cityId: inf.cityId, x: inf.x, z: inf.z, size, status: 'construction', since: S.month }; }
      } else if (a.kind === 'fret') {
        // au plus près du port (à défaut, des zones industrielles)
        const hub = S.country.infra.find((i) => i.type === 'port') ?? S.country.infra.find((i) => i.type === 'zone_industrielle');
        const byDist = [...S.country.cities].sort((p, q) => (hub ? Math.hypot(p.x - hub.x, p.z - hub.z) - Math.hypot(q.x - hub.x, q.z - hub.z) : S.cities[q.id].population - S.cities[p.id].population));
        const c = byDist[T.sites.filter((x) => x.kind === 'fret').length % Math.max(1, Math.min(3, byDist.length))];
        if (c) { const [x, z] = placeSite(S, c.id, 31 + T.sites.length, ['rail', 'autoroute']); where = ` (${c.name})`; site = { id: 0, kind: 'fret', label: `${d.label}${where}`, cityId: c.id, x, z, size, status: 'construction', since: S.month }; }
      }
    }
    const p = newProject(S, T, { kind: a.kind, label: `${d.label}${where} (${size} ${d.unit})`, size, cost: d.costPerUnit * size, months: d.months(size), maintenance: d.maintPerUnit * size, line: d.line });
    if (site) { site.id = T.siteSeq++; p.siteId = site.id; T.sites.push(site); }
    T.projects.push(p);
    return { ok: true, msg: `${p.label} lancé : ${(p.cost / 1e6).toFixed(0)} M€ sur ${p.months} mois` };
  }
  if (a.type === 'transport:buy') {
    const d = VEHICLE_DEFS[a.vehicle];
    if (!d) return { ok: false, msg: 'Matériel inconnu' };
    const n = Math.round(Number(a.count));
    if (!Number.isFinite(n) || n < 1 || n > 2000) return { ok: false, msg: 'Quantité invalide (1 à 2000)' };
    const replace = a.vehicle === 'busElectrique' && !!a.replace;
    const p = newProject(S, T, { kind: `veh:${a.vehicle}${replace ? ':remplacement' : ''}`, label: `${n} × ${d.label}${replace ? ' (remplacement de bus diesel)' : ''}`, size: n, cost: d.cost * n, months: d.delivery, maintenance: 0, line: 'transports' });
    T.projects.push(p);
    return { ok: true, msg: `Commande passée : ${p.label}, ${(p.cost / 1e6).toFixed(0)} M€, livraison dans ${p.months} mois` };
  }
  return { ok: false, msg: 'Action inconnue' };
}

function completeTransportProject(S: GameState, T: TransportState, p: Project) {
  const N = T.network;
  const k = p.size;
  switch (p.kind) {
    case 'tram': N.tramKm += k; T.fleet.tram += k * 1.2; break; // matériel initial inclus
    case 'metro': N.metroKm += k; T.fleet.metro += k * 2.5; break;
    case 'rail': N.railKm += k; T.fleet.train += k * 0.15; break;
    case 'tgv': N.tgvKm += k; T.fleet.tgv += k * 0.05; break;
    case 'autoroute': N.motorwayKm += k; break;
    case 'velo': N.cycleKm += k; break;
    case 'bornes': N.chargers += k * 100; break;
    case 'renovation': N.roadCondition = clamp(N.roadCondition + ((k * 100) / Math.max(1, N.motorwayKm + N.roadKm + N.localKm * 0.2)) * (1 - N.roadCondition), 0, 1); break;
    case 'aeroport': T.airports.capacity += 5e6 * k; break;
    case 'port': T.ports.capacity += 5e6 * k; break;
    case 'fret': N.freightTerminals += k; break;
    default:
      if (p.kind.startsWith('veh:')) {
        const v = p.kind.split(':')[1] as VehicleKind;
        if (v === 'bus') T.fleet.busDiesel += k;
        else if (v === 'busElectrique') { T.fleet.busElectric += k; if (p.kind.endsWith(':remplacement')) T.fleet.busDiesel = Math.max(0, T.fleet.busDiesel - k); }
        else T.fleet[v] += k;
      }
  }
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind: 'good', title: 'Transports : mise en service', text: `${p.label} est opérationnel.` });
  if (S.notices.length > 80) S.notices.shift();
}
