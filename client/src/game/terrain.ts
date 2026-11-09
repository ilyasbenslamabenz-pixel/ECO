// Grille de hauteurs du pays (maille de 1 km) et utilitaires géométriques, indépendants du moteur 3D.
import { HALF_D, HALF_W, MAP_D, MAP_W, makeHeightFn } from '../../../shared/sim/country';
import { fbm } from '../../../shared/noise';
import type { CountryDef } from '../../../shared/sim/types';

export const VS = 2; // exagération verticale du relief (1 unité = 1 km au sol)
export const RES = 0.125; // maille de la grille de hauteurs (km)

export interface Grid {
  nx: number;
  nz: number;
  h: Float32Array; // altitudes (km)
  sample: (x: number, z: number) => number;
  y: (x: number, z: number) => number; // altitude de rendu (unités), jamais sous le niveau de la mer
}

export function buildGrid(country: CountryDef): Grid {
  const fn = makeHeightFn(country);
  const nx = Math.round(MAP_W / RES) + 1;
  const nz = Math.round(MAP_D / RES) + 1;
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = fn(-HALF_W + i * RES, -HALF_D + j * RES);
  const sample = (x: number, z: number) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x + HALF_W) / RES));
    const fz = Math.max(0, Math.min(nz - 1.001, (z + HALF_D) / RES));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = h[j * nx + i];
    const b = h[j * nx + i + 1];
    const c = h[(j + 1) * nx + i];
    const d = h[(j + 1) * nx + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };
  return { nx, nz, h, sample, y: (x, z) => Math.max(0, sample(x, z)) * VS };
}

/** Densifie une polyligne pour qu'elle épouse le relief. */
export function densify(points: [number, number][], step = 0.8): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function forestMask(x: number, z: number) {
  return fbm(x * 0.035 + 50, z * 0.035 - 20, 3);
}

export function distToPolyline(x: number, z: number, pts: [number, number][]) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    if (Math.abs(x - ax) > 2 && Math.abs(x - bx) > 2) continue;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    d = Math.min(d, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return d;
}

/** Environnement visuel partagé (cycle jour/nuit, saisons, météo), lu par les matériaux. */
export const ENV = { night: 0, winter: 0, autumn: 0, snow: 0, wet: 0, time: 0 };
