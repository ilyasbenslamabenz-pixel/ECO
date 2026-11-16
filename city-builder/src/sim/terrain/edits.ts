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
 *  - `raise` / `lower` / `flatten` / `smooth` (Élever, Abaisser, Niveler, Adoucir) : pinceau circulaire, forme douce
 *    (cosinus, défaut) ou dure (`s` = 1 : plein effet jusqu'à 75 % du rayon), force `f` (0..1, Niveler et Adoucir) ;
 *    Niveler vise la hauteur du premier point (`h` fixée par la simulation) ou une hauteur choisie. Le plan ne crée
 *    pas d'eau : le remplissage des creux est calculé par le module d'eau (src/sim/hydro).
 *  - `slope` (Pente) : rampe rectiligne entre deux points (hauteurs des extrémités fixées à la pose), largeur `w`.
 *  - `dam` (Barrage) : ouvrage posé EN TRAVERS d'une vallée ou d'une rivière, ancré sur deux rives plus hautes ; le
 *    terrain de l'axe est relevé jusqu'à la crête (barrière continue pour l'eau), deux parements de béton (murs de
 *    quai dos à dos) ; crête, côté amont et débit de la rivière barrée fixés à la pose.
 *  - `source` / `unsource` : source d'eau (débit m³/s) posée ou retirée ; aucun effet sur le relief (eau calculée
 *    par src/sim/hydro à partir de la liste des éditions).
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
  /**
   * Pinceaux de relief : élever / abaisser de `d` m au centre, niveler à la hauteur `h`, adoucir. `s` = 1 : forme dure
   * (absent : douce, comportement d'origine) ; `f` : force 0..1 de Niveler / Adoucir (absent : 1).
   */
  | { k: 'raise'; x: number; z: number; r: number; d: number; s?: 1 }
  | { k: 'lower'; x: number; z: number; r: number; d: number; s?: 1 }
  /** `h` absent à la pose : hauteur du centre, fixée par la simulation (rejouée telle quelle au chargement). */
  | { k: 'flatten'; x: number; z: number; r: number; h?: number; f?: number; s?: 1 }
  | { k: 'smooth'; x: number; z: number; r: number; f?: number; s?: 1 }
  /** Pente : rampe de A à B, largeur `w` ; `ah` / `bh` (hauteurs des extrémités) fixées par la simulation. */
  | { k: 'slope'; ax: number; az: number; bx: number; bz: number; w: number; ah?: number; bh?: number; s?: 1 }
  /** Rivière : points de passage (x, z alternés), largeur du lit `w`. */
  | { k: 'river'; pts: number[]; w: number }
  /**
   * Barrage : axe A-B en travers d'une vallée. `hh` : hauteur voulue au-dessus du point le plus bas (0 ou absent :
   * maximale, jusqu'à la rive la plus basse). Fixés par la simulation à la pose : `h` crête (m), `up` côté amont
   * (+1 : côté de la normale (-uz, ux), -1 : l'autre), `q` débit de la rivière barrée (m³/s), `t` minute de jeu.
   */
  | { k: 'dam'; ax: number; az: number; bx: number; bz: number; hh?: number; h?: number; up?: 1 | -1; q?: number; t?: number }
  /** Source d'eau : débit `q` (m³/s) ; `t` minute de jeu de la pose (fixée par la simulation). */
  | { k: 'source'; x: number; z: number; q: number; t?: number }
  /** Retire la source la plus proche de (x, z) (la simulation vérifie qu'il y en a une). */
  | { k: 'unsource'; x: number; z: number }
  /**
   * Digue (posée par l'outil Routes, ouvrage « Digue » sur une retenue) : remblai le long de la polyligne `pts`
   * (axe de la route), crête de largeur `w` à la cote `h`, rampes de pente `g` depuis les cotes `ah` / `bh` des
   * extrémités, talus latéraux à 1/2. Ne fait que remblayer. `lk` : buses sous la digue (x1, z1, x2, z2 par buse, pieds
   * de talus de part et d'autre) qui relient les deux côtés pour l'eau (même niveau de part et d'autre, pas de lac
   * perché derrière la route). Tous les champs sont fixés par la simulation.
   */
  | { k: 'levee'; pts: number[]; w: number; h: number; ah: number; bh: number; g: number; lk?: number[] };

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
  /** Pente : largeur de la rampe (m). */
  minSlopeWidth: 8,
  maxSlopeWidth: 160,
  /** Barrage : longueur (m), hauteur au-dessus du point le plus bas de l'axe (m). */
  minDamLength: 24,
  maxDamLength: 600,
  minDamHeight: 3,
  maxDamHeight: 60,
  /** Source : débit (m³/s). */
  minSourceFlow: 2,
  maxSourceFlow: 200,
  /** Digue : points de l'axe, longueur (m), remblai maximal sous la crête (m), largeur de crête (m). */
  maxLeveePoints: 256,
  maxLeveeLength: 1600,
  maxLeveeFill: 30,
  minLeveeWidth: 8,
  maxLeveeWidth: 64,
} as const;

/** Coûts (CHF). */
export const EDIT_COSTS = {
  /** Défrichage : par m² de forêt dense (proportionnel à la densité). */
  clearPerM2: 0, // gratuit (demande joueur : le terrassement doit être gratuit)
  /** Minimum facturé pour un défrichage. */
  clearMin: 0,
  /** Remblai / déblai : par m³ de terre déplacée. */
  earthPerM3: 0, // gratuit (demande joueur) ; quais, barrages, sources et digues restent payants
  /** Mur de quai : par mètre. */
  wallPerM: 80,
  /** Barrage : par m³ de béton (axe × hauteur × épaisseur moyenne DAM_THICKNESS). */
  damPerM3: 18,
  /** Source d'eau : forfait + par m³/s de débit. */
  sourceBase: 2000,
  sourcePerM3s: 150,
  /** Digue routière : par m³ de remblai compacté, protégé par des enrochements (plus cher que la terre nue). */
  leveePerM3: 4,
} as const;

/** Digue : revanche de la crête au-dessus de l'eau (m), pente des talus latéraux (m de haut par m). */
export const LEVEE_FREEBOARD = 1.5;
export const LEVEE_SIDE_SLOPE = 0.5;

/** Barrage : épaisseur moyenne comptée pour le béton (m), demi-épaisseur des parements rendus (m). */
export const DAM_THICKNESS = 10;
/** Décalage de chaque mur de parement par rapport à l'axe : face avant à ±(DAM_WALL_OFFSET + QUAY_FRONT) m. */
export const DAM_WALL_OFFSET = 4.85;
/** Débit estimé d'une rivière barrée par mètre de largeur mouillée (m³/s/m), plafond (m³/s). */
export const DAM_FLOW_PER_M = 3;
export const DAM_FLOW_MAX = 300;

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
  const optF = (v: unknown): boolean => v === undefined || fin(v);
  const optS = o.s === undefined || o.s === 1;
  if (o.k === 'raise' || o.k === 'lower') return fin(o.x) && fin(o.z) && fin(o.r) && fin(o.d) && optS ? null : 'Pinceau de relief invalide';
  if (o.k === 'flatten') return fin(o.x) && fin(o.z) && fin(o.r) && optF(o.h) && optF(o.f) && optS ? null : 'Nivellement invalide';
  if (o.k === 'smooth') return fin(o.x) && fin(o.z) && fin(o.r) && optF(o.f) && optS ? null : 'Adoucissement invalide';
  if (o.k === 'slope') return fin(o.ax) && fin(o.az) && fin(o.bx) && fin(o.bz) && fin(o.w) && optF(o.ah) && optF(o.bh) && optS ? null : 'Pente invalide';
  if (o.k === 'dam') return fin(o.ax) && fin(o.az) && fin(o.bx) && fin(o.bz) && optF(o.hh) && optF(o.h) && (o.up === undefined || o.up === 1 || o.up === -1) && optF(o.q) && optF(o.t) ? null : 'Tracé de barrage invalide';
  if (o.k === 'source') return fin(o.x) && fin(o.z) && fin(o.q) && optF(o.t) ? null : 'Source d\'eau invalide';
  if (o.k === 'unsource') return fin(o.x) && fin(o.z) ? null : 'Retrait de source invalide';
  if (o.k === 'levee') return Array.isArray(o.pts) && o.pts.length >= 4 && o.pts.length % 2 === 0 && o.pts.length <= EDIT_LIMITS.maxLeveePoints * 2 && o.pts.every(fin) && fin(o.w) && fin(o.h) && fin(o.ah) && fin(o.bh) && fin(o.g) && o.g > 0 && (o.lk === undefined || (Array.isArray(o.lk) && o.lk.length % 4 === 0 && o.lk.length <= EDIT_LIMITS.maxLeveePoints * 4 && o.lk.every(fin))) ? null : 'Tracé de digue invalide';
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
    case 'raise': case 'lower': {
      const o: Extract<TerrainEdit, { k: 'raise' | 'lower' }> = { k: e.k, x: r2(e.x), z: r2(e.z), r: r2(clamp(e.r, L.minClearRadius, L.maxClearRadius)), d: r2(clamp(e.d, L.minStep, L.maxStep)) };
      if (e.s === 1) o.s = 1;
      return o;
    }
    case 'smooth': {
      const o: Extract<TerrainEdit, { k: 'smooth' }> = { k: 'smooth', x: r2(e.x), z: r2(e.z), r: r2(clamp(e.r, L.minClearRadius, L.maxClearRadius)) };
      if (e.f !== undefined && e.f < 1) o.f = r2(clamp(e.f, 0.05, 1));
      if (e.s === 1) o.s = 1;
      return o;
    }
    case 'slope': {
      const o: Extract<TerrainEdit, { k: 'slope' }> = { k: 'slope', ax: r2(e.ax), az: r2(e.az), bx: r2(e.bx), bz: r2(e.bz), w: r2(clamp(e.w, L.minSlopeWidth, L.maxSlopeWidth)) };
      if (e.ah !== undefined) o.ah = r2(e.ah);
      if (e.bh !== undefined) o.bh = r2(e.bh);
      if (e.s === 1) o.s = 1;
      return o;
    }
    case 'dam': {
      const o: Extract<TerrainEdit, { k: 'dam' }> = { k: 'dam', ax: r2(e.ax), az: r2(e.az), bx: r2(e.bx), bz: r2(e.bz) };
      if (e.hh !== undefined && e.hh > 0) o.hh = r2(clamp(e.hh, L.minDamHeight, L.maxDamHeight));
      if (e.h !== undefined) o.h = r2(e.h);
      if (e.up !== undefined) o.up = e.up;
      if (e.q !== undefined) o.q = r2(clamp(e.q, 0, DAM_FLOW_MAX));
      if (e.t !== undefined) o.t = r2(e.t);
      return o;
    }
    case 'source': {
      const o: Extract<TerrainEdit, { k: 'source' }> = { k: 'source', x: r2(e.x), z: r2(e.z), q: r2(clamp(e.q, L.minSourceFlow, L.maxSourceFlow)) };
      if (e.t !== undefined) o.t = r2(e.t);
      return o;
    }
    case 'unsource': return { k: 'unsource', x: r2(e.x), z: r2(e.z) };
    case 'levee': {
      const o: Extract<TerrainEdit, { k: 'levee' }> = { k: 'levee', pts: e.pts.slice(0, L.maxLeveePoints * 2).map(r2), w: r2(clamp(e.w, L.minLeveeWidth, L.maxLeveeWidth)), h: r2(e.h), ah: r2(e.ah), bh: r2(e.bh), g: Math.round(clamp(e.g, 0.01, 0.5) * 1000) / 1000 };
      if (e.lk !== undefined) o.lk = e.lk.slice(0, L.maxLeveePoints * 4).map(r2);
      return o;
    }
    case 'river': return { k: 'river', pts: e.pts.slice(0, L.maxRiverPoints * 2).map(r2), w: r2(clamp(e.w, L.minRiverWidth, L.maxRiverWidth)) };
    case 'flatten': {
      const o: Extract<TerrainEdit, { k: 'flatten' }> = { k: 'flatten', x: r2(e.x), z: r2(e.z), r: r2(clamp(e.r, L.minClearRadius, L.maxClearRadius)) };
      if (e.h !== undefined) o.h = r2(e.h);
      if (e.f !== undefined && e.f < 1) o.f = r2(clamp(e.f, 0.05, 1));
      if (e.s === 1) o.s = 1;
      return o;
    }
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
  const earth = volume * (edit.k === 'levee' ? C.leveePerM3 : C.earthPerM3) + wallLength * C.wallPerM;
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

  if (e.k === 'raise' || e.k === 'lower' || e.k === 'flatten' || e.k === 'smooth') {
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
    const hard = e.s === 1;
    const force = e.k === 'flatten' || e.k === 'smooth' ? (e.f ?? 1) : 1;
    // Adoucir : moyenne 5 × 5 lue sur une copie de la région (les voisins avant écriture).
    let src: Float32Array | null = null;
    const R = 2;
    const rw = rect.i1 - rect.i0 + 1 + 2 * R, rh = rect.j1 - rect.j0 + 1 + 2 * R;
    if (e.k === 'smooth') {
      src = new Float32Array(rw * rh);
      for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
        const gi = clamp(rect.i0 - R + i, 0, t.samplesX - 1), gj = clamp(rect.j0 - R + j, 0, t.samplesZ - 1);
        src[j * rw + i] = t.heights[gj * W + gi]!;
      }
    }
    const sign = e.k === 'lower' ? -1 : 1;
    for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
      const dist = Math.hypot(t.originX + i * sp - e.x, t.originZ + j * sp - e.z);
      if (dist > e.r) continue;
      const k = j * W + i;
      const h0 = t.heights[k]!;
      const w = brushWeight(dist / e.r, e.k === 'flatten' ? (hard ? 0.85 : 0.6) : hard ? 0.75 : 0) * force;
      let h: number;
      if (e.k === 'flatten') h = h0 + (target - h0) * w;
      else if (e.k === 'smooth') {
        let sum = 0;
        const li = i - rect.i0 + R, lj = j - rect.j0 + R;
        for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) sum += src![(lj + dj) * rw + li + di]!;
        h = h0 + (sum / ((2 * R + 1) * (2 * R + 1)) - h0) * w;
      } else h = h0 + sign * (e as { d: number }).d * w;
      // Jamais sous le fond de la mer : pas plus bas que le niveau de l'eau − 6 m.
      h = Math.max(h, t.waterLevel - 6);
      if (Math.abs(h - h0) < 0.01) continue;
      const ws0 = t.waterSurface[k]!;
      // Le plan ne crée pas d'eau : une case sèche abaissée reste sèche (le module d'eau remplit les creux reliés à
      // une eau voisine) ; une case relevée hors de l'eau devient terre.
      const ws = ws0 !== NO_WATER && ws0 > h + 0.05 ? ws0 : NO_WATER;
      c.set(k, Math.round(h * 100) / 100, ws);
    }
    const p = finish(t, edit, c, [], [], 0, circle(e.x, e.z, e.r));
    return p ? { ok: true, plan: p } : bad(e.k === 'flatten' ? 'Déjà plat ici' : e.k === 'smooth' ? 'Déjà doux ici' : 'Rien à modifier ici');
  }

  if (e.k === 'source' || e.k === 'unsource') {
    const i = Math.round((e.x - t.originX) / sp), j = Math.round((e.z - t.originZ) / sp);
    if (i < 1 || j < 1 || i >= t.samplesX - 1 || j >= t.samplesZ - 1) return bad('Source hors de la carte');
    const k = j * W + i;
    if (e.k === 'source' && wetK(t, k) && Math.abs(t.waterSurface[k]! - t.waterLevel) < 0.02) return bad('Une source ne se pose pas en mer');
    const cost = e.k === 'source' ? Math.round(EDIT_COSTS.sourceBase + EDIT_COSTS.sourcePerM3s * e.q) : 0;
    return { ok: true, plan: { edit: e, rect: { i0: i, j0: j, i1: i, j1: j }, idx: new Int32Array(0), h: new Float32Array(0), ws: new Float32Array(0), volume: 0, forestM2: 0, walls: [], wallLength: 0, cost, outline: circle(e.x, e.z, 10) } };
  }

  if (e.k === 'slope') return planSlope(t, e, c);
  if (e.k === 'dam') return planDam(t, e, c);

  if (e.k === 'river') return planRiver(t, e, c);
  if (e.k === 'levee') return planLevee(t, e, c);

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


/**
 * Poids d'un pinceau à la distance relative u (0 au centre, 1 au bord) : plein effet jusqu'à `plateau`, puis
 * raccord en cosinus jusqu'au bord. plateau = 0 : cloche douce d'origine.
 */
export function brushWeight(u: number, plateau: number): number {
  if (u >= 1) return 0;
  const v = plateau > 0 ? clamp((u - plateau) / (1 - plateau), 0, 1) : u;
  return 0.5 + 0.5 * Math.cos(Math.PI * v);
}

function circle(x: number, z: number, r: number): number[] {
  const out: number[] = [];
  for (let a = 0; a <= 32; a++) out.push(x + Math.cos((a / 32) * Math.PI * 2) * r, z + Math.sin((a / 32) * Math.PI * 2) * r);
  return out;
}

/** Hauteur (naturelle) de l'échantillon le plus proche de (x, z). */
function heightNear(t: EditableTerrain, x: number, z: number): number {
  const i = clamp(Math.round((x - t.originX) / t.spacing), 0, t.samplesX - 1), j = clamp(Math.round((z - t.originZ) / t.spacing), 0, t.samplesZ - 1);
  return t.heights[j * t.samplesX + i]!;
}

/** Pente : rampe linéaire de la hauteur de A à celle de B, sur une bande de largeur w (bords adoucis). */
function planSlope(t: EditableTerrain, e: Extract<TerrainEdit, { k: 'slope' }>, c: Changes): PlanOutcome {
  const bad = (message: string): PlanOutcome => ({ ok: false, message });
  const L = Math.hypot(e.bx - e.ax, e.bz - e.az);
  if (L < EDIT_LIMITS.minLength) return bad(`Pente trop courte (${EDIT_LIMITS.minLength} m minimum)`);
  if (L > EDIT_LIMITS.maxLength) return bad(`Pente trop longue (${EDIT_LIMITS.maxLength} m maximum)`);
  const ah = e.ah ?? Math.round(heightNear(t, e.ax, e.az) * 100) / 100;
  const bh = e.bh ?? Math.round(heightNear(t, e.bx, e.bz) * 100) / 100;
  const edit: TerrainEdit = { ...e, ah, bh };
  const hw = e.w / 2;
  const rect = rectFor(t, Math.min(e.ax, e.bx) - hw, Math.min(e.az, e.bz) - hw, Math.max(e.ax, e.bx) + hw, Math.max(e.az, e.bz) + hw);
  if (!rect) return bad('Zone hors de la carte');
  const W = t.samplesX, sp = t.spacing;
  const ux = (e.bx - e.ax) / L, uz = (e.bz - e.az) / L;
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const x = t.originX + i * sp - e.ax, z = t.originZ + j * sp - e.az;
    const along = x * ux + z * uz;
    const u = clamp(along / L, 0, 1);
    const across = Math.abs(-x * uz + z * ux);
    const out = along < 0 ? -along : along > L ? along - L : 0;
    const d = Math.hypot(across, out);
    if (d > hw) continue;
    const k = j * W + i;
    const h0 = t.heights[k]!;
    const w = brushWeight(d / hw, e.s === 1 ? 0.8 : 0.55);
    const h = Math.max(t.waterLevel - 6, h0 + (ah + (bh - ah) * u - h0) * w);
    if (Math.abs(h - h0) < 0.01) continue;
    const ws0 = t.waterSurface[k]!;
    c.set(k, Math.round(h * 100) / 100, ws0 !== NO_WATER && ws0 > h + 0.05 ? ws0 : NO_WATER);
  }
  const nx = -uz * hw, nz = ux * hw;
  const outline = [e.ax + nx, e.az + nz, e.bx + nx, e.bz + nz, e.bx - nx, e.bz - nz, e.ax - nx, e.az - nz, e.ax + nx, e.az + nz];
  const p = finish(t, edit, c, [], [], 0, outline);
  return p ? { ok: true, plan: p } : bad('Le terrain suit déjà cette pente');
}

/**
 * Digue : remblai sous l'axe d'une route. Crête plate (largeur `w`) à min(h, ah + g·s, bh + g·(L − s)) (s : abscisse
 * le long de l'axe), talus à LEVEE_SIDE_SLOPE de part et d'autre ; seuls les échantillons plus bas que le profil
 * sont relevés. Une case remblayée au-dessus de l'eau de base devient terre (l'eau dynamique est recalculée ensuite).
 */
function planLevee(t: EditableTerrain, e: Extract<TerrainEdit, { k: 'levee' }>, c: Changes): PlanOutcome {
  const bad = (message: string): PlanOutcome => ({ ok: false, message });
  const P = e.pts, m = P.length / 2;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1]! + Math.hypot(P[2 * i]! - P[2 * i - 2]!, P[2 * i + 1]! - P[2 * i - 1]!);
  const L = cum[m - 1]!;
  if (L < EDIT_LIMITS.minLength) return bad(`Digue trop courte (${EDIT_LIMITS.minLength} m minimum)`);
  if (L > EDIT_LIMITS.maxLeveeLength) return bad(`Digue trop longue (${EDIT_LIMITS.maxLeveeLength} m maximum)`);
  const hw = e.w / 2;
  const reach = hw + EDIT_LIMITS.maxLeveeFill / LEVEE_SIDE_SLOPE;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < m; i++) { x0 = Math.min(x0, P[2 * i]!); x1 = Math.max(x1, P[2 * i]!); z0 = Math.min(z0, P[2 * i + 1]!); z1 = Math.max(z1, P[2 * i + 1]!); }
  const rect = rectFor(t, x0 - reach, z0 - reach, x1 + reach, z1 + reach);
  if (!rect) return bad('Zone hors de la carte');
  const W = t.samplesX, sp = t.spacing;
  let maxFill = 0;
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const x = t.originX + i * sp, z = t.originZ + j * sp;
    // Point le plus proche de l'axe : distance d et abscisse s.
    // Au-delà des extrémités (projection hors de l'axe) : rien (pas de cône de remblai derrière les culées).
    let d = Infinity, s = 0, beyond = false;
    for (let q = 0; q + 1 < m; q++) {
      const ax = P[2 * q]!, az = P[2 * q + 1]!, dx = P[2 * q + 2]! - ax, dz = P[2 * q + 3]! - az;
      const l2 = dx * dx + dz * dz;
      const raw = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      const u = clamp(raw, 0, 1);
      const dd = Math.hypot(x - ax - dx * u, z - az - dz * u);
      if (dd < d) { d = dd; s = cum[q]! + (cum[q + 1]! - cum[q]!) * u; beyond = (q === 0 && raw < 0) || (q === m - 2 && raw > 1); }
    }
    if (d > reach || beyond) continue;
    const crest = Math.min(e.h, e.ah + e.g * s, e.bh + e.g * (L - s));
    const target = d <= hw ? crest : crest - (d - hw) * LEVEE_SIDE_SLOPE;
    const k = j * W + i;
    const h0 = t.heights[k]!;
    if (target < h0 + 0.01) continue;
    maxFill = Math.max(maxFill, target - h0);
    const h = Math.round(target * 100) / 100;
    const ws0 = t.waterSurface[k]!;
    c.set(k, h, ws0 !== NO_WATER && ws0 > h + 0.05 ? ws0 : NO_WATER);
  }
  if (maxFill > EDIT_LIMITS.maxLeveeFill + 0.01) return bad(`Retenue trop profonde pour une digue (${Math.round(maxFill)} m de remblai, ${EDIT_LIMITS.maxLeveeFill} m au plus) : choisissez Pont, Viaduc ou Tunnel`);
  // Buses (fixées à la pose, rejouées telles quelles) : tous les 3 points de l'axe remblayés, d'un pied de talus à
  // l'autre (première case non remblayée de chaque côté, plus une case), sur le relief d'AVANT la digue.
  let edit: TerrainEdit = e;
  if (e.lk === undefined) {
    const lk: number[] = [];
    for (let i = 1; i < m - 1; i += 3) {
      const px = P[2 * i]!, pz = P[2 * i + 1]!;
      const crest = Math.min(e.h, e.ah + e.g * cum[i]!, e.bh + e.g * (L - cum[i]!));
      if (crest < heightNear(t, px, pz) + 0.5) continue;
      const dx = P[2 * i + 2]! - P[2 * i - 2]!, dz = P[2 * i + 3]! - P[2 * i - 1]!, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const toe = (side: 1 | -1): number => {
        for (let d = hw; d <= reach; d += sp / 2) {
          if (crest - (d - hw) * LEVEE_SIDE_SLOPE < heightNear(t, px + side * nx * d, pz + side * nz * d) + 0.01) return d + sp;
        }
        return reach + sp;
      };
      const a = toe(1), b = toe(-1);
      lk.push(px + nx * a, pz + nz * a, px - nx * b, pz - nz * b);
    }
    edit = { ...e, lk: lk.map((v) => Math.round(v * 100) / 100) };
  }
  // Contour : axe décalé de la demi-largeur de crête de chaque côté.
  const left: number[] = [], right: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
    const dx = P[2 * b]! - P[2 * a]!, dz = P[2 * b + 1]! - P[2 * a + 1]!, l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * hw, nz = (dx / l) * hw;
    left.push(P[2 * i]! + nx, P[2 * i + 1]! + nz);
    right.unshift(P[2 * i]! - nx, P[2 * i + 1]! - nz); // côté droit parcouru en sens inverse (contour fermé)
  }
  const outline = [...left, ...right, left[0]!, left[1]!];
  const p = finish(t, edit, c, [], [], 0, outline);
  return p ? { ok: true, plan: p } : bad('Le terrain est déjà assez haut : pas de remblai à faire');
}

/** Géométrie d'un barrage (partagée par le plan et le module d'eau). */
export interface DamGeometry {
  /** Échantillons de l'axe (barrière relevée jusqu'à la crête). */
  band: number[];
  /** Échantillons voisins côté amont / aval (à 1 à 2,5 cases de l'axe). */
  upFace: number[];
  downFace: number[];
  length: number;
}

/** Échantillons de l'axe et des deux faces d'un barrage A-B ; `up` = côté amont (+1 : normale (-uz, ux)). */
export function damGeometry(t: TerrainData, ax: number, az: number, bx: number, bz: number, up: 1 | -1): DamGeometry {
  const L = Math.hypot(bx - ax, bz - az) || 1;
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  const W = t.samplesX, sp = t.spacing;
  const m = sp * 3;
  const rect = rectFor(t, Math.min(ax, bx) - m, Math.min(az, bz) - m, Math.max(ax, bx) + m, Math.max(az, bz) + m);
  const band: number[] = [], upFace: number[] = [], downFace: number[] = [];
  if (rect) for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const x = t.originX + i * sp - ax, z = t.originZ + j * sp - az;
    const along = x * ux + z * uz;
    const n = -x * uz + z * ux;
    const k = j * W + i;
    // Axe : bande continue (4-connexe quelle que soit l'orientation), prolongée d'une case aux extrémités.
    if (Math.abs(n) <= sp * 0.8 && along >= -sp && along <= L + sp) band.push(k);
    else if (along >= 0 && along <= L && Math.abs(n) <= sp * 2.5) (n * up > 0 ? upFace : downFace).push(k);
  }
  return { band, upFace, downFace, length: L };
}

/**
 * Barrage en travers d'une vallée : crête = rive la plus basse (ou hauteur voulue au-dessus du fond), axe relevé
 * jusqu'à la crête, deux parements (murs de quai dos à dos). Refus clairs : trop court / long, en mer, vallée trop
 * peu profonde (une extrémité ne s'appuie pas sur une rive plus haute).
 */
function planDam(t: EditableTerrain, e: Extract<TerrainEdit, { k: 'dam' }>, c: Changes): PlanOutcome {
  const bad = (message: string): PlanOutcome => ({ ok: false, message });
  const L = Math.hypot(e.bx - e.ax, e.bz - e.az);
  const DL = EDIT_LIMITS;
  if (L < DL.minDamLength) return bad(`Barrage trop court (${DL.minDamLength} m minimum) : tracez-le d'une rive à l'autre`);
  if (L > DL.maxDamLength) return bad(`Barrage trop long (${DL.maxDamLength} m maximum)`);
  const ux = (e.bx - e.ax) / L, uz = (e.bz - e.az) / L;
  // Profil de l'axe (pas de 2 m) : fond, rives, mer.
  const steps = Math.max(2, Math.ceil(L / 2));
  let minG = Infinity, sea = false, wetLen = 0;
  for (let s = 0; s <= steps; s++) {
    const x = e.ax + (e.bx - e.ax) * (s / steps), z = e.az + (e.bz - e.az) * (s / steps);
    const i = clamp(Math.round((x - t.originX) / t.spacing), 0, t.samplesX - 1), j = clamp(Math.round((z - t.originZ) / t.spacing), 0, t.samplesZ - 1);
    const k = j * t.samplesX + i;
    const wet = wetK(t, k);
    if (wet && Math.abs(t.waterSurface[k]! - t.waterLevel) < 0.02) sea = true;
    if (wet && s < steps) wetLen += L / steps;
    minG = Math.min(minG, t.heights[k]!);
  }
  if (sea) return bad('Pas de barrage en mer : posez-le en travers d\'une rivière ou d\'une vallée');
  // Rives : hauteur aux extrémités (moyenne sur 6 m vers l'extérieur).
  const endH = (x: number, z: number, dir: number): number => {
    let s = 0, n = 0;
    for (let d = 0; d <= 6; d += 2) { s += heightNear(t, x + ux * dir * d, z + uz * dir * d); n++; }
    return s / n;
  };
  const endA = endH(e.ax, e.az, -1), endB = endH(e.bx, e.bz, 1);
  let crest: number;
  if (e.h !== undefined) crest = e.h;
  else {
    crest = Math.min(endA, endB) - 0.3;
    if (e.hh !== undefined) crest = Math.min(crest, minG + e.hh);
    crest = Math.min(crest, minG + DL.maxDamHeight);
    crest = Math.round(crest * 100) / 100;
  }
  if (crest - minG < DL.minDamHeight) return bad(`Vallée trop peu profonde ici : chaque extrémité doit s'appuyer sur une rive au moins ${DL.minDamHeight} m plus haute que le fond`);
  // Côté amont : surface de l'eau (sinon terrain) la plus haute à 2,5 cases de part et d'autre de l'axe.
  let up: 1 | -1;
  if (e.up !== undefined) up = e.up;
  else {
    let sp1 = 0, sn = 0, n = 0;
    for (let s = 1; s < 10; s++) {
      const x = e.ax + (e.bx - e.ax) * (s / 10), z = e.az + (e.bz - e.az) * (s / 10);
      for (const side of [1, -1] as const) {
        const px = x - uz * side * t.spacing * 2.5, pz = z + ux * side * t.spacing * 2.5;
        const i = clamp(Math.round((px - t.originX) / t.spacing), 0, t.samplesX - 1), j = clamp(Math.round((pz - t.originZ) / t.spacing), 0, t.samplesZ - 1);
        const k = j * t.samplesX + i;
        const v = wetK(t, k) ? t.waterSurface[k]! : t.heights[k]!;
        if (side === 1) sp1 += v; else sn += v;
      }
      n++;
    }
    up = sp1 / n >= sn / n ? 1 : -1;
  }
  const g = damGeometry(t, e.ax, e.az, e.bx, e.bz, up);
  for (const k of g.band) {
    if (t.heights[k]! < crest) c.set(k, crest, NO_WATER);
    else if (wetK(t, k)) c.set(k, t.heights[k]!, NO_WATER);
  }
  // Débit de la rivière barrée : largeur mouillée de l'axe × DAM_FLOW_PER_M (0 dans une vallée sèche).
  const q = e.q ?? Math.round(clamp(wetLen * DAM_FLOW_PER_M, 0, DAM_FLOW_MAX));
  const edit: TerrainEdit = { ...e, h: crest, up, q };
  // Parements : murs de quai dos à dos (face amont, face aval), plateformes jointives sur la crête.
  const nx = -uz * up, nz = ux * up;
  const off = DAM_WALL_OFFSET;
  const bottom = Math.round((minG - 1.5) * 100) / 100;
  const walls: QuayWall[] = [
    { ax: e.ax + nx * off, az: e.az + nz * off, bx: e.bx + nx * off, bz: e.bz + nz * off, top: crest, bottom, nx, nz },
    { ax: e.ax - nx * off, az: e.az - nz * off, bx: e.bx - nx * off, bz: e.bz - nz * off, top: crest, bottom, nx: -nx, nz: -nz },
  ];
  // Béton : hauteur de l'ouvrage le long de l'axe × épaisseur moyenne.
  let area = 0;
  for (let s = 0; s < steps; s++) {
    const x = e.ax + (e.bx - e.ax) * ((s + 0.5) / steps), z = e.az + (e.bz - e.az) * ((s + 0.5) / steps);
    area += Math.max(0, crest - heightNear(t, x, z)) * (L / steps);
  }
  const hw = off + 2.8;
  const outline = [e.ax + nx * hw, e.az + nz * hw, e.bx + nx * hw, e.bz + nz * hw, e.bx - nx * hw, e.bz - nz * hw, e.ax - nx * hw, e.az - nz * hw, e.ax + nx * hw, e.az + nz * hw];
  const p = finish(t, edit, c, [], walls, 0, outline);
  if (!p) return bad('Rien à construire ici');
  p.wallLength = Math.round(L);
  p.cost = Math.round(area * DAM_THICKNESS * EDIT_COSTS.damPerM3);
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
