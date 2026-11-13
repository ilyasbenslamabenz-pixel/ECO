/**
 * Contrat municipal (phase 2B, sous-étape 1) — point d'entrée côté simulation. Voir docs/MUNICIPAL.md.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
export { IndicatorGrid, checkDiffusion, checkGeometry, geometryFor, type Falloff } from './grid';
export { IndicatorGrids, type Coupling, type GridJSON } from './grids';
export { ResourceNetwork, Networks, type NodeInit } from './network';
export { BudgetLedger, allocateByWeight, MIRROR_CATEGORIES, MIRROR_SERVICE, type EconomyMonthLike } from './budget';
export { EffectRegistry, type EffectQuery } from './effects';
export { MultiRateScheduler, type MunicipalTask, type TaskInfo, type TaskStats } from './scheduler';
export { Municipal, MUNICIPAL_SERVICE, DEFAULT_CELL_SIZE, BUILTIN_TASK_ORDER } from './municipal';
export { createMunicipalPlugin, municipalPlugin, type MunicipalPluginOptions } from './plugin';
export { encodeFloat32, decodeFloat32 } from './codec';
export { emptyMunicipalSave, migrateMunicipal, MUNICIPAL_SAVE_VERSION, type MunicipalSave } from './save';
