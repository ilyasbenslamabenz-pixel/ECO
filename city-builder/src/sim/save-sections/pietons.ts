/**
 * Section de sauvegarde versionnée du module « Piétons » — propriété de la branche p2a-pietons.
 * Écrite sous `save.plugins.pietons = { v, data, rng }` par l'hôte des modules (src/sim/plugins/host.ts).
 *
 * Règles : toute modification du format incrémente `PIETONS_SAVE_VERSION` et ajoute une étape à
 * `PIETONS_MIGRATIONS` (v -> v+1), avec un test dans tests/pietons/ (sauvegarde de l'ancienne version -> chargée).
 * `migratePietons` LÈVE une erreur si les données sont inutilisables : l'hôte attrape, notifie le joueur,
 * conserve la section d'origine et charge le reste de la partie.
 *
 * Format, historique (v1 gabarit vide, v2 marcheurs + trajets) et migrations : src/sim/pedestrians/save.ts
 * (réexporté ici ; voir l'en-tête de ce fichier pour la raison de cet emplacement).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { PIETONS_MIGRATIONS, PIETONS_SAVE_VERSION, emptyPietonsSave, migratePietons, type PietonsSave } from '../pedestrians/save';
import { runMigrations, type SaveSectionSpec } from './types';

export { PIETONS_MIGRATIONS, PIETONS_SAVE_VERSION, emptyPietonsSave, migratePietons };
export type { PietonsMarcheursV2, PietonsSave, PietonsSaveV1, PietonsSaveV2 } from '../pedestrians/save';

export const pietonsSaveSection: SaveSectionSpec<PietonsSave> = {
  id: 'pietons',
  version: PIETONS_SAVE_VERSION,
  empty: emptyPietonsSave,
  // Moteur de migration commun (vérifications de version), puis étapes et validation du module.
  migrate: (data, fromVersion) => migratePietons(runMigrations(data, fromVersion, PIETONS_SAVE_VERSION, PIETONS_MIGRATIONS, 'pietons'), PIETONS_SAVE_VERSION),
};
