/**
 * Section de sauvegarde versionnée (facultative) du module « Ressources » (zones spécialisées : forêt, agricole,
 * mixte). Format, version et migrations : src/sim/ressources/save.ts ; ce fichier les déclare comme section.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { RESSOURCES_SAVE_VERSION, emptyRessourcesSave, migrateRessources, type RessourcesSave } from '../ressources/save';
import type { SaveSectionSpec } from './types';

export { RESSOURCES_SAVE_VERSION, emptyRessourcesSave, migrateRessources, type RessourcesSave, type RessourcesSaveV1 } from '../ressources/save';

export const ressourcesSaveSection: SaveSectionSpec<RessourcesSave> = {
  id: 'ressources', version: RESSOURCES_SAVE_VERSION, empty: emptyRessourcesSave, migrate: migrateRessources,
};
