/**
 * Section de sauvegarde versionnée du module « Piétons » — propriété de la branche p2a-pietons.
 * Écrite sous `save.plugins.pietons = { v, data, rng }` par l'hôte des modules (src/sim/plugins/host.ts).
 *
 * Règles : toute modification du format incrémente `PIETONS_SAVE_VERSION` et ajoute une étape à
 * `migratePietons` (v -> v+1), avec un test dans tests/pietons/ (sauvegarde de l'ancienne version -> chargée).
 * `migratePietons` LÈVE une erreur si les données sont inutilisables : l'hôte attrape, notifie le joueur,
 * conserve la section d'origine et charge le reste de la partie.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { runMigrations, type SaveSectionSpec } from './types';

export const PIETONS_SAVE_VERSION = 1;

/** Format courant (v1 : gabarit vide, à compléter par le module). */
export interface PietonsSaveV1 {
  // Exemple : chantiers: { buildingId: number; phase: number; progress: number }[];
}
export type PietonsSave = PietonsSaveV1;

export function emptyPietonsSave(): PietonsSave {
  return {};
}

/** Étapes de migration : STEPS[v] transforme des données v en v+1. */
const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (d) => ({ ...d, nouveauChamp: [] }),
};

/** Migre des données écrites en version `fromVersion` vers le format courant (lève si impossible). */
export function migratePietons(data: unknown, fromVersion: number): PietonsSave {
  return runMigrations(data, fromVersion, PIETONS_SAVE_VERSION, STEPS, 'pietons') as PietonsSave;
}

export const pietonsSaveSection: SaveSectionSpec<PietonsSave> = {
  id: 'pietons', version: PIETONS_SAVE_VERSION, empty: emptyPietonsSave, migrate: migratePietons,
};
