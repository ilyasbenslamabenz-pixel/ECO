/**
 * Bords d'une route hors pont et hors tunnel : TALUS naturel (pente douce qui rejoint le terrain) ou MUR de
 * soutènement. Règles (les mêmes pour le nivellement de la simulation et pour le maillage du rendu) :
 *  - remblai (route au-dessus du terrain) : talus à 1 de haut pour FILL_RATIO de large ; mur si le pied du talus
 *    tomberait dans l'eau (bord de mer, berge de rivière) ou à plus de MAX_TALUS_WIDTH du bord ;
 *  - déblai (route sous le terrain) : talus à 1 pour CUT_RATIO ; mur au-delà de WALL_CUT_DEPTH de profondeur
 *    (tranchées d'accès aux tunnels, coteaux raides).
 * Le terrain évalué est le terrain NATUREL (avant nivellement) : décision indépendante de l'ordre de construction.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { derivCubic, evalCubic, type ArcTable, type Cubic } from './bezier';
import { localWaterLevel, type ProfileEnv, type RoadProfile } from './profile';
import { totalWidth, type RoadKindDef } from './types';

/** Largeur horizontale de talus par mètre de remblai (talus 1/2 : naturel, enherbé). */
export const FILL_RATIO = 2;
/** Largeur horizontale de talus par mètre de déblai (1/1,5). */
export const CUT_RATIO = 1.5;
/** Largeur maximale d'un talus (m) : au-delà, mur de soutènement. */
export const MAX_TALUS_WIDTH = 14;
/** Profondeur de déblai à partir de laquelle on construit un mur plutôt qu'un talus (m). */
export const WALL_CUT_DEPTH = 3.5;

/** Hauteur du dessus du bord (trottoir, pavés ou chaussée) au-dessus de l'axe. */
export function edgeTopY(k: RoadKindDef): number {
  return k.sidewalk > 0 ? k.curbHeight : k.surface === 'pavers' ? 0.04 : 0;
}

export type SideKind = 'flat' | 'fill' | 'cut' | 'wall-fill' | 'wall-cut';

/**
 * Traitement d'un bord : `edgeY` hauteur du bord, `ground(d)` terrain à la distance d au-delà du bord, `water(d)`
 * niveau d'eau local. Renvoie le type et la largeur du talus (0 pour un mur).
 */
export function sideTreatment(edgeY: number, ground: (d: number) => number, water: (d: number) => number): { kind: SideKind; width: number } {
  const g0 = ground(0.5);
  const dh = g0 - edgeY;
  if (Math.abs(dh) < 0.12) return { kind: 'flat', width: 0 };
  if (dh < 0) {
    // Remblai : le talus descend jusqu'à rencontrer le terrain.
    for (let d = 0.5; d <= MAX_TALUS_WIDTH; d += 0.5) {
      const g = ground(d);
      if (g < water(d) + 0.25) return { kind: 'wall-fill', width: 0 };
      if (edgeY - d / FILL_RATIO <= g) return { kind: 'fill', width: d };
    }
    return { kind: 'wall-fill', width: 0 };
  }
  if (dh > WALL_CUT_DEPTH) return { kind: 'wall-cut', width: 0 };
  for (let d = 0.5; d <= MAX_TALUS_WIDTH; d += 0.5) {
    if (edgeY + d / CUT_RATIO >= ground(d)) return { kind: 'cut', width: d };
  }
  return { kind: 'wall-cut', width: 0 };
}

/** Calcule `wallL` / `wallR` d'un profil (échantillons hors pont et hors tunnel). */
export function computeSides(p: RoadProfile, curve: Cubic, arc: ArcTable, k: RoadKindDef, env: ProfileEnv): void {
  const n = p.count;
  const wallL = new Uint8Array(n), wallR = new Uint8Array(n);
  const ht = totalWidth(k) / 2;
  const top = edgeTopY(k);
  const pt = new Float64Array(2), d = new Float64Array(2);
  for (let i = 0; i < n; i++) {
    if (p.bridge[i] || p.tunnel[i]) continue;
    const t = arc.tAt(i * p.step);
    evalCubic(curve, t, pt); derivCubic(curve, t, d);
    const l = Math.hypot(d[0]!, d[1]!) || 1;
    const nx = d[1]! / l, nz = -d[0]! / l;
    const edgeY = p.heights[i]! + top;
    for (const side of [1, -1] as const) {
      const px = (dd: number): number => pt[0]! + nx * side * (ht + dd);
      const pz = (dd: number): number => pt[1]! + nz * side * (ht + dd);
      const r = sideTreatment(edgeY, (dd) => env.heightAt(px(dd), pz(dd)), (dd) => localWaterLevel(env, px(dd), pz(dd)));
      if (r.kind === 'wall-fill' || r.kind === 'wall-cut') (side > 0 ? wallL : wallR)[i] = 1;
    }
  }
  // Trous d'un échantillon comblés (mur continu).
  for (const w of [wallL, wallR]) for (let i = 1; i < n - 1; i++) if (!w[i] && w[i - 1] && w[i + 1] && !p.bridge[i] && !p.tunnel[i]) w[i] = 1;
  p.wallL = wallL; p.wallR = wallR;
}

/** Plages de murs compactes pour les messages : triplets [côté (0 gauche, 1 droite), début, fin[. */
export function wallRuns(p: RoadProfile): number[] {
  const out: number[] = [];
  ([p.wallL, p.wallR] as const).forEach((w, side) => {
    if (!w) return;
    let start = -1;
    for (let i = 0; i <= w.length; i++) {
      const on = i < w.length && w[i] === 1;
      if (on && start < 0) start = i;
      if (!on && start >= 0) { out.push(side, start, i); start = -1; }
    }
  });
  return out;
}
