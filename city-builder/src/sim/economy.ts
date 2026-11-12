/**
 * Économie (phase 1 : budget réel = coûts de construction + entretien mensuel prélevé).
 * Recettes fiscales, demande RCI et budget détaillé : phase 2 (voir FEATURES.md).
 * TypeScript pur.
 */
import { ROAD_TYPES, type RoadTypeId } from '../shared/contracts';

export const DEMOLISH_REFUND_RATE = 0.25;

export class Economy {
  money = 0;
  /** Entretien mensuel courant (bâtiments + routes), recalculé incrémentalement. */
  monthlyUpkeep = 0;
  /** Recettes mensuelles (phase 2 : impôts). Toujours 0 en phase 1. */
  monthlyIncome = 0;

  canAfford(cost: number): boolean { return this.money >= cost; }
  spend(cost: number): void { this.money -= cost; }
  refund(amount: number): void { this.money += amount; }

  addUpkeep(v: number): void { this.monthlyUpkeep += v; }
  removeUpkeep(v: number): void { this.monthlyUpkeep = Math.max(0, this.monthlyUpkeep - v); }

  /** Appelé à chaque changement de mois. */
  onMonth(): void { this.money += this.monthlyIncome - this.monthlyUpkeep; }

  get monthlyBalance(): number { return this.monthlyIncome - this.monthlyUpkeep; }
}

export function roadCost(type: RoadTypeId, length: number): number {
  return Math.round(ROAD_TYPES[type].costPerMeter * length);
}

export function roadUpkeep(type: RoadTypeId, length: number): number {
  return ROAD_TYPES[type].upkeepPerMeterMonth * length;
}
