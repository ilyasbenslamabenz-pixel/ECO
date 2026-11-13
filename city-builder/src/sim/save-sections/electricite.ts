/**
 * Section de sauvegarde versionnée du module « Électricité » (phase 2B, sous-étape 4) — propriété de la branche
 * p2b-electricite. Format, version et migrations : src/sim/power/save.ts ; ce fichier les déclare comme section
 * (`SAVE_SECTIONS`).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ELECTRICITE_SAVE_VERSION, emptyElectriciteSave, migrateElectricite, type ElectriciteSave } from '../power/save';
import type { SaveSectionSpec } from './types';

export { ELECTRICITE_SAVE_VERSION, emptyElectriciteSave, migrateElectricite, checkPowerState, type ElectriciteSave, type ElectriciteSaveV1 } from '../power/save';

export const electriciteSaveSection: SaveSectionSpec<ElectriciteSave> = {
  id: 'electricite', version: ELECTRICITE_SAVE_VERSION, empty: emptyElectriciteSave, migrate: migrateElectricite,
};
