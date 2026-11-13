/**
 * Graphe routier de la simulation : nœuds + tronçons courbes (Bézier cubiques), stockage en
 * structure-de-tableaux (typed arrays, suppression par permutation, croissance par doublement),
 * index spatial, découpe de tronçon, profils en long mis en cache, journal des changements
 * (pour les deltas envoyés au rendu). TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ArcTable, closestOnCubic, cubicBounds, splitCubic, straightCubic, type Cubic } from './bezier';
import { computeProfile, profileFromHeights, profileHeightAt, type ProfileEnv, type RoadProfile } from './profile';
import { computeSides } from './sides';
import { SpatialHash } from './spatial';
import { ROAD_KINDS, ROAD_KIND_ORDER, halfWidth, type RoadKindId } from './types';

export interface NetworkChanges {
  nodesAdded: number[];
  nodesRemoved: number[];
  segmentsAdded: number[];
  segmentsRemoved: number[];
}

function growF64(a: Float64Array, n: number): Float64Array { const b = new Float64Array(n); b.set(a); return b; }
function growF32(a: Float32Array, n: number): Float32Array { const b = new Float32Array(n); b.set(a); return b; }
function growI32(a: Int32Array, n: number): Int32Array { const b = new Int32Array(n); b.set(a); return b; }
function growU8(a: Uint8Array, n: number): Uint8Array { const b = new Uint8Array(n); b.set(a); return b; }

export class RoadNetwork {
  /* ----- nœuds (SoA) ----- */
  nodeCount = 0;
  private nodeCap: number;
  nodeId: Int32Array;
  nodeX: Float64Array;
  nodeY: Float64Array;
  nodeZ: Float64Array;
  /** Nombre de tronçons incidents. */
  nodeDegree: Int32Array;

  /* ----- tronçons (SoA) ----- */
  segCount = 0;
  private segCap: number;
  segId: Int32Array;
  segA: Int32Array;
  segB: Int32Array;
  segKind: Uint8Array;
  /** 8 doubles par tronçon : courbe cubique complète (p0 = nœud a, p3 = nœud b). */
  segCurve: Float64Array;
  segLength: Float32Array;
  /** Hauteur imposée au tracé (m, multiple de 4 ; 0 = au niveau du terrain). */
  segElev: Float32Array;

  /** Incrémenté à chaque modification (invalide caches de chemins, maillages…). */
  version = 0;
  nextNodeId = 1;
  nextSegId = 1;

  private nodeIdx = new Map<number, number>();
  private segIdx = new Map<number, number>();
  private incidentMap = new Map<number, number[]>();
  private profiles = new Map<number, RoadProfile>();
  private arcs = new Map<number, ArcTable>();
  /** Tronçons dont le profil est imposé (setProfile) : jamais recalculé localement. */
  private pinned = new Set<number>();
  /** Tronçons d'anneau de giratoire : centre et rayon de l'axe de l'anneau. */
  private rings = new Map<number, [number, number, number]>();
  private readonly nodeHash = new SpatialHash(64);
  private readonly segHash = new SpatialHash(64);
  private changes: NetworkChanges = { nodesAdded: [], nodesRemoved: [], segmentsAdded: [], segmentsRemoved: [] };
  private readonly tmp: number[] = [];

  constructor(public env: ProfileEnv, capacity = 256) {
    this.nodeCap = capacity;
    this.nodeId = new Int32Array(capacity);
    this.nodeX = new Float64Array(capacity);
    this.nodeY = new Float64Array(capacity);
    this.nodeZ = new Float64Array(capacity);
    this.nodeDegree = new Int32Array(capacity);
    this.segCap = capacity;
    this.segId = new Int32Array(capacity);
    this.segA = new Int32Array(capacity);
    this.segB = new Int32Array(capacity);
    this.segKind = new Uint8Array(capacity);
    this.segCurve = new Float64Array(capacity * 8);
    this.segLength = new Float32Array(capacity);
    this.segElev = new Float32Array(capacity);
  }

  /* ------------------------------ Nœuds ------------------------------ */

  addNode(x: number, z: number, y?: number, id?: number): number {
    if (this.nodeCount === this.nodeCap) {
      const n = this.nodeCap * 2;
      this.nodeId = growI32(this.nodeId, n); this.nodeX = growF64(this.nodeX, n); this.nodeY = growF64(this.nodeY, n);
      this.nodeZ = growF64(this.nodeZ, n); this.nodeDegree = growI32(this.nodeDegree, n);
      this.nodeCap = n;
    }
    const nid = id ?? this.nextNodeId;
    if (this.nodeIdx.has(nid)) throw new Error(`nœud ${nid} déjà présent`);
    this.nextNodeId = Math.max(this.nextNodeId, nid + 1);
    const i = this.nodeCount++;
    this.nodeId[i] = nid; this.nodeX[i] = x; this.nodeZ[i] = z;
    this.nodeY[i] = y ?? this.env.heightAt(x, z);
    this.nodeDegree[i] = 0;
    this.nodeIdx.set(nid, i);
    this.incidentMap.set(nid, []);
    this.nodeHash.insert(nid, x, z, x, z);
    this.changes.nodesAdded.push(nid);
    this.version++;
    return nid;
  }

  nodeIndex(id: number): number { return this.nodeIdx.get(id) ?? -1; }
  hasNode(id: number): boolean { return this.nodeIdx.has(id); }

  nodePos(id: number): { x: number; y: number; z: number } {
    const i = this.nodeIdx.get(id);
    if (i === undefined) throw new Error(`nœud inconnu ${id}`);
    return { x: this.nodeX[i]!, y: this.nodeY[i]!, z: this.nodeZ[i]! };
  }

  /** Tronçons incidents à un nœud (ne pas modifier). */
  incident(nodeId: number): readonly number[] { return this.incidentMap.get(nodeId) ?? []; }

  private removeNode(id: number): void {
    const i = this.nodeIdx.get(id);
    if (i === undefined) return;
    const last = this.nodeCount - 1;
    if (i !== last) {
      this.nodeId[i] = this.nodeId[last]!; this.nodeX[i] = this.nodeX[last]!; this.nodeY[i] = this.nodeY[last]!;
      this.nodeZ[i] = this.nodeZ[last]!; this.nodeDegree[i] = this.nodeDegree[last]!;
      this.nodeIdx.set(this.nodeId[i]!, i);
    }
    this.nodeIdx.delete(id);
    this.incidentMap.delete(id);
    this.nodeHash.remove(id);
    this.nodeCount--;
    this.changes.nodesRemoved.push(id);
    this.version++;
  }

  /** Nœud le plus proche dans un rayon (ou -1). */
  nodeNear(x: number, z: number, radius: number, exclude?: (id: number) => boolean): number {
    const ids = this.nodeHash.query(x - radius, z - radius, x + radius, z + radius, this.tmp);
    let best = -1, bestD = radius;
    for (const id of ids) {
      if (exclude?.(id)) continue;
      const i = this.nodeIdx.get(id)!;
      const d = Math.hypot(this.nodeX[i]! - x, this.nodeZ[i]! - z);
      if (d <= bestD) { bestD = d; best = id; }
    }
    return best;
  }

  /* ----------------------------- Tronçons ----------------------------- */

  segIndex(id: number): number { return this.segIdx.get(id) ?? -1; }
  hasSegment(id: number): boolean { return this.segIdx.has(id); }

  /**
   * Ajoute un tronçon entre deux nœuds existants. `curve` (optionnelle) donne les points de
   * contrôle ; ses extrémités sont recalées sur les nœuds. Sans courbe : tronçon droit.
   */
  addSegment(a: number, b: number, kind: RoadKindId, curve?: Cubic, id?: number, elevation = 0): number {
    const ia = this.nodeIdx.get(a), ib = this.nodeIdx.get(b);
    if (ia === undefined || ib === undefined) throw new Error('nœud inconnu');
    if (a === b) throw new Error('tronçon dégénéré');
    if (this.segCount === this.segCap) {
      const n = this.segCap * 2;
      this.segId = growI32(this.segId, n); this.segA = growI32(this.segA, n); this.segB = growI32(this.segB, n);
      this.segKind = growU8(this.segKind, n); this.segCurve = growF64(this.segCurve, n * 8); this.segLength = growF32(this.segLength, n);
      this.segElev = growF32(this.segElev, n);
      this.segCap = n;
    }
    const sid = id ?? this.nextSegId;
    if (this.segIdx.has(sid)) throw new Error(`tronçon ${sid} déjà présent`);
    this.nextSegId = Math.max(this.nextSegId, sid + 1);
    const ax = this.nodeX[ia]!, az = this.nodeZ[ia]!, bx = this.nodeX[ib]!, bz = this.nodeZ[ib]!;
    const c = curve ? new Float64Array(curve) : straightCubic(ax, az, bx, bz);
    // Recalage des extrémités (et des tangentes, translatées du même déplacement).
    c[2] = c[2]! + (ax - c[0]!); c[3] = c[3]! + (az - c[1]!); c[0] = ax; c[1] = az;
    c[4] = c[4]! + (bx - c[6]!); c[5] = c[5]! + (bz - c[7]!); c[6] = bx; c[7] = bz;
    const i = this.segCount++;
    this.segId[i] = sid; this.segA[i] = a; this.segB[i] = b;
    this.segKind[i] = ROAD_KIND_ORDER.indexOf(kind);
    this.segElev[i] = Number.isFinite(elevation) ? elevation : 0;
    this.segCurve.set(c, i * 8);
    const arc = new ArcTable(c);
    this.arcs.set(sid, arc);
    this.segLength[i] = arc.length;
    this.segIdx.set(sid, i);
    this.nodeDegree[ia]!++; this.nodeDegree[ib]!++;
    this.incidentMap.get(a)!.push(sid);
    this.incidentMap.get(b)!.push(sid);
    const [x0, z0, x1, z1] = cubicBounds(c);
    const hw = halfWidth(kind);
    this.segHash.insert(sid, x0 - hw, z0 - hw, x1 + hw, z1 + hw);
    this.changes.segmentsAdded.push(sid);
    this.version++;
    return sid;
  }

  /** Supprime un tronçon ; les nœuds devenus orphelins sont supprimés (ids renvoyés). */
  removeSegment(id: number): number[] {
    const i = this.segIdx.get(id);
    if (i === undefined) return [];
    const a = this.segA[i]!, b = this.segB[i]!;
    const last = this.segCount - 1;
    if (i !== last) {
      this.segId[i] = this.segId[last]!; this.segA[i] = this.segA[last]!; this.segB[i] = this.segB[last]!;
      this.segKind[i] = this.segKind[last]!; this.segLength[i] = this.segLength[last]!; this.segElev[i] = this.segElev[last]!;
      this.segCurve.copyWithin(i * 8, last * 8, last * 8 + 8);
      this.segIdx.set(this.segId[i]!, i);
    }
    this.segIdx.delete(id);
    this.segCount--;
    this.arcs.delete(id);
    this.profiles.delete(id);
    this.pinned.delete(id);
    this.rings.delete(id);
    this.segHash.remove(id);
    this.changes.segmentsRemoved.push(id);
    this.version++;
    const orphans: number[] = [];
    for (const n of [a, b]) {
      const list = this.incidentMap.get(n);
      if (list) { const k = list.indexOf(id); if (k >= 0) list.splice(k, 1); }
      const ni = this.nodeIdx.get(n);
      if (ni === undefined) continue;
      this.nodeDegree[ni]!--;
      if (this.nodeDegree[ni]! <= 0) { this.removeNode(n); orphans.push(n); }
      else this.invalidateAround(n);
    }
    return orphans;
  }

  kindOf(id: number): RoadKindId {
    const i = this.segIdx.get(id);
    if (i === undefined) throw new Error(`tronçon inconnu ${id}`);
    return ROAD_KIND_ORDER[this.segKind[i]!]!;
  }

  /** Hauteur imposée au tracé du tronçon (m). */
  elevationOf(id: number): number {
    const i = this.segIdx.get(id);
    return i === undefined ? 0 : this.segElev[i]!;
  }

  /** Marque un tronçon comme portion d'anneau de giratoire (centre, rayon de l'axe). */
  setRing(id: number, ring: readonly [number, number, number] | null): void {
    if (!this.segIdx.has(id)) return;
    if (ring) this.rings.set(id, [ring[0], ring[1], ring[2]]); else this.rings.delete(id);
  }

  /** Giratoire dont le tronçon fait partie (centre x, z, rayon de l'axe), ou null. */
  ringOf(id: number): readonly [number, number, number] | null { return this.rings.get(id) ?? null; }

  endpoints(id: number): [number, number] {
    const i = this.segIdx.get(id)!;
    return [this.segA[i]!, this.segB[i]!];
  }

  /** Copie de la courbe d'un tronçon. */
  curve(id: number): Cubic {
    const i = this.segIdx.get(id);
    if (i === undefined) throw new Error(`tronçon inconnu ${id}`);
    return this.segCurve.slice(i * 8, i * 8 + 8);
  }

  arc(id: number): ArcTable {
    const a = this.arcs.get(id);
    if (!a) throw new Error(`tronçon inconnu ${id}`);
    return a;
  }

  length(id: number): number { return this.segLength[this.segIdx.get(id)!]!; }

  /** Profil en long (calculé à la demande puis mis en cache). */
  profile(id: number): RoadProfile {
    let p = this.profiles.get(id);
    if (p) return p;
    const i = this.segIdx.get(id);
    if (i === undefined) throw new Error(`tronçon inconnu ${id}`);
    const ia = this.nodeIdx.get(this.segA[i]!)!, ib = this.nodeIdx.get(this.segB[i]!)!;
    const kind = ROAD_KINDS[ROAD_KIND_ORDER[this.segKind[i]!]!];
    p = computeProfile(this.curve(id), this.arc(id), this.nodeY[ia]!, this.nodeY[ib]!, kind.maxGrade, this.env, this.segElev[i]!);
    computeSides(p, this.curve(id), this.arc(id), kind, this.env);
    this.profiles.set(id, p);
    return p;
  }

  /** Impose le profil calculé par la simulation (hauteurs au pas PROFILE_STEP + plages de pont). */
  setProfile(id: number, heights: readonly number[], runs: readonly number[], tunnels: readonly number[] = [], walls: readonly number[] = []): void {
    if (!this.segIdx.has(id)) return;
    const p = profileFromHeights(this.curve(id), this.arc(id), heights, runs, this.env, tunnels);
    p.wallL = new Uint8Array(p.count); p.wallR = new Uint8Array(p.count);
    for (let k = 0; k + 2 < walls.length; k += 3) {
      const arr = walls[k] === 0 ? p.wallL : p.wallR;
      for (let i = Math.max(0, walls[k + 1]!); i < Math.min(p.count, walls[k + 2]!); i++) arr[i] = 1;
    }
    this.profiles.set(id, p);
    this.pinned.add(id);
  }

  private invalidateAround(nodeId: number): void {
    for (const s of this.incident(nodeId)) if (!this.pinned.has(s)) this.profiles.delete(s);
  }

  /** Change la hauteur d'un nœud (profils incidents invalidés). */
  setNodeHeight(id: number, y: number): void {
    const i = this.nodeIdx.get(id);
    if (i === undefined) return;
    this.nodeY[i] = y;
    this.invalidateAround(id);
    this.version++;
  }

  /** Tronçons dont la boîte (élargie de la demi-largeur) touche la zone. */
  segmentsIn(minX: number, minZ: number, maxX: number, maxZ: number, out: number[] = []): number[] {
    return this.segHash.query(minX, minZ, maxX, maxZ, out);
  }

  /** Tronçon le plus proche d'un point (axe), dans un rayon. */
  segmentNear(x: number, z: number, radius: number, exclude?: (id: number) => boolean): { segId: number; t: number; d: number; x: number; z: number } | null {
    const ids = this.segHash.query(x - radius, z - radius, x + radius, z + radius, []);
    let best: { segId: number; t: number; d: number; x: number; z: number } | null = null;
    for (const id of ids) {
      if (exclude?.(id)) continue;
      const r = closestOnCubic(this.curve(id), x, z);
      if (r.d <= radius && (!best || r.d < best.d)) best = { segId: id, ...r };
    }
    return best;
  }

  /**
   * Découpe un tronçon en t (0 < t < 1) : crée un nœud (hauteur = profil existant) et deux tronçons
   * du même type qui reproduisent exactement la courbe d'origine. Renvoie le nœud et les deux tronçons.
   */
  splitSegment(id: number, t: number): { nodeId: number; first: number; second: number } {
    const i = this.segIdx.get(id);
    if (i === undefined) throw new Error(`tronçon inconnu ${id}`);
    const a = this.segA[i]!, b = this.segB[i]!;
    const kind = this.kindOf(id);
    const elev = this.segElev[i]!;
    const ring = this.rings.get(id) ?? null;
    const c = this.curve(id);
    const arc = this.arc(id);
    const y = profileHeightAt(this.profile(id), arc.sAt(t));
    const [l, r] = splitCubic(c, t);
    const nodeId = this.addNode(l[6]!, l[7]!, y);
    // Retrait sans supprimer les nœuds extrémités (ils gardent au moins le nouveau tronçon).
    const ia = this.nodeIdx.get(a)!, ib = this.nodeIdx.get(b)!;
    this.nodeDegree[ia]!++; this.nodeDegree[ib]!++; // protège contre la suppression d'orphelins
    this.removeSegment(id);
    this.nodeDegree[this.nodeIdx.get(a)!]!--; this.nodeDegree[this.nodeIdx.get(b)!]!--;
    const first = this.addSegment(a, nodeId, kind, l, undefined, elev);
    const second = this.addSegment(nodeId, b, kind, r, undefined, elev);
    if (ring) { this.setRing(first, ring); this.setRing(second, ring); }
    return { nodeId, first, second };
  }

  /** Renvoie et vide le journal des changements. */
  takeChanges(): NetworkChanges {
    const c = this.changes;
    this.changes = { nodesAdded: [], nodesRemoved: [], segmentsAdded: [], segmentsRemoved: [] };
    // Un élément créé puis supprimé dans le même lot n'apparaît nulle part.
    const cancel = (added: number[], removed: number[]): void => {
      const both = new Set(added.filter((x) => removed.includes(x)));
      if (both.size === 0) return;
      for (const arr of [added, removed]) {
        let w = 0;
        for (const x of arr) if (!both.has(x)) arr[w++] = x;
        arr.length = w;
      }
    };
    cancel(c.nodesAdded, c.nodesRemoved);
    cancel(c.segmentsAdded, c.segmentsRemoved);
    return c;
  }

  clear(): void {
    this.nodeCount = 0; this.segCount = 0;
    this.nodeIdx.clear(); this.segIdx.clear(); this.incidentMap.clear();
    this.profiles.clear(); this.pinned.clear(); this.rings.clear(); this.arcs.clear(); this.nodeHash.clear(); this.segHash.clear();
    this.nextNodeId = 1; this.nextSegId = 1;
    this.takeChanges();
    this.version++;
  }

  /** Ids de tous les tronçons (copie). */
  segmentIds(): number[] { return Array.from(this.segId.subarray(0, this.segCount)); }
  nodeIds(): number[] { return Array.from(this.nodeId.subarray(0, this.nodeCount)); }

  /** Longueur totale du réseau (m). */
  totalLength(): number {
    let s = 0;
    for (let i = 0; i < this.segCount; i++) s += this.segLength[i]!;
    return s;
  }
}
