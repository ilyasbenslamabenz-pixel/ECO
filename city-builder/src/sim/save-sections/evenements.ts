/** Section de sauvegarde du module « evenements ». Format : src/sim/plugins/evenements.ts. */
import { EVENEMENTS_SAVE_VERSION, emptyEvenementsSave, migrateEvenements, type EvenementsSave } from '../plugins/evenements';
import type { SaveSectionSpec } from './types';

export const evenementsSaveSection: SaveSectionSpec<EvenementsSave> = {
  id: 'evenements', version: EVENEMENTS_SAVE_VERSION, empty: emptyEvenementsSave, migrate: migrateEvenements,
};
