/**
 * Éditions du terrain par le joueur (simulation, TypeScript pur : ni three, ni DOM).
 *
 *  - `clear` (Défricher) : retire la forêt d'un disque (couche `forest` à 0) ; le rendu retire les arbres.
 *  - `quay`  (Quai / remblai) : le joueur trace une ligne droite le long d'une côte ou d'une berge ; l'eau située
 *    côté terre de la ligne est remblayée jusqu'à la ligne (bande de FILL_DEPTH m au plus) ; un mur de quai droit
 *    est posé sur la ligne, face à l'eau, dont le pied est approfondi. Sert aussi à combler ou dévier une rivière.
 *  - `dig`   (Creuser) : bassin ou canal rectangulaire droit (largeur `w`), mis en eau au niveau de l'eau voisine
 *    (sinon bassin isolé), berges aplanies et murs de quai là où la rive est sèche.
 *  - `river` (Rivière) : tracé courbe (points lissés), lit creusé en auge, berges naturelles en pente (sans mur),
 *    mise en eau descendante d'un bout à l'autre, raccordée au niveau de l'eau existante aux extrémités.
 *  - `raise` / `lower` / `flatten` (Élever, Abaisser, Niveler) : pinceau circulaire à bord adouci (cosinus) ;
 *    l'eau n'est jamais créée ni étendue (un fond relevé au-dessus de l'eau devient terre ferme).
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
  | { k: 'dig'; ax: number; az: number; bx: number; bz: number; w: number }
  /** Pinceaux de relief : élever / abaisser de `d` m au centre (bord adouci), niveler à la hauteur `h`. */
  | { k: 'raise'; x: number; z: number; r: number; d: number }
  | { k: 'lower'; x: number; z: number; r: number; d: number }
  /** `h` absent à la pose : hauteur du centre, fixée par la simulation (rejouée telle quelle au chargement). */
  | { k: 'flatten'; x: number; z: number; r: number; h?: number }
  /** Rivière : points de passage (x, z alternés), largeur du lit `w`. */
  | { k: 'river'; pts: number[]; w: number };

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
  /** Pas des pinceaux Élever / Abaisser (m). */
  minStep: 0.5,
  maxStep: 10,
  minRiverWidth: 16,
  maxRiverWidth: 64,
  /** Points de passage d'une rivière, longueur maximale (m). */
  maxRiverPoints: 32,
  maxRiverLength: 2400,
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
/** Rivière : profondeur au milieu du lit, largeur des berges en pente, pente des berges (m de haut par m). */
export const RIVER_DEPTH = 3.5;
export const RIVER_BANK = 14;
const RIVER_BANK_SLOPE = 0.55;
/** Largeur (en cases) de la bande préparée de part et d'autre d'un mur. */
const BAND = 1.5;
/** Arasement des berges d'un canal (en cases) : couvre la plateforme de quai rendue (12,5 m) plus une case d'interpolation. */
const DECK_CLEAR_CELLS = 3;

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
  if (o.k === 'raise' || o.k === 'lower') return fin(o.x) && fin(o.z) && fin(o.r) && fin(o.d) ? null : 'Pinceau de relief invalide';
  if (o.k === 'flatten') return fin(o.x) && fin(o.z) && fin(o.r) && (o.h === undefined || fin(o.h)) ? null : 'Nivellement invalide';
  if (o.k === 'river') return Array.isArray(o.pts) && o.pts.length >= 4 && o.pts.length % 2 === 0 && o.pts.length <= EDIT_LIMITS.maxRiverPoints * 2 && o.pts.every(fin) && fin(o.w) ? null : 'Tracé de rivière invalide';
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
    case 'raise': case 'lower': return { k: e.k, x: r2(e.x), z: r2(e.z), r: r2(clamp(e.r, L.minClearRadius, L.maxClearRadius)), d: r2(clamp(e.d, L.minStep, L.maxStep)) };
    case 'river': return { k: 'river', pts: e.pts.slice(0, L.maxRiverPoints * 2).map(r2), w: r2(clamp(e.w, L.minRiverWidth, L.maxRiverWidth)) };
    case 'flatten': return e.h === undefined ? { k: 'flatten', x: r2(e.x), z: r2(e.z), r: r2(clamp(e.r, L.minClearRadius, L.maxClearRadius)) } : { k: 'flatten', x: r2(e.x), z: r2(e.z), r: r2(clamp(e.r, L.minClearRadius, L.maxClearRadius)), h: r2(e.h) };
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

/**
 * Axe lissé d'une rivière (courbe de Catmull-Rom passant par les points), échantillonné tous les `step` m.
 * Partagé par la simulation et l'aperçu de l'outil (même courbe).
 */
export function riverCenterline(pts: readonly number[], step = 4): number[] {
  const P: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const n = P.length;
    if (n >= 2 && Math.hypot(pts[i]! - P[n - 2]!, pts[i + 1]! - P[n - 1]!) < 0.5) continue;
    P.push(pts[i]!, pts[i + 1]!);
  }
  const m = P.length / 2;
  if (m < 2) return P;
  const out: number[] = [P[0]!, P[1]!];
  const at = (i: number, c: 0 | 1): number => P[clamp(i, 0, m - 1) * 2 + c]!;
  for (let i = 0; i < m - 1; i++) {
    const seg = Math.hypot(at(i + 1, 0) - at(i, 0), at(i + 1, 1) - at(i, 1));
    const steps = Math.max(1, Math.ceil(seg / step));
    for (let s = 1; s <= steps; s++) {
      const u = s / steps, u2 = u * u, u3 = u2 * u;
      for (const c of [0, 1] as const) {
        const p0 = at(i - 1, c), p1 = at(i, c), p2 = at(i + 1, c), p3 = at(i + 2, c);
        out.push(0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3));
      }
    }
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

  if (e.k === 'raise' || e.k === 'lower' || e.k === 'flatten') {
    const rect = rectFor(t, e.x - e.r, e.z - e.r, e.x + e.r, e.z + e.r);
    if (!rect) return bad('Zone hors de la carte');
    let target = 0;
    let edit: TerrainEdit = e;
    if (e.k === 'flatten') {
      if (e.h === undefined) {
        const ci = clamp(Math.round((e.x - t.originX) / sp), 0, t.samplesX - 1), cj = clamp(Math.round((e.z - t.originZ) / sp), 0, t.samplesZ - 1);
        target = Math.round(t.heights[cj * W + ci]! * 100) / 100;
        edit = { ...e, h: target };
      } else target = e.h;
    }
    const sign = e.k === 'lower' ? -1 : 1;
    for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
      const dist = Math.hypot(t.originX + i * sp - e.x, t.originZ + j * sp - e.z);
      if (dist > e.r) continue;
      const k = j * W + i;
      const h0 = t.heights[k]!;
      // Bord adouci : plein effet au centre, nul au bord (nivellement : plein jusqu'à 60 % du rayon).
      const u = e.k === 'flatten' ? clamp((dist / e.r - 0.6) / 0.4, 0, 1) : dist / e.r;
      const w = 0.5 + 0.5 * Math.cos(Math.PI * u);
      let h = e.k === 'flatten' ? h0 + (target - h0) * w : h0 + sign * (e as { d: number }).d * w;
      // Jamais sous le fond de la mer : pas plus bas que le niveau de l'eau − 6 m.
      h = Math.max(h, t.waterLevel - 6);
      if (Math.abs(h - h0) < 0.01) continue;
      const ws0 = t.waterSurface[k]!;
      // L'eau ne s'étend pas : une case sèche abaissée reste sèche ; une case relevée hors de l'eau devient terre.
      const ws = ws0 !== NO_WATER && ws0 > h + 0.05 ? ws0 : NO_WATER;
      c.set(k, Math.round(h * 100) / 100, ws);
    }
    const outline: number[] = [];
    for (let a = 0; a <= 32; a++) outline.push(e.x + Math.cos((a / 32) * Math.PI * 2) * e.r, e.z + Math.sin((a / 32) * Math.PI * 2) * e.r);
    const p = finish(t, edit, c, [], [], 0, outline);
    return p ? { ok: true, plan: p } : bad(e.k === 'flatten' ? 'Déjà plat ici' : 'Rien à modifier ici');
  }

  if (e.k === 'river') return planRiver(t, e, c);

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
  // Berges au niveau du quai sur `band`, puis jusqu'à DECK_CLEAR au-delà du bord : relief seulement ARASÉ au niveau
  // du quai (jamais rehaussé). La plateforme rendue (12,5 m) dépasse la bande ; sans cet arasement, le relief plus
  // haut derrière la perçait par l'arrière, en dents de scie.
  const clear = DECK_CLEAR_CELLS * sp;
  const banks = samplesNear(hw + clear, clear);
  for (const k of banks) {
    const [lt, ln] = local(k);
    if (Math.abs(ln) <= hw && lt >= 0 && lt <= L) continue;
    if (wetK(t, k)) continue; // eau existante : le canal s'y raccorde
    const dn = Math.abs(ln) - hw, dt = lt < 0 ? -lt : lt > L ? lt - L : 0;
    if (Math.max(dn, dt) <= band) c.set(k, top, NO_WATER);
    else if (c.h(k) > top) c.set(k, top, NO_WATER);
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

/** Rivière : lit en auge le long de l'axe lissé, berges en pente, eau descendante raccordée aux extrémités. */
function planRiver(t: EditableTerrain, e: Extract<TerrainEdit, { k: 'river' }>, c: Changes): PlanOutcome {
  const bad = (message: string): PlanOutcome => ({ ok: false, message });
  const W = t.samplesX, sp = t.spacing;
  const path = riverCenterline(e.pts, Math.min(4, sp / 2));
  const n = path.length / 2;
  if (n < 2) return bad('Posez au moins deux points pour la rivière');
  const cum = new Float64Array(n);
  for (let v = 1; v < n; v++) cum[v] = cum[v - 1]! + Math.hypot(path[v * 2]! - path[v * 2 - 2]!, path[v * 2 + 1]! - path[v * 2 - 1]!);
  const total = cum[n - 1]!;
  if (total < EDIT_LIMITS.minLength) return bad(`Rivière trop courte (${EDIT_LIMITS.minLength} m minimum)`);
  if (total > EDIT_LIMITS.maxRiverLength) return bad(`Rivière trop longue (${EDIT_LIMITS.maxRiverLength} m maximum)`);
  const hw = e.w / 2;
  const reach = hw + RIVER_BANK;
  const idxAt = (x: number, z: number): number => {
    const i = Math.round((x - t.originX) / sp), j = Math.round((z - t.originZ) / sp);
    return i < 0 || j < 0 || i >= t.samplesX || j >= t.samplesZ ? -1 : j * W + i;
  };
  // Niveau de l'eau existante touchée par une extrémité (le plus bas), sinon NaN.
  const refAt = (x: number, z: number): number => {
    const rect = rectFor(t, x - hw - 2 * sp, z - hw - 2 * sp, x + hw + 2 * sp, z + hw + 2 * sp);
    let r = Infinity;
    if (rect) for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
      const k = j * W + i;
      if (wetK(t, k) && Math.hypot(t.originX + i * sp - x, t.originZ + j * sp - z) <= hw + 2 * sp) r = Math.min(r, t.waterSurface[k]!);
    }
    return Number.isFinite(r) ? r : NaN;
  };
  const refA = refAt(path[0]!, path[1]!), refB = refAt(path[(n - 1) * 2]!, path[(n - 1) * 2 + 1]!);
  // Point le plus bas des berges (terre sèche) à chaque station : l'eau reste dessous.
  const bankLow = new Float64Array(n).fill(Infinity);
  for (let v = 0; v < n; v++) {
    const a = Math.max(0, v - 1), b = Math.min(n - 1, v + 1);
    let tx = path[b * 2]! - path[a * 2]!, tz = path[b * 2 + 1]! - path[a * 2 + 1]!;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    for (const side of [-1, 1]) for (let d = hw + sp * 0.5; d <= reach; d += sp) {
      const k = idxAt(path[v * 2]! - tz * d * side, path[v * 2 + 1]! + tx * d * side);
      if (k >= 0 && !wetK(t, k)) bankLow[v] = Math.min(bankLow[v]!, t.heights[k]!);
    }
  }
  let lowest = Infinity;
  for (let v = 0; v < n; v++) lowest = Math.min(lowest, bankLow[v]!);
  const free = Number.isFinite(lowest) ? Math.max(t.waterLevel, lowest - 1.2) : t.waterLevel;
  const lv = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    const u = cum[v]! / total;
    let l = Number.isFinite(refA) && Number.isFinite(refB) ? refA + (refB - refA) * u : Number.isFinite(refA) ? refA : Number.isFinite(refB) ? refB : free;
    if (Number.isFinite(bankLow[v]!)) l = Math.min(l, bankLow[v]! - 0.8);
    lv[v] = Math.max(l, t.waterLevel - 2);
  }
  // L'eau descend d'un bout à l'autre (jamais de remontée).
  if (lv[0]! >= lv[n - 1]!) for (let v = 1; v < n; v++) lv[v] = Math.min(lv[v]!, lv[v - 1]!);
  else for (let v = n - 2; v >= 0; v--) lv[v] = Math.min(lv[v]!, lv[v + 1]!);
  // Pour chaque échantillon proche : distance à l'axe et niveau de l'eau au point le plus proche.
  const best = new Map<number, { d: number; l: number }>();
  for (let v = 0; v < n - 1; v++) {
    const ax = path[v * 2]!, az = path[v * 2 + 1]!, bx = path[v * 2 + 2]!, bz = path[v * 2 + 3]!;
    const rect = rectFor(t, Math.min(ax, bx) - reach, Math.min(az, bz) - reach, Math.max(ax, bx) + reach, Math.max(az, bz) + reach);
    if (!rect) continue;
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
    for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
      const x = t.originX + i * sp, z = t.originZ + j * sp;
      const u = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
      const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
      if (d > reach) continue;
      const k = j * W + i;
      const cur = best.get(k);
      if (!cur || d < cur.d) best.set(k, { d, l: lv[v]! + (lv[v + 1]! - lv[v]!) * u });
    }
  }
  let wetCount = 0;
  for (const [k, { d, l }] of best) {
    const h0 = t.heights[k]!;
    const wet0 = wetK(t, k);
    if (d <= hw) {
      const u = d / hw;
      const bed = l - (1.2 + (RIVER_DEPTH - 1.2) * (1 - u * u));
      c.set(k, Math.round(Math.min(h0, bed) * 100) / 100, wet0 ? Math.max(t.waterSurface[k]!, l) : Math.round(l * 100) / 100);
      wetCount++;
      continue;
    }
    if (wet0) continue; // eau existante : la rivière s'y raccorde
    const target = l + 0.5 + (d - hw) * RIVER_BANK_SLOPE;
    let h = h0;
    if (h0 > target) h = target; // déblai : berge en pente douce
    else if (d <= hw + sp * 1.2 && h0 < l + 0.5) h = l + 0.5; // levée : la berge reste au-dessus de l'eau
    if (Math.abs(h - h0) < 0.01 && t.waterSurface[k]! === NO_WATER) continue;
    c.set(k, Math.round(h * 100) / 100, NO_WATER);
  }
  if (wetCount === 0) return bad('Zone hors de la carte');
  // Contour : berges gauche puis droite.
  const left: number[] = [], right: number[] = [];
  const stride = Math.max(1, Math.round(8 / Math.min(4, sp / 2)));
  for (let v = 0; v < n; v += v === n - 1 ? 1 : Math.min(stride, n - 1 - v)) {
    const a = Math.max(0, v - 1), b = Math.min(n - 1, v + 1);
    let tx = path[b * 2]! - path[a * 2]!, tz = path[b * 2 + 1]! - path[a * 2 + 1]!;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    left.push(path[v * 2]! - tz * hw, path[v * 2 + 1]! + tx * hw);
    right.push(path[v * 2]! + tz * hw, path[v * 2 + 1]! - tx * hw);
    if (v === n - 1) break;
  }
  const outline = [...left];
  for (let q = right.length - 2; q >= 0; q -= 2) outline.push(right[q]!, right[q + 1]!);
  outline.push(left[0]!, left[1]!);
  const p = finish(t, e, c, [], [], 0, outline);
  return p ? { ok: true, plan: p } : bad('Rien à creuser');
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
