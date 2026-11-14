/**
 * Zonage — section de sauvegarde versionnée (`save.plugins.zonage`).
 *
 * Version 1 :
 *   grid     : géométrie de la grille + zones encodées en plages [code, longueur, …] (codes 0..6) ;
 *   owned    : bâtiments nés du zonage [[id, code de zone, niveau, minute de naissance], …] ;
 *   demand   : demande lissée R/C/B/I ; settings : croissance active ; tuning : réglages modifiés (écarts seuls) ;
 *   counters : totaux (bâtiments poussés, densifiés).
 * Les sauvegardes antérieures au zonage n'ont pas de section : le module démarre vide (aucune zone).
 * Migration : `migrateZonage(data, version)` — chaîne d'étapes `STEPS[v]` (v -> v+1), aucune pour l'instant.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
// Chemin écrit depuis la racine de src/sim (garde-fou d'architecture sur les imports « ../save… », voir chantiers).
import { runMigrations } from '../../sim/save-sections/types';
import { ZONE_COUNT, type ZonageDemand, type ZoneGridInfo } from '../../shared/protocol-ext/zonage';

export const ZONAGE_SAVE_VERSION = 1;

export interface ZonageSaveV1 {
  grid: (ZoneGridInfo & { rle: number[] }) | null;
  owned: [number, number, number, number][];
  demand: ZonageDemand;
  settings: { growth: boolean };
  tuning: Record<string, number>;
  counters: { grown: number; densified: number };
}
export type ZonageSave = ZonageSaveV1;

export function emptyZonageSave(): ZonageSave {
  return { grid: null, owned: [], demand: { R: 0, C: 0, B: 0, I: 0 }, settings: { growth: true }, tuning: {}, counters: { grown: 0, densified: 0 } };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const int = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v);

/** Étapes de migration v -> v+1 (aucune : la version 1 est la première). */
const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

/** Données écrites en `fromVersion` -> format courant, vérifiées. Lève si elles sont inutilisables. */
export function migrateZonage(data: unknown, fromVersion: number): ZonageSave {
  const d = runMigrations(data, fromVersion, ZONAGE_SAVE_VERSION, STEPS, 'zonage');
  const out = emptyZonageSave();
  if (d.grid !== null && d.grid !== undefined) {
    const g = d.grid;
    if (!isObj(g) || !int(g.w) || !int(g.h) || (g.w as number) < 1 || (g.h as number) < 1 || !Array.isArray(g.rle)) throw new Error('section zonage : grille invalide');
    if (!g.rle.every((v) => int(v) && (v as number) >= 0)) throw new Error('section zonage : plages invalides');
    for (let p = 0; p < g.rle.length; p += 2) if ((g.rle[p] as number) > ZONE_COUNT) throw new Error(`section zonage : code de zone ${String(g.rle[p])} inconnu`);
    out.grid = { originX: fin(g.originX), originZ: fin(g.originZ), cell: fin(g.cell, 8), w: g.w as number, h: g.h as number, rle: g.rle as number[] };
  }
  if (Array.isArray(d.owned)) {
    for (const o of d.owned) {
      if (Array.isArray(o) && o.length >= 3 && int(o[0]) && int(o[1]) && (o[1] as number) >= 1 && (o[1] as number) <= ZONE_COUNT && int(o[2])) {
        out.owned.push([o[0] as number, o[1] as number, o[2] as number, fin(o[3])]);
      }
    }
  }
  if (isObj(d.demand)) for (const k of ['R', 'C', 'B', 'I'] as const) out.demand[k] = Math.max(-1, Math.min(1, fin(d.demand[k])));
  if (isObj(d.settings) && typeof d.settings.growth === 'boolean') out.settings.growth = d.settings.growth;
  if (isObj(d.tuning)) for (const [k, v] of Object.entries(d.tuning)) if (typeof v === 'number' && Number.isFinite(v)) out.tuning[k] = v;
  if (isObj(d.counters)) out.counters = { grown: Math.max(0, fin(d.counters.grown)), densified: Math.max(0, fin(d.counters.densified)) };
  return out;
}
