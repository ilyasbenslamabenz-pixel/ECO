/**
 * Ressources — section de sauvegarde versionnée (`save.plugins.ressources`), FACULTATIVE.
 *
 * Version 1 :
 *   forest   : cases de la zone forestière [index, stock × 1000, capacité × 1000, …] (index de la grille du zonage) ;
 *   cleared  : index des cases déboisées ; regrown : cases repoussées depuis le début de la partie ;
 *   bois, nourriture : bilan du dernier jour et totaux ; recette : [mois en cours, mois précédent] (CHF).
 * Les sauvegardes antérieures n'ont pas de section : le module démarre vide (stocks lus sur le terrain au premier
 * jour). Migration : `migrateRessources(data, version)` — chaîne d'étapes `STEPS[v]` (v -> v+1), aucune pour l'instant.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
// Chemin écrit depuis la racine de src/sim (garde-fou d'architecture sur les imports « ../save… », voir zonage).
import { runMigrations } from '../../sim/save-sections/types';
import type { ResourceFlow } from '../../shared/protocol-ext/ressources';

export const RESSOURCES_SAVE_VERSION = 1;

export interface RessourcesSaveV1 {
  forest: number[];
  cleared: number[];
  regrown: number;
  bois: ResourceFlow;
  nourriture: ResourceFlow;
  recette: [number, number];
}
export type RessourcesSave = RessourcesSaveV1;

const flow = (): ResourceFlow => ({ production: 0, consumption: 0, exported: 0, imported: 0, totalProduced: 0 });

export function emptyRessourcesSave(): RessourcesSave {
  return { forest: [], cleared: [], regrown: 0, bois: flow(), nourriture: flow(), recette: [0, 0] };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const nat = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;

const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

function readFlow(v: unknown): ResourceFlow {
  const f = flow();
  if (!isObj(v)) return f;
  for (const k of ['production', 'consumption', 'exported', 'imported', 'totalProduced'] as const) f[k] = Math.max(0, fin(v[k]));
  return f;
}

/** Données écrites en `fromVersion` -> format courant, vérifiées. Lève si elles sont inutilisables. */
export function migrateRessources(data: unknown, fromVersion: number): RessourcesSave {
  const d = runMigrations(data, fromVersion, RESSOURCES_SAVE_VERSION, STEPS, 'ressources');
  const out = emptyRessourcesSave();
  if (d.forest !== undefined) {
    if (!Array.isArray(d.forest) || d.forest.length % 3 !== 0 || !d.forest.every(nat)) throw new Error('section ressources : forêt invalide');
    for (let p = 0; p < d.forest.length; p += 3) {
      out.forest.push(d.forest[p] as number, Math.min(1000, d.forest[p + 1] as number), Math.min(1000, d.forest[p + 2] as number));
    }
  }
  if (Array.isArray(d.cleared)) for (const v of d.cleared) if (nat(v)) out.cleared.push(v as number);
  out.regrown = Math.max(0, Math.floor(fin(d.regrown)));
  out.bois = readFlow(d.bois);
  out.nourriture = readFlow(d.nourriture);
  if (Array.isArray(d.recette)) out.recette = [fin(d.recette[0]), fin(d.recette[1])];
  return out;
}
