/** Section de sauvegarde du module « ameliorations ». Format : src/sim/plugins/ameliorations.ts. */
import { AMELIORATIONS_SAVE_VERSION, emptyAmeliorationsSave, migrateAmeliorations, type AmeliorationsSave } from '../plugins/ameliorations';
import type { SaveSectionSpec } from './types';

export const ameliorationsSaveSection: SaveSectionSpec<AmeliorationsSave> = {
  id: 'ameliorations', version: AMELIORATIONS_SAVE_VERSION, empty: emptyAmeliorationsSave, migrate: migrateAmeliorations,
};
