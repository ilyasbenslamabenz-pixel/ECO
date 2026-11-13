/**
 * Section de sauvegarde versionnée du module « Eau et assainissement » (phase 2B.5) : enregistrement dans
 * SAVE_SECTIONS. Format, version et migrations : src/sim/water-network/save.ts.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { EAU_SAVE_VERSION, emptyEauSave, migrateEau, type EauSave } from '../water-network/save';
import type { SaveSectionSpec } from './types';

export { EAU_SAVE_VERSION, emptyEauSave, migrateEau, type EauSave, type EauSaveV1 } from '../water-network/save';

export const eauSaveSection: SaveSectionSpec<EauSave> = {
  id: 'eau', version: EAU_SAVE_VERSION, empty: emptyEauSave, migrate: migrateEau,
};
