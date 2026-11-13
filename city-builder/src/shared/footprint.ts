/**
 * Empreintes au sol des bâtiments : rectangles ORIENTÉS (angle libre), partagés par la simulation
 * (validation, collisions, accès route) et par le client (aperçu, aimantation, sélection).
 * TypeScript pur, sans three ni DOM : portable tel quel (C#/C++) pour un portage Unity/Unreal.
 *
 * Convention de rotation : `rot` est exprimé en QUARTS DE TOUR (0..4, décimal autorisé depuis la
 * phase 1 : 0,5 = 45°), sens trigonométrique vu du dessus, identique à `Object3D.rotation.y` de three :
 *   monde = (lx·cosθ + lz·sinθ, −lx·sinθ + lz·cosθ), θ = rot·π/2.
 * Les sauvegardes antérieures (rot entier 0..3) restent valides sans conversion.
 */
import { TILE_SIZE } from './constants';

/** Rotation normalisée dans [0, 4[ (arrondie au 1/10 000 de quart de tour : sauvegarde stable). */
export function normRot(rot: number): number {
  const r = ((rot % 4) + 4) % 4;
  const q = Math.round(r * 10000) / 10000;
  return q >= 4 ? 0 : q;
}

/** Angle (radians) d'une rotation en quarts de tour. */
export function rotAngle(rot: number): number {
  return normRot(rot) * (Math.PI / 2);
}

/** Rotation (quarts de tour) correspondant à un angle en radians. */
export function angleToRot(theta: number): number {
  return normRot(theta / (Math.PI / 2));
}

/** Rectangle orienté : centre, demi-dimensions LOCALES (avant rotation), cos/sin de l'angle. */
export interface Obb {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  c: number;
  s: number;
}

export function makeObb(cx: number, cz: number, hx: number, hz: number, rot: number, out?: Obb): Obb {
  const th = rotAngle(rot);
  // Quarts de tour exacts : cos/sin exacts (pas de 6e-17 qui rendrait les tests de contact instables).
  const q = normRot(rot);
  let c = Math.cos(th), s = Math.sin(th);
  if (q === 0) { c = 1; s = 0; } else if (q === 1) { c = 0; s = 1; } else if (q === 2) { c = -1; s = 0; } else if (q === 3) { c = 0; s = -1; }
  const o = out ?? { cx: 0, cz: 0, hx: 0, hz: 0, c: 1, s: 0 };
  o.cx = cx; o.cz = cz; o.hx = hx; o.hz = hz; o.c = c; o.s = s;
  return o;
}

/** Empreinte d'un bâtiment de `tilesX × tilesZ` cases posé en (x, z) avec la rotation `rot`. */
export function footprintObb(tilesX: number, tilesZ: number, x: number, z: number, rot: number, out?: Obb): Obb {
  return makeObb(x, z, (tilesX * TILE_SIZE) / 2, (tilesZ * TILE_SIZE) / 2, rot, out);
}

/** Local -> monde. */
export function obbToWorld(o: Obb, lx: number, lz: number): [number, number] {
  return [o.cx + lx * o.c + lz * o.s, o.cz - lx * o.s + lz * o.c];
}

/** Monde -> local. */
export function obbToLocal(o: Obb, x: number, z: number): [number, number] {
  const dx = x - o.cx, dz = z - o.cz;
  return [dx * o.c - dz * o.s, dx * o.s + dz * o.c];
}

/** Coins dans l'ordre (−,−) (+,−) (+,+) (−,+), en coordonnées monde : [x0,z0, x1,z1, ...]. */
export function obbCorners(o: Obb): number[] {
  const out: number[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const [x, z] = obbToWorld(o, sx * o.hx, sz * o.hz);
    out.push(x, z);
  }
  return out;
}

/** Boîte englobante alignée sur les axes. */
export function obbAabb(o: Obb): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const ex = Math.abs(o.hx * o.c) + Math.abs(o.hz * o.s);
  const ez = Math.abs(o.hx * o.s) + Math.abs(o.hz * o.c);
  return { minX: o.cx - ex, minZ: o.cz - ez, maxX: o.cx + ex, maxZ: o.cz + ez };
}

export function pointInObb(o: Obb, x: number, z: number, margin = 0): boolean {
  const [lx, lz] = obbToLocal(o, x, z);
  return Math.abs(lx) <= o.hx + margin && Math.abs(lz) <= o.hz + margin;
}

/** Recouvrement strict (séparation par les axes). `eps` > 0 tolère un contact bord à bord. */
export function obbOverlap(a: Obb, b: Obb, eps = 0.01): boolean {
  // Axes : x et z locaux de a puis de b. Axe local x de o en monde = (c, −s), axe z = (s, c).
  const axes = [a.c, -a.s, a.s, a.c, b.c, -b.s, b.s, b.c];
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (let k = 0; k < 8; k += 2) {
    const ux = axes[k]!, uz = axes[k + 1]!;
    const ra = a.hx * Math.abs(a.c * ux - a.s * uz) + a.hz * Math.abs(a.s * ux + a.c * uz);
    const rb = b.hx * Math.abs(b.c * ux - b.s * uz) + b.hz * Math.abs(b.s * ux + b.c * uz);
    if (Math.abs(dx * ux + dz * uz) >= ra + rb - eps) return false;
  }
  return true;
}

/** Distance d'un point à un rectangle aligné (0 à l'intérieur). */
function distPointBox(x: number, z: number, hx: number, hz: number): number {
  const dx = Math.max(Math.abs(x) - hx, 0), dz = Math.max(Math.abs(z) - hz, 0);
  return Math.hypot(dx, dz);
}

function segSeg(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function distPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax, ez = bz - az;
  const l2 = ex * ex + ez * ez;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2)) : 0;
  return Math.hypot(ax + ex * t - px, az + ez * t - pz);
}

/** Distance d'un segment (monde) au rectangle orienté (0 s'il le touche ou le traverse). */
export function distSegmentObb(ax: number, az: number, bx: number, bz: number, o: Obb): number {
  const [lax, laz] = obbToLocal(o, ax, az);
  const [lbx, lbz] = obbToLocal(o, bx, bz);
  const hx = o.hx, hz = o.hz;
  if (Math.abs(lax) <= hx && Math.abs(laz) <= hz) return 0;
  if (Math.abs(lbx) <= hx && Math.abs(lbz) <= hz) return 0;
  const cs = [-hx, -hz, hx, -hz, hx, hz, -hx, hz];
  for (let k = 0; k < 8; k += 2) {
    const n = (k + 2) % 8;
    if (segSeg(lax, laz, lbx, lbz, cs[k]!, cs[k + 1]!, cs[n]!, cs[n + 1]!)) return 0;
  }
  let d = Math.min(distPointBox(lax, laz, hx, hz), distPointBox(lbx, lbz, hx, hz));
  for (let k = 0; k < 8; k += 2) d = Math.min(d, distPointSeg(cs[k]!, cs[k + 1]!, lax, laz, lbx, lbz));
  return d;
}
