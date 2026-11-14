/** Section de sauvegarde du module « politiques » (phase 2C). Format : src/sim/plugins/politiques.ts. */
import { POLITIQUES_SAVE_VERSION, emptyPolitiquesSave, migratePolitiques, type PolitiquesSave } from '../plugins/politiques';
import type { SaveSectionSpec } from './types';

export const politiquesSaveSection: SaveSectionSpec<PolitiquesSave> = {
  id: 'politiques', version: POLITIQUES_SAVE_VERSION, empty: emptyPolitiquesSave, migrate: migratePolitiques,
};
