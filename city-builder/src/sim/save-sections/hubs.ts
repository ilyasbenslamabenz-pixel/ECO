/**
 * Section de sauvegarde versionnée du module « hubs » (port et aéroport) — propriété de la branche p2c-port-aeroport.
 * Format, version et migrations : src/sim/hubs/save.ts (le plugin ne peut pas importer `../save*`).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { emptyHubsSave, HUBS_SAVE_VERSION, migrateHubs, type HubsSave } from '../hubs/save';
import type { SaveSectionSpec } from './types';

export { emptyHubsSave, HUBS_SAVE_VERSION, migrateHubs, type HubsSave } from '../hubs/save';

export const hubsSaveSection: SaveSectionSpec<HubsSave> = {
  id: 'hubs', version: HUBS_SAVE_VERSION, empty: emptyHubsSave, migrate: migrateHubs,
};
