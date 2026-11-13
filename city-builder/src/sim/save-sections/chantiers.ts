/**
 * Section de sauvegarde versionnée du module « Chantiers » — propriété de la branche p2a-chantiers.
 * Écrite sous `save.plugins.chantiers = { v, data, rng }` par l'hôte des modules (src/sim/plugins/host.ts).
 *
 * Règles : toute modification du format incrémente `CHANTIERS_SAVE_VERSION` et ajoute une étape à
 * `migrateChantiers` (v -> v+1), avec un test dans tests/chantiers/ (sauvegarde de l'ancienne version -> chargée).
 * `migrateChantiers` LÈVE une erreur si les données sont inutilisables : l'hôte attrape, notifie le joueur,
 * conserve la section d'origine et charge le reste de la partie.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { runMigrations, type SaveSectionSpec } from './types';

export const CHANTIERS_SAVE_VERSION = 1;

/** Format courant (v1 : gabarit vide, à compléter par le module). */
export interface ChantiersSaveV1 {
  // Exemple : chantiers: { buildingId: number; phase: number; progress: number }[];
}
export type ChantiersSave = ChantiersSaveV1;

export function emptyChantiersSave(): ChantiersSave {
  return {};
}

/** Étapes de migration : STEPS[v] transforme des données v en v+1. */
const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (d) => ({ ...d, nouveauChamp: [] }),
};

/** Migre des données écrites en version `fromVersion` vers le format courant (lève si impossible). */
export function migrateChantiers(data: unknown, fromVersion: number): ChantiersSave {
  return runMigrations(data, fromVersion, CHANTIERS_SAVE_VERSION, STEPS, 'chantiers') as ChantiersSave;
}

export const chantiersSaveSection: SaveSectionSpec<ChantiersSave> = {
  id: 'chantiers', version: CHANTIERS_SAVE_VERSION, empty: emptyChantiersSave, migrate: migrateChantiers,
};
