/** Section de sauvegarde du module « objectifs ». Format : src/sim/plugins/objectifs.ts. */
import { OBJECTIFS_SAVE_VERSION, emptyObjectifsSave, migrateObjectifs, type ObjectifsSave } from '../plugins/objectifs';
import type { SaveSectionSpec } from './types';

export const objectifsSaveSection: SaveSectionSpec<ObjectifsSave> = {
  id: 'objectifs', version: OBJECTIFS_SAVE_VERSION, empty: emptyObjectifsSave, migrate: migrateObjectifs,
};
