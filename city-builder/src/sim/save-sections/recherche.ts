/** Section de sauvegarde du module « recherche » (phase 2C). Format : src/sim/plugins/recherche.ts. */
import { RECHERCHE_SAVE_VERSION, emptyRechercheSave, migrateRecherche, type RechercheSave } from '../plugins/recherche';
import type { SaveSectionSpec } from './types';

export const rechercheSaveSection: SaveSectionSpec<RechercheSave> = {
  id: 'recherche', version: RECHERCHE_SAVE_VERSION, empty: emptyRechercheSave, migrate: migrateRecherche,
};
