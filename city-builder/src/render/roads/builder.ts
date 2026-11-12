/**
 * Générateur de maillage routier PROCÉDURAL, indépendant du moteur (aucun import de three) :
 * produit des tampons de sommets/indices par « couche » de matériau et des listes de décor
 * (lampadaires, arbres, mobilier) pour un ensemble de tronçons et de carrefours.
 * Pourrait tourner dans un Web Worker (tampons transférables) ; aujourd'hui appelé sur le thread
 * principal à la reconstruction d'un chunk (jamais par frame).
 *
 * Contenu : chaussée (asphalte), trottoirs surélevés avec bordures, terre-plein planté ou séparateur
 * béton, talus de rive (jupe) masquant le raccord au terrain, ponts (tablier, poutre caisson, corniche,
 * parapet béton + garde-corps métallique, piles avec chevêtre), dalles de carrefour à coins arrondis,
 * impasses arrondies, marquages (axes discontinus/continus, rives, séparation de voies, flèches,
 * passages piétons, lignes d'arrêt).
 */
import {
  ArcTable, CORNER_RADIUS, ROAD_KINDS, carriagewayWidth, computeJunction, derivCubic, evalCubic,
  lineIntersectT, profileGroundAt, profileHeightAt, profileIsBridge, totalWidth,
  type Cubic, type JunctionArm, type JunctionInfo, type RoadKindDef, type RoadNetwork, type RoadProfile,
} from '../../sim/roads';

export type LayerId = 'asphalt' | 'asphaltWorn' | 'sidewalk' | 'curb' | 'pavers' | 'grass' | 'concrete' | 'metal' | 'paint' | 'skirt';
export const LAYERS: readonly LayerId[] = ['asphalt', 'asphaltWorn', 'sidewalk', 'curb', 'pavers', 'grass', 'concrete', 'metal', 'paint', 'skirt'];

export class LayerBuffer {
  pos: number[] = [];
  idx: number[] = [];
  get vertexCount(): number { return this.pos.length / 3; }
  v(x: number, y: number, z: number): number {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
}

export type DecorKind = 'lamp' | 'tree' | 'bench' | 'planter' | 'bin';
export interface DecorItem { kind: DecorKind; x: number; y: number; z: number; rot: number; scale: number }

export interface BuildOutput {
  layers: Map<LayerId, LayerBuffer>;
  decor: DecorItem[];
}

export function newOutput(): BuildOutput {
  const layers = new Map<LayerId, LayerBuffer>();
  for (const l of LAYERS) layers.set(l, new LayerBuffer());
  return { layers, decor: [] };
}

/* Constantes de profil en travers. */
const SKIRT_DEPTH = 1.4;      // jupe sous la rive (m)
const PAINT_LIFT = 0.012;
const DECK_THICK = 0.9;
const PARAPET_H = 0.55;
const PARAPET_W = 0.35;
const RAIL_H = 1.05;
const BARRIER_H = 0.82;

/** Échantillonneur d'un tronçon : position, tangente, normale gauche, hauteur à l'abscisse s. */
class SegSampler {
  readonly curve: Cubic;
  readonly arc: ArcTable;
  readonly profile: RoadProfile;
  readonly length: number;
  private p = new Float64Array(2);
  private d = new Float64Array(2);
  x = 0; z = 0; y = 0; tx = 1; tz = 0; nx = 0; nz = -1; bridge = false; ground = 0;
  constructor(net: RoadNetwork, segId: number) {
    this.curve = net.curve(segId);
    this.arc = net.arc(segId);
    this.profile = net.profile(segId);
    this.length = this.arc.length;
  }
  at(s: number): this {
    const t = this.arc.tAt(s);
    evalCubic(this.curve, t, this.p);
    derivCubic(this.curve, t, this.d);
    const l = Math.hypot(this.d[0]!, this.d[1]!) || 1;
    this.x = this.p[0]!; this.z = this.p[1]!;
    this.tx = this.d[0]! / l; this.tz = this.d[1]! / l;
    // Normale gauche (vue de dessus, x vers l'est, z vers le sud) : (tz, -tx).
    this.nx = this.tz; this.nz = -this.tx;
    this.y = profileHeightAt(this.profile, s);
    this.bridge = profileIsBridge(this.profile, s);
    this.ground = profileGroundAt(this.profile, s);
    return this;
  }
}

/** Station d'un profil en travers : repère local figé (avec onglet éventuel). */
interface Station { x: number; z: number; y: number; nx: number; nz: number; tx: number; tz: number; miter: number; bridge: boolean; ground: number; s: number }

function stationFrom(sm: SegSampler, s: number): Station {
  sm.at(s);
  return { x: sm.x, z: sm.z, y: sm.y, nx: sm.nx, nz: sm.nz, tx: sm.tx, tz: sm.tz, miter: 1, bridge: sm.bridge, ground: sm.ground, s };
}

/**
 * Bande continue le long des stations entre deux points du profil en travers
 * (décalage latéral `off` à gauche, hauteur relative `dy`). `face` : normale voulue
 * ('up', 'down', 'left' = +n, 'right' = -n) pour choisir l'orientation des triangles.
 */
function strip(b: LayerBuffer, st: readonly Station[], offA: number, dyA: number, offB: number, dyB: number, face: 'up' | 'down' | 'left' | 'right', from = 0, to = st.length - 1): void {
  if (to - from < 1) return;
  const base = b.vertexCount;
  for (let i = from; i <= to; i++) {
    const s = st[i]!;
    const ma = offA * s.miter, mb = offB * s.miter;
    b.v(s.x + s.nx * ma, s.y + dyA, s.z + s.nz * ma);
    b.v(s.x + s.nx * mb, s.y + dyB, s.z + s.nz * mb);
  }
  // Orientation : normale géométrique du premier quad comparée à la normale voulue.
  const s0 = st[from]!, s1 = st[from + 1]!;
  const ax = s0.nx * offA, az = s0.nz * offA;
  const e1x = s1.x + s1.nx * offA - (s0.x + ax), e1y = s1.y - s0.y, e1z = s1.z + s1.nz * offA - (s0.z + az);
  const e2x = s0.nx * (offB - offA), e2y = dyB - dyA, e2z = s0.nz * (offB - offA);
  const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
  let wx = 0, wy = 0, wz = 0;
  if (face === 'up') wy = 1; else if (face === 'down') wy = -1;
  else if (face === 'left') { wx = s0.nx; wz = s0.nz; } else { wx = -s0.nx; wz = -s0.nz; }
  const flip = cx * wx + cy * wy + cz * wz < 0;
  for (let i = 0; i < to - from; i++) {
    const a0 = base + i * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
    if (!flip) { b.tri(a0, a1, b0); b.tri(b0, a1, b1); } else { b.tri(a0, b0, a1); b.tri(b0, b1, a1); }
  }
}

/** Parallélépipède orienté (x,z centre, rotation par vecteur tangent), de y0 à y1. */
function box(b: LayerBuffer, cx: number, cz: number, tx: number, tz: number, halfLen: number, halfWid: number, y0: number, y1: number, taper = 0): void {
  const nx = tz, nz = -tx;
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const base = b.vertexCount;
  for (const yy of [y0, y1]) {
    const w = yy === y1 ? halfWid - taper : halfWid;
    const l = yy === y1 ? halfLen - taper : halfLen;
    for (const [u, v] of corners) b.v(cx + tx * u * l + nx * v * w, yy, cz + tz * u * l + nz * v * w);
  }
  // Faces latérales et dessus (le dessous est invisible).
  const quads = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]];
  for (const [a, bb, c, d] of quads) {
    pushQuadOutward(b, base + a!, base + bb!, base + c!, base + d!, cx, (y0 + y1) / 2, cz);
  }
}

/** Quad orienté vers l'extérieur d'un point intérieur de référence. */
function pushQuadOutward(b: LayerBuffer, a: number, c1: number, c2: number, d: number, ix: number, iy: number, iz: number): void {
  const P = b.pos;
  const ax = P[a * 3]!, ay = P[a * 3 + 1]!, az = P[a * 3 + 2]!;
  const e1x = P[c1 * 3]! - ax, e1y = P[c1 * 3 + 1]! - ay, e1z = P[c1 * 3 + 2]! - az;
  const e2x = P[d * 3]! - ax, e2y = P[d * 3 + 1]! - ay, e2z = P[d * 3 + 2]! - az;
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const out = nx * (ax - ix) + ny * (ay - iy) + nz * (az - iz) >= 0;
  if (out) { b.tri(a, c1, c2); b.tri(a, c2, d); } else { b.tri(a, c2, c1); b.tri(a, d, c2); }
}

/** Cylindre polygonal vertical (piles, poteaux). */
function prism(b: LayerBuffer, cx: number, cz: number, rx: number, rz: number, tx: number, tz: number, y0: number, y1: number, sides: number): void {
  const nx = tz, nz = -tx;
  const base = b.vertexCount;
  for (const yy of [y0, y1]) {
    for (let k = 0; k < sides; k++) {
      const a = ((k + 0.5) / sides) * Math.PI * 2;
      const u = Math.cos(a) * rx, v = Math.sin(a) * rz;
      b.v(cx + tx * u + nx * v, yy, cz + tz * u + nz * v);
    }
  }
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    pushQuadOutward(b, base + k, base + k1, base + sides + k1, base + sides + k, cx, (y0 + y1) / 2, cz);
  }
  const top = b.v(cx, y1, cz);
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    const p0 = base + sides + k, p1 = base + sides + k1;
    // dessus orienté vers +Y
    const P = b.pos;
    const ex = P[p0 * 3]! - cx, ez = P[p0 * 3 + 2]! - cz, fx = P[p1 * 3]! - cx, fz = P[p1 * 3 + 2]! - cz;
    if (ez * fx - ex * fz > 0) b.tri(top, p0, p1); else b.tri(top, p1, p0);
  }
}

/** Quad de peinture (polygone plat) aux 4 coins donnés (sens quelconque, orienté vers le haut). */
function flatQuad(b: LayerBuffer, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, x3: number, y3: number, z3: number): void {
  const a = b.v(x0, y0, z0), c1 = b.v(x1, y1, z1), c2 = b.v(x2, y2, z2), d = b.v(x3, y3, z3);
  const ny = (z1 - z0) * (x3 - x0) - (x1 - x0) * (z3 - z0);
  if (ny > 0) { b.tri(a, c1, c2); b.tri(a, c2, d); } else { b.tri(a, c2, c1); b.tri(a, d, c2); }
}

/* -------------------------------------------------------------------------- */
/* Tronçons                                                                    */
/* -------------------------------------------------------------------------- */

export interface BuildContext {
  net: RoadNetwork;
  junctions: Map<number, JunctionInfo>;
}

export function junctionOf(ctx: BuildContext, nodeId: number): JunctionInfo {
  let j = ctx.junctions.get(nodeId);
  if (!j) { j = computeJunction(ctx.net, nodeId); ctx.junctions.set(nodeId, j); }
  return j;
}

function armOf(j: JunctionInfo, segId: number, atStart: boolean): JunctionArm | undefined {
  return j.arms.find((a) => a.segId === segId && a.atStart === atStart) ?? j.arms.find((a) => a.segId === segId);
}

/** Normale d'onglet à un nœud « continu » (moyenne des deux normales gauches, orientée comme ce tronçon). */
function miterAt(ctx: BuildContext, j: JunctionInfo, segId: number, st: Station): void {
  const other = j.arms.find((a) => a.segId !== segId);
  if (!other) return;
  // Direction de déplacement du tronçon courant au nœud = st.t ; l'autre tronçon, en continuant, a la direction other.dir.
  // Normale gauche de l'autre dans le même sens de déplacement : (dz, -dx) de sa direction sortante si on arrive au nœud…
  const self = j.arms.find((a) => a.segId === segId)!;
  // Sens de marche « traversant » : du tronçon courant vers l'autre.
  const travelInX = -self.dirX, travelInZ = -self.dirZ; // direction en arrivant par le tronçon courant
  const travelOutX = other.dirX, travelOutZ = other.dirZ;
  let mx = travelInX + travelOutX, mz = travelInZ + travelOutZ;
  const ml = Math.hypot(mx, mz);
  if (ml < 1e-6) return;
  mx /= ml; mz /= ml;
  // normale gauche du sens traversant
  let nx = mz, nz = -mx;
  // orientation : comme la normale de la station
  if (nx * st.nx + nz * st.nz < 0) { nx = -nx; nz = -nz; }
  const c = nx * st.nx + nz * st.nz;
  if (c < 0.35) return;
  st.nx = nx; st.nz = nz; st.miter = 1 / c;
  void ctx;
}

/** Profil en travers d'un tronçon (couches) le long de stations déjà calculées. */
function crossSection(out: BuildOutput, k: RoadKindDef, st: Station[]): void {
  const L = out.layers;
  const hc = carriagewayWidth(k) / 2;
  const ht = totalWidth(k) / 2;
  const mh = k.medianWidth / 2;
  const curb = k.curbHeight;
  const asphalt = L.get(k.surface === 'asphalt_worn' ? 'asphaltWorn' : 'asphalt')!;
  // Découpe en plages pont / terre.
  const ranges: { from: number; to: number; bridge: boolean }[] = [];
  let r0 = 0;
  for (let i = 1; i <= st.length; i++) {
    if (i === st.length || st[i]!.bridge !== st[r0]!.bridge) {
      // Les plages se chevauchent d'une station pour rester continues.
      ranges.push({ from: r0, to: Math.min(st.length - 1, i), bridge: st[r0]!.bridge });
      r0 = i;
    }
  }
  for (const rg of ranges) {
    const { from, to, bridge } = rg;
    if (to - from < 1) continue;
    // Chaussée
    if (k.surface === 'pavers') {
      strip(L.get('pavers')!, st, -ht, 0.04, ht, 0.04, 'up', from, to);
    } else if (mh > 0 && k.median !== 'planted') {
      strip(asphalt, st, -hc, 0, -mh, 0, 'up', from, to);
      strip(asphalt, st, mh, 0, hc, 0, 'up', from, to);
    } else {
      strip(asphalt, st, -hc, 0, hc, 0, 'up', from, to);
    }
    // Terre-plein (planté : construit à part avec nez arrondis, voir plantedMedian)
    if (k.median === 'barrier') {
      // Séparateur béton profil « New Jersey ».
      const c = L.get('concrete')!;
      strip(c, st, -mh, 0, -0.32, 0.25, 'right', from, to);
      strip(c, st, -0.32, 0.25, -0.12, BARRIER_H, 'right', from, to);
      strip(c, st, 0.12, BARRIER_H, 0.32, 0.25, 'left', from, to);
      strip(c, st, 0.32, 0.25, mh, 0, 'left', from, to);
      strip(c, st, -0.12, BARRIER_H, 0.12, BARRIER_H, 'up', from, to);
    }
    // Trottoirs et bordures
    if (k.sidewalk > 0) {
      const cb = 0.2;
      for (const side of [1, -1] as const) {
        const a = side * hc, bnd = side * (hc + cb), o = side * ht;
        strip(L.get('curb')!, st, a, 0, a, curb, side > 0 ? 'right' : 'left', from, to);
        strip(L.get('curb')!, st, Math.min(a, bnd), curb, Math.max(a, bnd), curb, 'up', from, to);
        strip(L.get('sidewalk')!, st, Math.min(bnd, o), curb, Math.max(bnd, o), curb, 'up', from, to);
      }
    }
    const topY = k.sidewalk > 0 ? curb : k.surface === 'pavers' ? 0.04 : 0;
    if (!bridge) {
      // Jupe de rive : masque le raccord au terrain non nivelé.
      for (const side of [1, -1] as const) {
        strip(L.get('skirt')!, st, side * ht, topY, side * (ht + 0.6), -SKIRT_DEPTH, side > 0 ? 'left' : 'right', from, to);
      }
      if (k.id === 'highway') {
        // Glissières de sécurité (poteaux + lisse) sur les accotements.
        for (const side of [1, -1] as const) {
          const off = side * (ht - 0.4);
          strip(L.get('metal')!, st, off, 0.45, off, 0.78, side > 0 ? 'right' : 'left', from, to);
          strip(L.get('metal')!, st, off + side * 0.04, 0.45, off + side * 0.04, 0.78, side > 0 ? 'left' : 'right', from, to);
        }
        guardrailPosts(L.get('metal')!, st, from, to, ht - 0.35);
      }
    } else {
      bridgeSection(out, k, st, from, to, ht, topY);
    }
  }
}

/**
 * Terre-plein planté : bordures, herbe, et nez arrondis aux extrémités (dégage les passages piétons).
 * La chaussée est continue dessous.
 */
function plantedMedian(out: BuildOutput, k: RoadKindDef, sm: SegSampler, s0: number, s1: number, roundStart: boolean, roundEnd: boolean): void {
  const L = out.layers;
  const mh = k.medianWidth / 2, curb = k.curbHeight, cb = 0.18;
  const a = s0 + (roundStart ? 5.5 + mh : 0), b = s1 - (roundEnd ? 5.5 + mh : 0);
  if (b - a < 1) return;
  const n = Math.max(1, Math.ceil((b - a) / 3));
  const st: Station[] = [];
  for (let i = 0; i <= n; i++) st.push(stationFrom(sm, a + ((b - a) * i) / n));
  strip(L.get('curb')!, st, -mh, 0, -mh, curb, 'right');
  strip(L.get('curb')!, st, mh, 0, mh, curb, 'left');
  strip(L.get('curb')!, st, -mh, curb, -mh + cb, curb, 'up');
  strip(L.get('curb')!, st, mh - cb, curb, mh, curb, 'up');
  strip(L.get('grass')!, st, -mh + cb, curb - 0.02, mh - cb, curb - 0.02, 'up');
  const cap = (s: Station, dir: number): void => {
    const N = 10;
    const fx = s.tx * dir, fz = s.tz * dir;
    const ring = (r: number, dy: number, buf: LayerBuffer): number[] => {
      const ids: number[] = [];
      for (let i = 0; i <= N; i++) {
        const ang = -Math.PI / 2 + (Math.PI * i) / N;
        const u = Math.cos(ang) * r, v = Math.sin(ang) * r;
        ids.push(buf.v(s.x + fx * u + s.nx * v, s.y + dy, s.z + fz * u + s.nz * v));
      }
      return ids;
    };
    const curbB = L.get('curb')!, grass = L.get('grass')!;
    const A = ring(mh, 0, curbB), B = ring(mh, curb, curbB);
    for (let i = 0; i < N; i++) orientedQuad(curbB, A[i]!, A[i + 1]!, B[i + 1]!, B[i]!, 2, s.x, s.y, s.z);
    const C = ring(mh, curb, curbB), D = ring(mh - cb, curb, curbB);
    for (let i = 0; i < N; i++) orientedQuad(curbB, C[i]!, C[i + 1]!, D[i + 1]!, D[i]!, 1, 0, 0, 0);
    const c = grass.v(s.x, s.y + curb - 0.02, s.z);
    const G = ring(mh - cb, curb - 0.02, grass);
    for (let i = 0; i < N; i++) orientedTri(grass, c, G[i]!, G[i + 1]!, 1);
  };
  if (roundStart) cap(st[0]!, -1);
  if (roundEnd) cap(st[st.length - 1]!, 1);
}

function guardrailPosts(b: LayerBuffer, st: Station[], from: number, to: number, off: number): void {
  let next = st[from]!.s;
  for (let i = from; i <= to; i++) {
    const s = st[i]!;
    if (s.s < next) continue;
    next = s.s + 4;
    for (const side of [1, -1]) {
      const x = s.x + s.nx * side * off, z = s.z + s.nz * side * off;
      box(b, x, z, s.tx, s.tz, 0.06, 0.06, s.y, s.y + 0.8);
    }
  }
}

function bridgeSection(out: BuildOutput, k: RoadKindDef, st: Station[], from: number, to: number, ht: number, topY: number): void {
  const L = out.layers;
  const c = L.get('concrete')!;
  const edge = ht + 0.25;
  // Corniche (rive du tablier) et sous-face
  for (const side of [1, -1] as const) {
    strip(c, st, side * edge, topY, side * edge, -DECK_THICK, side > 0 ? 'left' : 'right', from, to);
    strip(c, st, side * ht, topY, side * edge, topY, 'up', from, to);
  }
  strip(c, st, -edge, -DECK_THICK, edge, -DECK_THICK, 'down', from, to);
  // Poutre caisson
  const gw = Math.max(1.5, ht * 0.55), gd = DECK_THICK + 1.3;
  strip(c, st, gw, -DECK_THICK, gw * 0.8, -gd, 'left', from, to);
  strip(c, st, -gw, -DECK_THICK, -gw * 0.8, -gd, 'right', from, to);
  strip(c, st, -gw * 0.8, -gd, gw * 0.8, -gd, 'down', from, to);
  // Parapet béton + garde-corps métallique
  for (const side of [1, -1] as const) {
    const o = side * (edge - PARAPET_W / 2);
    const i0 = side * (edge - PARAPET_W), i1 = side * edge;
    strip(c, st, i0, topY, i0, topY + PARAPET_H, side > 0 ? 'right' : 'left', from, to);
    strip(c, st, i1, topY, i1, topY + PARAPET_H, side > 0 ? 'left' : 'right', from, to);
    strip(c, st, Math.min(i0, i1), topY + PARAPET_H, Math.max(i0, i1), topY + PARAPET_H, 'up', from, to);
    const m = L.get('metal')!;
    // lisse haute (tube aplati) et lisse intermédiaire
    for (const [y0, y1] of [[RAIL_H - 0.06, RAIL_H], [0.78, 0.82]] as const) {
      strip(m, st, o - 0.05, topY + y1, o + 0.05, topY + y1, 'up', from, to);
      strip(m, st, o + side * 0.05, topY + y0, o + side * 0.05, topY + y1, side > 0 ? 'left' : 'right', from, to);
      strip(m, st, o - side * 0.05, topY + y0, o - side * 0.05, topY + y1, side > 0 ? 'right' : 'left', from, to);
    }
    // montants tous les 2 m
    let next = st[from]!.s;
    for (let i = from; i <= to; i++) {
      const s = st[i]!;
      if (s.s < next) continue;
      next = s.s + 2;
      box(m, s.x + s.nx * o, s.z + s.nz * o, s.tx, s.tz, 0.035, 0.035, s.y + topY + PARAPET_H, s.y + topY + RAIL_H);
    }
  }
}

/** Piles de pont aux abscisses du profil. */
function piers(out: BuildOutput, k: RoadKindDef, sm: SegSampler, waterLevel: number, sMin: number, sMax: number): void {
  const c = out.layers.get('concrete')!;
  const ht = totalWidth(k) / 2;
  for (const s of sm.profile.piers) {
    if (s < sMin || s > sMax) continue;
    sm.at(s);
    const top = sm.y - DECK_THICK - 1.3;
    const bottom = Math.min(sm.ground, waterLevel - 1.5) - 1;
    if (top - bottom < 1) continue;
    // chevêtre
    box(c, sm.x, sm.z, sm.tx, sm.tz, 0.9, Math.max(1.8, ht * 0.62), top - 1.1, top, 0);
    // fûts (1 ou 2 selon la largeur)
    const twin = ht > 9;
    for (const off of twin ? [-ht * 0.38, ht * 0.38] : [0]) {
      const px = sm.x + sm.nx * off, pz = sm.z + sm.nz * off;
      prism(c, px, pz, 0.85, twin ? 1.1 : 1.6, sm.tx, sm.tz, bottom, top - 1.1, 10);
      // semelle
      box(c, px, pz, sm.tx, sm.tz, 1.5, twin ? 1.8 : 2.4, bottom - 0.5, bottom + 0.4);
    }
  }
}

/** Marquages et décor d'un tronçon. */
function markings(out: BuildOutput, ctx: BuildContext, k: RoadKindDef, sm: SegSampler, s0: number, s1: number, startJ: JunctionInfo, endJ: JunctionInfo): void {
  const P = out.layers.get('paint')!;
  if (!k.vehicles || k.surface === 'pavers') return;
  const lw = k.laneWidth;
  const mh = k.medianWidth / 2;
  const hc = carriagewayWidth(k) / 2;
  const nF = k.lanesForward, nB = k.lanesBackward;
  const line = (off: number, width: number, a: number, b: number): void => {
    // bande de peinture qui suit la courbe de a à b
    const n = Math.max(1, Math.ceil((b - a) / 2));
    const st: Station[] = [];
    for (let i = 0; i <= n; i++) st.push(stationFrom(sm, a + ((b - a) * i) / n));
    strip(P, st, off - width / 2, PAINT_LIFT, off + width / 2, PAINT_LIFT, 'up');
  };
  const dashed = (off: number, width: number, dash: number, gap: number): void => {
    for (let s = s0 + gap / 2; s + dash <= s1; s += dash + gap) line(off, width, s, s + dash);
  };
  const solid = (off: number, width: number): void => { if (s1 - s0 > 0.5) line(off, width, s0, s1); };
  const urban = k.speedKmh <= 60;
  // Axe central (double sens sans terre-plein)
  if (nB > 0 && mh === 0) {
    if (urban) dashed(0, 0.12, 3, 3.5); else solid(0, 0.15);
  }
  // Ligne continue le long du terre-plein
  if (mh > 0) { solid(mh + 0.3, 0.15); solid(-mh - 0.3, 0.15); }
  // Séparations de voies (même sens) : T1 (3 m / 10 m) en ville, 3 m / 10 m aussi sur autoroute (plus large)
  const sepW = urban ? 0.12 : 0.15;
  const lanesAt = (forward: boolean, i: number): number => {
    // limite entre voie i et i+1 (rang depuis l'axe)
    if (nB === 0) return (nF * lw) / 2 - (i + 1) * lw;
    const d = mh + (i + 1) * lw;
    return forward ? -d : d;
  };
  for (let i = 0; i < nF - 1; i++) dashed(lanesAt(true, i), sepW, 3, urban ? 5 : 10);
  for (let i = 0; i < nB - 1; i++) dashed(lanesAt(false, i), sepW, 3, urban ? 5 : 10);
  // Lignes de rive (axes à grande vitesse ou à plusieurs voies)
  if (nF + nB >= 4 || nB === 0 || !urban) {
    const edgeOff = hc - k.shoulder - 0.1;
    solid(edgeOff, 0.15); solid(-edgeOff, 0.15);
  }
  // Abords de carrefour : passages piétons, lignes d'arrêt, flèches.
  const ends: { j: JunctionInfo; atStart: boolean }[] = [{ j: startJ, atStart: true }, { j: endJ, atStart: false }];
  for (const { j, atStart } of ends) {
    if (j.type !== 'junction') continue;
    const sBase = atStart ? s0 : s1;
    const dir = atStart ? 1 : -1;
    if (s1 - s0 < 14) continue;
    // Passage piéton (bandes parallèles à l'axe, 0,5 m / 0,5 m), sur la largeur de chaussée hors terre-plein.
    if (k.pedestrians && k.sidewalk > 0) {
      const a = sBase + dir * 0.8, b = sBase + dir * 4.8;
      const sa = Math.min(a, b), sb = Math.max(a, b);
      for (let off = -hc + 0.5; off + 0.5 <= hc - 0.3; off += 1.0) {
        if (mh > 0 && off + 0.5 > -mh && off < mh) continue;
        line(off + 0.25, 0.5, sa, sb);
      }
    }
    // Ligne d'arrêt sur les voies entrantes.
    const incomingForward = !atStart; // en arrivant à l'extrémité b, ce sont les voies directes qui entrent
    const nIn = incomingForward ? nF : nB;
    if (nIn > 0) {
      const sStop = sBase + dir * (k.sidewalk > 0 ? 5.6 : 1.5);
      const offs: number[] = [];
      for (let r = 0; r <= nIn; r++) offs.push(nB === 0 ? (nF * lw) / 2 - r * lw : (incomingForward ? -1 : 1) * (mh + r * lw));
      const lo = Math.min(...offs), hi = Math.max(...offs);
      const st = [stationFrom(sm, sStop), stationFrom(sm, sStop + dir * 0.5)];
      if (dir < 0) st.reverse();
      strip(P, st, lo + 0.1, PAINT_LIFT, hi - 0.1, PAINT_LIFT, 'up');
      // Flèches de présélection (voies multiples ou sens unique)
      if (nIn >= 2 || nB === 0) {
        for (let r = 0; r < nIn; r++) {
          const off = nB === 0 ? (nF * lw) / 2 - (r + 0.5) * lw : (incomingForward ? -1 : 1) * (mh + (r + 0.5) * lw);
          const turn = nIn >= 2 && r === 0 ? 'left' : nIn >= 2 && r === nIn - 1 ? 'right' : 'straight';
          arrow(P, sm, sStop + dir * 9, off, incomingForward, turn);
        }
      }
    }
  }
  void ctx;
}

/** Flèche au sol (5 m) : tout droit, ou tout droit + tourne-à-gauche / à-droite. */
function arrow(P: LayerBuffer, sm: SegSampler, sCenter: number, off: number, forward: boolean, turn: 'straight' | 'left' | 'right'): void {
  sm.at(sCenter);
  const fx = forward ? sm.tx : -sm.tx, fz = forward ? sm.tz : -sm.tz; // sens de circulation
  const lx = fz, lz = -fx; // gauche du conducteur
  const cx = sm.x + sm.nx * off, cz = sm.z + sm.nz * off, y = sm.y + PAINT_LIFT;
  const pt = (u: number, v: number): [number, number] => [cx + fx * u + lx * v, cz + fz * u + lz * v];
  const quad = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): void =>
    flatQuad(P, a[0], y, a[1], b[0], y, b[1], c[0], y, c[1], d[0], y, d[1]);
  const tri = (a: [number, number], b: [number, number], c: [number, number]): void => {
    const i0 = P.v(a[0], y, a[1]), i1 = P.v(b[0], y, b[1]), i2 = P.v(c[0], y, c[1]);
    const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (ny > 0) P.tri(i0, i1, i2); else P.tri(i0, i2, i1);
  };
  // fût
  quad(pt(-2.5, -0.09), pt(1.2, -0.09), pt(1.2, 0.09), pt(-2.5, 0.09));
  // pointe
  tri(pt(1.2, -0.38), pt(2.5, 0), pt(1.2, 0.38));
  if (turn !== 'straight') {
    const s = turn === 'left' ? 1 : -1;
    quad(pt(-0.6, 0), pt(-0.6 + 0.18, 0), pt(0.2, s * 0.75), pt(0.02, s * 0.75));
    tri(pt(-0.1, s * 0.72), pt(0.55, s * 1.25), pt(0.45, s * 0.55));
  }
}

/** Décor d'un tronçon : lampadaires, arbres d'alignement, mobilier des rues piétonnes. */
function decor(out: BuildOutput, k: RoadKindDef, sm: SegSampler, s0: number, s1: number, segId: number): void {
  const hc = carriagewayWidth(k) / 2;
  const ht = totalWidth(k) / 2;
  const curb = k.curbHeight;
  const margin = 7;
  const a = s0 + margin, b = s1 - margin;
  if (b <= a) return;
  const put = (kind: DecorKind, s: number, off: number, dy: number, rotExtra: number, scale: number): void => {
    sm.at(s);
    const x = sm.x + sm.nx * off, z = sm.z + sm.nz * off;
    // Rotation autour de Y : face du modèle (+Z) tournée vers l'axe de la route.
    const fx = -Math.sign(off) * sm.nx, fz = -Math.sign(off) * sm.nz;
    out.decor.push({ kind, x, y: sm.y + dy, z, rot: Math.atan2(fx, fz) + rotExtra, scale });
  };
  const len = b - a;
  // Lampadaires
  if (k.lampSpacing > 0) {
    const n = Math.max(1, Math.round(len / k.lampSpacing));
    const big = k.id === 'avenue' || k.id === 'boulevard';
    for (let i = 0; i <= n; i++) {
      const s = a + (len * i) / Math.max(1, n);
      sm.at(s);
      const onBridge = sm.bridge;
      const sideOff = onBridge ? ht - 0.1 : k.sidewalk > 0 ? hc + 0.75 : ht - 0.9;
      const both = big || k.id === 'pedestrian' || onBridge;
      const sides = both ? [1, -1] : [i % 2 === 0 ? 1 : -1];
      for (const side of sides) {
        const st = big && !onBridge ? (side > 0 ? 0 : 0.5) : 0; // quinconce
        const ss = Math.min(b, s + st * (len / Math.max(1, n)));
        put('lamp', ss, side * sideOff, (k.sidewalk > 0 ? curb : 0.04) + (onBridge ? 0 : 0), 0, big ? 1.45 : 1.15);
      }
    }
  }
  // Arbres d'alignement : terre-plein planté, trottoirs larges des boulevards.
  if (k.treeSpacing > 0) {
    const n = Math.max(1, Math.round(len / k.treeSpacing));
    for (let i = 0; i <= n; i++) {
      const s = a + (len * (i + 0.5)) / (n + 1);
      sm.at(s);
      if (sm.bridge) continue;
      if (k.median === 'planted') put('tree', s, 0.001, curb, (segId * 1.7 + i * 2.3) % 6.28, 0.95 + ((segId + i * 7) % 5) * 0.06);
      if (k.id === 'boulevard') {
        for (const side of [1, -1]) put('tree', s, side * (ht - 1.4), curb, (segId + i * 1.3) % 6.28, 1 + ((i * 3 + segId) % 4) * 0.07);
      }
    }
  }
  // Rue piétonne : jardinières, bancs, corbeilles.
  if (k.id === 'pedestrian') {
    const step = 16;
    let i = 0;
    for (let s = a + 8; s < b; s += step, i++) {
      sm.at(s);
      if (sm.bridge) continue;
      const side = i % 2 === 0 ? 1 : -1;
      put('planter', s, side * (ht - 2.2), 0.04, 0, 1.3);
      put('bench', s + 2.5, side * (ht - 2.0), 0.04, 0, 1);
      if (i % 3 === 1) put('bin', s - 2.2, side * (ht - 2.0), 0.04, 0, 1);
    }
  }
}

export interface SegmentBuildInfo { s0: number; s1: number }

/** Construit la géométrie complète d'un tronçon (hors dalles de carrefour). */
export function buildSegment(out: BuildOutput, ctx: BuildContext, segId: number): SegmentBuildInfo {
  const net = ctx.net;
  const k = ROAD_KINDS[net.kindOf(segId)];
  const [na, nb] = net.endpoints(segId);
  const ja = junctionOf(ctx, na), jb = junctionOf(ctx, nb);
  const sm = new SegSampler(net, segId);
  const L = sm.length;
  const trimA = ja.type === 'junction' ? (armOf(ja, segId, true)?.setback ?? 0) : 0;
  const trimB = jb.type === 'junction' ? (armOf(jb, segId, false)?.setback ?? 0) : 0;
  const s0 = Math.min(trimA, L * 0.49), s1 = Math.max(L - trimB, L * 0.51);
  // Stations : pas adaptatif (≤ 4 m, ≤ 2 m en courbe), plus les points de bascule terre / pont.
  const st: Station[] = [];
  const curved = Math.abs(sm.curve[2]! - (sm.curve[0]! + (sm.curve[6]! - sm.curve[0]!) / 3)) + Math.abs(sm.curve[3]! - (sm.curve[1]! + (sm.curve[7]! - sm.curve[1]!) / 3)) > 0.05;
  const step = curved ? 2 : 4;
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) st.push(stationFrom(sm, s0 + ((s1 - s0) * i) / n));
  // Raccords : bascule nette terre/pont (on duplique la station frontière avec le drapeau de l'autre côté).
  for (let i = 1; i < st.length; i++) {
    if (st[i]!.bridge !== st[i - 1]!.bridge) {
      const sb = (st[i]!.s + st[i - 1]!.s) / 2;
      const m1 = stationFrom(sm, sb); m1.bridge = st[i - 1]!.bridge;
      const m2 = stationFrom(sm, sb); m2.bridge = st[i]!.bridge;
      st.splice(i, 0, m1, m2);
      i += 2;
    }
  }
  if (ja.type === 'continuous') miterAt(ctx, ja, segId, st[0]!);
  if (jb.type === 'continuous') miterAt(ctx, jb, segId, st[st.length - 1]!);
  crossSection(out, k, st);
  if (k.median === 'planted') plantedMedian(out, k, sm, s0, s1, ja.type !== 'continuous', jb.type !== 'continuous');
  piers(out, k, sm, net.env.waterLevel, s0, s1);
  markings(out, ctx, k, sm, s0, s1, ja, jb);
  decor(out, k, sm, s0, s1, segId);
  if (ja.type === 'end') deadEnd(out, k, st[0]!, -1);
  if (jb.type === 'end') deadEnd(out, k, st[st.length - 1]!, 1);
  return { s0, s1 };
}

/** Impasse : demi-disque de chaussée + trottoir en anneau + bordure + jupe. */
function deadEnd(out: BuildOutput, k: RoadKindDef, s: Station, dir: number): void {
  const L = out.layers;
  const hc = carriagewayWidth(k) / 2, ht = totalWidth(k) / 2;
  const curb = k.curbHeight;
  const N = 14;
  const fx = s.tx * dir, fz = s.tz * dir; // vers l'extérieur
  const ring = (r: number, dy: number, b: LayerBuffer): number[] => {
    const ids: number[] = [];
    for (let i = 0; i <= N; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / N;
      const u = Math.cos(a) * r, v = Math.sin(a) * r; // u le long de f, v le long de n
      ids.push(b.v(s.x + fx * u + s.nx * v, s.y + dy, s.z + fz * u + s.nz * v));
    }
    return ids;
  };
  const fan = (b: LayerBuffer, dy: number, r: number): void => {
    const c = b.v(s.x, s.y + dy, s.z);
    const ids = ring(r, dy, b);
    for (let i = 0; i < N; i++) orientedTri(b, c, ids[i]!, ids[i + 1]!, 1);
  };
  const band = (b: LayerBuffer, r0: number, dy0: number, r1: number, dy1: number, want: number): void => {
    const A = ring(r0, dy0, b), B = ring(r1, dy1, b);
    for (let i = 0; i < N; i++) {
      orientedQuad(b, A[i]!, A[i + 1]!, B[i + 1]!, B[i]!, want, s.x, s.y, s.z);
    }
  };
  if (k.surface === 'pavers') { fan(L.get('pavers')!, 0.04, ht); band(L.get('skirt')!, ht, 0.04, ht + 0.6, -SKIRT_DEPTH, 2); return; }
  const asphalt = L.get(k.surface === 'asphalt_worn' ? 'asphaltWorn' : 'asphalt')!;
  fan(asphalt, 0, hc);
  if (k.sidewalk > 0) {
    band(L.get('curb')!, hc, 0, hc, curb, -2);
    band(L.get('curb')!, hc, curb, hc + 0.2, curb, 1);
    band(L.get('sidewalk')!, hc + 0.2, curb, ht, curb, 1);
  }
  band(L.get('skirt')!, ht, k.sidewalk > 0 ? curb : 0, ht + 0.6, -SKIRT_DEPTH, 2);
}

/** Triangle orienté vers le haut (want=1) ou le bas (-1). */
function orientedTri(b: LayerBuffer, a: number, c: number, d: number, want: number): void {
  const P = b.pos;
  const e1x = P[c * 3]! - P[a * 3]!, e1z = P[c * 3 + 2]! - P[a * 3 + 2]!;
  const e2x = P[d * 3]! - P[a * 3]!, e2z = P[d * 3 + 2]! - P[a * 3 + 2]!;
  const ny = e1z * e2x - e1x * e2z;
  if (ny * want >= 0) b.tri(a, c, d); else b.tri(a, d, c);
}

/** Quad orienté : want 1 = haut, 2 = vers l'extérieur du centre, -2 = vers le centre. */
function orientedQuad(b: LayerBuffer, a: number, c: number, d: number, e: number, want: number, cx: number, cy: number, cz: number): void {
  if (want === 1 || want === -1) { orientedTri(b, a, c, d, want); orientedTri(b, a, d, e, want); return; }
  const P = b.pos;
  const ax = P[a * 3]!, ay = P[a * 3 + 1]!, az = P[a * 3 + 2]!;
  const e1x = P[c * 3]! - ax, e1y = P[c * 3 + 1]! - ay, e1z = P[c * 3 + 2]! - az;
  const e2x = P[e * 3]! - ax, e2y = P[e * 3 + 1]! - ay, e2z = P[e * 3 + 2]! - az;
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const outward = nx * (ax - cx) + ny * (ay - cy) * 0 + nz * (az - cz) >= 0;
  void ny;
  if (outward === (want > 0)) { b.tri(a, c, d); b.tri(a, d, e); } else { b.tri(a, d, c); b.tri(a, e, d); }
}

/* -------------------------------------------------------------------------- */
/* Dalles de carrefour                                                         */
/* -------------------------------------------------------------------------- */

/** Construit la dalle d'un carrefour (type 'junction') : chaussée, coins de trottoir arrondis, bordures. */
export function buildJunction(out: BuildOutput, ctx: BuildContext, nodeId: number): void {
  const j = junctionOf(ctx, nodeId);
  if (j.type !== 'junction') return;
  const net = ctx.net;
  const node = net.nodePos(nodeId);
  const L = out.layers;
  const arms = j.arms;
  const n = arms.length;
  // Extrémités de chaque branche au recul : centre, normale, hauteur.
  interface End { x: number; z: number; y: number; nx: number; nz: number; dx: number; dz: number; arm: JunctionArm; k: RoadKindDef }
  const ends: End[] = arms.map((arm) => {
    const sm = new SegSampler(net, arm.segId);
    const s = arm.atStart ? arm.setback : sm.length - arm.setback;
    sm.at(s);
    // Normale « p » orientée vers le voisin suivant (angle croissant) : rotation +90° de la direction sortante.
    return { x: sm.x, z: sm.z, y: sm.y, nx: -arm.dirZ, nz: arm.dirX, dx: arm.dirX, dz: arm.dirZ, arm, k: ROAD_KINDS[arm.kind] };
  });
  const allPavers = ends.every((e) => e.k.surface === 'pavers');
  const surf = allPavers ? L.get('pavers')! : ends.some((e) => e.k.surface === 'asphalt_worn') && ends.every((e) => e.k.surface !== 'asphalt') ? L.get('asphaltWorn')! : L.get('asphalt')!;
  const surfLift = allPavers ? 0.04 : 0;
  const curbH = Math.max(...ends.map((e) => e.k.curbHeight));
  // Contour de la chaussée : pour chaque branche, bord droit -> bord gauche, puis coin vers la suivante.
  const contour: [number, number, number][] = [];
  const Q = 10; // points par coin
  const corners: { inner: [number, number, number][]; outer: [number, number, number][]; hasWalk: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const e = ends[i]!, f = ends[(i + 1) % n]!;
    const hcE = allPavers ? e.arm.halfTotal : e.arm.halfCarriage;
    const hcF = allPavers ? f.arm.halfTotal : f.arm.halfCarriage;
    // côté « -p » (vers la branche précédente) puis côté « +p » (vers la suivante)
    contour.push([e.x - e.nx * hcE, e.y + surfLift, e.z - e.nz * hcE]);
    contour.push([e.x + e.nx * hcE, e.y + surfLift, e.z + e.nz * hcE]);
    // Coin entre e (+p) et f (-p).
    const quadCorner = (offE: number, offF: number, dy: number): [number, number, number][] => {
      const ax = e.x + e.nx * offE, az = e.z + e.nz * offE;
      const bx = f.x - f.nx * offF, bz = f.z - f.nz * offF;
      // Point de contrôle : intersection des bords (droites parallèles aux branches).
      let t = lineIntersectT(ax, az, -e.dx, -e.dz, bx, bz, -f.dx, -f.dz);
      let cx: number, cz: number;
      if (!Number.isFinite(t) || t < 0 || t > e.arm.setback * 1.5 + 4) { cx = (ax + bx) / 2; cz = (az + bz) / 2; }
      else { cx = ax - e.dx * t; cz = az - e.dz * t; }
      const pts: [number, number, number][] = [];
      for (let q = 0; q <= Q; q++) {
        const u = q / Q, w = 1 - u;
        const x = w * w * ax + 2 * w * u * cx + u * u * bx;
        const z = w * w * az + 2 * w * u * cz + u * u * bz;
        pts.push([x, e.y * w + f.y * u + dy, z]);
      }
      void t; t = 0;
      return pts;
    };
    const inner = quadCorner(hcE, hcF, surfLift);
    for (let q = 1; q < Q; q++) contour.push(inner[q]!);
    const hasWalk = e.k.sidewalk > 0 || f.k.sidewalk > 0;
    const outer = quadCorner(hasWalk ? e.arm.halfTotal : hcE, hasWalk ? f.arm.halfTotal : hcF, hasWalk ? curbH : surfLift);
    corners.push({ inner, outer, hasWalk });
  }
  // Éventail depuis le centre (le contour est étoilé autour du nœud).
  const c = surf.v(node.x, node.y + surfLift, node.z);
  const ids = contour.map((p) => surf.v(p[0], p[1], p[2]));
  for (let i = 0; i < ids.length; i++) orientedTri(surf, c, ids[i]!, ids[(i + 1) % ids.length]!, 1);
  // Coins : bordure (face verticale + dessus) et trottoir entre bord de chaussée et bord extérieur, puis jupe.
  for (const cr of corners) {
    const { inner, outer } = cr;
    if (cr.hasWalk) {
      const curb = L.get('curb')!, walk = L.get('sidewalk')!;
      for (let q = 0; q < Q; q++) {
        const a0 = inner[q]!, a1 = inner[q + 1]!;
        // face verticale de bordure (vers la chaussée = vers le nœud)
        const i0 = curb.v(a0[0], a0[1], a0[2]), i1 = curb.v(a1[0], a1[1], a1[2]);
        const i2 = curb.v(a1[0], a1[1] + curbH, a1[2]), i3 = curb.v(a0[0], a0[1] + curbH, a0[2]);
        orientedQuad(curb, i0, i1, i2, i3, -2, node.x, node.y, node.z);
      }
      // dessus de bordure (0,2 m) + trottoir : bandes entre courbe intérieure et extérieure
      const lerpPt = (p: [number, number, number], o: [number, number, number], u: number, y: number): [number, number, number] =>
        [p[0] + (o[0] - p[0]) * u, y, p[2] + (o[2] - p[2]) * u];
      for (let q = 0; q < Q; q++) {
        const p0 = inner[q]!, p1 = inner[q + 1]!, o0 = outer[q]!, o1 = outer[q + 1]!;
        const w0 = Math.hypot(o0[0] - p0[0], o0[2] - p0[2]) || 1, w1 = Math.hypot(o1[0] - p1[0], o1[2] - p1[2]) || 1;
        const u0 = Math.min(0.5, 0.2 / w0), u1 = Math.min(0.5, 0.2 / w1);
        const y0 = p0[1] + curbH, y1 = p1[1] + curbH;
        const m0 = lerpPt(p0, o0, u0, y0), m1 = lerpPt(p1, o1, u1, y1);
        const a = curb.v(p0[0], y0, p0[2]), b = curb.v(p1[0], y1, p1[2]), cc = curb.v(m1[0], y1, m1[2]), d = curb.v(m0[0], y0, m0[2]);
        orientedQuad(curb, a, b, cc, d, 1, 0, 0, 0);
        const wa = walk.v(m0[0], y0, m0[2]), wb = walk.v(m1[0], y1, m1[2]), wc = walk.v(o1[0], y1, o1[2]), wd = walk.v(o0[0], y0, o0[2]);
        orientedQuad(walk, wa, wb, wc, wd, 1, 0, 0, 0);
      }
    }
    // jupe extérieure
    const sk = L.get('skirt')!;
    for (let q = 0; q < Q; q++) {
      const o0 = outer[q]!, o1 = outer[q + 1]!;
      const ex0 = o0[0] - node.x, ez0 = o0[2] - node.z, l0 = Math.hypot(ex0, ez0) || 1;
      const ex1 = o1[0] - node.x, ez1 = o1[2] - node.z, l1 = Math.hypot(ex1, ez1) || 1;
      const a = sk.v(o0[0], o0[1], o0[2]), b = sk.v(o1[0], o1[1], o1[2]);
      const cc = sk.v(o1[0] + (ex1 / l1) * 0.6, o1[1] - SKIRT_DEPTH - curbH, o1[2] + (ez1 / l1) * 0.6);
      const d = sk.v(o0[0] + (ex0 / l0) * 0.6, o0[1] - SKIRT_DEPTH - curbH, o0[2] + (ez0 / l0) * 0.6);
      orientedQuad(sk, a, b, cc, d, 2, node.x, node.y, node.z);
    }
  }
  void CORNER_RADIUS;
}
