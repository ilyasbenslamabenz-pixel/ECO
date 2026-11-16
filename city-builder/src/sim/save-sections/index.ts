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
import { zonageSaveSection } from './zonage';
import { ressourcesSaveSection } from './ressources';
import { politiquesSaveSection } from './politiques';
import { rechercheSaveSection } from './recherche';
import { paliersSaveSection } from './paliers';
import { secteursSaveSection } from './secteurs';
import { ameliorationsSaveSection } from './ameliorations';
import { busSaveSection } from './bus';
import { objectifsSaveSection } from './objectifs';
import { evenementsSaveSection } from './evenements';
import { historiqueSaveSection } from './historique';
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
  zonageSaveSection,
  ressourcesSaveSection,
  politiquesSaveSection,
  rechercheSaveSection,
  paliersSaveSection,
  secteursSaveSection,
  ameliorationsSaveSection,
  busSaveSection,
  objectifsSaveSection,
  evenementsSaveSection,
  historiqueSaveSection,
];
