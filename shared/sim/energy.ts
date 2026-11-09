// Moteur énergie : parc de production électrique, stockage, réseau, appel au merit order par blocs horaires,
// prix de l'électricité, bilan d'énergie finale, électrification des usages, comptabilité carbone brute,
// investissements de marché et projets publics (construction / fermeture). Un appel = un mois.
//
// Conventions : puissances en MW, énergies mensuelles en MWh, flux annualisés en MWh/an ou t/an,
// prix en €/MWh constants (prix initiaux), montants budgétaires en € courants annualisés (€/an).
import { SECTORS, SECTOR_INDEX, type SectorId } from './data';
import { clamp } from './economy';
import {
  BLOCKS, BUILD_IDS, CARRIERS, CARRIER_AIR, CARRIER_CO2, CARRIER_PRICE, CARRIER_UPSTREAM, CARS_PER_PERSON, CHARGER_COST, DAYS_MONTH,
  DEFAULT_ENERGY_POLICY, ELEC_GROUPS, ELEC_GROUP_DEF, EV_KWH_KM, HEAT_FOSSIL_CO2, HEAT_PUMP_GAIN, HOURS_MONTH, HOUSEHOLD_ENERGY, ICE_KWH_KM,
  IMPORT_CO2_INTENSITY, INITIAL_MARGIN, INTERCONNECT_SHARE, KM_PER_CAR, PEAKERS_SHARE, POTENTIAL, MARKET_RATE, NEIGHBOUR_CO2, NEIGHBOUR_PRICE, NETWORK_COST,
  BASE_LOSSES, BIOMASS_CO2_BIOGENIC, OFFSET_PRICE, OTHER_CO2_SHARE, RENOV_MWH_PER_MEUR, SEASON, SECTOR_ENERGY, STORAGE, SUPPLY_MARGIN, TECHS, TECH_IDS, VOLL,
  annuity, type BuildId, type Carrier, type ElecGroup, type EnergyPolicy, type TechId,
} from './energyData';
import { INFRA_TECH, addSite, closeSites } from './energySites';
import type { GameState, Infra, Policy } from './types';

// ---------- Types ----------
export interface PlantFleet { mw: number; publicMw: number; initialMw: number }

export interface EnergyProject {
  id: number;
  kind: 'build' | 'close';
  tech: BuildId;
  mw: number;
  start: number; // mois de lancement
  done: number; // mois de mise en service (ou fin du démantèlement)
  cost: number; // coût total pour l'État (€ courants) ; 0 pour un projet privé
  paid: number; // montant déjà versé (€)
  public: boolean;
  name: string;
  infraId?: number; // site correspondant sur la carte (country.infra)
  applied?: boolean; // fermeture : capacité déjà retirée du parc
}

/** Bilan électrique du mois (MWh sur le mois). Identité : production + importations = consommation + pertes + exportations + (charge − décharge du stockage). */
export interface ElecBalance {
  production: number; // production nette injectée (après écrêtement)
  byTech: Record<TechId, number>;
  consumption: number; // consommation finale desservie
  losses: number; // pertes en ligne
  imports: number;
  exports: number;
  storageCharge: number;
  storageDischarge: number;
  curtailment: number; // production renouvelable écrêtée (non comptée dans la production)
  unserved: number; // énergie non distribuée (délestages)
  demand: number; // demande brute (consommation + pertes) avant délestage
  peakMW: number; // pointe de consommation du mois
  firmMW: number; // puissance garantie (pilotable + stockage + part des interconnexions)
  margin: number; // marge de capacité (firm / pointe − 1)
  prices: Record<string, number>; // prix de gros par bloc (€/MWh)
  wholesale: number; // prix de gros moyen pondéré (€/MWh)
  co2: number; // émissions directes de la production (t CO₂ sur le mois)
}

/** Énergie finale (MWh/an, rythme annuel désaisonnalisé). */
export interface FinalEnergy {
  byCarrier: Record<Carrier, number>;
  byUse: Record<'industrie' | 'agricultureBtp' | 'tertiaire' | 'transport' | 'residentiel', number>;
  total: number;
  renewable: number; // énergie finale d'origine renouvelable (MWh/an)
  renewableShare: number; // part renouvelable de l'énergie finale
  elecShare: number; // part de l'électricité dans l'énergie finale
}

/** Comptabilité des émissions (t CO₂e/an, rythme annualisé du mois). */
export interface EmissionsAccount {
  bySource: Record<'electricite' | 'autresEnergie' | 'industrie' | 'transport' | 'batiments' | 'agriculture' | 'construction', number>;
  power: number; // production d'électricité (mix réel)
  territorialGross: number; // émissions territoriales brutes (tous GES) = directes
  direct: number; // émissions directes (combustion et procédés sur le territoire)
  indirect: number; // émissions indirectes : amont des combustibles, cycle de vie des équipements, contenu des importations
  imported: number; // émissions contenues dans les importations (biens + électricité)
  exported: number; // émissions contenues dans les exportations
  footprint: number; // empreinte carbone = directes ménages + production − exportées + importées + amont
  fossilCO2: number; // CO₂ fossile brut (combustion de combustibles fossiles + procédés)
  biogenic: number; // CO₂ biogénique de la biomasse (non compté dans les émissions brutes, suivi à part)
  nonCO2: number; // autres GES (CH₄, N₂O, gaz fluorés) en t CO₂e
  // complétés par le module environnement
  absorptions: number; // absorptions des puits naturels (forêts, zones humides, sols, espaces verts)
  landUse: number; // émissions dues aux changements d'usage des sols (artificialisation, déboisement)
  net: number; // émissions territoriales nettes = brutes + usage des sols − absorptions
  offsets: number; // crédits carbone internationaux achetés (non déduits des brutes ni des nettes territoriales)
  netAfterOffsets: number; // nettes − compensation (affichage seulement)
  intensityElec: number; // g CO₂/kWh produit
  intensityGdp: number; // t CO₂e par M€ de PIB (réel)
  intensityFinal: number; // t CO₂ par MWh d'énergie finale
}

export interface Goal { id: string; name: string; value: number; target: number; progress: number; achieved: boolean; unit: string; definition: string }

interface MonthRec { gen: number; ren: number; cons: number; imp: number; exp: number; co2: number; peak: number; unserved: number; gross: number }

export interface EnergyState {
  /** facteur cumulé des chocs extérieurs appliqués à macro.energyPrice par d'autres modules (international, crises) */
  extFactor?: number;
  lastIndexOut?: number;
  fleet: Record<TechId, PlantFleet>;
  storage: { mw: number; mwh: number; publicMw: number };
  projects: EnergyProject[];
  projectSeq: number;
  interconnectMw: number;
  gridStock: number; // investissements réseau additionnels cumulés (€ constants, amortis 3 %/an)
  gridQuality: number; // 0..1
  lossRate: number;
  chargers: number; // bornes de recharge publiques
  evShare: number; // part électrique du parc automobile
  evSales: number; // part électrique des ventes de voitures neuves
  heatPumpShare: number; // part du chauffage fossile initial des ménages remplacée par des pompes à chaleur
  renovation: number; // part des besoins de chauffage économisée par la rénovation
  efficiency: number; // multiplicateur d'efficacité autonome (1 = initial)
  efficiencyCarbon: number; // multiplicateur d'efficacité induit par le prix du carbone
  electrification: Record<ElecGroup, number>; // part des usages fossiles initiaux électrifiés
  biofuelShare: number;
  heatRenewable: number; // part renouvelable des réseaux de chaleur
  fossilIndex: number; // indice des prix mondiaux des combustibles fossiles (1 = initial, modifiable par un futur module de crises)
  wholesaleSmooth: number; // prix de gros lissé (contrats à terme) €/MWh
  retailPrice: number; // prix de l'électricité hors taxes pour le consommateur €/MWh
  elecIndex: number; // prix de l'électricité / prix initial
  demandTrend: number; // croissance annuelle lissée de la demande d'électricité
  shortageRisk: number; // probabilité de délestage à la pointe (0..1)
  shortageMonths: number; // nombre de mois avec délestage
  balance: ElecBalance;
  final: FinalEnergy;
  emissions: EmissionsAccount;
  elecRenShare: number; // part renouvelable de l'électricité (12 mois glissants)
  elecRenShareMonth: number;
  airPollutants: number; // polluants atmosphériques locaux (t éq. PM2,5/an)
  jobs: { operation: number; construction: number };
  importDependence: number; // part de l'énergie finale couverte par des importations (combustibles fossiles, électricité importée)
  finance: Record<'capex' | 'decommission' | 'om' | 'support' | 'ev' | 'heatPumps' | 'charging' | 'renovation' | 'grid' | 'offsets' | 'revenue', number>;
  roll: MonthRec[];
  goals: Goal[];
  /** Sites énergétiques de la carte (copie de country.infra, envoyée à chaque instantané pour que la carte suive constructions et fermetures). */
  sites: Infra[];
  calib: {
    kElec: number; // calibrage de l'électricité stationnaire
    fScale: Record<string, number>; // calibrage des combustibles fossiles par secteur
    other0: Record<string, number>; // émissions hors combustion initiales (t/an)
    econ0: Record<string, number>; // émissions initiales calculées par le moteur économique (t/an)
    fossilFinal0: number;
    retail0: number;
    carbon0: number;
    industrial0: number;
    vehicle0: number;
    fuel0: number;
    air0: number;
    interconnect0: number; // capacité d'interconnexion initiale (MW)
    initialRenCap: Record<TechId, number>;
  };
}

export type EnergyAction =
  | { type: 'energyBuild'; tech: BuildId; mw: number }
  | { type: 'energyClose'; tech: BuildId; mw: number; atMonth?: number; infraId?: number } // atMonth : mois de fermeture programmée (ex. « fermer le charbon en 2035 »)
  | { type: 'energyCancel'; id: number };

export const ENERGY_ACTION_TYPES = ['energyBuild', 'energyClose', 'energyCancel'] as const;

// ---------- Outils ----------
const norm = (a: number[]) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.map((v) => v / m); };
const SN = { solar: norm(SEASON.solar), wind: norm(SEASON.wind), windSea: norm(SEASON.windSea), hydro: norm(SEASON.hydro), nuclear: norm(SEASON.nuclear), heating: norm(SEASON.heating), base: norm(SEASON.base), neighbour: norm(SEASON.neighbour) };
const LOAD_NORM = BLOCKS.reduce((s, b) => s + b.hours * b.load, 0);
const sat = (price: number, scale: number) => 1 - Math.exp(-Math.max(0, price) / scale);
const emptyTech = (): Record<TechId, number> => Object.fromEntries(TECH_IDS.map((t) => [t, 0])) as Record<TechId, number>;
const emptyCarrier = (): Record<Carrier, number> => Object.fromEntries(CARRIERS.map((c) => [c, 0])) as Record<Carrier, number>;
const popOf = (S: GameState) => S.demography.cohorts.reduce((s, v) => s + v, 0);
const yearsOf = (S: GameState) => S.month / 12;
export const energyPolicyOf = (P: Policy): EnergyPolicy => ({ ...DEFAULT_ENERGY_POLICY, ...(P.energy ?? {}) });


/** Puissance garantie à la pointe des batteries (décroît quand le stockage devient abondant : pointes plus longues à couvrir). */
function storageFirm(E: EnergyState, peakMW: number) {
  if (E.storage.mw <= 0) return 0;
  const penetration = E.storage.mw / Math.max(1, peakMW);
  return E.storage.mw * 0.9 * clamp(1 - 2 * Math.max(0, penetration - 0.1), 0.25, 1);
}

function firmCapacity(E: EnergyState, peakMW: number) {
  let f = 0;
  for (const t of TECH_IDS) f += E.fleet[t].mw * TECHS[t].firm;
  return f + storageFirm(E, peakMW) + 0.5 * E.interconnectMw;
}

// ---------- Demande d'énergie finale ----------
interface Demand {
  final: FinalEnergy;
  elecHeat: number; // électricité de chauffage (MWh/an, profil saisonnier marqué)
  elecOther: number; // autres usages stationnaires (MWh/an)
  elecEv: number; // recharge des véhicules (MWh/an, plate)
  combustion: Record<string, number>; // émissions de combustion directes par secteur et ménages (t/an)
  upstream: number; // émissions amont des combustibles finals (t/an)
  biogenic: number;
  heatFossilCO2: number; // émissions des réseaux de chaleur (rattachées au secteur de l'énergie)
  air: number; // polluants locaux de l'énergie finale (t/an)
  fossilFinal: number; // énergie finale fossile (MWh/an)
}

function computeDemand(S: GameState, P: Policy, E: EnergyState): Demand {
  const C = E.calib;
  const Pl = S.macro.priceLevel;
  const byCarrier = emptyCarrier();
  const byUse = { industrie: 0, agricultureBtp: 0, tertiaire: 0, transport: 0, residentiel: 0 };
  const combustion: Record<string, number> = {};
  let upstream = 0;
  let air = 0;
  const eff = E.efficiency * E.efficiencyCarbon;
  const elasticity = Math.pow(Math.max(0.2, E.elecIndex), -0.1); // élasticité-prix de court terme
  let elecHeat = 0;
  let elecOther = 0;
  const bio = E.biofuelShare;
  const addFossil = (key: string, c: Carrier, mwh: number) => {
    if (c === 'petrole') {
      byCarrier.petrole += mwh; // les biocarburants sont comptés dans les produits pétroliers mais leur part est renouvelable
      combustion[key] = (combustion[key] ?? 0) + mwh * (1 - bio) * CARRIER_CO2.petrole;
      upstream += mwh * (1 - bio) * CARRIER_UPSTREAM.petrole + mwh * bio * 0.03;
    } else {
      byCarrier[c] += mwh;
      combustion[key] = (combustion[key] ?? 0) + mwh * CARRIER_CO2[c];
      upstream += mwh * CARRIER_UPSTREAM[c];
    }
    air += (mwh / 1000) * CARRIER_AIR[c];
  };
  SECTORS.forEach((d, i) => {
    const def = SECTOR_ENERGY[d.id];
    const real = S.sectors[i].output / Pl / 1e6; // VA réelle (M€)
    const service = d.energyIntensity * real * (def.ownUse ?? 1) * eff;
    const e = E.electrification[def.group];
    const g = ELEC_GROUP_DEF[def.group];
    const m = def.mix;
    const fossilShare = m.petrole + m.gaz + m.charbon;
    const fs = C.fScale[d.id] ?? 1;
    const elec = service * C.kElec * (m.elec + (e * fossilShare) / g.gain) * elasticity;
    byCarrier.elec += elec;
    if (def.group === 'tertiaire') { elecHeat += elec * 0.3; elecOther += elec * 0.7; } else elecOther += elec;
    for (const c of ['petrole', 'gaz', 'charbon'] as const) if (m[c] > 0) addFossil(d.id, c, service * m[c] * (1 - e) * fs);
    byCarrier.chaleur += service * m.chaleur;
    byCarrier.biomasse += service * m.biomasse;
    air += ((service * m.biomasse) / 1000) * CARRIER_AIR.biomasse * 0.3; // chaudières industrielles filtrées
    const use = d.id === 'transport' ? 'transport' : def.group === 'industrie' ? 'industrie' : def.group === 'machines' ? 'agricultureBtp' : 'tertiaire';
    byUse[use] += service * (m.elec * C.kElec + (e * fossilShare * C.kElec) / g.gain + fossilShare * (1 - e) * fs + m.chaleur + m.biomasse);
  });
  // Ménages : chauffage et électricité spécifique
  const pop = popOf(S);
  const hh = S.demography.households || pop / 2.2;
  const H = HOUSEHOLD_ENERGY;
  const effHH = E.efficiency * E.efficiencyCarbon;
  const heatNeed = (1 - E.renovation) * effHH;
  const hp = E.heatPumpShare;
  const fsH = C.fScale.menages ?? 1;
  const resElecHeat = hh * (H.elecHeat + ((H.gaz + H.fioul) * hp) / HEAT_PUMP_GAIN) * heatNeed * C.kElec * elasticity;
  const resElecAppl = hh * H.elecAppliances * E.efficiency * C.kElec * elasticity;
  elecHeat += resElecHeat;
  elecOther += resElecAppl;
  byCarrier.elec += resElecHeat + resElecAppl;
  addFossil('menages', 'gaz', hh * H.gaz * (1 - hp) * heatNeed * fsH);
  addFossil('menages', 'petrole', hh * H.fioul * (1 - hp) * heatNeed * fsH);
  const wood = hh * H.bois * heatNeed;
  byCarrier.biomasse += wood;
  air += (wood / 1000) * CARRIER_AIR.biomasse;
  byCarrier.chaleur += hh * H.chaleur * heatNeed;
  byUse.residentiel += resElecHeat + resElecAppl + hh * (H.gaz + H.fioul) * (1 - hp) * heatNeed * fsH + wood + hh * H.chaleur * heatNeed;
  // Voitures particulières
  const cars = pop * CARS_PER_PERSON;
  const km = cars * KM_PER_CAR * E.efficiency;
  const carFuel = (km * (1 - E.evShare) * ICE_KWH_KM) / 1000 * fsH;
  const elecEv = (km * E.evShare * EV_KWH_KM) / 1000;
  addFossil('menages', 'petrole', carFuel);
  byCarrier.elec += elecEv;
  byUse.transport += carFuel + elecEv;
  // Agrégats
  const total = CARRIERS.reduce((s, c) => s + byCarrier[c], 0);
  const elecRen = E.elecRenShare;
  const renewable = byCarrier.elec * elecRen + byCarrier.chaleur * E.heatRenewable + byCarrier.biomasse + byCarrier.petrole * bio;
  const biogenic = byCarrier.biomasse * BIOMASS_CO2_BIOGENIC;
  const heatFossilCO2 = byCarrier.chaleur * (1 - E.heatRenewable) * HEAT_FOSSIL_CO2;
  const fossilFinal = byCarrier.petrole * (1 - bio) + byCarrier.gaz + byCarrier.charbon;
  return {
    final: { byCarrier, byUse, total, renewable, renewableShare: total > 0 ? renewable / total : 0, elecShare: total > 0 ? byCarrier.elec / total : 0 },
    elecHeat, elecOther, elecEv, combustion, upstream, biogenic, heatFossilCO2, air, fossilFinal,
  };
}

function carrierPrices(E: EnergyState): Record<Carrier, number> {
  const fi = E.fossilIndex;
  return {
    elec: E.retailPrice,
    petrole: CARRIER_PRICE.petrole * fi * (1 + 0.6 * (E.biofuelShare - 0.07)), // les biocarburants coûtent ~60 % de plus
    gaz: CARRIER_PRICE.gaz * fi,
    charbon: CARRIER_PRICE.charbon * fi,
    chaleur: CARRIER_PRICE.chaleur * (0.6 + 0.4 * fi),
    biomasse: CARRIER_PRICE.biomasse,
  };
}

// ---------- Appel des moyens de production (merit order par blocs horaires) ----------
interface DispatchResult {
  bal: ElecBalance;
  revenueByTech: Record<TechId, number>; // recettes de marché (€ sur le mois)
  varCostByTech: Record<TechId, number>;
  importCost: number;
  exportRevenue: number;
  air: number; // polluants des centrales (t sur le mois)
  lifecycle: number; // émissions amont du parc (t sur le mois)
  biogenic: number;
}

interface Unit { tech: TechId | 'import'; cost: number; max: number; used: number }

function dispatch(E: EnergyState, carbon: number, m: number, demand: { elecHeat: number; elecOther: number; elecEv: number }, years: number): DispatchResult {
  const F = E.fleet;
  const finalMonth = (demand.elecHeat * SN.heating[m] + demand.elecOther * SN.base[m] + demand.elecEv) / 12;
  const gross = finalMonth / (1 - E.lossRate);
  const nb = NEIGHBOUR_PRICE * SN.neighbour[m] * (0.5 + 0.5 * E.fossilIndex);
  const ic = E.interconnectMw;
  const blocks = BLOCKS.map((b) => ({ ...b, h: HOURS_MONTH * b.hours, load: (gross * b.hours * b.load) / LOAD_NORM }));
  // productions fatales par bloc (MWh)
  const fatal = blocks.map((b) => {
    const g = emptyTech();
    g.solaire = F.solaire.mw * TECHS.solaire.cf * SN.solar[m] * HOURS_MONTH * b.solar;
    g.eolien = F.eolien.mw * TECHS.eolien.cf * SN.wind[m] * b.h;
    g.eolienMer = F.eolienMer.mw * TECHS.eolienMer.cf * SN.windSea[m] * b.h;
    g.nucleaire = F.nucleaire.mw * Math.min(0.97, TECHS.nucleaire.cf * SN.nuclear[m]) * b.h;
    g.geothermie = F.geothermie.mw * TECHS.geothermie.cf * b.h;
    g.hydraulique = F.hydraulique.mw * TECHS.hydraulique.cf * SN.hydro[m] * 0.35 * b.h; // fil de l'eau
    return g;
  });
  const hydroBudget0 = F.hydraulique.mw * TECHS.hydraulique.cf * SN.hydro[m] * 0.65 * HOURS_MONTH; // lacs (modulable)
  const thermal: TechId[] = ['charbon', 'gaz', 'petrole', 'biomasse'];
  const mc = (t: TechId) => TECHS[t].fuel * (TECHS[t].fossil ? E.fossilIndex : 1) + TECHS[t].varOM + TECHS[t].co2 * carbon;

  const run = (charge: number[], discharge: number[]) => {
    let hydroLeft = hydroBudget0;
    const out = blocks.map((b, k) => {
      const load = b.load + charge[k] - discharge[k];
      const gen = { ...fatal[k] };
      const mr = TECH_IDS.reduce((s, t) => s + gen[t], 0);
      // hydraulique de lac : réservée aux blocs où la demande résiduelle est la plus chère (pointe, puis jour, puis nuit)
      const hydroCap = Math.max(0, F.hydraulique.mw * b.h - gen.hydraulique);
      const hydro = Math.min(hydroLeft, hydroCap, Math.max(0, load - mr));
      hydroLeft -= hydro;
      gen.hydraulique += hydro;
      let need = load - mr - hydro;
      let imports = 0;
      let exports = 0;
      let curtail = 0;
      let unserved = 0;
      let price: number;
      const impPrice = nb * b.price;
      const expPrice = impPrice * 0.92;
      const units: Unit[] = thermal.filter((t) => F[t].mw > 0).map((t) => ({ tech: t, cost: mc(t), max: F[t].mw * TECHS[t].cf * b.h, used: 0 }));
      units.push({ tech: 'import', cost: impPrice, max: ic * b.h, used: 0 });
      units.sort((a, c) => a.cost - c.cost);
      if (need <= 0) {
        const surplus = -need;
        exports = Math.min(surplus, ic * b.h);
        curtail = surplus - exports;
        price = curtail > 1e-6 ? 0 : expPrice;
        // écrêtement : renouvelables variables d'abord, puis modulation du nucléaire
        let c = curtail;
        for (const t of ['solaire', 'eolien', 'eolienMer', 'nucleaire'] as TechId[]) {
          const cut = Math.min(c, gen[t]);
          gen[t] -= cut;
          c -= cut;
        }
        need = 0;
      } else {
        price = 0;
        for (const u of units) {
          if (need <= 0) break;
          const take = Math.min(u.max, need);
          u.used += take;
          need -= take;
          price = u.cost;
        }
        if (need > 1e-6) { unserved = need; price = VOLL; }
        // exportations des moyens pilotables moins chers que le prix des voisins
        let expLeft = ic * b.h;
        const impUnit = units.find((u) => u.tech === 'import')!;
        if (impUnit.used <= 0) {
          for (const u of units) {
            if (u.tech === 'import' || u.cost >= expPrice || expLeft <= 0) continue;
            const extra = Math.min(u.max - u.used, expLeft);
            if (extra <= 0) continue;
            u.used += extra;
            expLeft -= extra;
            exports += extra;
            price = Math.max(price, u.cost);
          }
        }
        for (const u of units) {
          if (u.tech === 'import') imports = u.used;
          else gen[u.tech] += u.used;
        }
      }
      return { gen, imports, exports, curtail, unserved, price, load, impPrice, expPrice };
    });
    return out;
  };

  const zero = [0, 0, 0];
  let res = run(zero, zero);
  // stockage : cycle journalier, décharge à la pointe, charge sur le bloc le moins cher (surplus renouvelable en priorité)
  const charge = [0, 0, 0];
  const discharge = [0, 0, 0];
  if (E.storage.mw > 0 && E.storage.mwh > 0) {
    const eta = STORAGE.efficiency;
    const cheap = res[1].price <= res[2].price ? 1 : 2;
    const dMax = Math.min(E.storage.mw * blocks[0].h, E.storage.mwh * DAYS_MONTH * eta, blocks[0].load);
    const cMax = E.storage.mw * blocks[cheap].h;
    const d = Math.min(dMax, cMax * eta);
    if (d > 0 && res[0].price > res[cheap].price / eta + 2) {
      discharge[0] = d;
      charge[cheap] = d / eta;
      res = run(charge, discharge);
    }
  }
  const byTech = emptyTech();
  const revenueByTech = emptyTech();
  const varCostByTech = emptyTech();
  let imports = 0, exports = 0, curt = 0, unserved = 0, priceW = 0, loadSum = 0, importCost = 0, exportRevenue = 0;
  const prices: Record<string, number> = {};
  res.forEach((r, k) => {
    for (const t of TECH_IDS) {
      byTech[t] += r.gen[t];
      revenueByTech[t] += r.gen[t] * r.price;
      varCostByTech[t] += r.gen[t] * mc(t);
    }
    imports += r.imports;
    exports += r.exports;
    curt += r.curtail;
    unserved += r.unserved;
    priceW += r.price * blocks[k].load;
    loadSum += blocks[k].load;
    importCost += r.imports * r.impPrice;
    exportRevenue += r.exports * r.expPrice;
    prices[blocks[k].id] = r.price;
  });
  const production = TECH_IDS.reduce((s, t) => s + byTech[t], 0);
  const servedGross = gross - unserved;
  const losses = servedGross * E.lossRate;
  const peakMW = (gross / HOURS_MONTH) * (BLOCKS[0].load / LOAD_NORM) * 1.05;
  const firmMW = firmCapacity(E, peakMW);
  let co2 = 0, air = 0, lifecycle = 0, biogenic = 0;
  for (const t of TECH_IDS) {
    co2 += byTech[t] * TECHS[t].co2;
    air += (byTech[t] / 1000) * TECHS[t].airPollution;
    lifecycle += byTech[t] * TECHS[t].lifecycle;
    biogenic += byTech[t] * TECHS[t].co2Biogenic;
  }
  lifecycle += charge.reduce((s, v) => s + v, 0) * STORAGE.lifecycle;
  void years;
  return {
    bal: {
      production, byTech, consumption: servedGross - losses, losses, imports, exports,
      storageCharge: charge.reduce((s, v) => s + v, 0), storageDischarge: discharge.reduce((s, v) => s + v, 0),
      curtailment: curt, unserved, demand: gross, peakMW, firmMW, margin: firmMW / Math.max(1, peakMW) - 1, prices,
      wholesale: loadSum > 0 ? priceW / loadSum : 0, co2,
    },
    revenueByTech, varCostByTech, importCost, exportRevenue, air, lifecycle, biogenic,
  };
}

const renewableGen = (b: ElecBalance) => TECH_IDS.reduce((s, t) => s + (TECHS[t].renewable ? b.byTech[t] : 0), 0);

// ---------- Initialisation et calibrage ----------
const round50 = (v: number) => Math.ceil(v / 50) * 50;

/** Complète le parc initial par un site en service placé automatiquement. */
function addInitialCapacity(S: GameState, E: EnergyState, t: TechId, mw: number) {
  if (mw <= 0) return;
  const inf = addSite(S, t, mw, 'active', 0);
  inf.builtYear = S.startYear - 15;
  E.fleet[t].mw += mw;
}

export function initEnergy(S: GameState): EnergyState {
  const P = S.policy;
  const fleet = Object.fromEntries(TECH_IDS.map((t) => [t, { mw: 0, publicMw: 0, initialMw: 0 }])) as Record<TechId, PlantFleet>;
  for (const inf of S.country.infra) {
    const t = INFRA_TECH[inf.type];
    if (!t || t === 'batteries' || (inf.status ?? 'active') !== 'active') continue;
    fleet[t].mw += inf.capacity;
  }
  const E: EnergyState = {
    fleet, storage: { mw: 0, mwh: 0, publicMw: 0 }, projects: [], projectSeq: 1, interconnectMw: 0, gridStock: 0, gridQuality: 0.7,
    lossRate: BASE_LOSSES, chargers: 0, evShare: 0.12, evSales: 0.22, heatPumpShare: 0, renovation: 0, efficiency: 1, efficiencyCarbon: 1,
    electrification: { industrie: 0, machines: 0, tertiaire: 0, transport: 0 }, biofuelShare: 0.07, heatRenewable: 0.45, fossilIndex: 1,
    wholesaleSmooth: 70, retailPrice: 70 + NETWORK_COST + SUPPLY_MARGIN, elecIndex: 1, demandTrend: 0, shortageRisk: 0, shortageMonths: 0,
    balance: null as unknown as ElecBalance, final: null as unknown as FinalEnergy, emissions: null as unknown as EmissionsAccount,
    elecRenShare: 0.15, elecRenShareMonth: 0.15, airPollutants: 0, jobs: { operation: 0, construction: 0 }, importDependence: 0,
    finance: { capex: 0, decommission: 0, om: 0, support: 0, ev: 0, heatPumps: 0, charging: 0, renovation: 0, grid: 0, offsets: 0, revenue: 0 },
    roll: [], goals: [], sites: [],
    calib: {
      kElec: 1, fScale: {}, other0: {}, econ0: {}, fossilFinal0: 0, retail0: 70 + NETWORK_COST + SUPPLY_MARGIN,
      carbon0: P.eco.carbon, industrial0: P.eco.industrial, vehicle0: P.eco.vehicle, fuel0: P.eco.fuel, air0: 0, interconnect0: 0,
      initialRenCap: emptyTech(),
    },
  };
  S.energy = E;
  // 1) combustibles : les émissions de combustion ne peuvent excéder celles du moteur économique ; le reste = procédés et autres GES
  let d = computeDemand(S, P, E);
  const A = S.accounts;
  const econ: Record<string, number> = {};
  SECTORS.forEach((s, i) => (econ[s.id] = A.emissionsBySector[i] ?? 0));
  econ.menages = A.emissionsHouseholds;
  for (const k of Object.keys(econ)) {
    const comb = d.combustion[k] ?? 0;
    if (k !== 'energie' && comb > econ[k] && comb > 0) E.calib.fScale[k] = econ[k] / comb;
  }
  d = computeDemand(S, P, E);
  // 2) cité-État : interconnexions dimensionnées sur la charge moyenne (importations structurelles)
  const annualGross = (d.elecHeat + d.elecOther + d.elecEv) / (1 - E.lossRate);
  E.interconnectMw = round50(INTERCONNECT_SHARE * annualGross / 8760);
  E.calib.interconnect0 = E.interconnectMw;
  // 3) parc initial complété (turbines de pointe, cycles combinés) pour couvrir la pointe d'hiver avec une marge de 12 % et sans délestage
  const peak = dispatch(E, P.eco.industrial, 0, d, 0).bal.peakMW;
  addInitialCapacity(S, E, 'petrole', round50(PEAKERS_SHARE * peak) - E.fleet.petrole.mw);
  const deficit = (1 + INITIAL_MARGIN) * peak - firmCapacity(E, peak);
  if (deficit > 0) addInitialCapacity(S, E, 'gaz', round50(deficit / TECHS.gaz.firm));
  for (let k = 0; k < 20; k++) {
    let unserved = 0;
    for (let m = 0; m < 12; m++) unserved += dispatch(E, P.eco.industrial, m, d, 0).bal.unserved;
    if (unserved <= 0) break;
    addInitialCapacity(S, E, 'gaz', 200);
  }
  for (const t of TECH_IDS) { E.fleet[t].initialMw = E.fleet[t].mw; E.calib.initialRenCap[t] = E.fleet[t].mw; }
  // 3) prix : année complète simulée pour obtenir le prix de gros moyen et remplir les cumuls glissants
  E.chargers = (S.demography.cohorts.reduce((s, v) => s + v, 0) * CARS_PER_PERSON * E.evShare) / 10;
  let priceSum = 0;
  let last: DispatchResult | null = null;
  const recs: MonthRec[] = [];
  for (let m = 0; m < 12; m++) {
    const r = dispatch(E, P.eco.industrial, m, d, 0);
    priceSum += r.bal.wholesale * r.bal.demand;
    recs.push(monthRec(r.bal));
    if (m === 0) last = r;
  }
  const grossYear = recs.reduce((s, r) => s + r.gross, 0);
  E.wholesaleSmooth = priceSum / Math.max(1, grossYear);
  E.retailPrice = retailOf(E, E.wholesaleSmooth, E.wholesaleSmooth);
  E.calib.retail0 = E.retailPrice;
  E.elecIndex = 1;
  E.roll = recs;
  const powerAnnual = recs.reduce((s, r) => s + r.co2, 0);
  const energieOther = Math.max(0, econ.energie - powerAnnual - (d.combustion.energie ?? 0) - d.heatFossilCO2);
  for (const k of Object.keys(econ)) {
    E.calib.other0[k] = k === 'energie' ? energieOther : Math.max(0, econ[k] - (d.combustion[k] ?? 0));
    E.calib.econ0[k] = econ[k];
  }
  E.calib.fossilFinal0 = d.fossilFinal;
  E.elecRenShare = rollingRenShare(E);
  d = computeDemand(S, P, E);
  finishMonth(S, P, E, d, last!, true);
  E.calib.air0 = E.airPollutants;
  refreshSites(S);
  S.macro.energyPrice = 1;
  return E;
}

function monthRec(b: ElecBalance): MonthRec {
  return { gen: b.production, ren: renewableGen(b), cons: b.consumption, imp: b.imports, exp: b.exports, co2: b.co2, peak: b.peakMW, unserved: b.unserved, gross: b.demand };
}

function rollingRenShare(E: EnergyState) {
  const ren = E.roll.reduce((s, r) => s + r.ren, 0);
  const grossCons = E.roll.reduce((s, r) => s + r.gen + r.imp - r.exp, 0);
  return grossCons > 0 ? clamp(ren / grossCons, 0, 1) : 0;
}

function retailOf(E: EnergyState, smooth: number, month: number) {
  const vre = E.balance ? (E.balance.byTech.solaire + E.balance.byTech.eolien + E.balance.byTech.eolienMer) / Math.max(1, E.balance.production) : 0.03;
  const network = NETWORK_COST * (1 + 0.6 * Math.max(0, vre - 0.25));
  return 0.7 * smooth + 0.3 * month + network + SUPPLY_MARGIN;
}

// ---------- Pas mensuel ----------
export function energyStep(S: GameState, P: Policy): void {
  const E = S.energy;
  if (!E) return;
  const EP = energyPolicyOf(P);
  const yrs = yearsOf(S);
  const m = S.month % 12;
  const C = E.calib;
  const pop = popOf(S);
  // 1. Dynamique des usages (inerties : renouvellement des équipements)
  const carbonEff = sat(P.eco.carbon, 150) - sat(C.carbon0, 150);
  const indEff = sat(P.eco.industrial, 150) - sat(C.industrial0, 150);
  const elecPenalty = clamp(1 - 0.5 * (E.elecIndex - 1), 0.3, 1.3);
  for (const g of ELEC_GROUPS) {
    const def = ELEC_GROUP_DEF[g];
    const target = clamp((def.trend * yrs + def.carbon * (g === 'industrie' ? indEff : carbonEff)) * elecPenalty, 0, def.max);
    E.electrification[g] += (target - E.electrification[g]) / 120;
  }
  E.efficiency *= 1 - 0.009 / 12;
  const effTarget = 1 - 0.15 * Math.max(0, 0.5 * carbonEff + 0.5 * indEff);
  E.efficiencyCarbon += (effTarget - E.efficiencyCarbon) / 120;
  E.biofuelShare += (clamp(EP.biofuelMandate, 0, 0.5) - E.biofuelShare) / 24;
  E.heatRenewable += (clamp(0.45 + 0.4 * carbonEff + 0.004 * yrs, 0.2, 0.95) - E.heatRenewable) / 120;
  // pompes à chaleur
  const hh = S.demography.households || pop / 2.2;
  const hpRate = clamp(0.012 + 0.04 * carbonEff + 0.03 * Math.min(1, EP.heatPumpSubsidy / 8000) - 0.02 * (E.elecIndex - 1), 0, 0.12);
  const dHp = (1 - E.heatPumpShare) * hpRate / 12;
  E.heatPumpShare += dHp;
  const hpInstalls = dHp * hh * 0.6; // logements chauffés aux combustibles fossiles convertis ce mois-ci
  // rénovation énergétique : tendance autonome + budget public
  E.renovation = clamp(E.renovation + 0.005 / 12 + (EP.renovationBudget / 12 / 1e6 * RENOV_MWH_PER_MEUR) / Math.max(1, hh * 11.6), 0, 0.6);
  // véhicules électriques
  const cars = pop * CARS_PER_PERSON;
  const evs = cars * E.evShare;
  const coverage = evs > 0 ? Math.min(1, (E.chargers * 10) / evs) : 1;
  E.evSales = clamp(
    0.22 + 0.025 * yrs + 0.3 * sat(EP.evSubsidy, 5000) + 0.25 * (sat(P.eco.vehicle, 500) - sat(C.vehicle0, 500)) + 0.4 * (P.eco.fuel - C.fuel0)
    + 0.3 * carbonEff - 0.25 * (1 - coverage) - 0.15 * (E.elecIndex - 1), 0.02, 0.98);
  const carSales = cars / 15 / 12;
  E.evShare = clamp(E.evShare + (E.evSales - E.evShare) / 180, 0, 1);
  const evSold = carSales * E.evSales;
  // bornes : déploiement privé couvrant 85 % du besoin + programme public
  const need = (cars * E.evShare) / 10;
  if (need > E.chargers) E.chargers += (need - E.chargers) * 0.85 / 12;
  E.chargers += EP.chargingBudget / 12 / CHARGER_COST;
  // réseau : investissement additionnel → pertes, fiabilité, interconnexions
  const gdpReal0 = S.baseline.gdpReal || S.accounts.gdpReal || 1;
  E.gridStock = E.gridStock * (1 - 0.03 / 12) + EP.gridBudget / 12 / S.macro.priceLevel;
  const gridRef = 0.03 * gdpReal0;
  const gridEff = 1 - Math.exp(-E.gridStock / gridRef);
  E.lossRate = BASE_LOSSES - 0.02 * gridEff;
  E.gridQuality = 0.7 + 0.3 * gridEff;
  E.interconnectMw = E.calib.interconnect0 * (1 + gridEff);

  // 2. Projets : fermetures programmées, versements et mises en service
  for (const p of E.projects) if (p.kind === 'close' && !p.applied && S.month >= p.start) applyClosure(S, E, p);
  let capexPaid = 0;
  let decomPaid = 0;
  for (const p of E.projects) {
    if (p.public && p.cost > 0 && p.paid < p.cost && S.month > p.start) {
      const pay = Math.min(p.cost - p.paid, p.cost / Math.max(1, p.done - p.start));
      p.paid += pay;
      if (p.kind === 'build') capexPaid += pay; else decomPaid += pay;
    }
  }
  const finished = E.projects.filter((p) => S.month >= p.done);
  for (const p of finished) {
    if (p.kind === 'build') {
      if (p.tech === 'batteries') {
        E.storage.mw += p.mw;
        E.storage.mwh += p.mw * STORAGE.hours;
        if (p.public) E.storage.publicMw += p.mw;
      } else {
        E.fleet[p.tech].mw += p.mw;
        if (p.public) E.fleet[p.tech].publicMw += p.mw;
      }
      const site = p.infraId !== undefined ? S.country.infra.find((i) => i.id === p.infraId) : undefined;
      if (site) { site.status = 'active'; site.serviceMonth = S.month; site.builtYear = S.startYear + Math.floor(S.month / 12); }
      if (p.public) notice(S, 'good', 'Mise en service', `${p.name} est raccordé au réseau.`);
    }
  }
  E.projects = E.projects.filter((p) => S.month < p.done);

  // 3. Demande et appel des moyens de production
  const d = computeDemand(S, P, E);
  const r = dispatch(E, P.eco.industrial, m, d, yrs);
  const prevGross = E.roll.length >= 12 ? E.roll[E.roll.length - 12].gross : r.bal.demand;
  E.roll.push(monthRec(r.bal));
  if (E.roll.length > 12) E.roll.shift();
  E.demandTrend += ((r.bal.demand / Math.max(1, prevGross) - 1) - E.demandTrend) / 12;

  // 4. Prix
  E.wholesaleSmooth += (Math.min(r.bal.wholesale, 1000) - E.wholesaleSmooth) / 12;
  E.retailPrice = retailOf(E, E.wholesaleSmooth, Math.min(r.bal.wholesale, 1000));
  E.elecIndex = E.retailPrice / C.retail0;
  E.elecRenShare = rollingRenShare(E);

  // 5. Finances publiques de l'énergie (€ courants annualisés)
  const Pl = S.macro.priceLevel;
  let om = 0;
  let margin = 0;
  for (const t of TECH_IDS) {
    const f = E.fleet[t];
    if (f.publicMw <= 0) continue;
    om += f.publicMw * TECHS[t].fixedOM * 1000;
    const share = f.publicMw / Math.max(1, f.mw);
    margin += share * (r.revenueByTech[t] - r.varCostByTech[t]) * 12;
  }
  om += E.storage.publicMw * STORAGE.fixedOM * 1000;
  let newRen = 0;
  for (const t of ['solaire', 'eolien', 'eolienMer'] as TechId[]) {
    const f = E.fleet[t];
    newRen += r.bal.byTech[t] * Math.max(0, f.mw - C.initialRenCap[t]) / Math.max(1, f.mw);
  }
  E.finance = {
    capex: capexPaid * 12,
    decommission: decomPaid * 12,
    om: om * Pl,
    support: EP.renewableSupport * newRen * 12 * Pl,
    ev: evSold * EP.evSubsidy * 12,
    heatPumps: hpInstalls * EP.heatPumpSubsidy * 12,
    charging: EP.chargingBudget,
    renovation: EP.renovationBudget,
    grid: EP.gridBudget,
    offsets: EP.offsets * OFFSET_PRICE * Pl,
    revenue: Math.max(0, margin) * Pl,
  };
  const F = E.finance;
  addPublicFlow(S, 'energie', F.capex + F.decommission + F.om + F.support + F.ev + F.heatPumps + F.charging + F.renovation + F.grid, F.revenue);
  addPublicFlow(S, 'ecologie', F.offsets, 0);

  // 6. Indicateurs, émissions, prix de l'énergie pour l'économie
  finishMonth(S, P, E, d, r, false);

  // 7. Pénurie : délestages → confiance, qualité perçue des infrastructures, alerte
  const unservedShare = r.bal.unserved / Math.max(1, r.bal.demand);
  if (unservedShare > 0) {
    E.shortageMonths += 1;
    S.macro.confidence = clamp(S.macro.confidence - Math.min(0.1, unservedShare * 1.5), 0.05, 0.95);
    S.services.infrastructures = clamp(S.services.infrastructures - Math.min(0.1, unservedShare * 1.5), 0, 1);
    if (unservedShare > 0.002) notice(S, 'bad', 'Délestages électriques', `${(unservedShare * 100).toFixed(1).replace('.', ',')} % de la demande n'a pas pu être servie ce mois-ci : production pilotable, stockage et importations insuffisants à la pointe.`);
  }

  // 8. Investissements de marché
  if (EP.autoInvest) marketInvestment(S, P, E, EP);
  E.jobs = jobsOf(E, S.month);
  refreshSites(S);
}

/** Met à jour la liste des sites énergétiques transmise au client. */
export function refreshSites(S: GameState) {
  if (!S.energy) return;
  S.energy.sites = S.country.infra.filter((i) => INFRA_TECH[i.type] !== undefined).map((i) => ({ ...i }));
}

/** Calcule les indicateurs du mois, la comptabilité carbone brute et l'indice de prix de l'énergie. */
function finishMonth(S: GameState, P: Policy, E: EnergyState, d: Demand, r: DispatchResult, init: boolean) {
  const C = E.calib;
  const A = S.accounts;
  const Pl = S.macro.priceLevel;
  E.balance = r.bal;
  E.final = d.final;
  const ren = renewableGen(r.bal);
  E.elecRenShareMonth = clamp(ren / Math.max(1, r.bal.production + r.bal.imports - r.bal.exports), 0, 1);
  // pénurie : risque de délestage selon la marge de capacité à la pointe
  const marginRisk = 1 / (1 + Math.exp(r.bal.margin / 0.03));
  E.shortageRisk = r.bal.unserved > 0 ? Math.max(0.95, marginRisk) : marginRisk;
  // indice des prix de l'énergie : indice de Paasche Σ q·p / Σ q·p0 (quantités du mois, prix hors taxes ; 1 = prix initiaux).
  // L'efficacité énergétique réduit les quantités mais pas l'indice ; seule l'évolution des prix le fait varier.
  if (!init) {
    const price = carrierPrices(E);
    let bill = 0;
    let billBase = 0;
    for (const c of CARRIERS) {
      bill += d.final.byCarrier[c] * price[c];
      billBase += d.final.byCarrier[c] * (c === 'elec' ? C.retail0 : CARRIER_PRICE[c]);
    }
    // les chocs appliqués entre-temps par d'autres modules (voisins, accords, crises) sont conservés multiplicativement
    const ext = E.lastIndexOut ? S.macro.energyPrice / E.lastIndexOut : 1;
    E.extFactor = clamp((E.extFactor ?? 1) * ext, 0.2, 5);
    S.macro.energyPrice = clamp((bill / Math.max(1, billBase)) * E.extFactor, 0.3, 5);
  }
  E.lastIndexOut = S.macro.energyPrice;
  // ---- émissions (t/an) ----
  const econ: Record<string, number> = {};
  SECTORS.forEach((s, i) => (econ[s.id] = A.emissionsBySector[i] ?? 0));
  econ.menages = A.emissionsHouseholds;
  const power = r.bal.co2 * 12;
  const bySector: Record<string, number> = {};
  let nonCO2 = 0;
  let processCO2 = 0;
  for (const k of Object.keys(econ)) {
    const scale = C.econ0[k] > 0 ? econ[k] / C.econ0[k] : 1;
    let other = (C.other0[k] ?? 0) * scale;
    if (k === 'energie') {
      // raffinage, transport du gaz : suit la demande d'énergie fossile et la décarbonation du secteur
      const ie = S.sectors[SECTOR_INDEX.energie].emissionIntensity / SECTORS[SECTOR_INDEX.energie].emissionIntensity;
      other = (C.other0.energie ?? 0) * (d.fossilFinal / Math.max(1, C.fossilFinal0)) * ie;
    }
    const co2Share = OTHER_CO2_SHARE[k as SectorId | 'menages'] ?? 0;
    processCO2 += other * co2Share;
    nonCO2 += other * (1 - co2Share);
    bySector[k] = (d.combustion[k] ?? 0) + other + (k === 'energie' ? power + d.heatFossilCO2 : 0);
  }
  const combustionTotal = Object.values(d.combustion).reduce((s, v) => s + v, 0);
  // remplace les émissions du moteur économique par celles du bilan énergétique
  A.emissionsBySector = SECTORS.map((s) => bySector[s.id]);
  A.emissionsHouseholds = bySector.menages;
  A.emissions = A.emissionsBySector.reduce((s, v) => s + v, 0) + A.emissionsHouseholds;
  const gross = A.emissions;
  const tertiaire = (['commerce', 'tourisme', 'technologie', 'finance', 'services', 'sante', 'education'] as SectorId[]).reduce((s, k) => s + bySector[k], 0);
  // répartition des émissions des ménages entre voitures et logements (selon leurs carburants)
  const cars = popOf(S) * CARS_PER_PERSON;
  const carCO2 = ((cars * KM_PER_CAR * E.efficiency * (1 - E.evShare) * ICE_KWH_KM) / 1000) * (C.fScale.menages ?? 1) * (1 - E.biofuelShare) * CARRIER_CO2.petrole;
  const hhOther = bySector.menages - carCO2;
  const years = yearsOf(S);
  const importsReal = A.imports / Pl / 1e6;
  const exportsReal = A.exports / Pl / 1e6;
  const importedGoods = importsReal * IMPORT_CO2_INTENSITY * Math.pow(1 - 0.012, years);
  const importedElec = r.bal.imports * 12 * NEIGHBOUR_CO2 * Math.pow(0.98, years);
  const productionEmissions = gross - bySector.menages;
  const exported = exportsReal * (productionEmissions / Math.max(1, A.gdpReal / 1e6));
  const upstream = d.upstream + r.lifecycle * 12;
  const fossilCO2 = power - r.bal.byTech.geothermie * TECHS.geothermie.co2 * 12 + combustionTotal + d.heatFossilCO2 + processCO2;
  const prevNet = E.emissions;
  E.emissions = {
    bySource: {
      electricite: power,
      autresEnergie: bySector.energie - power,
      industrie: bySector.industrie,
      transport: bySector.transport + carCO2,
      batiments: tertiaire + hhOther,
      agriculture: bySector.agriculture,
      construction: bySector.construction,
    },
    power,
    territorialGross: gross,
    direct: gross,
    indirect: upstream + importedGoods + importedElec,
    imported: importedGoods + importedElec,
    exported,
    footprint: gross - exported + importedGoods + importedElec + upstream,
    fossilCO2,
    biogenic: d.biogenic + r.biogenic * 12,
    nonCO2,
    absorptions: prevNet?.absorptions ?? 0,
    landUse: prevNet?.landUse ?? 0,
    net: 0,
    offsets: energyPolicyOf(P).offsets,
    netAfterOffsets: 0,
    intensityElec: r.bal.production > 0 ? (r.bal.co2 / r.bal.production) * 1000 : 0,
    intensityGdp: gross / Math.max(1, A.gdpReal / 1e6),
    intensityFinal: (combustionTotal + power + d.heatFossilCO2) / Math.max(1, d.final.total),
  };
  E.emissions.net = gross + E.emissions.landUse - E.emissions.absorptions;
  E.emissions.netAfterOffsets = E.emissions.net - E.emissions.offsets;
  // dépendance aux importations (approche « énergie primaire ») : combustibles fossiles (tous importés, rendement des centrales
  // ≈ 45 % → ×2,2), électricité importée nette ; ressources nationales : renouvelables et nucléaire produits sur le territoire
  const fossilElecInput = (r.bal.byTech.charbon + r.bal.byTech.gaz + r.bal.byTech.petrole) * 12 * 2.2;
  const domesticGen = (r.bal.production - r.bal.byTech.charbon - r.bal.byTech.gaz - r.bal.byTech.petrole) * 12;
  const netImp = Math.max(0, r.bal.imports - r.bal.exports) * 12;
  const imported = d.fossilFinal + fossilElecInput + netImp;
  E.importDependence = clamp(imported / Math.max(1, imported + domesticGen + (d.final.total - d.final.byCarrier.elec - d.fossilFinal)), 0, 1);
  E.airPollutants = d.air + r.air * 12 * 0.4 + (S.sectors[SECTOR_INDEX.agriculture].output / Pl / 1e6) * 0.25 + (S.sectors[SECTOR_INDEX.industrie].output / Pl / 1e6) * 0.05;
}

function jobsOf(E: EnergyState, month: number) {
  let operation = E.storage.mw * STORAGE.jobsOp;
  for (const t of TECH_IDS) operation += E.fleet[t].mw * TECHS[t].jobsOp;
  let construction = 0;
  for (const p of E.projects) {
    if (p.kind !== 'build' || month < p.start) continue;
    const def = p.tech === 'batteries' ? STORAGE : TECHS[p.tech];
    construction += (p.mw * def.jobsBuild) / Math.max(1, (p.done - p.start) / 12);
  }
  return { operation, construction };
}

/** Coût actualisé de l'électricité d'une filière (€/MWh) pour un investisseur au taux r et un facteur de charge donné. */
export function lcoe(t: TechId, carbon: number, cf = TECHS[t].cf, r = MARKET_RATE, fossilIndex = 1) {
  const d = TECHS[t];
  const fixed = (d.capex * 1000 * annuity(r, d.lifetime) + d.fixedOM * 1000) / Math.max(1, cf * 8760);
  return fixed + d.fuel * (d.fossil ? fossilIndex : 1) + d.varOM + d.co2 * carbon;
}

/** Les opérateurs privés construisent : (a) des moyens garantis si la marge de capacité prévue est insuffisante ; (b) des renouvelables rentables. */
function marketInvestment(S: GameState, P: Policy, E: EnergyState, EP: EnergyPolicy) {
  const carbon = P.eco.industrial;
  const peak = Math.max(...E.roll.map((r) => r.peak));
  const peakFuture = peak * (1 + Math.max(0, E.demandTrend) * 3);
  let pipelineFirm = 0;
  for (const p of E.projects) {
    if (p.kind !== 'build') continue;
    pipelineFirm += p.tech === 'batteries' ? p.mw * 0.6 : p.mw * TECHS[p.tech].firm;
  }
  const gap = peakFuture * 1.1 - firmCapacity(E, peak) - pipelineFirm;
  if (gap > 20) {
    // coût annuel par kW garanti : annuité + maintenance + énergie (fonctionnement ~5 % du temps) / contribution à la pointe
    const opts: { id: BuildId; cost: number }[] = [];
    for (const t of ['gaz', 'petrole', 'biomasse'] as TechId[]) {
      const dft = TECHS[t];
      if (E.fleet[t].mw + pipelineMw(E, t) >= potentialMW(S, t)) continue;
      const energy = 0.05 * 8760 * (dft.fuel * (dft.fossil ? E.fossilIndex : 1) + dft.varOM + dft.co2 * carbon) / 1000;
      opts.push({ id: t, cost: (dft.capex * annuity(MARKET_RATE, dft.lifetime) + dft.fixedOM + energy) / dft.firm });
    }
    const credit = clamp(1 - 2 * Math.max(0, (E.storage.mw + pipelineMw(E, 'batteries')) / Math.max(1, peak) - 0.1), 0.25, 1) * 0.9;
    opts.push({ id: 'batteries', cost: (STORAGE.capex * annuity(MARKET_RATE, STORAGE.lifetime) + STORAGE.fixedOM + 0.05 * 8760 * 0.3 * E.wholesaleSmooth / 1000) / credit });
    opts.sort((a, b) => a.cost - b.cost);
    const best = opts[0].id;
    const firm = best === 'batteries' ? credit : TECHS[best as TechId].firm;
    privateProject(S, E, best, Math.max(50, gap * 0.25) / firm);
  }
  // énergie : renouvelables variables si le prix capté dépasse le coût complet (avec complément de rémunération)
  const avgLoad = E.roll.reduce((s, r) => s + r.gross, 0) / (12 * HOURS_MONTH);
  const prod = Math.max(1, E.roll.reduce((s, r) => s + r.gen, 0));
  const solarShare = (E.fleet.solaire.mw * TECHS.solaire.cf * 8760) / prod;
  const windShare = ((E.fleet.eolien.mw * TECHS.eolien.cf + E.fleet.eolienMer.mw * TECHS.eolienMer.cf) * 8760) / prod;
  const storageBoost = Math.min(0.3, E.storage.mwh / Math.max(1, avgLoad * 24) );
  const capture: Record<string, number> = {
    solaire: clamp(1 - 1.3 * solarShare + storageBoost, 0.15, 1),
    eolien: clamp(1 - 0.7 * windShare + storageBoost * 0.5, 0.25, 1),
    eolienMer: clamp(1 - 0.7 * windShare + storageBoost * 0.5, 0.25, 1),
  };
  for (const t of ['solaire', 'eolien', 'eolienMer'] as TechId[]) {
    const value = E.wholesaleSmooth * capture[t] + EP.renewableSupport;
    const cost = lcoe(t, carbon);
    if (value > cost * 1.05) {
      const rate = Math.min(1, (value / cost - 1) * 1.5);
      const mwh = avgLoad * 8760 * 0.004 * rate; // jusqu'à ~5 % de la demande par an
      const room = potentialMW(S, t) - E.fleet[t].mw - pipelineMw(E, t);
      privateProject(S, E, t, Math.min(room, mwh / (TECHS[t].cf * 8760)));
    }
  }
}

/**
 * Potentiel maximal installable d'une filière (MW), borné par les surfaces disponibles de la cité-État
 * (toitures, terres non bâties, mer) et par les ressources (rivière, géothermie, biomasse durable).
 */
export function potentialMW(S: GameState, t: BuildId): number {
  const E = S.energy;
  const L = S.environment?.land;
  const sea = S.environment?.seaKm2 ?? 0;
  const have = t === 'batteries' ? (E?.storage.mw ?? 0) : (E?.fleet[t].mw ?? 0);
  const init = t === 'batteries' ? 0 : (E?.fleet[t].initialMw ?? 0);
  let pot: number;
  switch (t) {
    case 'solaire': pot = L ? (L.artificialise + L.espacesVerts) * POTENTIAL.roofShare * POTENTIAL.roofMWkm2 + (L.agricole + L.naturel) * POTENTIAL.groundShare * POTENTIAL.groundMWkm2 : 5000; break;
    case 'eolien': pot = L ? (L.agricole + L.naturel + L.foret) * POTENTIAL.windMWkm2 : 300; break;
    case 'eolienMer': pot = POTENTIAL.offshoreEEZ + sea * POTENTIAL.seaMWkm2; break;
    case 'hydraulique': pot = init + POTENTIAL.hydroExtra; break;
    case 'geothermie': pot = POTENTIAL.geothermie; break;
    case 'biomasse': pot = POTENTIAL.biomasse; break;
    case 'nucleaire': pot = POTENTIAL.nucleaire; break;
    case 'batteries': pot = POTENTIAL.batteries; break;
    default: pot = POTENTIAL.thermal;
  }
  return Math.max(pot, have);
}

function pipelineMw(E: EnergyState, t: BuildId) {
  return E.projects.reduce((s, p) => s + (p.kind === 'build' && p.tech === t ? p.mw : 0), 0);
}

/** Projet privé : regroupé par filière et par année de lancement (aucun coût pour l'État). */
function privateProject(S: GameState, E: EnergyState, t: BuildId, mw: number) {
  if (!(mw > 0.5)) return;
  const def = t === 'batteries' ? STORAGE : TECHS[t];
  const year = Math.floor(S.month / 12);
  const existing = E.projects.find((p) => !p.public && p.kind === 'build' && p.tech === t && Math.floor(p.start / 12) === year);
  if (existing) {
    existing.mw += mw;
    const site = S.country.infra.find((i) => i.id === existing.infraId);
    if (site) resizeSite(site, t, existing.mw);
    if (site) existing.name = `${site.name} — ${Math.round(existing.mw)} MW (opérateurs privés)`;
    return;
  }
  const done = S.month + def.buildMonths;
  const site = addSite(S, t, mw, 'construction', done);
  E.projects.push({ id: E.projectSeq++, kind: 'build', tech: t, mw, start: S.month, done, cost: 0, paid: 0, public: false, name: `${site.name} — ${Math.round(mw)} MW (opérateurs privés)`, infraId: site.id });
}

function resizeSite(site: { capacity: number; employees: number; maintenance: number; energyMWh: number; emissions: number }, t: BuildId, mw: number) {
  const def = t === 'batteries' ? null : TECHS[t];
  site.capacity = Math.round(mw);
  site.employees = Math.round(mw * (def ? def.jobsOp : STORAGE.jobsOp));
  site.maintenance = Math.round(mw * 1000 * (def ? def.fixedOM : STORAGE.fixedOM));
  site.energyMWh = def ? -Math.round(mw * def.cf * 8760) : 0;
  site.emissions = def ? Math.round(mw * def.cf * 8760 * def.co2) : 0;
}

/** Retire du parc la capacité d'une fermeture (immédiate ou arrivée à échéance) et met la carte à jour. */
function applyClosure(S: GameState, E: EnergyState, p: EnergyProject) {
  p.applied = true;
  const tech = p.tech;
  const have = tech === 'batteries' ? E.storage.mw : E.fleet[tech].mw;
  const m = Math.min(p.mw, have);
  p.mw = m;
  if (m <= 0) return;
  if (tech === 'batteries') {
    E.storage.mwh *= (E.storage.mw - m) / E.storage.mw;
    E.storage.publicMw = Math.max(0, E.storage.publicMw - m);
    E.storage.mw -= m;
  } else {
    const f = E.fleet[tech];
    const privateMw = f.mw - f.publicMw;
    f.mw -= m;
    f.publicMw = Math.max(0, f.publicMw - Math.max(0, m - privateMw));
  }
  closeSites(S, tech, m, p.infraId);
  if (p.start > 0 && S.month >= p.start && p.start !== p.done) {
    notice(S, 'info', 'Fermeture effective', `${p.name} : la capacité est retirée du réseau.`);
  }
}

export function techName(t: BuildId) {
  return t === 'batteries' ? STORAGE.name : TECHS[t].name;
}

/** Ajoute aux comptes du mois une dépense et une recette publiques (€/an) et met à jour la trésorerie en conséquence. */
export function addPublicFlow(S: GameState, key: 'energie' | 'ecologie', spending: number, revenue: number) {
  const A = S.accounts;
  A.spending[key] = (A.spending[key] ?? 0) + spending;
  if (revenue) A.revenue.energiePublique = (A.revenue.energiePublique ?? 0) + revenue;
  A.spendingTotal += spending;
  A.revenueTotal += revenue;
  A.balance = A.revenueTotal - A.spendingTotal;
  A.primaryBalance = A.balance + (A.spending.interets ?? 0);
  S.finance.cash += (revenue - spending) / 12;
}

function notice(S: GameState, kind: 'info' | 'warn' | 'good' | 'bad', title: string, text: string) {
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind, title, text });
  if (S.notices.length > 80) S.notices.shift();
}

// ---------- Actions du joueur ----------
export function isEnergyAction(a: { type?: unknown }): a is EnergyAction {
  return (ENERGY_ACTION_TYPES as readonly unknown[]).includes(a?.type);
}

/** Devis d'un projet de construction public (coût total en € courants, durée, emplois). */
export function buildQuote(S: GameState, tech: BuildId, mw: number) {
  const def = tech === 'batteries' ? STORAGE : TECHS[tech];
  const cost = def.capex * 1000 * mw * S.macro.priceLevel;
  return { cost, months: def.buildMonths, jobsBuild: (mw * def.jobsBuild) / Math.max(1, def.buildMonths / 12), jobsOp: mw * def.jobsOp, om: def.fixedOM * 1000 * mw * S.macro.priceLevel };
}

/** Devis d'une fermeture (démantèlement + indemnisation des exploitants pour les capacités privées). */
export function closeQuote(S: GameState, tech: BuildId, mw: number) {
  const E = S.energy!;
  const def = tech === 'batteries' ? STORAGE : TECHS[tech];
  const publicMw = tech === 'batteries' ? E.storage.publicMw : E.fleet[tech].publicMw;
  const privateMw = Math.max(0, mw - publicMw);
  const cost = (def.decommission * mw + 0.15 * def.capex * privateMw) * 1000 * S.macro.priceLevel;
  return { cost, months: tech === 'nucleaire' ? 60 : 24, jobsLost: mw * def.jobsOp };
}

export function applyEnergyAction(S: GameState, a: EnergyAction): { ok: boolean; msg: string } {
  const r = applyEnergyActionInner(S, a);
  if (r.ok) refreshSites(S);
  return r;
}

function applyEnergyActionInner(S: GameState, a: EnergyAction): { ok: boolean; msg: string } {
  const E = S.energy;
  if (!E) return { ok: false, msg: 'Module énergie indisponible' };
  if (a.type === 'energyCancel') {
    const p = E.projects.find((x) => x.id === Number(a.id) && x.public && (x.kind === 'build' || (x.kind === 'close' && !x.applied)));
    if (!p) return { ok: false, msg: 'Projet introuvable ou déjà engagé' };
    E.projects = E.projects.filter((x) => x !== p);
    if (p.kind === 'build') {
      S.country.infra = S.country.infra.filter((i) => i.id !== p.infraId);
      notice(S, 'info', 'Projet abandonné', `${p.name} est abandonné ; les sommes engagées (${fmtB(p.paid)}) sont perdues.`);
    } else notice(S, 'info', 'Fermeture annulée', `${p.name} n'aura pas lieu.`);
    return { ok: true, msg: `Annulé : ${p.name}` };
  }
  const tech = a.tech;
  if (!BUILD_IDS.includes(tech)) return { ok: false, msg: 'Filière inconnue' };
  const mw = Math.round(Number(a.mw));
  if (!Number.isFinite(mw) || mw < 1) return { ok: false, msg: 'Puissance invalide' };
  if (mw > 10000) return { ok: false, msg: 'Puissance limitée à 10 000 MW par opération' };
  if (a.type === 'energyBuild') {
    if (tech !== 'batteries') {
      const left = Math.floor(potentialMW(S, tech) - E.fleet[tech].mw - pipelineMw(E, tech));
      if (mw > left) return { ok: false, msg: `Potentiel exploitable insuffisant : ${Math.max(0, left).toLocaleString('fr-FR')} MW disponibles au maximum pour cette filière (surfaces et ressources limitées)` };
      if (tech === 'nucleaire' && mw < 300) return { ok: false, msg: 'Un réacteur nucléaire compte au moins 300 MW' };
    }
    const q = buildQuote(S, tech, mw);
    if (q.cost > S.accounts.gdp * 0.1) return { ok: false, msg: 'Un projet ne peut dépasser 10 % du PIB' };
    const site = addSite(S, tech, mw, 'construction', S.month + q.months);
    const name = `${site.name} — ${mw} MW (projet public)`;
    E.projects.push({ id: E.projectSeq++, kind: 'build', tech, mw, start: S.month, done: S.month + q.months, cost: q.cost, paid: 0, public: true, name, infraId: site.id });
    notice(S, 'info', 'Chantier lancé', `${name} : ${fmtB(q.cost)} sur ${q.months} mois, ${Math.round(q.jobsBuild)} emplois de chantier puis ${Math.round(q.jobsOp)} emplois permanents.`);
    return { ok: true, msg: `Construction lancée : ${name}, mise en service dans ${q.months} mois` };
  }
  if (a.type === 'energyClose') {
    let infraId: number | undefined;
    let m = mw;
    if (a.infraId !== undefined) {
      const site = S.country.infra.find((i) => i.id === Number(a.infraId));
      if (!site || INFRA_TECH[site.type] !== tech || (site.status ?? 'active') !== 'active') return { ok: false, msg: 'Site introuvable ou déjà fermé' };
      infraId = site.id;
      m = site.capacity;
    }
    const have = tech === 'batteries' ? E.storage.mw : E.fleet[tech].mw;
    const scheduled = E.projects.reduce((s2, p) => s2 + (p.kind === 'close' && !p.applied && p.tech === tech ? p.mw : 0), 0);
    if (have - scheduled < 1) return { ok: false, msg: 'Aucune capacité installée (ou déjà programmée à la fermeture) dans cette filière' };
    m = Math.min(m, have - scheduled);
    const at = Number.isFinite(Number(a.atMonth)) ? Math.max(S.month, Math.round(Number(a.atMonth))) : S.month;
    if (at > S.month + 600) return { ok: false, msg: 'Échéance trop lointaine (50 ans au maximum)' };
    const q = closeQuote(S, tech, m);
    const when = at > S.month ? `en ${monthName(at, S.startYear)}` : 'immédiatement';
    const name = `Fermeture ${techName(tech)} — ${Math.round(m)} MW`;
    const p: EnergyProject = { id: E.projectSeq++, kind: 'close', tech, mw: m, start: at, done: at + q.months, cost: q.cost, paid: 0, public: true, name, infraId, applied: false };
    E.projects.push(p);
    if (at <= S.month) applyClosure(S, E, p);
    const peak = Math.max(...E.roll.map((r) => r.peak));
    const margin = firmCapacity(E, peak) / Math.max(1, peak) - 1;
    notice(S, margin < 0 ? 'warn' : 'info', 'Fermeture de centrale', `${name} ${when} : ${fmtB(q.cost)} de démantèlement et d'indemnisation sur ${q.months} mois, ${Math.round(q.jobsLost)} emplois supprimés.${margin < 0 ? ' Attention : la puissance garantie ne couvre plus la pointe de consommation.' : ''}`);
    return { ok: true, msg: `${name} : ${when}` };
  }
  return { ok: false, msg: 'Action inconnue' };
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthName = (m: number, y0: number) => `${MONTHS[m % 12]} ${y0 + Math.floor(m / 12)}`;
const fmtB = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1).replace('.', ',')} Md€` : `${(v / 1e6).toFixed(0)} M€`);

/** Bornage des paramètres de politique énergétique proposés par le client. */
export function sanitizeEnergyPolicy(input: Partial<EnergyPolicy> | undefined, current: EnergyPolicy | undefined): EnergyPolicy {
  const c = { ...DEFAULT_ENERGY_POLICY, ...(current ?? {}) };
  const i = input ?? c;
  const n = (v: unknown, a: number, b: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? clamp(x, a, b) : d; };
  return {
    autoInvest: typeof i.autoInvest === 'boolean' ? i.autoInvest : c.autoInvest,
    renewableSupport: n(i.renewableSupport, 0, 150, c.renewableSupport),
    evSubsidy: n(i.evSubsidy, 0, 15000, c.evSubsidy),
    heatPumpSubsidy: n(i.heatPumpSubsidy, 0, 20000, c.heatPumpSubsidy),
    chargingBudget: n(i.chargingBudget, 0, 5e9, c.chargingBudget),
    renovationBudget: n(i.renovationBudget, 0, 3e10, c.renovationBudget),
    gridBudget: n(i.gridBudget, 0, 2e10, c.gridBudget),
    biofuelMandate: n(i.biofuelMandate, 0, 0.5, c.biofuelMandate),
    offsets: n(i.offsets, 0, 1e8, c.offsets),
    waterBudget: n(i.waterBudget, 0, 1e10, c.waterBudget),
    zan: n(i.zan, 0, 1, c.zan),
  };
}

/** Valeurs à enregistrer dans l'historique mensuel. */
export function energyHistory(S: GameState): Record<string, number> {
  const E = S.energy;
  if (!E) return {};
  const b = E.balance;
  return {
    elecRenShare: E.elecRenShare,
    finalRenShare: E.final.renewableShare,
    elecPrice: E.retailPrice,
    wholesalePrice: b.wholesale,
    energyPrice: S.macro.energyPrice,
    elecDemand: b.demand * 12,
    elecProduction: b.production * 12,
    elecImports: b.imports * 12,
    elecExports: b.exports * 12,
    unserved: b.unserved * 12,
    shortageRisk: E.shortageRisk,
    capacityMargin: b.margin,
    finalEnergy: E.final.total,
    emissionsGross: E.emissions.territorialGross,
    emissionsNet: E.emissions.net,
    absorptions: E.emissions.absorptions,
    fossilCO2: E.emissions.fossilCO2,
    footprint: E.emissions.footprint,
    powerCO2: E.emissions.power,
    carbonIntensityElec: E.emissions.intensityElec,
    evShare: E.evShare,
  };
}

export { TECHS, TECH_IDS, STORAGE, BUILD_IDS };
