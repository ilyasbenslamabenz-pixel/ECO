/**
 * Section de sauvegarde versionnée du module « Bâtiments & quartiers » — propriété de la branche p2a-batiments.
 * Écrite sous `save.plugins.batiments = { v, data, rng }` par l'hôte des modules (src/sim/plugins/host.ts).
 *
 * Règles : toute modification du format incrémente `BATIMENTS_SAVE_VERSION` et ajoute une étape à
 * `migrateBatiments` (v -> v+1), avec un test dans tests/batiments/ (sauvegarde de l'ancienne version -> chargée).
 * `migrateBatiments` LÈVE une erreur si les données sont inutilisables : l'hôte attrape, notifie le joueur,
 * conserve la section d'origine et charge le reste de la partie.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { runMigrations, type SaveSectionSpec } from './types';

export const BATIMENTS_SAVE_VERSION = 1;

/** Format courant (v1 : gabarit vide, à compléter par le module). */
export interface BatimentsSaveV1 {
  // Exemple : chantiers: { buildingId: number; phase: number; progress: number }[];
}
export type BatimentsSave = BatimentsSaveV1;

export function emptyBatimentsSave(): BatimentsSave {
  return {};
}

/** Étapes de migration : STEPS[v] transforme des données v en v+1. */
const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (d) => ({ ...d, nouveauChamp: [] }),
};

/** Migre des données écrites en version `fromVersion` vers le format courant (lève si impossible). */
export function migrateBatiments(data: unknown, fromVersion: number): BatimentsSave {
  return runMigrations(data, fromVersion, BATIMENTS_SAVE_VERSION, STEPS, 'batiments') as BatimentsSave;
}

export const batimentsSaveSection: SaveSectionSpec<BatimentsSave> = {
  id: 'batiments', version: BATIMENTS_SAVE_VERSION, empty: emptyBatimentsSave, migrate: migrateBatiments,
};
