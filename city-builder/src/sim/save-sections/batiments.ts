/**
 * Section de sauvegarde versionnée du module « Bâtiments & quartiers » — propriété de la branche p2a-batiments.
 * Écrite sous `save.plugins.batiments = { v, data, rng }` par l'hôte des modules (src/sim/plugins/host.ts).
 *
 * Façade : le format et les migrations vivent dans `src/sim/districts/save.ts` (le module de simulation doit
 * pouvoir les importer sans enfreindre le garde-fou d'architecture, qui interdit `../save…` depuis src/sim).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { BATIMENTS_SAVE_VERSION, emptyBatimentsSave, migrateBatiments } from '../districts/save';
import type { SaveSectionSpec } from './types';

export { BATIMENTS_SAVE_VERSION, emptyBatimentsSave, migrateBatiments };
export type { BatimentsSave, BatimentsSaveV2, SavedDistrict, SavedProposal } from '../districts/save';

export const batimentsSaveSection: SaveSectionSpec<ReturnType<typeof emptyBatimentsSave>> = {
  id: 'batiments', version: BATIMENTS_SAVE_VERSION, empty: emptyBatimentsSave, migrate: migrateBatiments,
};
