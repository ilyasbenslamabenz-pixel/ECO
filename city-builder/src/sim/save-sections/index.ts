/**
 * Registre des sections de sauvegarde des modules de phase 2 (une ligne par module).
 * Fichier COMMUN (superviseur) : chaque branche ne modifie que `./<module>.ts`.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { batimentsSaveSection } from './batiments';
import { chantiersSaveSection } from './chantiers';
import { circulationSaveSection } from './circulation';
import { electriciteSaveSection } from './electricite';
import { pietonsSaveSection } from './pietons';
import { municipalSaveSection } from './municipal';
import { dechetsSaveSection } from './dechets';
import { hubsSaveSection } from './hubs';
import { eauSaveSection } from './eau';
import type { SaveSectionSpec } from './types';

export type { SaveSectionSpec } from './types';
export { runMigrations } from './types';

export const SAVE_SECTIONS: readonly SaveSectionSpec<unknown>[] = [
  batimentsSaveSection,
  circulationSaveSection,
  pietonsSaveSection,
  chantiersSaveSection,
  municipalSaveSection,
  electriciteSaveSection,
  dechetsSaveSection,
  hubsSaveSection,
  eauSaveSection,
];
