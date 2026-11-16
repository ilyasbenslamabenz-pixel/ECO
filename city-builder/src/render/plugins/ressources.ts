/**
 * Module de RENDU « Ressources » (zones spécialisées) — aucun nouvel asset :
 *  - les bâtiments nés des zones forêt / agricole / mixte (modèles existants) reçoivent une TEINTE légère
 *    (`SPECIAL_TINTS`, via `buildings.setBuildingTint`) ;
 *  - les cases de forêt DÉBOISÉES par les exploitations perdent leurs arbres (`vegetation.removeInFootprint`).
 *    La repousse se voit au rechargement de la partie (la végétation est resemée depuis le terrain, puis les cases
 *    encore déboisées sont dégagées) : la végétation n'offre pas d'ajout en direct.
 * Diagnostic e2e : `window.__ressources`.
 */
import { SPECIAL_TINTS, type RessourcesDelta, type RessourcesStats } from '../../shared/protocol-ext/ressources';
import type { RenderPlugin, RenderPluginContext } from './types';

let ctxRef: RenderPluginContext | null = null;
const tinted = new Set<number>();
let lastStats: RessourcesStats | null = null;
let clearedCount = 0;

declare global {
  interface Window {
    __ressources?: { tinted(): number; cleared(): number; stats(): RessourcesStats | null };
  }
}

/** Demi-côté (m) du carré dégagé par case déboisée (case de 8 m). */
const HALF_CELL = 4;

function apply(p: RessourcesDelta | undefined): void {
  if (!p) return;
  if (p.stats) lastStats = p.stats;
  const b = ctxRef?.buildings;
  if (p.tints && b?.setBuildingTint) {
    for (let k = 0; k + 1 < p.tints.length; k += 2) {
      const rgb = SPECIAL_TINTS[p.tints[k + 1]!];
      if (!rgb) continue;
      b.setBuildingTint(p.tints[k]!, rgb);
      tinted.add(p.tints[k]!);
    }
  }
  const veg = ctxRef?.vegetation;
  if (p.cleared && veg) {
    for (let k = 0; k + 1 < p.cleared.length; k += 2) { veg.removeInFootprint(p.cleared[k]!, p.cleared[k + 1]!, HALF_CELL, HALF_CELL, 0, 0); clearedCount++; }
  }
}

export const ressourcesRenderPlugin: RenderPlugin = {
  id: 'ressources',
  init(ctx) {
    ctxRef = ctx;
    if (typeof window !== 'undefined') window.__ressources = { tinted: () => tinted.size, cleared: () => clearedCount, stats: () => lastStats };
  },
  applySnapshotExt(payload) {
    // Nouvel état complet : les anciennes teintes sont retirées, puis l'instantané est appliqué.
    const b = ctxRef?.buildings;
    if (b?.setBuildingTint) for (const id of tinted) b.setBuildingTint(id, null);
    tinted.clear();
    clearedCount = 0;
    lastStats = null;
    apply(payload as RessourcesDelta | undefined);
  },
  applyDeltaExt(payload) { apply(payload as RessourcesDelta); },
  dispose() { tinted.clear(); ctxRef = null; },
};
