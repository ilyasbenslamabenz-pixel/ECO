/** Section de sauvegarde du module « historique ». Format : src/shared/protocol-ext/historique.ts. */
import { emptyHistoriqueSave, HISTORIQUE_SAVE_VERSION, migrateHistorique } from '../plugins/historique';
import type { HistoriqueState } from '../../shared/protocol-ext/historique';
import type { SaveSectionSpec } from './types';

export const historiqueSaveSection: SaveSectionSpec<HistoriqueState> = {
  id: 'historique', version: HISTORIQUE_SAVE_VERSION, empty: emptyHistoriqueSave, migrate: migrateHistorique,
};
