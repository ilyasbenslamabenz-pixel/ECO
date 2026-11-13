/**
 * Section de sauvegarde versionnée du module « Circulation » — propriété de la branche p2a-circulation.
 * Écrite sous `save.plugins.circulation = { v, data, rng }` par l'hôte des modules (src/sim/plugins/host.ts).
 *
 * Règles : toute modification du format incrémente `CIRCULATION_SAVE_VERSION` et ajoute une étape à
 * `migrateCirculation` (v -> v+1), avec un test dans tests/circulation/ (sauvegarde de l'ancienne version -> chargée).
 * `migrateCirculation` LÈVE une erreur si les données sont inutilisables : l'hôte attrape, notifie le joueur,
 * conserve la section d'origine et charge le reste de la partie.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { runMigrations, type SaveSectionSpec } from './types';

export const CIRCULATION_SAVE_VERSION = 1;

/** Format courant (v1 : gabarit vide, à compléter par le module). */
export interface CirculationSaveV1 {
  // Exemple : chantiers: { buildingId: number; phase: number; progress: number }[];
}
export type CirculationSave = CirculationSaveV1;

export function emptyCirculationSave(): CirculationSave {
  return {};
}

/** Étapes de migration : STEPS[v] transforme des données v en v+1. */
const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (d) => ({ ...d, nouveauChamp: [] }),
};

/** Migre des données écrites en version `fromVersion` vers le format courant (lève si impossible). */
export function migrateCirculation(data: unknown, fromVersion: number): CirculationSave {
  return runMigrations(data, fromVersion, CIRCULATION_SAVE_VERSION, STEPS, 'circulation') as CirculationSave;
}

export const circulationSaveSection: SaveSectionSpec<CirculationSave> = {
  id: 'circulation', version: CIRCULATION_SAVE_VERSION, empty: emptyCirculationSave, migrate: migrateCirculation,
};
