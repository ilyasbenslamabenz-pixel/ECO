/**
 * Zonage — grille des zones : une case de 8 m (TILE_SIZE) par octet, alignée sur l'origine de la carte.
 *
 *  - `zone[i]`  : code de zone 0..6 (0 = non zoné) — seule donnée sauvegardée ;
 *  - `edge[i]`  : distance du centre de la case au bord de la route desservante la plus proche, par pas de
 *                 0,5 m (255 = aucune route à portée) — recalculée quand le réseau change ;
 *  - `seg[i]`   : identifiant du tronçon le plus proche (0 = aucun).
 *
 * Peindre : les cases dont le centre est à moins de `radius` m du tracé ET dans la bande de `depth` cases
 * le long d'une route desservante (hors chaussée, hors eau) prennent la zone. Effacer : toutes les cases du tracé.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { TILE_SIZE } from '../../shared/constants';
import {
  CELL_CONNECTED, ZONE_COUNT, ZONE_DEPTH_MAX, ZONE_DEPTH_MIN, rleDecode, rleEncode, type ZoneCode, type ZoneGridInfo,
} from '../../shared/protocol-ext/zonage';
import type { RoadGeometry } from './roads';

/** Les cases dont le centre est à moins de cette distance du bord de la chaussée ne sont jamais zonées. */
export const MIN_EDGE_M = 1;
/** Portée maximale (m, depuis le bord) de la desserte d'une case zonée. */
export const MAX_EDGE_M = ZONE_DEPTH_MAX * TILE_SIZE + 2;
const NO_ROAD = 255;

export class ZoneGrid {
  info: ZoneGridInfo | null = null;
  zone = new Uint8Array(0);
  edge = new Uint8Array(0);
  seg = new Uint32Array(0);
  /** Cases zonées par code (index 0 inutilisé). */
  readonly counts = new Array<number>(ZONE_COUNT + 1).fill(0);
  /** Cases dont le code transmis au rendu a changé depuis le dernier delta. */
  readonly changed = new Set<number>();
  /** Listes de cases par code (reconstruites à la demande après une modification). */
  private lists: number[][] | null = null;

  /** Grille vide couvrant l'emprise (null : aucune partie). */
  reset(bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null): void {
    this.changed.clear();
    this.lists = null;
    this.counts.fill(0);
    if (!bounds) { this.info = null; this.zone = new Uint8Array(0); this.edge = new Uint8Array(0); this.seg = new Uint32Array(0); return; }
    const w = Math.max(1, Math.round((bounds.maxX - bounds.minX) / TILE_SIZE));
    const h = Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / TILE_SIZE));
    this.info = { originX: bounds.minX, originZ: bounds.minZ, cell: TILE_SIZE, w, h };
    this.zone = new Uint8Array(w * h);
    this.edge = new Uint8Array(w * h).fill(NO_ROAD);
    this.seg = new Uint32Array(w * h);
  }

  get size(): number { return this.zone.length; }
  get zonedCount(): number { let n = 0; for (let c = 1; c <= ZONE_COUNT; c++) n += this.counts[c]!; return n; }

  /** Index de la case contenant (x, z), -1 hors grille. */
  index(x: number, z: number): number {
    const g = this.info;
    if (!g) return -1;
    const i = Math.floor((x - g.originX) / g.cell), j = Math.floor((z - g.originZ) / g.cell);
    return i < 0 || j < 0 || i >= g.w || j >= g.h ? -1 : j * g.w + i;
  }

  centerX(idx: number): number { const g = this.info!; return g.originX + ((idx % g.w) + 0.5) * g.cell; }
  centerZ(idx: number): number { const g = this.info!; return g.originZ + (Math.floor(idx / g.w) + 0.5) * g.cell; }

  /** Distance au bord de la route la plus proche (m), Infinity sans route à portée. */
  edgeM(idx: number): number { const e = this.edge[idx]!; return e === NO_ROAD ? Infinity : e * 0.5; }
  connected(idx: number): boolean { return this.edge[idx]! !== NO_ROAD; }

  /** Code transmis au rendu : zone | CELL_CONNECTED. */
  wireCode(idx: number): number { return this.zone[idx]! | (this.edge[idx]! !== NO_ROAD ? CELL_CONNECTED : 0); }

  set(idx: number, code: ZoneCode): boolean {
    const old = this.zone[idx]!;
    if (old === code) return false;
    this.counts[old]!--;
    this.counts[code]!++;
    this.zone[idx] = code;
    this.changed.add(idx);
    this.lists = null;
    return true;
  }

  /** Recalcule la desserte d'une case (route la plus proche). */
  private refreshCell(idx: number, roads: RoadGeometry): void {
    const hit = roads.nearest(this.centerX(idx), this.centerZ(idx), MAX_EDGE_M);
    const before = this.edge[idx]!;
    if (hit) {
      this.edge[idx] = Math.min(NO_ROAD - 1, Math.max(0, Math.round((hit.d - hit.half) * 2)));
      this.seg[idx] = hit.segId;
    } else {
      this.edge[idx] = NO_ROAD;
      this.seg[idx] = 0;
    }
    if ((before === NO_ROAD) !== (this.edge[idx] === NO_ROAD) && this.zone[idx]) this.changed.add(idx);
  }

  /** Desserte de toutes les cases zonées (après une modification du réseau routier). */
  refreshConnectivity(roads: RoadGeometry): void {
    const z = this.zone;
    for (let i = 0; i < z.length; i++) if (z[i]) this.refreshCell(i, roads);
  }

  /**
   * Peint `code` (0 = efface) le long du tracé `points` [x0, z0, x1, z1, …].
   * Zonage : bande de `depth` cases depuis le bord des routes desservantes ; jamais sur la chaussée ni sur l'eau.
   */
  paint(points: readonly number[], code: ZoneCode, depth: number, radius: number, roads: RoadGeometry, isWet: (x: number, z: number) => boolean): number {
    const g = this.info;
    if (!g || points.length < 2) return 0;
    const dep = Math.max(ZONE_DEPTH_MIN, Math.min(ZONE_DEPTH_MAX, Math.round(depth)));
    const maxEdge = dep * g.cell;
    const r = Math.max(2, Math.min(80, radius));
    let changed = 0;
    const seen = new Set<number>();
    const n = Math.floor(points.length / 2);
    for (let k = 0; k < n; k++) {
      const ax = points[2 * k]!, az = points[2 * k + 1]!;
      const bx = k + 1 < n ? points[2 * k + 2]! : ax, bz = k + 1 < n ? points[2 * k + 3]! : az;
      if (k + 1 < n || n === 1) {
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - g.originX) / g.cell));
        const i1 = Math.min(g.w - 1, Math.floor((Math.max(ax, bx) + r - g.originX) / g.cell));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r - g.originZ) / g.cell));
        const j1 = Math.min(g.h - 1, Math.floor((Math.max(az, bz) + r - g.originZ) / g.cell));
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const idx = j * g.w + i;
            if (seen.has(idx)) continue;
            const cx = g.originX + (i + 0.5) * g.cell, cz = g.originZ + (j + 0.5) * g.cell;
            let t = l2 > 1e-9 ? ((cx - ax) * dx + (cz - az) * dz) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            if (Math.hypot(cx - (ax + dx * t), cz - (az + dz * t)) > r) continue;
            seen.add(idx);
            if (code === 0) { if (this.set(idx, 0)) changed++; continue; }
            const hit = roads.nearest(cx, cz, maxEdge);
            if (!hit) continue;
            const edge = hit.d - hit.half;
            if (edge < MIN_EDGE_M || edge > maxEdge || isWet(cx, cz)) continue;
            if (this.set(idx, code)) changed++;
            this.refreshCell(idx, roads);
          }
        }
      }
    }
    return changed;
  }

  /** Cases portant le code `code` (liste mise en cache). */
  cellsOf(code: number): readonly number[] {
    if (!this.lists) {
      const lists: number[][] = [];
      for (let c = 0; c <= ZONE_COUNT; c++) lists.push([]);
      const z = this.zone;
      for (let i = 0; i < z.length; i++) if (z[i]) lists[z[i]!]!.push(i);
      this.lists = lists;
    }
    return this.lists[code] ?? [];
  }

  /** Cases modifiées depuis le dernier appel : [index, code transmis, …]. */
  takeChanged(): number[] | undefined {
    if (this.changed.size === 0) return undefined;
    const out: number[] = [];
    for (const i of this.changed) out.push(i, this.wireCode(i));
    this.changed.clear();
    return out;
  }

  /** Grille complète pour le rendu (codes transmis, avec le bit de desserte). */
  wireRle(): number[] {
    const z = this.zone, e = this.edge;
    const w = new Uint8Array(z.length);
    for (let i = 0; i < z.length; i++) w[i] = z[i]! | (z[i] && e[i] !== NO_ROAD ? CELL_CONNECTED : 0);
    return rleEncode(w);
  }

  /** Zones seules (sauvegarde). */
  zonesRle(): number[] { return rleEncode(this.zone); }

  /** Recharge les zones (sauvegarde) ; la grille doit avoir la même géométrie. Lève si les données sont invalides. */
  loadZones(info: ZoneGridInfo, rle: readonly unknown[]): void {
    const g = this.info;
    if (!g || g.w !== info.w || g.h !== info.h) throw new Error(`grille ${info.w}×${info.h} incompatible avec la carte ${g?.w ?? 0}×${g?.h ?? 0}`);
    rleDecode(rle, this.zone, ZONE_COUNT);
    this.counts.fill(0);
    for (let i = 0; i < this.zone.length; i++) this.counts[this.zone[i]!]!++;
    this.lists = null;
    this.changed.clear();
  }
}
