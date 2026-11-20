/**
 * Collisions de la rue : les immeubles sont des rectangles alignés sur les axes. Un cercle (personnage, véhicule)
 * est repoussé hors des rectangles voisins (grille de hachage de 24 m). Occlusion caméra : le segment tête →
 * caméra traverse-t-il un immeuble (en tenant compte de sa hauteur) ? TypeScript pur.
 */
import type { District } from '../sim/district';

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number; h: number }
const CELL = 24;
export const FLOOR_H = 3.2;

export class Collider {
  readonly rects: Rect[] = [];
  private readonly grid = new Map<number, number[]>();
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  constructor(rects: Rect[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    for (const r of rects) this.add(r);
    this.bounds = bounds;
  }

  /** Immeubles du quartier, limites à 30 m au-delà des dernières rues. */
  static fromDistrict(d: District): Collider {
    const m = 30;
    return new Collider(d.buildings.map((b) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.floors * FLOOR_H + 0.6 })),
      { minX: -d.size.w / 2 - m, maxX: d.size.w / 2 + m, minZ: -d.size.d / 2 - m, maxZ: d.size.d / 2 + m });
  }

  add(r: Rect): void {
    const k = this.rects.push(r) - 1;
    for (let i = Math.floor(r.minX / CELL); i <= Math.floor(r.maxX / CELL); i++) {
      for (let j = Math.floor(r.minZ / CELL); j <= Math.floor(r.maxZ / CELL); j++) {
        const key = i * 4096 + j;
        const list = this.grid.get(key);
        if (list) list.push(k); else this.grid.set(key, [k]);
      }
    }
  }

  private near(x: number, z: number, r: number): Set<number> {
    const out = new Set<number>();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) for (const k of this.grid.get(i * 4096 + j) ?? []) out.add(k);
    }
    return out;
  }

  /** Position corrigée d'un cercle (x, z, rayon) et indicateur de contact. */
  resolve(x: number, z: number, radius: number): { x: number; z: number; hit: boolean } {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const k of this.near(x, z, radius)) {
        const r = this.rects[k]!;
        const cx = Math.max(r.minX, Math.min(x, r.maxX)), cz = Math.max(r.minZ, Math.min(z, r.maxZ));
        let dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        hit = true;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * radius; z = cz + (dz / d) * radius;
        } else {
          // Centre à l'intérieur : sortie par le bord le plus proche.
          const l = x - r.minX, rr = r.maxX - x, t = z - r.minZ, bb = r.maxZ - z;
          const m = Math.min(l, rr, t, bb);
          if (m === l) x = r.minX - radius; else if (m === rr) x = r.maxX + radius; else if (m === t) z = r.minZ - radius; else z = r.maxZ + radius;
          dx = 0; dz = 0;
        }
      }
    }
    const b = this.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) hit = true;
    x = Math.max(b.minX, Math.min(b.maxX, x)); z = Math.max(b.minZ, Math.min(b.maxZ, z));
    return { x, z, hit };
  }

  /** Part (0..1) du segment a → b libre avant le premier immeuble traversé. */
  clearFraction(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const steps = Math.max(2, Math.ceil(len / 0.5));
    const cand = this.near((ax + bx) / 2, (az + bz) / 2, len / 2 + 1);
    if (!cand.size) return 1;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      for (const k of cand) {
        const r = this.rects[k]!;
        if (y < r.h && x > r.minX - 0.3 && x < r.maxX + 0.3 && z > r.minZ - 0.3 && z < r.maxZ + 0.3) return Math.max(0, (s - 1) / steps);
      }
    }
    return 1;
  }
}
