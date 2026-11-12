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
import { TAX_SECTORS, type Forecast, type Loan, type LoanOffer, type MonthRecord, type TaxSector } from './economy';
import type { Season } from './clock';

export interface SimNotice {
  /** Minute de jeu de l'événement. */
  minute: number;
  level: 'info' | 'warn' | 'danger';
  message: string;
}

export interface EconomyReport {
  money: number;
  taxRates: Record<TaxSector, number>;
  forecast: Forecast;
  loans: Loan[];
  debt: number;
  loanCapacity: number;
  currentLoanRate: number;
  monthsInDeficit: number;
  bankrupt: boolean;
  /** Derniers mois clos (24 dans le rapport périodique, tout l'historique via getReport). */
  history: MonthRecord[];
}

export interface TrafficReport {
  vehicles: number;
  meanSpeedKmh: number;
  arrived: number;
  connectedBuildings: number;
  tripsFromCitizens: number;
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
}

export type ExtCommandName = keyof ExtCommandMap;
export type ExtCommandArgs<K extends ExtCommandName> = ExtCommandMap[K]['args'];
export type ExtCommandResult<K extends ExtCommandName> = ExtCommandMap[K]['result'];
export type ExtCommandMessage = { [K in ExtCommandName]: { kind: 'cmd'; reqId: number; name: K; args: ExtCommandArgs<K> } }[ExtCommandName];

/** Delta enrichi : `report` présent environ une fois par seconde. */
export type DeltaMessageExt = DeltaMessage & { report?: SimReport };

export const EXT_COMMANDS: readonly ExtCommandName[] = ['setTaxRate', 'loanOffer', 'takeLoan', 'repayLoan', 'getReport', 'inspectBuilding', 'inspectCitizen', 'setFocus', 'settle'];

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
  }
}
