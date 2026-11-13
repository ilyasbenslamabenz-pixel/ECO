/**
 * Éditions du terrain par le joueur (simulation, TypeScript pur : ni three, ni DOM).
 *
 *  - `clear` (Défricher) : retire la forêt d'un disque (couche `forest` à 0) ; le rendu retire les arbres.
 *  - `quay`  (Quai / remblai) : le joueur trace une ligne droite le long d'une côte ou d'une berge ; l'eau située
 *    côté terre de la ligne est remblayée jusqu'à la ligne (bande de FILL_DEPTH m au plus) ; un mur de quai droit
 *    est posé sur la ligne, face à l'eau, dont le pied est approfondi. Sert aussi à combler ou dévier une rivière.
 *  - `dig`   (Creuser) : bassin ou canal rectangulaire droit (largeur `w`), mis en eau au niveau de l'eau voisine
 *    (sinon bassin isolé), berges aplanies et murs de quai là où la rive est sèche.
 *
 * Chaque édition est d'abord PLANIFIÉE (`planEdit`, sans rien modifier : coût, échantillons touchés, murs), puis
 * APPLIQUÉE (`commitEdit`). La simulation conserve la liste des éditions (sauvegarde) et les rejoue au chargement
 * sur le terrain régénéré : le résultat est identique (calcul déterministe).
 *
 * Grille de 8 m : un mur vertical ne peut pas être porté par la carte de hauteurs. La rive de part et d'autre du
 * mur est donc préparée pour le maillage du rendu : côté terre, plateforme plane sur 1,5 case (sous le quai) ;
 * côté eau, pied approfondi sur 1,5 case. Le rendu pose le mur (avec sa plateforme) exactement sur la ligne.
 */
import { clamp } from '../../shared/math';
import type { TerrainData } from '../../shared/contracts';
import { NO_WATER, type SampleRect } from './types';

export type TerrainEdit =
  | { k: 'clear'; x: number; z: number; r: number }
  | { k: 'quay'; ax: number; az: number; bx: number; bz: number }
  | { k: 'dig'; ax: number; az: number; bx: number; bz: number; w: number };

export type TerrainEditKind = TerrainEdit['k'];

/** Terrain éditable : hauteurs NATURELLES + surface d'eau + forêt (même indexation). */
export type EditableTerrain = TerrainData & { waterSurface: Float32Array; forest: Uint8Array };

export const EDIT_LIMITS = {
  minClearRadius: 4,
  maxClearRadius: 120,
  minLength: 12,
  maxLength: 800,
  /** Profondeur maximale de remblai derrière la ligne de quai (m). */
  fillDepth: 160,
  minDigWidth: 16,
  maxDigWidth: 96,
  /** Nombre maximal d'éditions conservées dans une partie. */
  maxEdits: 4000,
} as const;

/** Coûts (CHF). */
export const EDIT_COSTS = {
  /** Défrichage : par m² de forêt dense (proportionnel à la densité). */
  clearPerM2: 0.4,
  /** Minimum facturé pour un défrichage. */
  clearMin: 20,
  /** Remblai / déblai : par m³ de terre déplacée. */
  earthPerM3: 1.5,
  /** Mur de quai : par mètre. */
  wallPerM: 80,
} as const;

/** Hauteur du quai au-dessus de l'eau (m) et profondeur du pied du mur sous l'eau (m). */
export const QUAY_FREEBOARD = 1.2;
export const QUAY_FOOT_DEPTH = 5;
/** Profondeur d'un bassin creusé sous sa surface d'eau (m). */
export const DIG_DEPTH = 4;
/** Largeur (en cases) de la bande préparée de part et d'autre d'un mur. */
const BAND = 1.5;

/**
 * Mur de quai (rendu) : segment (ax,az)-(bx,bz), dessus `top`, pied `bottom`, normale (nx,nz) vers l'EAU.
 * Sérialisé à plat : QUAY_STRIDE nombres par mur.
 */
export interface QuayWall { ax: number; az: number; bx: number; bz: number; top: number; bottom: number; nx: number; nz: number }
export const QUAY_STRIDE = 8;

export interface EditPlan {
  edit: TerrainEdit;
  /** Région touchée (bornes incluses). */
  rect: SampleRect;
  /** Échantillons modifiés et leurs nouvelles valeurs. */
  idx: Int32Array;
  h: Float32Array;
  ws: Float32Array;
  /** Échantillons dont seule la forêt est retirée (défrichage) inclus dans idx ; forêt mise à 0 pour tous. */
  volume: number;
  /** Surface de forêt retirée (m², pondérée par la densité). */
  forestM2: number;
  walls: QuayWall[];
  wallLength: number;
  cost: number;
  /** Contour de la zone touchée (x, z alternés) pour l'aperçu. */
  outline: number[];
}

export type PlanOutcome = { ok: true; plan: EditPlan } | { ok: false; message: string };

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Valide la forme d'une édition reçue (commande ou sauvegarde) ; renvoie un message d'erreur ou null. */
export function editShapeError(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return 'Édition du terrain absente';
  const o = e as Record<string, unknown>;
  if (o.k === 'clear') return fin(o.x) && fin(o.z) && fin(o.r) ? null : 'Défrichage invalide';
  if (o.k === 'quay') return fin(o.ax) && fin(o.az) && fin(o.bx) && fin(o.bz) ? null : 'Tracé de quai invalide';
  if (o.k === 'dig') return fin(o.ax) && fin(o.az) && fin(o.bx) && fin(o.bz) && fin(o.w) ? null : 'Tracé de bassin invalide';
  return 'Type d\'édition du terrain inconnu';
}

/** Copie normalisée (bornes appliquées, champs superflus retirés), arrondie au cm. */
export function normalizeEdit(e: TerrainEdit): TerrainEdit {
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const L = EDIT_LIMITS;
  switch (e.k) {
    case 'clear': return { k: 'clear', x: r2(e.x), z: r2(e.z), r: r2(clamp(e.r, L.minClearRadius, L.maxClearRadius)) };
    case 'quay': return { k: 'quay', ax: r2(e.ax), az: r2(e.az), bx: r2(e.bx), bz: r2(e.bz) };
    case 'dig': return { k: 'dig', ax: r2(e.ax), az: r2(e.az), bx: r2(e.bx), bz: r2(e.bz), w: r2(clamp(e.w, L.minDigWidth, L.maxDigWidth)) };
  }
}

/** Liste d'éditions lue d'une sauvegarde ; null si mal formée. */
export function parseEdits(raw: unknown): TerrainEdit[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > EDIT_LIMITS.maxEdits) return null;
  const out: TerrainEdit[] = [];
  for (const e of raw) {
    if (editShapeError(e)) return null;
    out.push(normalizeEdit(e as TerrainEdit));
  }
  return out;
}

const wetK = (t: EditableTerrain, k: number): boolean => t.waterSurface[k]! !== NO_WATER && t.waterSurface[k]! > t.heights[k]! + 0.05;

/** Région d'échantillons d'une boîte (m), bornée à la carte ; null si vide. */
function rectFor(t: TerrainData, x0: number, z0: number, x1: number, z1: number): SampleRect | null {
  const i0 = Math.max(0, Math.floor((x0 - t.originX) / t.spacing));
  const j0 = Math.max(0, Math.floor((z0 - t.originZ) / t.spacing));
  const i1 = Math.min(t.samplesX - 1, Math.ceil((x1 - t.originX) / t.spacing));
  const j1 = Math.min(t.samplesZ - 1, Math.ceil((z1 - t.originZ) / t.spacing));
  return i0 > i1 || j0 > j1 ? null : { i0, j0, i1, j1 };
}

/** Accumulateur des changements d'un plan (dernière valeur gagnante par échantillon). */
class Changes {
  readonly map = new Map<number, { h: number; ws: number }>();
  constructor(private t: EditableTerrain) {}
  h(k: number): number { return this.map.get(k)?.h ?? this.t.heights[k]!; }
  ws(k: number): number { return this.map.get(k)?.ws ?? this.t.waterSurface[k]!; }
  set(k: number, h: number, ws: number): void { this.map.set(k, { h, ws }); }
  wet(k: number): boolean { const w = this.ws(k); return w !== NO_WATER && w > this.h(k) + 0.05; }
}

/** Vrai si l'échantillon le plus proche de (x, z) est en eau (selon l'état planifié). */
function wetNearest(t: EditableTerrain, c: Changes, x: number, z: number): boolean {
  const i = Math.round((x - t.originX) / t.spacing), j = Math.round((z - t.originZ) / t.spacing);
  if (i < 0 || j < 0 || i >= t.samplesX || j >= t.samplesZ) return false;
  return c.wet(j * t.samplesX + i);
}

/** Murs le long d'un segment : portions dont le côté « eau » (normale) est mouillé et le côté terre sec. */
function wallRuns(t: EditableTerrain, c: Changes, ax: number, az: number, bx: number, bz: number, nx: number, nz: number, top: number, bottom: number, out: QuayWall[]): number {
  const L = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(L / 2));
  // Points testés de part et d'autre : l'échantillon le plus proche tombe dans la bande préparée (1,5 case).
  let start = -1;
  let total = 0;
  const flush = (end: number): void => {
    if (start < 0) return;
    const u0 = start / steps, u1 = end / steps;
    if ((u1 - u0) * L >= 2) {
      out.push({ ax: ax + (bx - ax) * u0, az: az + (bz - az) * u0, bx: ax + (bx - ax) * u1, bz: az + (bz - az) * u1, top, bottom, nx, nz });
      total += (u1 - u0) * L;
    }
    start = -1;
  };
  for (let s = 0; s <= steps; s++) {
    const x = ax + ((bx - ax) * s) / steps, z = az + ((bz - az) * s) / steps;
    const ok = wetNearest(t, c, x + nx * t.spacing * 0.75, z + nz * t.spacing * 0.75) && !wetNearest(t, c, x - nx * t.spacing * 1.25, z - nz * t.spacing * 1.25);
    if (ok && start < 0) start = s;
    if (!ok && start >= 0) flush(s);
  }
  flush(steps);
  return total;
}

function finish(t: EditableTerrain, edit: TerrainEdit, c: Changes, forestOnly: number[], walls: QuayWall[], wallLength: number, outline: number[]): EditPlan | null {
  const keys = new Set<number>([...c.map.keys(), ...forestOnly]);
  if (keys.size === 0) return null;
  const idx = new Int32Array(keys.size);
  const h = new Float32Array(keys.size);
  const ws = new Float32Array(keys.size);
  let n = 0, volume = 0, forestM2 = 0;
  let i0 = Infinity, j0 = Infinity, i1 = -1, j1 = -1;
  const area = t.spacing * t.spacing;
  for (const k of keys) {
    idx[n] = k;
    h[n] = c.h(k);
    ws[n] = c.ws(k);
    volume += Math.abs(h[n]! - t.heights[k]!) * area;
    forestM2 += (t.forest[k]! / 255) * area;
    const i = k % t.samplesX, j = (k / t.samplesX) | 0;
    if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
    n++;
  }
  const C = EDIT_COSTS;
  const earth = volume * C.earthPerM3 + wallLength * C.wallPerM;
  const cost = Math.round(edit.k === 'clear' ? Math.max(C.clearMin, forestM2 * C.clearPerM2) : earth + forestM2 * C.clearPerM2);
  return { edit, rect: { i0, j0, i1, j1 }, idx, h, ws, volume: Math.round(volume), forestM2: Math.round(forestM2), walls, wallLength: Math.round(wallLength), cost, outline };
}

/** Planifie une édition sans rien modifier. */
export function planEdit(t: EditableTerrain, raw: TerrainEdit): PlanOutcome {
  const shape = editShapeError(raw);
  if (shape) return { ok: false, message: shape };
  const e = normalizeEdit(raw);
  const bad = (message: string): PlanOutcome => ({ ok: false, message });
  const W = t.samplesX;
  const sp = t.spacing;
  const c = new Changes(t);

  if (e.k === 'clear') {
    const rect = rectFor(t, e.x - e.r, e.z - e.r, e.x + e.r, e.z + e.r);
    if (!rect) return bad('Zone hors de la carte');
    const ks: number[] = [];
    for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
      if (Math.hypot(t.originX + i * sp - e.x, t.originZ + j * sp - e.z) <= e.r) ks.push(j * W + i);
    }
    const outline: number[] = [];
    for (let a = 0; a <= 32; a++) outline.push(e.x + Math.cos((a / 32) * Math.PI * 2) * e.r, e.z + Math.sin((a / 32) * Math.PI * 2) * e.r);
    const p = finish(t, e, c, ks, [], 0, outline);
    return p ? { ok: true, plan: p } : bad('Zone hors de la carte');
  }

  const L = Math.hypot(e.bx - e.ax, e.bz - e.az);
  if (L < EDIT_LIMITS.minLength) return bad(`Tracé trop court (${EDIT_LIMITS.minLength} m minimum)`);
  if (L > EDIT_LIMITS.maxLength) return bad(`Tracé trop long (${EDIT_LIMITS.maxLength} m maximum)`);
  const ux = (e.bx - e.ax) / L, uz = (e.bz - e.az) / L;
  const band = BAND * sp;
  /** Coordonnées locales d'un échantillon : t le long du tracé, n selon la normale (-uz, ux). */
  const local = (k: number): [number, number] => {
    const x = t.originX + (k % W) * sp - e.ax, z = t.originZ + ((k / W) | 0) * sp - e.az;
    return [x * ux + z * uz, -x * uz + z * ux];
  };
  const samplesNear = (reach: number, tExtra: number): number[] => {
    const xs = [e.ax, e.bx], zs = [e.az, e.bz];
    const m = reach + tExtra;
    const rect = rectFor(t, Math.min(...xs) - m, Math.min(...zs) - m, Math.max(...xs) + m, Math.max(...zs) + m);
    const out: number[] = [];
    if (!rect) return out;
    for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
      const k = j * W + i;
      const [lt, ln] = local(k);
      if (lt >= -tExtra && lt <= L + tExtra && Math.abs(ln) <= reach) out.push(k);
    }
    return out;
  };

  if (e.k === 'quay') {
    const D = EDIT_LIMITS.fillDepth;
    const ks = samplesNear(D, 0);
    // Côté terre : celui qui compte le plus d'échantillons secs dans la bande.
    let dryPos = 0, dryNeg = 0, wetAny = 0;
    for (const k of ks) {
      const [, ln] = local(k);
      if (wetK(t, k)) { wetAny++; continue; }
      if (ln > 0) dryPos++; else dryNeg++;
    }
    if (wetAny === 0) return bad('Aucune eau à remblayer le long de ce tracé : tracez la ligne du quai dans l\'eau, parallèle à la rive');
    const sigma = dryPos > dryNeg ? -1 : 1; // d = sigma * ln : positif côté eau
    // Surface de référence : eau remblayée ou au pied du mur.
    let ref = -Infinity;
    for (const k of ks) {
      const d = sigma * local(k)[1];
      if (d <= band && wetK(t, k)) ref = Math.max(ref, t.waterSurface[k]!);
    }
    if (!Number.isFinite(ref)) return bad('Aucune eau à remblayer de ce côté du tracé');
    const top = ref + QUAY_FREEBOARD;
    const foot = ref - QUAY_FOOT_DEPTH;
    let filled = 0, maxD = 0;
    for (const k of ks) {
      const d = sigma * local(k)[1];
      const h0 = t.heights[k]!;
      if (d > 0) {
        if (d <= band && wetK(t, k) && h0 > foot) c.set(k, foot, t.waterSurface[k]!);
      } else if (d >= -band) {
        c.set(k, top, NO_WATER);
        if (wetK(t, k)) filled++;
        maxD = Math.max(maxD, -d);
      } else if (wetK(t, k)) {
        c.set(k, top, NO_WATER);
        filled++;
        maxD = Math.max(maxD, -d);
      } else if (h0 < top && t.waterSurface[k]! !== NO_WATER) {
        // Rive basse anciennement marquée en eau (berge exondée) : mise à niveau.
        c.set(k, top, NO_WATER);
      }
    }
    if (filled === 0) return bad('Rien à remblayer : la ligne doit passer dans l\'eau, devant la rive');
    const walls: QuayWall[] = [];
    const nx = -uz * sigma, nz = ux * sigma;
    const wl = wallRuns(t, c, e.ax, e.az, e.bx, e.bz, nx, nz, top, foot, walls);
    const dd = Math.max(maxD, band);
    const outline = [e.ax, e.az, e.bx, e.bz, e.bx - nx * dd, e.bz - nz * dd, e.ax - nx * dd, e.az - nz * dd, e.ax, e.az];
    const p = finish(t, e, c, [], walls, wl, outline);
    return p ? { ok: true, plan: p } : bad('Rien à remblayer');
  }

  // Bassin / canal.
  const hw = e.w / 2;
  const inner = samplesNear(hw, 0);
  if (inner.length === 0) return bad('Zone hors de la carte');
  const around = samplesNear(hw + 2 * sp, 2 * sp);
  let ref = Infinity;
  for (const k of around) if (wetK(t, k)) ref = Math.min(ref, t.waterSurface[k]!);
  let isolated = false;
  if (!Number.isFinite(ref)) {
    // Bassin isolé : eau un peu sous le point le plus bas des bords, jamais sous le niveau de la mer.
    let lo = Infinity;
    for (const k of around) {
      const [lt, ln] = local(k);
      if (Math.abs(ln) > hw || lt < 0 || lt > L) lo = Math.min(lo, t.heights[k]!);
    }
    ref = Math.max(t.waterLevel, (Number.isFinite(lo) ? lo : t.waterLevel) - 1.5);
    isolated = true;
  }
  const top = ref + QUAY_FREEBOARD;
  const bed = ref - DIG_DEPTH;
  for (const k of inner) c.set(k, Math.min(t.heights[k]!, bed), ref);
  const banks = samplesNear(hw + band, band);
  for (const k of banks) {
    const [lt, ln] = local(k);
    if (Math.abs(ln) <= hw && lt >= 0 && lt <= L) continue;
    if (wetK(t, k)) continue; // eau existante : le canal s'y raccorde
    c.set(k, top, NO_WATER);
  }
  const walls: QuayWall[] = [];
  const nx = -uz, nz = ux; // normale (côté +n)
  // Murs : côtés longs (normale vers l'intérieur) et extrémités.
  const p1x = e.ax + nx * hw, p1z = e.az + nz * hw, p2x = e.bx + nx * hw, p2z = e.bz + nz * hw;
  const q1x = e.ax - nx * hw, q1z = e.az - nz * hw, q2x = e.bx - nx * hw, q2z = e.bz - nz * hw;
  let wl = 0;
  wl += wallRuns(t, c, p1x, p1z, p2x, p2z, -nx, -nz, top, bed, walls);
  wl += wallRuns(t, c, q1x, q1z, q2x, q2z, nx, nz, top, bed, walls);
  wl += wallRuns(t, c, q1x, q1z, p1x, p1z, ux, uz, top, bed, walls);
  wl += wallRuns(t, c, q2x, q2z, p2x, p2z, -ux, -uz, top, bed, walls);
  const outline = [p1x, p1z, p2x, p2z, q2x, q2z, q1x, q1z, p1x, p1z];
  const p = finish(t, e, c, [], walls, wl, outline);
  if (!p) return bad('Rien à creuser');
  if (isolated && p.volume < 1) return bad('Rien à creuser');
  return { ok: true, plan: p };
}

/** Applique un plan : hauteurs (une ou plusieurs copies : naturelles, nivelées), surface d'eau, forêt. */
export function commitEdit(t: EditableTerrain, plan: EditPlan, extraHeights: readonly Float32Array[] = []): void {
  for (let n = 0; n < plan.idx.length; n++) {
    const k = plan.idx[n]!;
    t.heights[k] = plan.h[n]!;
    for (const hh of extraHeights) hh[k] = plan.h[n]!;
    t.waterSurface[k] = plan.ws[n]!;
    t.forest[k] = 0;
  }
}

/** Murs à plat (QUAY_STRIDE nombres par mur), pour le rendu et les messages. */
export function flattenWalls(walls: readonly QuayWall[], out: number[] = []): number[] {
  for (const w of walls) out.push(w.ax, w.az, w.bx, w.bz, w.top, w.bottom, w.nx, w.nz);
  return out;
}
