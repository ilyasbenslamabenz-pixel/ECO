/**
 * Section de sauvegarde versionnée du contrat municipal (phase 2B, sous-étape 1) — propriété de la branche
 * p2b-municipal. Le format, la version et les migrations sont dans src/sim/municipal/save.ts ; ce fichier
 * les déclare comme section (`SAVE_SECTIONS`, ligne d'enregistrement demandée dans docs/requests/municipal.md).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { emptyMunicipalSave, migrateMunicipal, MUNICIPAL_SAVE_VERSION, type MunicipalSave } from '../municipal/save';
import type { SaveSectionSpec } from './types';

export { emptyMunicipalSave, migrateMunicipal, MUNICIPAL_SAVE_VERSION, type MunicipalSave, type MunicipalSaveV1 } from '../municipal/save';

export const municipalSaveSection: SaveSectionSpec<MunicipalSave> = {
  id: 'municipal', version: MUNICIPAL_SAVE_VERSION, empty: emptyMunicipalSave, migrate: migrateMunicipal,
};
