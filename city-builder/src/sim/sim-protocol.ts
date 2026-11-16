/**
 * EXTENSION du protocole main <-> worker pour l'économie, la démographie et le LOD de
 * simulation. Rétro-compatible : mêmes enveloppes que shared/protocol.ts
 * ({ kind:'cmd', reqId, name, args } -> { kind:'result', ... }), noms de commandes nouveaux.
 * En attente de fusion dans shared/protocol.ts par l'architecte (docs/requests/simulation.md) ;
 * en attendant, le thread principal peut appeler `bridge.send(name as never, args as never)`.
 * Le rapport périodique est joint au delta sous la clé facultative `report` (≈ 1 fois/s).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { CommandError, GameDate } from '../shared/contracts';
import type { DeltaMessage } from '../shared/protocol';
import type { BuildingOccupancy, CitizenInfo, DemographyReport } from './demography';
import { EDU_TAX_LEVELS, TAX_SECTORS, type Forecast, type Loan, type LoanOffer, type MonthRecord, type TaxSector } from './economy';
import type { Season } from './clock';
import type { CityBuildResult } from './city-builder';
import { editShapeError, type TerrainEdit } from './terrain/edits';

/** Réponse d'une édition du terrain (Défricher, Quai / remblai, Creuser). */
export interface TerrainEditResult {
  cost: number;
  /** Terre déplacée (m³), forêt retirée (m²), longueur de mur de quai (m). */
  volume: number;
  forestM2: number;
  wallLength: number;
  /** Contour de la zone touchée (x, z alternés, fermé) pour l'aperçu. */
  outline: number[];
  /** Niveler : hauteur cible retenue (reprise par les passes suivantes d'un même geste). */
  h?: number;
  /** Pente : hauteurs retenues aux extrémités. */
  ah?: number;
  bh?: number;
  /** Barrage : crête (m) et débit de la rivière barrée (m³/s). */
  crest?: number;
  flow?: number;
  /** Source, barrage : eau prévue en régime établi (src/sim/hydro). */
  water?: {
    /** Niveau du lac ou de la retenue (m) ; null : l'eau rejoint tout de suite une eau existante. */
    level: number | null;
    areaM2: number;
    storedM3: number;
    /** Exutoire : eau existante, bord de la carte, aucun (cuvette fermée ou retenue pleine sans débordement). */
    outlet: '' | 'eau' | 'bord';
    status: 'sink' | 'partial' | 'capped' | 'none';
    /** Barrage : hauteur de chute et débit entrant en régime établi. */
    headM?: number;
    flowM3s?: number;
  };
  /** Édition appliquée (hors dryRun) : son rang dans la liste des éditions (annulation `terrainUndo`). */
  seq?: number;
}

/** État de l'eau dynamique (commande `hydroState`). */
export interface HydroStateResult {
  sources: { id: number; x: number; z: number; q: number }[];
  dams: { id: number; level: number; tail: number; headM: number; flowM3s: number; crest: number; lengthM: number; full: boolean; x: number; z: number }[];
  /** Toutes les alimentations ont atteint leur régime établi. */
  steady: boolean;
  active: boolean;
  /** Durée du dernier calcul de l'eau (ms) et nombre de calculs depuis le début de la partie. */
  lastMs: number;
  computeCount: number;
  /** Rang de la plus ancienne édition annulable (-1 : aucune) et nombre d'éditions. */
  undoable: number;
  edits: number;
}

export interface SimNotice {
  /** Minute de jeu de l'événement. */
  minute: number;
  level: 'info' | 'warn' | 'danger';
  message: string;
}

export interface EconomyReport {
  money: number;
  taxRates: Record<TaxSector, number>;
  /**
   * Impôt résidentiel par niveau d'éducation (0 = sans diplôme … 4 = études supérieures) : taux, noms, recettes
   * mensuelles prévues et parts de l'assiette. `taxRates.residential` = taux effectif (moyenne pondérée).
   */
  eduTaxRates?: number[];
  eduTaxNames?: string[];
  eduTaxIncome?: number[];
  eduTaxShares?: number[];
  forecast: Forecast;
  loans: Loan[];
  debt: number;
  loanCapacity: number;
  currentLoanRate: number;
  monthsInDeficit: number;
  bankrupt: boolean;
  /** Derniers mois clos (24 dans le rapport périodique, tout l'historique via getReport). */
  history: MonthRecord[];
  /** Postes détaillés des services du mois en cours (`MonthRecord.serviceLines`) ; absent s'il n'y en a aucun. */
  serviceLinesMonth?: Record<string, number>;
}

export interface TrafficReport {
  vehicles: number;
  meanSpeedKmh: number;
  arrived: number;
  connectedBuildings: number;
  tripsFromCitizens: number;
  /** Trajets détaillés non admis (plafond horaire du trafic atteint, vague 4). */
  tripsCapped?: number;
}

export interface SimReport {
  date: GameDate;
  season: Season;
  weekday: number;
  dateFr: string;
  economy: EconomyReport;
  demography: DemographyReport;
  traffic: TrafficReport;
  notices: SimNotice[];
}

export interface ExtCommandMap {
  setTaxRate: { args: { sector: TaxSector; rate: number }; result: { sector: TaxSector; rate: number } };
  /** Taux résidentiel d'un niveau d'éducation (0..4) ; renvoie le taux retenu et le taux résidentiel effectif. */
  setEduTaxRate: { args: { level: number; rate: number }; result: { level: number; rate: number; residential: number; eduTaxRates: number[] } };
  loanOffer: { args: { amount: number; months: number }; result: LoanOffer };
  takeLoan: { args: { amount: number; months: number }; result: { loan: Loan; money: number } };
  repayLoan: { args: { loanId: number }; result: { paid: number; money: number } };
  getReport: { args: { fullHistory?: boolean }; result: SimReport };
  inspectBuilding: { args: { buildingId: number }; result: BuildingOccupancy };
  inspectCitizen: { args: { citizenId: number }; result: CitizenInfo };
  /** Point focal de la caméra (LOD de simulation). À envoyer quand la caméra se déplace de plus de ~50 m. */
  setFocus: { args: { x: number; z: number }; result: { detailed: number; simplified: number; statistical: number } };
  /** Peuplement accéléré (scène de démonstration) : N vagues d'immigration + recherche d'emploi immédiates. */
  settle: { args: { waves: number }; result: { population: number; households: number } };
  /**
   * Construit une ville (scène de démonstration ou test de charge) avec les opérations du joueur
   * (src/sim/city-builder.ts). Suivi d'un instantané complet.
   */
  buildCity: { args: { preset: 'demo' | 'stress'; maxBuildings?: number; settleWaves?: number; vehicles?: number }; result: CityBuildResult & { vehicles: number } };
  /**
   * Giratoire posé sur un carrefour ou une route (module routes, src/sim/roads/roundabout.ts) : `size` petit (Ø 36 m)
   * ou grand (Ø 56 m). dryRun : valide et chiffre sans construire.
   */
  buildRoundabout: { args: { x: number; z: number; size: 'small' | 'large'; dryRun?: boolean }; result: { edgeIds: number[]; cost: number } };
  /** Édition du terrain par le joueur (src/sim/terrain/edits.ts) ; `dryRun` : coût et contour sans rien modifier. */
  terrainEdit: { args: { edit: TerrainEdit; dryRun?: boolean }; result: TerrainEditResult };
  /** Annule les éditions du terrain de rang ≥ `since` (coût remboursé ; refus si un bâtiment ou une route y a été construit). */
  terrainUndo: { args: { since: number }; result: { reverted: number; refund: number } };
  /** Eau dynamique : sources, barrages (chute, débit), coût du calcul. */
  hydroState: { args: Record<string, never>; result: HydroStateResult };
  /**
   * Déplace un bâtiment existant (même identifiant : habitants, emplois et élèves conservés), gratuitement, avec les
   * contrôles de la pose (carte, collisions hors lui-même, routes, eau, pente). dryRun : valide sans déplacer.
   */
  moveBuilding: { args: { buildingId: number; x: number; z: number; rot: number; dryRun?: boolean }; result: { buildingId: number; x: number; z: number; rot: number } };
}

export type ExtCommandName = keyof ExtCommandMap;
export type ExtCommandArgs<K extends ExtCommandName> = ExtCommandMap[K]['args'];
export type ExtCommandResult<K extends ExtCommandName> = ExtCommandMap[K]['result'];
export type ExtCommandMessage = { [K in ExtCommandName]: { kind: 'cmd'; reqId: number; name: K; args: ExtCommandArgs<K> } }[ExtCommandName];

/** Delta enrichi : `report` présent environ une fois par seconde. */
export type DeltaMessageExt = DeltaMessage & { report?: SimReport };

export const EXT_COMMANDS: readonly ExtCommandName[] = ['setTaxRate', 'setEduTaxRate', 'loanOffer', 'takeLoan', 'repayLoan', 'getReport', 'inspectBuilding', 'inspectCitizen', 'setFocus', 'settle', 'buildCity', 'buildRoundabout', 'terrainEdit', 'moveBuilding', 'terrainUndo', 'hydroState'];

export function isExtCommandName(name: unknown): name is ExtCommandName {
  return typeof name === 'string' && (EXT_COMMANDS as readonly string[]).includes(name);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const bad = (message: string): CommandError => ({ code: 'INVALID_ARGS', message });

/** Validation à l'exécution d'une commande étendue (le worker ne fait pas confiance au thread principal). */
export function validateExtCommand(msg: unknown): CommandError | null {
  if (!isObj(msg) || msg.kind !== 'cmd' || !isNum(msg.reqId) || !isExtCommandName(msg.name)) return bad('Message mal formé');
  const a = msg.args;
  if (!isObj(a)) return bad('Arguments manquants');
  switch (msg.name) {
    case 'setTaxRate':
      if (typeof a.sector !== 'string' || !(TAX_SECTORS as readonly string[]).includes(a.sector)) return bad('Secteur fiscal inconnu');
      return isNum(a.rate) ? null : bad('Taux invalide');
    case 'setEduTaxRate':
      if (!isNum(a.level) || !Number.isInteger(a.level) || a.level < 0 || a.level >= EDU_TAX_LEVELS) return bad('Niveau d\'éducation inconnu');
      return isNum(a.rate) ? null : bad('Taux invalide');
    case 'loanOffer':
    case 'takeLoan':
      return isNum(a.amount) && isNum(a.months) ? null : bad('Montant ou durée invalide');
    case 'repayLoan':
      return isNum(a.loanId) ? null : bad('loanId invalide');
    case 'getReport':
      return a.fullHistory === undefined || typeof a.fullHistory === 'boolean' ? null : bad('fullHistory invalide');
    case 'inspectBuilding':
      return isNum(a.buildingId) ? null : bad('buildingId invalide');
    case 'inspectCitizen':
      return isNum(a.citizenId) ? null : bad('citizenId invalide');
    case 'setFocus':
      return isNum(a.x) && isNum(a.z) ? null : bad('Point focal invalide');
    case 'settle':
      return isNum(a.waves) && a.waves >= 1 && a.waves <= 200 ? null : bad('Nombre de vagues invalide (1..200)');
    case 'buildCity':
      if (a.preset !== 'demo' && a.preset !== 'stress') return bad('Préréglage de ville inconnu');
      if (a.maxBuildings !== undefined && (!isNum(a.maxBuildings) || a.maxBuildings < 1 || a.maxBuildings > 5000)) return bad('Nombre de bâtiments invalide (1..5000)');
      if (a.vehicles !== undefined && (!isNum(a.vehicles) || a.vehicles < 0 || a.vehicles > 5000)) return bad('Nombre de véhicules invalide (0..5000)');
      if (a.settleWaves !== undefined && (!isNum(a.settleWaves) || a.settleWaves < 0 || a.settleWaves > 200)) return bad('Nombre de vagues invalide (0..200)');
      return null;
    case 'buildRoundabout':
      if (!isNum(a.x) || !isNum(a.z)) return bad('Position de giratoire invalide');
      return a.size === 'small' || a.size === 'large' ? null : bad('Taille de giratoire inconnue');
    case 'moveBuilding':
      if (!isNum(a.buildingId) || !isNum(a.x) || !isNum(a.z) || !isNum(a.rot)) return bad('Déplacement invalide');
      return a.dryRun === undefined || typeof a.dryRun === 'boolean' ? null : bad('dryRun invalide');
    case 'terrainEdit': {
      if (a.dryRun !== undefined && typeof a.dryRun !== 'boolean') return bad('dryRun invalide');
      const e = editShapeError(a.edit);
      return e ? bad(e) : null;
    }
    case 'terrainUndo':
      return isNum(a.since) && Number.isInteger(a.since) && a.since >= 0 ? null : bad('since invalide');
    case 'hydroState':
      return null;
  }
}
