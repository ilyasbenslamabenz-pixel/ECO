/** Section de sauvegarde du module « developpement » (arbres de développement). Format : src/sim/plugins/developpement.ts. */
import { DEVELOPPEMENT_SAVE_VERSION, emptyDeveloppementSave, migrateDeveloppement, type DeveloppementSave } from '../plugins/developpement';
import type { SaveSectionSpec } from './types';

export const developpementSaveSection: SaveSectionSpec<DeveloppementSave> = {
  id: 'developpement', version: DEVELOPPEMENT_SAVE_VERSION, empty: emptyDeveloppementSave, migrate: migrateDeveloppement,
};
