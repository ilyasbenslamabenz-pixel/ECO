/**
 * Graphe piéton dérivé du réseau routier (lecture seule) : trottoirs des deux côtés de chaque tronçon ouvert
 * aux piétons, coins de carrefour, passages piétons (marqués là où le rendu des routes les peint, libres
 * ailleurs), liaisons des rues piétonnes. La géométrie reprend EXACTEMENT celle du rendu des routes
 * (src/render/roads/builder.ts) : mêmes reculs de carrefour (`computeJunction`), mêmes décalages latéraux,
 * même position des passages (bandes peintes de 0,8 à 4,8 m après le recul), mêmes coins (Bézier quadratique).
 *
 * Structure : nœuds (x, y, z) + arêtes non orientées portant une polyligne 3D (points + abscisses cumulées),
 * une demi-largeur utile (évitement latéral), le tronçon et le carrefour d'origine. Liste d'adjacence compacte.
 * Chaque arête a une clé stable (nature + positions arrondies de ses extrémités) : après une modification du
 * réseau, les piétons dont le chemin n'est pas touché le conservent (voir crowd.ts `remap`).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ArcTable, derivCubic, evalCubic, isStraight, type Cubic } from '../roads/bezier';
import { computeJunction, lineIntersectT, type JunctionInfo } from '../roads/junction';
import type { RoadNetwork } from '../roads/network';
import { profileHeightAt, type RoadProfile } from '../roads/profile';
import { ROAD_KINDS, carriagewayWidth, type RoadKindDef } from '../roads/types';

/** Sous-ensemble en lecture seule du réseau routier (la façade `PluginRoads` des modules le fournit). */
export type RoadsView = Readonly<Pick<RoadNetwork,
  'version' | 'nodeIds' | 'segmentIds' | 'incident' | 'kindOf' | 'endpoints' | 'curve' | 'length' | 'profile' | 'nodePos'>>;

export const EDGE_SIDEWALK = 0;
export const EDGE_CORNER = 1;
/** Passage piéton peint (bandes blanches) à l'abord d'un carrefour. */
export const EDGE_CROSS_MARKED = 2;
/** Traversée de chaussée sans marquage (bout d'impasse, abord de carrefour court, pleine rue calme). */
export const EDGE_CROSS_UNMARKED = 3;
/** Liaison libre entre les deux files d'une rue piétonne (aucun véhicule). */
export const EDGE_LINK = 4;

/** Distance (m) entre le recul du carrefour et l'axe du passage peint (bandes de 0,8 à 4,8 m). */
export const CROSSWALK_OFFSET = 2.8;
/** Longueur utile minimale d'un tronçon pour que ses passages soient peints (identique au rendu). */
export const CROSSWALK_MIN_SEGMENT = 14;
/** Tronçon (rue, sens unique) au-delà duquel des traversées libres en pleine rue sont proposées. */
const MIDBLOCK_MIN = 110;
const MIDBLOCK_SPACING = 80;
const INDEX_CELL = 20;

export interface PedGraphStats {
  nodes: number;
  edges: number;
  sidewalkM: number;
  crossings: number;
  crossingsMarked: number;
}

/** Résultat de `PedGraph.nearest` (objet réutilisable). */
export interface NearestHit { edge: number; s: number; x: number; y: number; z: number; d: number }

export class PedGraph {
  /** Version du réseau routier dont ce graphe est dérivé. */
  roadsVersion = -1;
  nodeCount = 0;
  nx = new Float32Array(0);
  ny = new Float32Array(0);
  nz = new Float32Array(0);
  edgeCount = 0;
  ea = new Int32Array(0);
  eb = new Int32Array(0);
  eKind = new Uint8Array(0);
  eLen = new Float32Array(0);
  /** Demi-largeur utile (m) pour le décalage latéral des piétons. */
  eHalf = new Float32Array(0);
  /** Tronçon routier d'origine (-1 pour un coin de carrefour). */
  eSeg = new Int32Array(0);
  /** Carrefour (nœud routier) d'un passage ou d'un coin ; -1 en pleine rue. */
  eNode = new Int32Array(0);
  /** Traversées : abscisse (m depuis l'extrémité a du TRONÇON routier) où la chaussée est traversée. */
  eRoadS = new Float32Array(0);
  /** Polyligne de l'arête : premier point et nombre de points dans `pts` / `ptS`. */
  ePt0 = new Int32Array(0);
  ePtN = new Int32Array(0);
  /** Points (x, y, z) des polylignes, de l'extrémité a vers b. */
  pts = new Float32Array(0);
  /** Abscisse cumulée (m, plan XZ) de chaque point depuis l'extrémité a. */
  ptS = new Float32Array(0);
  adjStart = new Int32Array(1);
  adjEdge = new Int32Array(0);
  /** Clés stables des arêtes. */
  eKey: string[] = [];
  keyIndex = new Map<string, number>();
  stats: PedGraphStats = { nodes: 0, edges: 0, sidewalkM: 0, crossings: 0, crossingsMarked: 0 };
  private cells = new Map<number, number[]>();

  /** Autre extrémité de l'arête `e` vue du nœud `n`. */
  other(e: number, n: number): number { return this.ea[e] === n ? this.eb[e]! : this.ea[e]!; }

  isCrossing(e: number): boolean { const k = this.eKind[e]!; return k === EDGE_CROSS_MARKED || k === EDGE_CROSS_UNMARKED; }

  /**
   * Point de la polyligne de l'arête `e` à l'abscisse `s` (depuis a). Écrit [x, y, z, dirX, dirZ] dans `out`
   * (direction unitaire a -> b du morceau) et renvoie l'index du morceau (à repasser en `hint`).
   */
  pointAt(e: number, s: number, out: Float32Array | number[], hint = 0): number {
    const p0 = this.ePt0[e]!, n = this.ePtN[e]!;
    const S = this.ptS;
    let i = hint < 0 ? 0 : hint > n - 2 ? n - 2 : hint;
    while (i < n - 2 && S[p0 + i + 1]! < s) i++;
    while (i > 0 && S[p0 + i]! > s) i--;
    const a = p0 + i, b = a + 1;
    const l = S[b]! - S[a]!;
    const t = l > 1e-6 ? Math.min(1, Math.max(0, (s - S[a]!) / l)) : 0;
    const P = this.pts;
    const ax = P[a * 3]!, ay = P[a * 3 + 1]!, az = P[a * 3 + 2]!;
    const dx = P[b * 3]! - ax, dz = P[b * 3 + 2]! - az;
    out[0] = ax + dx * t;
    out[1] = ay + (P[b * 3 + 1]! - ay) * t;
    out[2] = az + dz * t;
    const inv = l > 1e-6 ? 1 / l : 0;
    out[3] = dx * inv;
    out[4] = dz * inv;
    return i;
  }

  private static cellKey(cx: number, cz: number): number { return (cx + 32768) * 65536 + (cz + 32768); }

  /** Enregistre les morceaux de polyligne dans l'index spatial (appelé par le constructeur du graphe). */
  buildIndex(): void {
    this.cells.clear();
    for (let e = 0; e < this.edgeCount; e++) {
      const p0 = this.ePt0[e]!, n = this.ePtN[e]!;
      for (let i = 0; i < n - 1; i++) {
        const a = (p0 + i) * 3, b = a + 3;
        const x0 = Math.min(this.pts[a]!, this.pts[b]!), x1 = Math.max(this.pts[a]!, this.pts[b]!);
        const z0 = Math.min(this.pts[a + 2]!, this.pts[b + 2]!), z1 = Math.max(this.pts[a + 2]!, this.pts[b + 2]!);
        for (let cx = Math.floor(x0 / INDEX_CELL); cx <= Math.floor(x1 / INDEX_CELL); cx++) {
          for (let cz = Math.floor(z0 / INDEX_CELL); cz <= Math.floor(z1 / INDEX_CELL); cz++) {
            const k = PedGraph.cellKey(cx, cz);
            let list = this.cells.get(k);
            if (!list) { list = []; this.cells.set(k, list); }
            list.push(e, i);
          }
        }
      }
    }
  }

  /**
   * Point du graphe le plus proche de (x, z) dans un rayon. `walkOnly` : trottoirs et rues piétonnes seulement
   * (accès des bâtiments) ; sinon toutes les arêtes (recalage d'un piéton). Renvoie false si rien n'est à portée.
   */
  nearest(x: number, z: number, maxR: number, walkOnly: boolean, out: NearestHit): boolean {
    let best = maxR * maxR, found = false;
    const c0x = Math.floor((x - maxR) / INDEX_CELL), c1x = Math.floor((x + maxR) / INDEX_CELL);
    const c0z = Math.floor((z - maxR) / INDEX_CELL), c1z = Math.floor((z + maxR) / INDEX_CELL);
    const P = this.pts;
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.cells.get(PedGraph.cellKey(cx, cz));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const e = list[k]!;
          if (walkOnly && this.eKind[e] !== EDGE_SIDEWALK) continue;
          const a = (this.ePt0[e]! + list[k + 1]!) * 3, b = a + 3;
          const ax = P[a]!, az = P[a + 2]!;
          const dx = P[b]! - ax, dz = P[b + 2]! - az;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 1e-9 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + dx * t, pz = az + dz * t;
          const d2 = (px - x) * (px - x) + (pz - z) * (pz - z);
          if (d2 < best) {
            best = d2; found = true;
            out.edge = e;
            out.s = this.ptS[a / 3]! + Math.sqrt(l2) * t;
            out.x = px; out.z = pz; out.y = P[a + 1]! + (P[b + 1]! - P[a + 1]!) * t;
          }
        }
      }
    }
    if (found) out.d = Math.sqrt(best);
    return found;
  }
}

/* ------------------------------------------------------------------ */
/* Construction                                                         */
/* ------------------------------------------------------------------ */

interface SegData {
  id: number;
  k: RoadKindDef;
  curve: Cubic;
  arc: ArcTable;
  profile: RoadProfile;
  s0: number;
  s1: number;
  /** Décalage latéral de l'axe de marche et relevé (bordure) au-dessus de la chaussée. */
  off: number;
  dy: number;
  half: number;
  hc: number;
  straight: boolean;
}

const tmpP = new Float64Array(2), tmpD = new Float64Array(2);

/** Point du profil en travers : abscisse s, décalage latéral (positif = gauche du sens a -> b), relevé dy. */
function crossPoint(sd: SegData, s: number, lateral: number, dy: number, out: number[]): void {
  const t = sd.arc.tAt(s);
  evalCubic(sd.curve, t, tmpP);
  derivCubic(sd.curve, t, tmpD);
  const l = Math.hypot(tmpD[0]!, tmpD[1]!) || 1;
  // Normale gauche (vue de dessus) : (tz, -tx) — même convention que le rendu des routes.
  const nx = tmpD[1]! / l, nz = -tmpD[0]! / l;
  out.push(tmpP[0]! + nx * lateral, profileHeightAt(sd.profile, s) + dy, tmpP[1]! + nz * lateral);
}

class Builder {
  nx: number[] = []; ny: number[] = []; nz: number[] = [];
  nodeKeys: string[] = [];
  nodeMap = new Map<string, number>();
  ea: number[] = []; eb: number[] = []; eKind: number[] = []; eHalf: number[] = []; eSeg: number[] = []; eNode: number[] = []; eRoadS: number[] = [];
  ePt0: number[] = []; ePtN: number[] = [];
  pts: number[] = [];

  node(x: number, y: number, z: number): number {
    // Clé au décimètre en plan, au demi-mètre en hauteur (un pont et la rue qu'il enjambe restent distincts).
    const key = `${Math.round(x * 10)},${Math.round(z * 10)},${Math.round(y * 2)}`;
    let i = this.nodeMap.get(key);
    if (i === undefined) {
      i = this.nx.length;
      this.nx.push(x); this.ny.push(y); this.nz.push(z);
      this.nodeKeys.push(key);
      this.nodeMap.set(key, i);
    }
    return i;
  }

  /** Ajoute une arête dont la polyligne est `p` (x, y, z à plat, ≥ 2 points) ; renvoie son index ou -1 si dégénérée. */
  edge(kind: number, p: number[], half: number, segId: number, nodeId: number, roadS = 0): number {
    const n = p.length / 3;
    if (n < 2) return -1;
    const a = this.node(p[0]!, p[1]!, p[2]!);
    const b = this.node(p[(n - 1) * 3]!, p[(n - 1) * 3 + 1]!, p[(n - 1) * 3 + 2]!);
    if (a === b) return -1;
    const e = this.ea.length;
    this.ea.push(a); this.eb.push(b); this.eKind.push(kind); this.eHalf.push(half); this.eSeg.push(segId); this.eNode.push(nodeId); this.eRoadS.push(roadS);
    this.ePt0.push(this.pts.length / 3); this.ePtN.push(n);
    for (let i = 0; i < p.length; i++) this.pts.push(p[i]!);
    return e;
  }
}

function segData(roads: RoadsView, id: number, junctions: Map<number, JunctionInfo>): SegData | null {
  const k = ROAD_KINDS[roads.kindOf(id)];
  if (!k.pedestrians) return null;
  const curve = roads.curve(id);
  const arc = new ArcTable(curve);
  const L = arc.length;
  if (!(L > 0.5)) return null;
  const [na, nb] = roads.endpoints(id);
  const ja = junctions.get(na)!, jb = junctions.get(nb)!;
  const armA = ja.arms.find((x) => x.segId === id && x.atStart) ?? ja.arms.find((x) => x.segId === id);
  const armB = jb.arms.find((x) => x.segId === id && !x.atStart) ?? jb.arms.find((x) => x.segId === id);
  const trimA = ja.type === 'junction' ? (armA?.setback ?? 0) : 0;
  const trimB = jb.type === 'junction' ? (armB?.setback ?? 0) : 0;
  const hc = carriagewayWidth(k) / 2;
  const walk = k.sidewalk > 0;
  return {
    id, k, curve, arc, profile: roads.profile(id),
    s0: Math.min(trimA, L * 0.49), s1: Math.max(L - trimB, L * 0.51),
    off: walk ? hc + k.sidewalk / 2 : k.vehicles ? Math.max(0.3, hc - 0.5) : hc / 2,
    dy: walk ? k.curbHeight : k.surface === 'pavers' ? 0.04 : 0,
    half: walk ? Math.max(0.3, k.sidewalk / 2 - 0.4) : k.vehicles ? 0.3 : Math.max(0.3, hc / 2 - 0.25),
    hc, straight: isStraight(curve),
  };
}

/** Construit le graphe piéton complet du réseau courant. */
export function buildPedGraph(roads: RoadsView): PedGraph {
  const net = roads as unknown as RoadNetwork; // computeJunction n'utilise que des méthodes de consultation présentes dans RoadsView
  const B = new Builder();
  const junctions = new Map<number, JunctionInfo>();
  for (const n of roads.nodeIds()) junctions.set(n, computeJunction(net, n));
  const segs = new Map<number, SegData>();
  let sidewalkM = 0, crossings = 0, marked = 0;

  for (const id of roads.segmentIds()) {
    const sd = segData(roads, id, junctions);
    if (!sd) continue;
    segs.set(id, sd);
    const { k, s0, s1 } = sd;
    const [na, nb] = roads.endpoints(id);
    const span = s1 - s0;
    // Points de coupure des trottoirs : extrémités + traversées.
    const cuts: { s: number; kind: number; node: number }[] = [];
    const endCut = (atStart: boolean): void => {
      const j = junctions.get(atStart ? na : nb)!;
      if (!k.vehicles) { cuts.push({ s: atStart ? s0 : s1, kind: EDGE_LINK, node: j.nodeId }); return; }
      if (j.type === 'junction' && k.sidewalk > 0 && span >= CROSSWALK_MIN_SEGMENT) {
        cuts.push({ s: atStart ? s0 + CROSSWALK_OFFSET : s1 - CROSSWALK_OFFSET, kind: EDGE_CROSS_MARKED, node: j.nodeId });
      } else if (j.type === 'junction' || j.type === 'end') {
        cuts.push({ s: atStart ? s0 : s1, kind: EDGE_CROSS_UNMARKED, node: j.nodeId });
      }
    };
    endCut(true);
    const mid = !k.vehicles ? (span > 50 ? Math.floor(span / 40) : 0)
      : (k.id === 'street' || k.id === 'oneway') && span > MIDBLOCK_MIN ? Math.floor(span / MIDBLOCK_SPACING) : 0;
    for (let i = 0; i < mid; i++) cuts.push({ s: s0 + ((i + 1) * span) / (mid + 1), kind: k.vehicles ? EDGE_CROSS_UNMARKED : EDGE_LINK, node: -1 });
    endCut(false);
    const breaks = [s0, ...cuts.map((c) => c.s), s1].sort((p, q) => p - q).filter((v, i, arr) => i === 0 || v - arr[i - 1]! > 0.05);
    const step = sd.straight ? 8 : 4;
    for (const side of [1, -1]) {
      for (let i = 0; i + 1 < breaks.length; i++) {
        const u = breaks[i]!, v = breaks[i + 1]!;
        const p: number[] = [];
        const n = Math.max(1, Math.ceil((v - u) / step));
        for (let q = 0; q <= n; q++) crossPoint(sd, u + ((v - u) * q) / n, side * sd.off, sd.dy, p);
        if (B.edge(EDGE_SIDEWALK, p, sd.half, id, -1) >= 0) sidewalkM += v - u;
      }
    }
    for (const c of cuts) {
      const p: number[] = [];
      crossPoint(sd, c.s, sd.off, sd.dy, p);
      if (c.kind !== EDGE_LINK && sd.off > sd.hc + 0.25) {
        crossPoint(sd, c.s, sd.hc + 0.2, sd.dy, p);
        crossPoint(sd, c.s, sd.hc - 0.2, 0, p);
        crossPoint(sd, c.s, -sd.hc + 0.2, 0, p);
        crossPoint(sd, c.s, -sd.hc - 0.2, sd.dy, p);
      }
      crossPoint(sd, c.s, -sd.off, sd.dy, p);
      const half = c.kind === EDGE_CROSS_MARKED ? 1.6 : c.kind === EDGE_CROSS_UNMARKED ? 0.8 : 0.5;
      if (B.edge(c.kind, p, half, id, c.node, c.s) >= 0 && c.kind !== EDGE_LINK) { crossings++; if (c.kind === EDGE_CROSS_MARKED) marked++; }
    }
  }

  // Coins : entre deux branches voisines (angle croissant), côté « +p » de l'une et « -p » de la suivante.
  for (const j of junctions.values()) {
    const arms = j.arms.filter((a) => segs.has(a.segId));
    const n = arms.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const e = arms[i]!, f = arms[(i + 1) % n]!;
      const se = segs.get(e.segId)!, sf = segs.get(f.segId)!;
      // +p = rotation +90° de la direction sortante ; en repère du tronçon : droite si le tronçon part du nœud.
      const sideE = e.atStart ? -1 : 1, sideF = f.atStart ? 1 : -1;
      const A: number[] = [], Bp: number[] = [];
      crossPoint(se, e.atStart ? se.s0 : se.s1, sideE * se.off, se.dy, A);
      crossPoint(sf, f.atStart ? sf.s0 : sf.s1, sideF * sf.off, sf.dy, Bp);
      const ax = A[0]!, ay = A[1]!, az = A[2]!, bx = Bp[0]!, by = Bp[1]!, bz = Bp[2]!;
      const dist = Math.hypot(bx - ax, bz - az);
      const p: number[] = [ax, ay, az];
      if (dist > 1.5) {
        const t = lineIntersectT(ax, az, -e.dirX, -e.dirZ, bx, bz, -f.dirX, -f.dirZ);
        let cx = (ax + bx) / 2, cz = (az + bz) / 2;
        if (Number.isFinite(t) && t >= 0 && t <= e.setback * 1.5 + 6) { cx = ax - e.dirX * t; cz = az - e.dirZ * t; }
        const Q = 6;
        for (let q = 1; q < Q; q++) {
          const u = q / Q, w = 1 - u;
          p.push(w * w * ax + 2 * w * u * cx + u * u * bx, ay * w + by * u, w * w * az + 2 * w * u * cz + u * u * bz);
        }
      }
      p.push(bx, by, bz);
      B.edge(EDGE_CORNER, p, Math.min(se.half, sf.half), -1, j.nodeId);
    }
  }

  return finish(B, roads.version, { sidewalkM, crossings, marked });
}

function finish(B: Builder, version: number, c: { sidewalkM: number; crossings: number; marked: number }): PedGraph {
  const g = new PedGraph();
  g.roadsVersion = version;
  g.nodeCount = B.nx.length;
  g.nx = Float32Array.from(B.nx); g.ny = Float32Array.from(B.ny); g.nz = Float32Array.from(B.nz);
  const E = B.ea.length;
  g.edgeCount = E;
  g.ea = Int32Array.from(B.ea); g.eb = Int32Array.from(B.eb); g.eKind = Uint8Array.from(B.eKind);
  g.eHalf = Float32Array.from(B.eHalf); g.eSeg = Int32Array.from(B.eSeg); g.eNode = Int32Array.from(B.eNode); g.eRoadS = Float32Array.from(B.eRoadS);
  g.ePt0 = Int32Array.from(B.ePt0); g.ePtN = Int32Array.from(B.ePtN);
  g.pts = Float32Array.from(B.pts);
  g.ptS = new Float32Array(g.pts.length / 3);
  g.eLen = new Float32Array(E);
  for (let e = 0; e < E; e++) {
    const p0 = g.ePt0[e]!, n = g.ePtN[e]!;
    let acc = 0;
    g.ptS[p0] = 0;
    for (let i = 1; i < n; i++) {
      const a = (p0 + i - 1) * 3, b = a + 3;
      acc += Math.hypot(g.pts[b]! - g.pts[a]!, g.pts[b + 2]! - g.pts[a + 2]!);
      g.ptS[p0 + i] = acc;
    }
    g.eLen[e] = acc;
  }
  // Adjacence compacte.
  const deg = new Int32Array(g.nodeCount + 1);
  for (let e = 0; e < E; e++) { deg[g.ea[e]! + 1]!++; deg[g.eb[e]! + 1]!++; }
  for (let i = 0; i < g.nodeCount; i++) deg[i + 1]! += deg[i]!;
  g.adjStart = deg;
  g.adjEdge = new Int32Array(E * 2);
  const fill = new Int32Array(g.nodeCount);
  for (let e = 0; e < E; e++) {
    const a = g.ea[e]!, b = g.eb[e]!;
    g.adjEdge[deg[a]! + fill[a]!++] = e;
    g.adjEdge[deg[b]! + fill[b]!++] = e;
  }
  // Clés stables.
  g.eKey = new Array<string>(E);
  for (let e = 0; e < E; e++) {
    const ka = B.nodeKeys[g.ea[e]!]!, kb = B.nodeKeys[g.eb[e]!]!;
    let key = `${g.eKind[e]}|${ka}|${kb}`;
    while (g.keyIndex.has(key)) key += '+';
    g.eKey[e] = key;
    g.keyIndex.set(key, e);
  }
  g.stats = { nodes: g.nodeCount, edges: E, sidewalkM: Math.round(c.sidewalkM), crossings: c.crossings, crossingsMarked: c.marked };
  g.buildIndex();
  return g;
}
