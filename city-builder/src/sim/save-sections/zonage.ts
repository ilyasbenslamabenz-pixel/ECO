/**
 * Section de sauvegarde versionnée du module « Zonage » (phase 2B). Format, version et migrations :
 * src/sim/zoning/save.ts ; ce fichier les déclare comme section (`SAVE_SECTIONS`).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ZONAGE_SAVE_VERSION, emptyZonageSave, migrateZonage, type ZonageSave } from '../zoning/save';
import type { SaveSectionSpec } from './types';

export { ZONAGE_SAVE_VERSION, emptyZonageSave, migrateZonage, type ZonageSave, type ZonageSaveV1 } from '../zoning/save';

export const zonageSaveSection: SaveSectionSpec<ZonageSave> = {
  id: 'zonage', version: ZONAGE_SAVE_VERSION, empty: emptyZonageSave, migrate: migrateZonage,
};
