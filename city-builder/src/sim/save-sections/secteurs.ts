/** Section de sauvegarde du module « secteurs ». Format : src/sim/plugins/secteurs.ts. */
import { SECTEURS_SAVE_VERSION, emptySecteursSave, migrateSecteurs, type SecteursSave } from '../plugins/secteurs';
import type { SaveSectionSpec } from './types';

export const secteursSaveSection: SaveSectionSpec<SecteursSave> = {
  id: 'secteurs', version: SECTEURS_SAVE_VERSION, empty: emptySecteursSave, migrate: migrateSecteurs,
};
