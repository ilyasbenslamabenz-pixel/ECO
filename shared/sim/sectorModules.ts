// Orchestration des moteurs sectoriels (phase 4b) : transports, industrie, agriculture, déchets.
// Appelés par engine.ts : initialisation dans createGame, pas mensuel dans tick (après economyStep), actions, historique.
import { agricultureAction, agricultureStep, DEFAULT_AGRICULTURE_POLICY, initAgriculture, sanitizeAgriculturePolicy, type AgricultureAction } from './agriculture';
import { DEFAULT_INDUSTRY_POLICY, industryAction, industryStep, initIndustry, sanitizeIndustryPolicy, type IndustryAction } from './industry';
import { DEFAULT_TRANSPORT_POLICY, initTransport, sanitizeTransportPolicy, transportAction, transportStep, type TransportAction } from './transport';
import { DEFAULT_WASTE_POLICY, initWaste, sanitizeWastePolicy, wasteAction, wasteStep, type WasteAction } from './waste';
import type { GameState, Policy } from './types';

export type SectorAction = TransportAction | IndustryAction | AgricultureAction | WasteAction;

/** Politiques sectorielles par défaut (neutres : l'état initial reste à l'équilibre). */
export function defaultSectorPolicies(): Pick<Policy, 'transport' | 'industry' | 'agriculture' | 'waste'> {
  return { transport: { ...DEFAULT_TRANSPORT_POLICY }, industry: { ...DEFAULT_INDUSTRY_POLICY }, agriculture: { ...DEFAULT_AGRICULTURE_POLICY }, waste: { ...DEFAULT_WASTE_POLICY } };
}

/** Bornes des politiques sectorielles proposées par le client. */
export function sanitizeSectorPolicies(i: Partial<Policy> | undefined, c: Partial<Policy>): Pick<Policy, 'transport' | 'industry' | 'agriculture' | 'waste'> {
  return {
    transport: sanitizeTransportPolicy(i?.transport, c.transport ?? DEFAULT_TRANSPORT_POLICY),
    industry: sanitizeIndustryPolicy(i?.industry, c.industry ?? DEFAULT_INDUSTRY_POLICY),
    agriculture: sanitizeAgriculturePolicy(i?.agriculture, c.agriculture ?? DEFAULT_AGRICULTURE_POLICY),
    waste: sanitizeWastePolicy(i?.waste, c.waste ?? DEFAULT_WASTE_POLICY),
  };
}

/** Initialise les quatre moteurs à partir de l'état calibré (aucun effet sur les comptes, hors émissions des déchets). */
export function initSectors(S: GameState, fresh = false) {
  Object.assign(S.policy, { ...defaultSectorPolicies(), ...pick(S.policy) });
  S.industry = initIndustry(S);
  S.agriculture = initAgriculture(S);
  S.transport = initTransport(S);
  S.waste = initWaste(S);
  if (fresh) S.accounts.emissions += S.waste.emissions; // les déchets s'ajoutent à l'inventaire dès l'état initial
}

function pick(P: Policy) {
  const o: Partial<Policy> = {};
  if (P.transport) o.transport = P.transport;
  if (P.industry) o.industry = P.industry;
  if (P.agriculture) o.agriculture = P.agriculture;
  if (P.waste) o.waste = P.waste;
  return o;
}

/** Pas mensuel, à appeler juste après economyStep (avant la mesure de l'inflation et la satisfaction). */
export function sectorsStep(S: GameState) {
  if (!S.industry || !S.agriculture || !S.transport || !S.waste) initSectors(S); // anciennes sauvegardes
  const P = S.policy;
  industryStep(S, P);
  agricultureStep(S, P);
  transportStep(S, P);
  wasteStep(S, P);
}

export function applySectorAction(S: GameState, a: SectorAction): { ok: boolean; msg: string } {
  if (!a || typeof a !== 'object' || typeof a.type !== 'string') return { ok: false, msg: 'Action invalide' };
  if (!S.industry || !S.agriculture || !S.transport || !S.waste) initSectors(S);
  const t = a.type;
  if (t.startsWith('transport:')) return transportAction(S, a as TransportAction);
  if (t.startsWith('industry:')) return industryAction(S, a as IndustryAction);
  if (t.startsWith('agriculture:')) return agricultureAction(S, a as AgricultureAction);
  if (t.startsWith('waste:')) return wasteAction(S, a as WasteAction);
  return { ok: false, msg: 'Action inconnue' };
}

export const SECTOR_HISTORY_KEYS = [
  'tr_car', 'tr_pt', 'tr_bike', 'tr_congestion', 'tr_travelTime', 'tr_evShare', 'tr_satisfaction', 'tr_emissions', 'tr_freightRail',
  'ind_productivity', 'ind_emissionIndex', 'ind_emissions', 'ind_production',
  'agri_production', 'agri_foodPrice', 'foodCPI', 'foodInflation', 'agri_selfSufficiency', 'agri_emissions', 'agri_soil', 'agri_biodiversity', 'agri_drought', 'agri_water',
  'waste_total', 'waste_recycling', 'waste_landfill', 'waste_emissions',
] as const;

/** Ajoute les séries sectorielles à l'historique (appelé par recordHistory). */
export function recordSectorHistory(S: GameState, push: (k: string, v: number) => void) {
  const T = S.transport, I = S.industry, G = S.agriculture, W = S.waste;
  if (!T || !I || !G || !W) return;
  push('tr_car', T.modal.voiture);
  push('tr_pt', T.modal.transportsCommuns);
  push('tr_bike', T.modal.velo);
  push('tr_congestion', T.congestion);
  push('tr_travelTime', T.travelTime);
  push('tr_evShare', T.fleet.evShare);
  push('tr_satisfaction', T.satisfaction);
  push('tr_emissions', T.emissions.total);
  push('tr_freightRail', T.freightRailShare);
  push('ind_productivity', I.productivityIndex);
  push('ind_emissionIndex', I.emissionIndex);
  push('ind_emissions', I.emissions);
  push('ind_production', I.production);
  push('agri_production', G.production);
  push('agri_foodPrice', G.foodPrice);
  push('foodCPI', S.macro.priceLevel * G.foodPrice);
  push('foodInflation', G.foodInflation);
  push('agri_selfSufficiency', G.selfSufficiency);
  push('agri_emissions', G.emissions.total);
  push('agri_soil', G.soilHealth);
  push('agri_biodiversity', G.biodiversity);
  push('agri_drought', G.drought);
  push('agri_water', G.waterM3);
  push('waste_total', W.household + W.industrial);
  push('waste_recycling', W.recyclingRate);
  push('waste_landfill', W.flows.enfouissement);
  push('waste_emissions', W.emissions);
}
