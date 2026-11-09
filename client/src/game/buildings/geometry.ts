// Gabarits géométriques unitaires (emprise [-0.5, 0.5]², hauteur [0, 1]) instanciés et mis à l'échelle
// par bâtiment. Chaque sommet porte « pinfo » = (partie, hauteur relative du haut des murs) :
// partie 0 = mur, 1 = toit plat, 2 = toit en pente, 3 = verrière, 4 = mur cylindrique.
import { Mesh, VertexData, type Scene } from '@babylonjs/core';

export const PART = { wall: 0, flat: 1, slope: 2, glass: 3, cyl: 4 } as const;
type V3 = [number, number, number];

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  info: number[] = [];
  idx: number[] = [];
  constructor(public wallTop: number) {}
  /** Polygone convexe plan ; l'ordre des sommets est corrigé selon la normale extérieure fournie. */
  poly(pts: V3[], n: V3, part: number, extra = 0) {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const nn: V3 = [n[0] / l, n[1] / l, n[2] / l];
    this.polyN(pts, pts.map(() => nn), part, extra);
  }
  /** Polygone avec une normale par sommet (surfaces lissées). */
  polyN(pts: V3[], ns: V3[], part: number, extra = 0) {
    const base = this.pos.length / 3;
    pts.forEach((p, i) => { this.pos.push(...p); this.nrm.push(...ns[i]); this.info.push(part, extra || this.wallTop); });
    // convention Babylon : cross(b - a, c - a) opposé à la normale
    const [a, b, c] = pts;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const n = ns[0];
    const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0;
    for (let i = 1; i < pts.length - 1; i++) {
      if (flip) this.idx.push(base, base + i + 1, base + i);
      else this.idx.push(base, base + i, base + i + 1);
    }
  }
  /** Prisme droit à base rectangulaire (murs + dessus), sans fond. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, top: number = PART.flat, wall: number = PART.wall) {
    this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], wall);
    this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], wall);
    this.poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], wall);
    this.poly([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], wall);
    if (top >= 0) this.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], top);
  }
  mesh(name: string, scene: Scene) {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.normals = this.nrm;
    vd.indices = this.idx;
    vd.applyToMesh(m);
    m.setVerticesData('pinfo', this.info, false, 2);
    return m;
  }
}

/** Bloc à toit plat. */
export function boxTemplate(name: string, scene: Scene) {
  const b = new Builder(1);
  b.box(-0.5, 0.5, 0, 1, -0.5, 0.5);
  return b.mesh(name, scene);
}

/** Tour cylindrique (16 pans lissés) à toit plat. */
export function cylTemplate(name: string, scene: Scene, seg = 16) {
  const b = new Builder(1);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    b.polyN([[c0 * 0.5, 0, s0 * 0.5], [c1 * 0.5, 0, s1 * 0.5], [c1 * 0.5, 1, s1 * 0.5], [c0 * 0.5, 1, s0 * 0.5]], [[c0, 0, s0], [c1, 0, s1], [c1, 0, s1], [c0, 0, s0]], PART.cyl);
  }
  const top: V3[] = [];
  for (let i = seg - 1; i >= 0; i--) { const a = (i / seg) * Math.PI * 2; top.push([Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5]); }
  b.poly(top, [0, 1, 0], PART.flat);
  return b.mesh(name, scene);
}

/** Silo : cylindre et toit conique. */
export function siloTemplate(name: string, scene: Scene, seg = 12) {
  const wt = 0.86;
  const b = new Builder(wt);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    b.polyN([[c0 * 0.5, 0, s0 * 0.5], [c1 * 0.5, 0, s1 * 0.5], [c1 * 0.5, wt, s1 * 0.5], [c0 * 0.5, wt, s0 * 0.5]], [[c0, 0, s0], [c1, 0, s1], [c1, 0, s1], [c0, 0, s0]], PART.cyl);
    b.polyN([[c0 * 0.5, wt, s0 * 0.5], [c1 * 0.5, wt, s1 * 0.5], [0, 1, 0]], [[c0, 0.8, s0], [c1, 0.8, s1], [(c0 + c1) / 2, 0.8, (s0 + s1) / 2]], PART.slope);
  }
  return b.mesh(name, scene);
}

/**
 * Immeuble à brisis (comble mansardé) : murs jusqu'à 0,78, brisis à forte pente sur les deux longs
 * pans (±z), terrasson plat ; les pignons (±x) restent verticaux pour former des rangs continus.
 */
export function mansardTemplate(name: string, scene: Scene) {
  const wt = 0.78, top = 0.97, ins = 0.32;
  const b = new Builder(wt);
  b.box(-0.5, 0.5, 0, wt, -0.5, 0.5, -1);
  b.poly([[-0.5, wt, -0.5], [0.5, wt, -0.5], [0.5, top, -ins], [-0.5, top, -ins]], [0, 0.18 / 0.19, -1], PART.slope);
  b.poly([[-0.5, wt, 0.5], [0.5, wt, 0.5], [0.5, top, ins], [-0.5, top, ins]], [0, 0.18 / 0.19, 1], PART.slope);
  b.poly([[-0.5, wt, -0.5], [-0.5, wt, 0.5], [-0.5, top, ins], [-0.5, top, -ins]], [-1, 0, 0], PART.slope);
  b.poly([[0.5, wt, -0.5], [0.5, wt, 0.5], [0.5, top, ins], [0.5, top, -ins]], [1, 0, 0], PART.slope);
  b.poly([[-0.5, top, -ins], [0.5, top, -ins], [0.5, top, ins], [-0.5, top, ins]], [0, 1, 0], PART.flat);
  // souches de cheminée en briques sur le terrasson
  b.box(-0.42, -0.36, top, 1, -0.12, 0.12, PART.flat, PART.slope);
  b.box(0.36, 0.42, top, 1, -0.12, 0.12, PART.flat, PART.slope);
  return b.mesh(name, scene);
}

/**
 * Îlot haussmannien complet en un seul volume (niveau de détail lointain) : quatre ailes à brisis
 * autour d'une cour, profondeur d'aile relative « dep ».
 */
export function ringTemplate(name: string, scene: Scene, dep = 0.1) {
  const wt = 0.78, top = 0.97, ins = 0.32 * dep;
  const b = new Builder(wt);
  const wing = (x0: number, x1: number, z0: number, z1: number, alongX: boolean) => {
    b.box(x0, x1, 0, wt, z0, z1, -1);
    if (alongX) {
      b.poly([[x0, wt, z0], [x1, wt, z0], [x1, top, z0 + ins], [x0, top, z0 + ins]], [0, 0.9, -1], PART.slope);
      b.poly([[x0, wt, z1], [x1, wt, z1], [x1, top, z1 - ins], [x0, top, z1 - ins]], [0, 0.9, 1], PART.slope);
      b.poly([[x0, top, z0 + ins], [x1, top, z0 + ins], [x1, top, z1 - ins], [x0, top, z1 - ins]], [0, 1, 0], PART.flat);
    } else {
      b.poly([[x0, wt, z0], [x0, wt, z1], [x0 + ins, top, z1], [x0 + ins, top, z0]], [-1, 0.9, 0], PART.slope);
      b.poly([[x1, wt, z0], [x1, wt, z1], [x1 - ins, top, z1], [x1 - ins, top, z0]], [1, 0.9, 0], PART.slope);
      b.poly([[x0 + ins, top, z0], [x1 - ins, top, z0], [x1 - ins, top, z1], [x0 + ins, top, z1]], [0, 1, 0], PART.flat);
    }
  };
  wing(-0.5, 0.5, 0.5 - dep, 0.5, true);
  wing(-0.5, 0.5, -0.5, -0.5 + dep, true);
  wing(-0.5, -0.5 + dep, -0.5 + dep, 0.5 - dep, false);
  wing(0.5 - dep, 0.5, -0.5 + dep, 0.5 - dep, false);
  return b.mesh(name, scene);
}

/** Pavillon : murs jusqu'à 0,6 et vrai toit à deux pans (prisme) avec débords, faîtage selon x. */
export function houseTemplate(name: string, scene: Scene) {
  const wt = 0.6, ov = 0.06;
  const b = new Builder(wt);
  b.box(-0.5, 0.5, 0, wt, -0.5, 0.5, -1);
  // pignons triangulaires
  b.poly([[-0.5, wt, -0.5], [-0.5, wt, 0.5], [-0.5, 1, 0]], [-1, 0, 0], PART.wall);
  b.poly([[0.5, wt, -0.5], [0.5, wt, 0.5], [0.5, 1, 0]], [1, 0, 0], PART.wall);
  // pans de toiture avec débord
  const ye = wt - ov * (1 - wt) / 0.5;
  const sl = (1 - wt) / 0.5;
  b.poly([[-0.5 - ov, ye, -0.5 - ov], [0.5 + ov, ye, -0.5 - ov], [0.5 + ov, 1, 0], [-0.5 - ov, 1, 0]], [0, 1, -sl], PART.slope);
  b.poly([[-0.5 - ov, ye, 0.5 + ov], [0.5 + ov, ye, 0.5 + ov], [0.5 + ov, 1, 0], [-0.5 - ov, 1, 0]], [0, 1, sl], PART.slope);
  // dessous des débords (visibles en vue rasante)
  b.poly([[-0.5 - ov, ye, -0.5 - ov], [0.5 + ov, ye, -0.5 - ov], [0.5 + ov, wt, -0.5], [-0.5 - ov, wt, -0.5]], [0, -1, 0], PART.wall);
  b.poly([[-0.5 - ov, ye, 0.5 + ov], [0.5 + ov, ye, 0.5 + ov], [0.5 + ov, wt, 0.5], [-0.5 - ov, wt, 0.5]], [0, -1, 0], PART.wall);
  // cheminée
  b.box(0.18, 0.28, 0.8, 1.08, 0.08, 0.2, PART.flat, PART.slope);
  return b.mesh(name, scene);
}

/** Toiture en sheds (dents de scie, verrières orientées au nord), 5 dents selon z. */
export function shedTemplate(name: string, scene: Scene, teeth = 5) {
  const wt = 0.7;
  const b = new Builder(wt);
  b.box(-0.5, 0.5, 0, wt, -0.5, 0.5, -1);
  for (let k = 0; k < teeth; k++) {
    const z0 = -0.5 + k / teeth, z1 = z0 + 1 / teeth;
    b.poly([[-0.5, wt, z0], [0.5, wt, z0], [0.5, 1, z1], [-0.5, 1, z1]], [0, 1 / teeth, -(1 - wt)], PART.slope);
    b.poly([[-0.5, wt, z1], [0.5, wt, z1], [0.5, 1, z1], [-0.5, 1, z1]], [0, 0, 1], PART.glass);
    b.poly([[-0.5, wt, z0], [-0.5, wt, z1], [-0.5, 1, z1]], [-1, 0, 0], PART.wall);
    b.poly([[0.5, wt, z0], [0.5, wt, z1], [0.5, 1, z1]], [1, 0, 0], PART.wall);
  }
  return b.mesh(name, scene);
}

/** Hangar à toiture cintrée (voûte selon x). */
export function vaultTemplate(name: string, scene: Scene, seg = 10) {
  const wt = 0.55;
  const b = new Builder(wt);
  b.box(-0.5, 0.5, 0, wt, -0.5, 0.5, -1);
  const prof: [number, number][] = [];
  for (let i = 0; i <= seg; i++) { const a = Math.PI * (1 - i / seg); prof.push([Math.cos(a) * 0.5, wt + Math.sin(a) * (1 - wt)]); }
  for (let i = 0; i < seg; i++) {
    const [z0, y0] = prof[i], [z1, y1] = prof[i + 1];
    const n0: V3 = [0, (y0 - wt) / (1 - wt), z0 * 2], n1: V3 = [0, (y1 - wt) / (1 - wt), z1 * 2];
    b.polyN([[-0.5, y0, z0], [0.5, y0, z0], [0.5, y1, z1], [-0.5, y1, z1]], [n0, n0, n1, n1], PART.slope);
  }
  for (const x of [-0.5, 0.5]) {
    const pts: V3[] = prof.map(([z, y]) => [x, y, z]);
    b.poly(pts, [x * 2, 0, 0], PART.wall);
  }
  return b.mesh(name, scene);
}

/**
 * Pile de balcons : 24 niveaux (dalle + garde-corps) espacés d'une unité ; le shader escamote les
 * niveaux au-delà du nombre d'étages de l'instance (pinfo.y = numéro de niveau).
 */
export function balconyTemplate(name: string, scene: Scene, levels = 24) {
  const b = new Builder(1);
  for (let k = 0; k < levels; k++) {
    const y = k;
    // dalle (profondeur selon +z, de 0 à 1)
    const s = b.pos.length / 3;
    b.box(-0.5, 0.5, y, y + 0.06, 0, 1, PART.flat, PART.wall);
    // garde-corps : face avant et retours
    b.poly([[-0.5, y + 0.06, 1], [0.5, y + 0.06, 1], [0.5, y + 0.36, 1], [-0.5, y + 0.36, 1]], [0, 0, 1], PART.glass);
    b.poly([[-0.5, y + 0.06, 1], [0.5, y + 0.06, 1], [0.5, y + 0.36, 1], [-0.5, y + 0.36, 1]], [0, 0, -1], PART.glass);
    for (let i = s; i < b.pos.length / 3; i++) b.info[i * 2 + 1] = k;
  }
  return b.mesh(name, scene);
}

/** Arbre bas-poly : tronc et houppier (octaèdre allongé), pour les cours et jardins. */
export function treeTemplate(name: string, scene: Scene) {
  const b = new Builder(1);
  b.box(-0.06, 0.06, 0, 0.4, -0.06, 0.06, -1, PART.wall);
  const r = 0.5, y0 = 0.3, y1 = 0.62, y2 = 1;
  const ring: V3[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ring.push([Math.cos(a) * r, y1, Math.sin(a) * r]); }
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const mx = (p[0] + q[0]) / 2, mz = (p[2] + q[2]) / 2;
    b.polyN([p, q, [0, y2, 0]], [[p[0], 0.7, p[2]], [q[0], 0.7, q[2]], [0, 1, 0]], PART.slope);
    b.polyN([q, p, [0, y0, 0]], [[q[0], -0.3, q[2]], [p[0], -0.3, p[2]], [mx, -1, mz]], PART.slope);
  }
  return b.mesh(name, scene);
}
