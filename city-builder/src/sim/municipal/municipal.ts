/**
 * Façade du contrat municipal : regroupe grilles d'indicateurs, réseaux, budget, registre d'effets et
 * ordonnanceur multi-fréquence d'une partie. L'objet est STABLE pendant toute la session (publié une fois
 * comme service `municipal`) : `reset` / `load` remplacent son contenu en place, les tâches enregistrées
 * par les modules sont conservées.
 *
 * Tâches intégrées (ordre 1000 = après les tâches des modules, ordre 0 par défaut) :
 *  - `municipal:propagation:<fréquence>` : diffusion des grilles et couplages de cette fréquence ;
 *  - `municipal:budget` (mois) : miroir du bilan de l'économie (si une source est branchée) puis clôture.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { FREQUENCIES, type GridGeometry } from '../../shared/municipal/types';
import { BudgetLedger, type EconomyMonthLike } from './budget';
import { EffectRegistry } from './effects';
import { geometryFor } from './grid';
import { IndicatorGrids } from './grids';
import { Networks } from './network';
import { MultiRateScheduler } from './scheduler';
import type { MunicipalSave } from './save';

/** Nom du service inter-modules (`ctx.use<Municipal>(MUNICIPAL_SERVICE)`). */
export const MUNICIPAL_SERVICE = 'municipal';
/** Résolution par défaut des grilles : 32 m (4 tuiles de 8 m) ; carte de 2 048 m = 64 × 64 cellules. */
export const DEFAULT_CELL_SIZE = 32;
export const BUILTIN_TASK_ORDER = 1000;

export class Municipal {
  grids: IndicatorGrids;
  networks: Networks;
  budget: BudgetLedger;
  effects: EffectRegistry;
  readonly scheduler = new MultiRateScheduler();
  /** Source facultative du bilan mensuel de l'économie de base (branchée par le module si le cœur l'expose). */
  economySource: (() => EconomyMonthLike | undefined) | null = null;
  /** Poids de ventilation par quartier des lignes recopiées (null = ville entière). */
  districtWeights: (() => Record<string, number> | undefined) | null = null;

  constructor(geometry: GridGeometry = { originX: 0, originZ: 0, cellSize: DEFAULT_CELL_SIZE, cols: 1, rows: 1 }) {
    this.grids = new IndicatorGrids(geometry);
    this.networks = new Networks();
    this.budget = new BudgetLedger();
    this.effects = new EffectRegistry();
    for (const f of FREQUENCIES) {
      this.scheduler.add({ id: `municipal:propagation:${f}`, every: f, order: BUILTIN_TASK_ORDER, run: () => this.grids.propagate(f) });
    }
    this.scheduler.add({
      id: 'municipal:budget', every: 'month', order: BUILTIN_TASK_ORDER + 1,
      run: (info) => {
        const rec = this.economySource?.();
        if (rec) this.budget.mirrorEconomyMonth(rec, this.districtWeights?.() ?? undefined);
        if (rec || !this.budget.isEmpty || this.budget.pendingModuleBalance() !== 0) this.budget.closeMonth(info.index - 1);
      },
    });
  }

  /** Façade couvrant un rectangle monde avec des cellules de `cellSize` m. */
  static forBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }, cellSize = DEFAULT_CELL_SIZE): Municipal {
    return new Municipal(geometryFor(bounds, cellSize));
  }

  /** Nouvelle partie : contenu vidé, géométrie par défaut changée, échéances remises à zéro (tâches conservées). */
  reset(geometry: GridGeometry): void {
    this.grids = new IndicatorGrids(geometry);
    this.networks = new Networks();
    this.budget = new BudgetLedger();
    this.effects = new EffectRegistry();
    this.scheduler.resetClock();
  }

  /** Vrai si rien n'a été défini ni enregistré (aucune section de sauvegarde, aucun delta). */
  get isEmpty(): boolean {
    return this.grids.count === 0 && this.networks.count === 0 && this.budget.isEmpty && this.effects.isEmpty;
  }

  /** Somme des versions (détection de changement pour les deltas). */
  contentVersion(): number {
    let v = this.grids.version + this.budget.version + this.effects.version + this.networks.count;
    for (const id of this.grids.ids()) v += this.grids.get(id)!.version;
    for (const k of this.networks.kinds()) v += this.networks.get(k)!.version;
    return v;
  }

  toJSON(): MunicipalSave {
    return {
      grids: this.grids.toJSON(),
      networks: this.networks.toJSON(),
      budget: this.budget.toJSON(),
      effects: this.effects.toJSON(),
      scheduler: this.scheduler.toJSON(),
    };
  }

  /** Remplace le contenu par une sauvegarde (format courant, déjà migré). Lève si les données sont incohérentes. */
  load(s: MunicipalSave): void {
    const grids = IndicatorGrids.fromJSON(s.grids);
    const networks = Networks.fromJSON(s.networks);
    const budget = BudgetLedger.fromJSON(s.budget);
    const effects = EffectRegistry.fromJSON(s.effects);
    this.grids = grids; this.networks = networks; this.budget = budget; this.effects = effects;
    this.scheduler.fromJSON(s.scheduler);
  }
}
