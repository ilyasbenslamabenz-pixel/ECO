/**
 * Section de sauvegarde versionnée du module « Déchets » (phase 2B.6) — propriété de la branche p2b-dechets.
 * Le format, la version et les migrations sont dans src/sim/waste/save.ts (garde-fou d'architecture : pas
 * d'import `../save*` depuis src/sim/plugins) ; ce fichier les déclare comme section (`SAVE_SECTIONS`).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { DECHETS_SAVE_VERSION, emptyDechetsSave, migrateDechets, type DechetsSave } from '../waste/save';
import type { SaveSectionSpec } from './types';

export { DECHETS_SAVE_VERSION, emptyDechetsSave, migrateDechets, type DechetsSave, type DechetsSaveV1 } from '../waste/save';

export const dechetsSaveSection: SaveSectionSpec<DechetsSave> = {
  id: 'dechets', version: DECHETS_SAVE_VERSION, empty: emptyDechetsSave, migrate: migrateDechets,
};
