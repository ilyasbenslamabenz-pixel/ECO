/** Section de sauvegarde du module « paliers ». Format : src/sim/plugins/paliers.ts. */
import { PALIERS_SAVE_VERSION, emptyPaliersSave, migratePaliers, type PaliersSave } from '../plugins/paliers';
import type { SaveSectionSpec } from './types';

export const paliersSaveSection: SaveSectionSpec<PaliersSave> = {
  id: 'paliers', version: PALIERS_SAVE_VERSION, empty: emptyPaliersSave, migrate: migratePaliers,
};
