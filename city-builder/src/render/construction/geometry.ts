/**
 * Géométrie propre au CHANTIER, construite à la taille du bâtiment (rendu) — propriété p2a-chantiers.
 *
 * Ce qui ne peut pas être un modèle fixe (il épouse l'emprise du bâtiment) est construit ici, avec le
 * même soin que les modèles : plateforme de terrassement et rampe d'accès, dalle de fondation avec
 * coffrage bois et nappe d'armatures, ossature béton qui monte étage par étage (poteaux, poutres,
 * planchers, noyau), vestiges d'une démolition. Les matériaux sont ceux des GLB (textures partagées).
 *
 * Astuce de performance : l'ossature est construite UNE FOIS à la hauteur finale, les étages se suivant
 * dans le tampon d'indices ; la montée du bâtiment est alors un simple `setDrawRange` (aucune
 * reconstruction, aucune allocation par image).
 */
import * as THREE from 'three';

/** Accumulateur de géométrie (positions, normales, UV en mètres, indices). */
export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];

  get vertexCount(): number { return this.pos.length / 3; }
  get indexCount(): number { return this.idx.length; }

  /** Quadrilatère (sens trigonométrique vu de la normale). */
  quad(p0: THREE.Vector3Like, p1: THREE.Vector3Like, p2: THREE.Vector3Like, p3: THREE.Vector3Like, tile: number): void {
    const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
    const bx = p3.x - p0.x, by = p3.y - p0.y, bz = p3.z - p0.z;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const w = Math.hypot(ax, ay, az) / tile, h = Math.hypot(bx, by, bz) / tile;
    const base = this.vertexCount;
    const push = (p: THREE.Vector3Like, u: number, v: number): void => {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(nx, ny, nz);
      this.uv.push(u, v);
    };
    push(p0, 0, 0); push(p1, w, 0); push(p2, w, h); push(p3, 0, h);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Boîte axée (min/max), faces extérieures, UV en mètres. */
  box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tile: number, skipBottom = true): void {
    const v = (x: number, y: number, z: number): THREE.Vector3Like => ({ x, y, z });
    this.quad(v(minX, minY, maxZ), v(maxX, minY, maxZ), v(maxX, maxY, maxZ), v(minX, maxY, maxZ), tile);
    this.quad(v(maxX, minY, minZ), v(minX, minY, minZ), v(minX, maxY, minZ), v(maxX, maxY, minZ), tile);
    this.quad(v(maxX, minY, maxZ), v(maxX, minY, minZ), v(maxX, maxY, minZ), v(maxX, maxY, maxZ), tile);
    this.quad(v(minX, minY, minZ), v(minX, minY, maxZ), v(minX, maxY, maxZ), v(minX, maxY, minZ), tile);
    this.quad(v(minX, maxY, maxZ), v(maxX, maxY, maxZ), v(maxX, maxY, minZ), v(minX, maxY, minZ), tile);
    if (!skipBottom) this.quad(v(minX, minY, minZ), v(maxX, minY, minZ), v(maxX, minY, maxZ), v(minX, minY, maxZ), tile);
  }

  /** Barre carrée entre deux points (armatures, poutres fines). */
  bar(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, tile: number): void {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) return;
    const ux = dx / l, uy = dy / l, uz = dz / l;
    // Repère orthonormé autour de l'axe.
    let ax = 0, ay = 1, az = 0;
    if (Math.abs(uy) > 0.99) { ax = 1; ay = 0; }
    let px = ay * uz - az * uy, py = az * ux - ax * uz, pz = ax * uy - ay * ux;
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl; py /= pl; pz /= pl;
    const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
    const corner = (t: number, s1: number, s2: number): THREE.Vector3Like => ({
      x: x0 + ux * (l * t) + px * r * s1 + qx * r * s2,
      y: y0 + uy * (l * t) + py * r * s1 + qy * r * s2,
      z: z0 + uz * (l * t) + pz * r * s1 + qz * r * s2,
    });
    const ring: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const a = ring[i]!, b = ring[(i + 1) % 4]!;
      this.quad(corner(0, a[0], a[1]), corner(0, b[0], b[1]), corner(1, b[0], b[1]), corner(1, a[0], a[1]), tile);
    }
  }

  /** Construit la BufferGeometry (indices 32 bits si nécessaire). */
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Plateforme de terrassement : terre décapée, bord en talus et rampe d'accès côté +Z. */
export function buildPlatform(w: number, d: number, height = 0.35): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const x = w / 2, z = d / 2, t = height, s = 1.1; // talus
  const v = (px: number, py: number, pz: number): THREE.Vector3Like => ({ x: px, y: py, z: pz });
  // Dessus.
  b.quad(v(-x, t, z), v(x, t, z), v(x, t, -z), v(-x, t, -z), 2);
  // Talus périphérique (4 côtés).
  b.quad(v(-x - s, 0, z + s), v(x + s, 0, z + s), v(x, t, z), v(-x, t, z), 2);
  b.quad(v(x + s, 0, -z - s), v(-x - s, 0, -z - s), v(-x, t, -z), v(x, t, -z), 2);
  b.quad(v(x + s, 0, z + s), v(x + s, 0, -z - s), v(x, t, -z), v(x, t, z), 2);
  b.quad(v(-x - s, 0, -z - s), v(-x - s, 0, z + s), v(-x, t, z), v(-x, t, -z), 2);
  // Rampe d'accès (côté +Z).
  const rw = Math.min(5, w * 0.4);
  b.quad(v(-rw / 2, t, z + s), v(rw / 2, t, z + s), v(rw / 2, 0, z + s + 3.5), v(-rw / 2, 0, z + s + 3.5), 2);
  return b.build();
}

/** Dalle de fondation : béton, becquet de coffrage en bois et longrines. */
export function buildSlab(w: number, d: number, thickness = 0.45): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const x = w / 2, z = d / 2;
  b.box(-x, 0, -z, x, thickness, z, 2.5);
  // Longrines (bandes surélevées sous les futurs murs porteurs).
  const r = 0.35;
  b.box(-x, thickness, -z, x, thickness + 0.18, -z + r, 2.5);
  b.box(-x, thickness, z - r, x, thickness + 0.18, z, 2.5);
  b.box(-x, thickness, -z + r, -x + r, thickness + 0.18, z - r, 2.5);
  b.box(x - r, thickness, -z + r, x, thickness + 0.18, z - r, 2.5);
  return b.build();
}

/** Coffrage bois autour de la dalle (planches et piquets). */
export function buildFormwork(w: number, d: number, thickness = 0.45): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const x = w / 2 + 0.08, z = d / 2 + 0.08, h = thickness + 0.12;
  b.box(-x, 0, z - 0.05, x, h, z, 1.57);
  b.box(-x, 0, -z, x, h, -z + 0.05, 1.57);
  b.box(-x, 0, -z, -x + 0.05, h, z, 1.57);
  b.box(x - 0.05, 0, -z, x, h, z, 1.57);
  const n = Math.max(2, Math.round(w / 2.5));
  for (let i = 0; i <= n; i++) {
    const px = -x + (2 * x * i) / n;
    b.bar(px, 0, z + 0.12, px, h + 0.25, z + 0.12, 0.04, 1.57);
    b.bar(px, 0, -z - 0.12, px, h + 0.25, -z - 0.12, 0.04, 1.57);
  }
  return b.build();
}

/** Nappe d'armatures (acier) au-dessus de la dalle. */
export function buildRebar(w: number, d: number, y: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const x = w / 2 - 0.3, z = d / 2 - 0.3;
  const step = 1.1;
  const nx = Math.max(2, Math.round((2 * x) / step));
  const nz = Math.max(2, Math.round((2 * z) / step));
  for (let i = 0; i <= nx; i++) {
    const px = -x + (2 * x * i) / nx;
    b.bar(px, y, -z, px, y, z, 0.016, 0.5);
  }
  for (let j = 0; j <= nz; j++) {
    const pz = -z + (2 * z * j) / nz;
    b.bar(-x, y + 0.035, pz, x, y + 0.035, pz, 0.016, 0.5);
  }
  return b.build();
}

export interface StructureGeometry {
  geometry: THREE.BufferGeometry;
  /** Nombre d'indices cumulés après chaque étage (etage 0 = premier plancher). */
  floorRanges: number[];
  floors: number;
  floorHeight: number;
}

/**
 * Ossature béton à la taille du bâtiment : poteaux, poutres de rive, planchers et noyau central.
 * Les étages se suivent dans le tampon d'indices : `floorRanges[k]` donne le nombre d'indices à
 * dessiner pour montrer k+1 étages (montée progressive sans reconstruire la géométrie).
 */
export function buildStructure(w: number, d: number, height: number, floorHeight = 3.1): StructureGeometry {
  const floors = Math.max(1, Math.min(60, Math.round(height / floorHeight)));
  const b = new GeoBuilder();
  const ranges: number[] = [];
  const x = w / 2 - 0.35, z = d / 2 - 0.35;
  const colR = Math.max(0.16, Math.min(0.32, 0.12 + height * 0.0022));
  const nx = Math.max(2, Math.round(w / 6));
  const nz = Math.max(2, Math.round(d / 6));
  const core = w > 16 && d > 16 && floors > 6;
  for (let f = 0; f < floors; f++) {
    const y0 = f * floorHeight;
    const y1 = y0 + floorHeight;
    // Poteaux de l'étage.
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        if (i > 0 && i < nx && j > 0 && j < nz) continue; // poteaux de rive + file centrale
        const px = -x + (2 * x * i) / nx;
        const pz = -z + (2 * z * j) / nz;
        b.box(px - colR, y0, pz - colR, px + colR, y1 - 0.22, pz + colR, 2.5);
      }
    }
    // File intérieure (un poteau sur deux) pour les grandes emprises.
    if (nx > 2 && nz > 2) {
      for (let i = 1; i < nx; i += 2) {
        for (let j = 1; j < nz; j += 2) {
          const px = -x + (2 * x * i) / nx;
          const pz = -z + (2 * z * j) / nz;
          b.box(px - colR * 0.85, y0, pz - colR * 0.85, px + colR * 0.85, y1 - 0.22, pz + colR * 0.85, 2.5);
        }
      }
    }
    // Noyau (cage d'escalier / ascenseurs).
    if (core) {
      const cw = Math.min(5, w * 0.22), cd = Math.min(4.5, d * 0.22);
      b.box(-cw / 2, y0, -cd / 2, -cw / 2 + 0.25, y1, cd / 2, 2.5);
      b.box(cw / 2 - 0.25, y0, -cd / 2, cw / 2, y1, cd / 2, 2.5);
      b.box(-cw / 2, y0, -cd / 2, cw / 2, y1, -cd / 2 + 0.25, 2.5);
    }
    // Plancher de l'étage (dalle pleine + retombée de rive).
    b.box(-x - 0.35, y1 - 0.22, -z - 0.35, x + 0.35, y1, z + 0.35, 2.5, false);
    ranges.push(b.indexCount);
  }
  return { geometry: b.build(), floorRanges: ranges, floors, floorHeight };
}

/**
 * Vestiges d'une démolition : murs rompus en dents de scie et pans écroulés, à la taille du bâtiment.
 * `ratio` (0..1) donne la part encore debout ; la géométrie est construite une fois pour `ratio = 1`,
 * et les tranches horizontales se suivent dans le tampon d'indices (même astuce que l'ossature).
 */
export function buildRemains(w: number, d: number, height: number): StructureGeometry {
  const slices = Math.max(2, Math.min(40, Math.round(height / 2.2)));
  const sliceH = height / slices;
  const b = new GeoBuilder();
  const ranges: number[] = [];
  const x = w / 2, z = d / 2;
  const hash = (n: number): number => {
    let v = (n | 0) ^ 0x9e3779b9;
    v = Math.imul(v ^ (v >>> 16), 0x85ebca6b);
    v = Math.imul(v ^ (v >>> 13), 0xc2b2ae35);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  // Tranches du bas vers le haut : chaque tranche est un anneau de murs percé d'ouvertures irrégulières.
  for (let s = 0; s < slices; s++) {
    const y0 = s * sliceH, y1 = y0 + sliceH * 0.92;
    const n = Math.max(3, Math.round(w / 3));
    for (let i = 0; i < n; i++) {
      const x0 = -x + (2 * x * i) / n, x1 = -x + (2 * x * (i + 1)) / n;
      if (hash(s * 131 + i) > 0.25) b.box(x0 + 0.1, y0, z - 0.4, x1 - 0.1, y1 * (0.9 + 0.1 * hash(i * 7 + s)), z, 2.5);
      if (hash(s * 57 + i + 99) > 0.25) b.box(x0 + 0.1, y0, -z, x1 - 0.1, y1, -z + 0.4, 2.5);
    }
    const m = Math.max(3, Math.round(d / 3));
    for (let j = 0; j < m; j++) {
      const z0 = -z + (2 * z * j) / m, z1 = -z + (2 * z * (j + 1)) / m;
      if (hash(s * 311 + j + 7) > 0.3) b.box(-x, y0, z0 + 0.1, -x + 0.4, y1, z1 - 0.1, 2.5);
      if (hash(s * 733 + j + 17) > 0.3) b.box(x - 0.4, y0, z0 + 0.1, x, y1, z1 - 0.1, 2.5);
    }
    ranges.push(b.indexCount);
  }
  return { geometry: b.build(), floorRanges: ranges, floors: slices, floorHeight: sliceH };
}
