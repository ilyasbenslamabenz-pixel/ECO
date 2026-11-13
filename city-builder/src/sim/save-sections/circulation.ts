/**
 * Section de sauvegarde versionnée du module « Circulation » — propriété de la branche p2a-circulation.
 * Écrite sous `save.plugins.circulation = { v, data, rng }` par l'hôte des modules (src/sim/plugins/host.ts).
 *
 * Contenu v1 : état des carrefours à feux (phase, étape, chronomètre, par identifiant de nœud) et réglages
 * du joueur (réacheminement, affichage de la carte de congestion). Les véhicules ne sont PAS sauvegardés :
 * ce sont des déplacements en cours, régénérés par la demande ; les feux, eux, se retrouvent à l'identique.
 *
 * Règles : toute modification du format incrémente `CIRCULATION_SAVE_VERSION` et ajoute une étape à
 * `migrateCirculation` (v -> v+1), avec un test dans tests/circulation/ (sauvegarde de l'ancienne version -> chargée).
 * `migrateCirculation` LÈVE une erreur si les données sont inutilisables : l'hôte attrape, notifie le joueur,
 * conserve la section d'origine et charge le reste de la partie.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { runMigrations, type SaveSectionSpec } from './types';

export const CIRCULATION_SAVE_VERSION = 1;

/** Feu d'un carrefour : identifiant du nœud, phase courante, étape (0 vert, 1 orange, 2 rouge intégral), chronomètre (s). */
export interface SignalSave {
  n: number;
  p: number;
  st: number;
  t: number;
}

/** Format courant (v1). */
export interface CirculationSaveV1 {
  /** Carrefours à feux (omis quand il n'y en a aucun). */
  feux?: SignalSave[];
  /** Réacheminement selon la congestion (défaut vrai). */
  reroute?: boolean;
  /** Carte de congestion affichée (défaut faux). */
  overlay?: boolean;
}
export type CirculationSave = CirculationSaveV1;

export function emptyCirculationSave(): CirculationSave {
  return { feux: [], reroute: true, overlay: false };
}

/** Relit une section (quelle que soit sa provenance) en valeurs sûres : jamais d'exception sur un champ exotique. */
export function readCirculationSave(d: CirculationSave): Required<CirculationSave> {
  const raw = Array.isArray(d.feux) ? d.feux : [];
  const feux: SignalSave[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const n = Number((f as SignalSave).n), p = Number((f as SignalSave).p);
    const st = Number((f as SignalSave).st), t = Number((f as SignalSave).t);
    if (!Number.isFinite(n) || !Number.isFinite(p) || !Number.isFinite(st) || !Number.isFinite(t)) continue;
    feux.push({ n: n | 0, p: Math.max(0, p | 0), st: Math.min(2, Math.max(0, st | 0)), t: Math.max(0, t) });
  }
  return { feux, reroute: d.reroute !== false, overlay: d.overlay === true };
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
