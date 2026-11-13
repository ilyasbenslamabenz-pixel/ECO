/**
 * Graphe de circulation du trafic (TypeScript pur, worker) construit à partir d'une description
 * NEUTRE du réseau routier (nœuds + tronçons polylignes avec nombre de voies par sens).
 *
 * - « Liens » unifiés en structure-de-tableaux : VOIES (une par tronçon, sens et rang) et CONNECTEURS
 *   (manœuvres dans les carrefours : courbes de Bézier quadratiques d'une fin de voie au début d'une autre).
 * - Voies : décalage latéral à droite du sens de marche (circulation à droite), rognage aux carrefours.
 * - Connecteurs : type de manœuvre (tout droit / gauche / droite / demi-tour en impasse), règles de voie
 *   (tourner à droite depuis la voie de droite, à gauche depuis la voie de gauche), conflits géométriques
 *   précalculés (croisement ou convergence vers la même voie).
 * - Carrefours : régime (aucun, priorité à droite, cédez-le-passage, feux tricolores), bras et phases.
 * - Arcs orientés (tronçon, sens) pour le calcul d'itinéraire A*.
 * AUCUN import de three ni du DOM.
 */

/** Description neutre d'un tronçon (indépendante du stockage du monde : RoadGraph ou RoadNetwork). */
export interface TrafficEdgeInput {
  id: number;
  a: number;
  b: number;
  /** Polyligne de l'axe, de a vers b : x, y, z, x, y, z… (au moins 2 points). */
  points: number[];
  lanesForward: number;
  lanesBackward: number;
  laneWidth: number;
  /** Largeur du terre-plein central (m). */
  median: number;
  speedKmh: number;
  /** Rang hiérarchique (0 rue, 1 avenue, 2 boulevard, 3 voie rapide) : priorités et feux. */
  rank: number;
  /**
   * Distance (m, le long de l'axe) du nœud a / b à la LIGNE D'ARRÊT : fin des voies entrantes et début des voies
   * sortantes. Absent : rognage calculé d'après la largeur des voies du carrefour (comportement d'origine).
   */
  stopA?: number;
  stopB?: number;
  /**
   * Distance (m) du nœud a / b au CENTRE du passage piéton qui traverse le tronçon à cette extrémité ;
   * valeur négative = pas de passage. Absent : passage par défaut aux carrefours (2,8 m avant la ligne d'arrêt).
   */
  crossA?: number;
  crossB?: number;
  /** Demi-largeur de la chaussée traversée par le passage (m, bordure à bordure / 2). Absent : d'après les voies. */
  crossHalf?: number;
}
export interface TrafficNodeInput { id: number; x: number; y: number; z: number }
export interface TrafficNetworkInput { nodes: TrafficNodeInput[]; edges: TrafficEdgeInput[] }

export const enum Control { None = 0, Priority = 1, Yield = 2, Signal = 3, DeadEnd = 4 }
export const enum Turn { Straight = 0, Left = 1, Right = 2, UTurn = 3 }

const growF = (a: Float32Array, n: number): Float32Array => { const b = new Float32Array(n); b.set(a.subarray(0, Math.min(a.length, n))); return b; };

export class TrafficGraph {
  /* ---------- nœuds ---------- */
  readonly nodeCount: number;
  readonly nodeId: Int32Array;
  readonly nodeX: Float32Array;
  readonly nodeY: Float32Array;
  readonly nodeZ: Float32Array;
  readonly nodeControl: Uint8Array;
  /** Rognage des voies au carrefour (m). */
  readonly nodeTrim: Float32Array;
  /** Feux : nombre de phases, durée de vert de chaque phase (s). */
  readonly nodePhases: Uint8Array;
  readonly nodeGreen: Float32Array; // 4 phases max par nœud
  readonly nodeArmStart: Int32Array; // CSR des bras (arcs entrants) par nœud
  readonly armArc: Int32Array; // arc entrant (tronçon, sens) de chaque bras
  readonly armPhase: Uint8Array;
  readonly armRankPrio: Uint8Array; // 1 = bras prioritaire (cédez-le-passage)
  readonly armAngle: Float32Array; // direction d'arrivée (rad)
  /** Branche (tronçon incident) de chaque bras : index dans les tableaux `leg*`. */
  readonly armLeg: Int32Array;

  /* ---------- branches et passages piétons ---------- */
  /** CSR des branches (tronçons incidents, avec ou sans voie entrante) par nœud. */
  readonly nodeLegStart: Int32Array;
  readonly legNode: Int32Array;
  readonly legEdge: Int32Array;
  /** Identifiant stable du passage : idTronçon × 2 + (0 extrémité a | 1 extrémité b). */
  readonly legId: Int32Array;
  /** Bras entrant de la branche (index de bras), −1 si la branche n'a pas de voie entrante. */
  readonly legArm: Int32Array;
  /** Distance du nœud à la ligne d'arrêt de la branche (m). */
  readonly legStop: Float32Array;
  /** Distance du nœud au centre du passage piéton (m) ; −1 = pas de passage. */
  readonly legCross: Float32Array;
  /** Demi-largeur de chaussée traversée (m). */
  readonly legHalf: Float32Array;
  /** Passage : centre (x, y, z) et deux extrémités sur les bordures (a = côté gauche du sens sortant, b = côté droit). */
  readonly legX: Float32Array; readonly legY: Float32Array; readonly legZ: Float32Array;
  readonly legAX: Float32Array; readonly legAZ: Float32Array; readonly legBX: Float32Array; readonly legBZ: Float32Array;
  /** Bits des phases de feu pendant lesquelles des véhicules franchissent le passage en mouvement protégé (tout droit ou bras de la branche). */
  readonly legPhaseMask: Uint8Array;
  private readonly legIndexOf = new Map<number, number>();

  /* ---------- tronçons ---------- */
  readonly edgeCount: number;
  readonly edgeId: Int32Array;
  readonly edgeA: Int32Array; // index de nœud
  readonly edgeB: Int32Array;
  readonly edgeLen: Float32Array;
  readonly edgeSpeed: Float32Array; // m/s
  readonly edgeRank: Uint8Array;
  readonly edgeLanes: Uint8Array; // 2 par tronçon : [avant, arrière]
  readonly edgeLaneWidth: Float32Array;
  readonly edgeMedian: Float32Array;
  /** Distance nœud → ligne d'arrêt imposée par l'entrée (2 par tronçon : [a, b]) ; NaN = rognage par défaut. */
  readonly edgeStop: Float32Array;
  readonly edgePtStart: Int32Array; // CSR des points de polyligne
  readonly ptX: Float32Array;
  readonly ptY: Float32Array;
  readonly ptZ: Float32Array;
  readonly ptS: Float32Array; // abscisse curviligne cumulée
  /** Premier lien (voie) de chaque arc = tronçon*2 + (0 avant | 1 arrière) ; -1 si aucun. */
  readonly arcFirstLane: Int32Array;
  readonly arcLaneCount: Uint8Array;

  /* ---------- liens (voies + connecteurs) ---------- */
  linkCount = 0;
  laneCount = 0;
  linkKind: Uint8Array = new Uint8Array(0); // 0 voie, 1 connecteur
  linkLen: Float32Array = new Float32Array(0);
  linkSpeed: Float32Array = new Float32Array(0);
  linkArc: Int32Array = new Int32Array(0); // voie : arc ; connecteur : arc de destination
  linkRank: Uint8Array = new Uint8Array(0); // voie : rang (0 = intérieur, près de l'axe)
  linkOffset: Float32Array = new Float32Array(0); // voie : décalage à droite de l'axe (m), dans le sens de marche
  linkS0: Float32Array = new Float32Array(0); // voie : abscisse de début sur l'axe (dans le sens de marche)
  linkToNode: Int32Array = new Int32Array(0);
  linkFromNode: Int32Array = new Int32Array(0);
  // connecteurs
  connFrom: Int32Array = new Int32Array(0); // voie amont
  connTo: Int32Array = new Int32Array(0); // voie aval
  connTurn: Uint8Array = new Uint8Array(0);
  connArm: Int32Array = new Int32Array(0); // bras d'entrée (index dans armArc)
  /** Branche de sortie de chaque connecteur (index de branche) et abscisse du connecteur où commence le passage piéton de sortie (−1 : aucun). */
  connOutLeg: Int32Array = new Int32Array(0);
  connOutCrossS: Float32Array = new Float32Array(0);
  connP: Float32Array = new Float32Array(0); // 9 flottants : p0, p1 (contrôle), p2
  conflictStart: Int32Array = new Int32Array(0);
  conflicts: Int32Array = new Int32Array(0);
  /** Connecteurs sortant de chaque voie (CSR sur l'index de voie). */
  laneConnStart: Int32Array = new Int32Array(0);
  laneConns: Int32Array = new Int32Array(0);

  /* ---------- arcs (itinéraires) ---------- */
  /** CSR : arcs atteignables depuis chaque arc via au moins un connecteur (manœuvres autorisées). */
  arcNextStart: Int32Array = new Int32Array(0);
  arcNext: Int32Array = new Int32Array(0);
  /** CSR : arcs sortant de chaque nœud. */
  readonly nodeOutStart: Int32Array;
  readonly nodeOut: Int32Array;

  private readonly nodeIndexOf = new Map<number, number>();
  private readonly edgeIndexOf = new Map<number, number>();

  constructor(input: TrafficNetworkInput) {
    const nodes = input.nodes;
    this.nodeCount = nodes.length;
    this.nodeId = new Int32Array(nodes.length);
    this.nodeX = new Float32Array(nodes.length);
    this.nodeY = new Float32Array(nodes.length);
    this.nodeZ = new Float32Array(nodes.length);
    nodes.forEach((n, i) => { this.nodeId[i] = n.id; this.nodeX[i] = n.x; this.nodeY[i] = n.y; this.nodeZ[i] = n.z; this.nodeIndexOf.set(n.id, i); });
    const edges = input.edges.filter((e) => this.nodeIndexOf.has(e.a) && this.nodeIndexOf.has(e.b) && e.a !== e.b && e.points.length >= 6 && e.lanesForward + e.lanesBackward > 0);
    const E = edges.length;
    this.edgeCount = E;
    this.edgeId = new Int32Array(E); this.edgeA = new Int32Array(E); this.edgeB = new Int32Array(E);
    this.edgeLen = new Float32Array(E); this.edgeSpeed = new Float32Array(E); this.edgeRank = new Uint8Array(E);
    this.edgeLanes = new Uint8Array(E * 2); this.edgeLaneWidth = new Float32Array(E); this.edgeMedian = new Float32Array(E);
    this.edgeStop = new Float32Array(E * 2).fill(NaN);
    this.edgePtStart = new Int32Array(E + 1);
    let np = 0;
    for (const e of edges) np += e.points.length / 3;
    this.ptX = new Float32Array(np); this.ptY = new Float32Array(np); this.ptZ = new Float32Array(np); this.ptS = new Float32Array(np);
    let k = 0;
    edges.forEach((e, i) => {
      this.edgeId[i] = e.id; this.edgeIndexOf.set(e.id, i);
      this.edgeA[i] = this.nodeIndexOf.get(e.a)!; this.edgeB[i] = this.nodeIndexOf.get(e.b)!;
      this.edgeSpeed[i] = Math.max(1, e.speedKmh / 3.6); this.edgeRank[i] = e.rank;
      this.edgeLanes[i * 2] = e.lanesForward; this.edgeLanes[i * 2 + 1] = e.lanesBackward;
      this.edgeLaneWidth[i] = e.laneWidth; this.edgeMedian[i] = e.median;
      if (e.stopA !== undefined && e.stopA >= 0) this.edgeStop[i * 2] = e.stopA;
      if (e.stopB !== undefined && e.stopB >= 0) this.edgeStop[i * 2 + 1] = e.stopB;
      this.edgePtStart[i] = k;
      let s = 0;
      for (let p = 0; p < e.points.length; p += 3) {
        const x = e.points[p]!, y = e.points[p + 1]!, z = e.points[p + 2]!;
        if (p > 0) s += Math.hypot(x - this.ptX[k - 1]!, z - this.ptZ[k - 1]!);
        this.ptX[k] = x; this.ptY[k] = y; this.ptZ[k] = z; this.ptS[k] = s; k++;
      }
      this.edgeLen[i] = s;
    });
    this.edgePtStart[E] = k;

    // arcs sortants par nœud
    const deg = new Int32Array(this.nodeCount + 1);
    const degAll = new Int32Array(this.nodeCount);
    for (let e = 0; e < E; e++) {
      degAll[this.edgeA[e]!]!++; degAll[this.edgeB[e]!]!++;
      if (this.edgeLanes[e * 2]! > 0) deg[this.edgeA[e]! + 1]!++;
      if (this.edgeLanes[e * 2 + 1]! > 0) deg[this.edgeB[e]! + 1]!++;
    }
    for (let i = 0; i < this.nodeCount; i++) deg[i + 1]! += deg[i]!;
    this.nodeOutStart = deg;
    this.nodeOut = new Int32Array(deg[this.nodeCount]!);
    const fill = new Int32Array(this.nodeCount);
    for (let e = 0; e < E; e++) {
      if (this.edgeLanes[e * 2]! > 0) { const n = this.edgeA[e]!; this.nodeOut[deg[n]! + fill[n]!++] = e * 2; }
      if (this.edgeLanes[e * 2 + 1]! > 0) { const n = this.edgeB[e]!; this.nodeOut[deg[n]! + fill[n]!++] = e * 2 + 1; }
    }

    // régime des carrefours, rognage, bras
    this.nodeControl = new Uint8Array(this.nodeCount);
    this.nodeTrim = new Float32Array(this.nodeCount);
    this.nodePhases = new Uint8Array(this.nodeCount);
    this.nodeGreen = new Float32Array(this.nodeCount * 4);
    this.nodeArmStart = new Int32Array(this.nodeCount + 1);
    const incident: number[][] = Array.from({ length: this.nodeCount }, () => []);
    for (let e = 0; e < E; e++) { incident[this.edgeA[e]!]!.push(e); incident[this.edgeB[e]!]!.push(e); }
    const arms: number[] = [];
    const armPhase: number[] = [], armPrio: number[] = [], armAngle: number[] = [];
    // branches : une par tronçon incident (dans l'ordre d'entrée des tronçons)
    this.nodeLegStart = new Int32Array(this.nodeCount + 1);
    { let nlegs = 0; for (let n = 0; n < this.nodeCount; n++) { this.nodeLegStart[n] = nlegs; nlegs += incident[n]!.length; } this.nodeLegStart[this.nodeCount] = nlegs; }
    const NL = this.nodeLegStart[this.nodeCount]!;
    this.legNode = new Int32Array(NL); this.legEdge = new Int32Array(NL); this.legId = new Int32Array(NL); this.legArm = new Int32Array(NL).fill(-1);
    this.legStop = new Float32Array(NL); this.legCross = new Float32Array(NL).fill(-1); this.legHalf = new Float32Array(NL);
    this.legX = new Float32Array(NL); this.legY = new Float32Array(NL); this.legZ = new Float32Array(NL);
    this.legAX = new Float32Array(NL); this.legAZ = new Float32Array(NL); this.legBX = new Float32Array(NL); this.legBZ = new Float32Array(NL);
    this.legPhaseMask = new Uint8Array(NL);
    const armLeg: number[] = [];
    for (let n = 0; n < this.nodeCount; n++) {
      this.nodeArmStart[n] = arms.length;
      const inc = incident[n]!;
      const d = inc.length;
      let maxHalf = 0;
      for (const e of inc) maxHalf = Math.max(maxHalf, this.halfWidth(e));
      this.nodeTrim[n] = d >= 3 ? maxHalf + 1.5 : d === 2 ? Math.min(4, this.kinkTrim(n, inc)) : 0;
      // bras entrants
      const nodeArms: { arc: number; angle: number; rank: number; lanes: number; leg: number }[] = [];
      inc.forEach((e, li) => {
        const leg = this.nodeLegStart[n]! + li;
        this.legNode[leg] = n; this.legEdge[leg] = e;
        const arcIn = this.edgeB[e] === n ? e * 2 : e * 2 + 1;
        if (this.edgeLanes[arcIn]! === 0) return; // pas de voie entrante (sens unique sortant)
        const [dx, dz] = this.arcEndDir(arcIn);
        nodeArms.push({ arc: arcIn, angle: Math.atan2(dx, dz), rank: this.edgeRank[e]!, lanes: this.edgeLanes[arcIn]!, leg });
      });
      let control = Control.None;
      if (d === 1) control = Control.DeadEnd;
      else if (d >= 3) {
        const big = inc.filter((e) => Math.max(this.edgeLanes[e * 2]!, this.edgeLanes[e * 2 + 1]!) >= 2).length;
        const ranks = inc.map((e) => this.edgeRank[e]!);
        const maxR = Math.max(...ranks), minR = Math.min(...ranks);
        // feux : croisement de deux axes à plusieurs voies, ou carrefour à 4 branches touchant un axe principal
        if (maxR >= 4) control = Control.Yield; // giratoire (rang 4, adapters.ts) : cédez-le-passage aux entrées
        else if (big >= 3 || (d >= 4 && maxR >= 1)) control = Control.Signal;
        else if (maxR > minR) control = Control.Yield;
        else control = Control.Priority;
      }
      this.nodeControl[n] = control;
      // phases : bras regroupés par direction (opposés = même phase)
      const phaseOf: number[] = nodeArms.map(() => -1);
      let phases = 0;
      for (let i = 0; i < nodeArms.length; i++) {
        if (phaseOf[i]! >= 0) continue;
        phaseOf[i] = phases;
        for (let j = i + 1; j < nodeArms.length; j++) {
          if (phaseOf[j]! >= 0) continue;
          let da = Math.abs(nodeArms[i]!.angle - nodeArms[j]!.angle) % (Math.PI * 2);
          if (da > Math.PI) da = Math.PI * 2 - da;
          if (da > Math.PI * 0.75) { phaseOf[j] = phases; break; }
        }
        phases++;
      }
      phases = Math.min(4, phases);
      this.nodePhases[n] = control === Control.Signal ? phases : 0;
      const maxRank = nodeArms.reduce((m, a) => Math.max(m, a.rank), 0);
      for (let p = 0; p < 4; p++) {
        let lanes = 1;
        nodeArms.forEach((a, i) => { if (phaseOf[i] === p) lanes = Math.max(lanes, a.lanes); });
        this.nodeGreen[n * 4 + p] = 14 + 5 * lanes;
      }
      nodeArms.forEach((a, i) => {
        this.legArm[a.leg] = arms.length; armLeg.push(a.leg);
        arms.push(a.arc); armPhase.push(Math.min(3, phaseOf[i]!)); armAngle.push(a.angle);
        armPrio.push(control === Control.Yield && a.rank === maxRank ? 1 : 0);
      });
    }
    this.nodeArmStart[this.nodeCount] = arms.length;
    this.armArc = Int32Array.from(arms);
    this.armPhase = Uint8Array.from(armPhase);
    this.armRankPrio = Uint8Array.from(armPrio);
    this.armAngle = Float32Array.from(armAngle);
    this.armLeg = Int32Array.from(armLeg);

    // lignes d'arrêt effectives (mêmes proportions que le rognage des voies) et passages piétons
    const crossIn = new Float32Array(E * 2).fill(NaN), halfIn = new Float32Array(E).fill(NaN);
    edges.forEach((e, i) => {
      if (e.crossA !== undefined) crossIn[i * 2] = e.crossA;
      if (e.crossB !== undefined) crossIn[i * 2 + 1] = e.crossB;
      if (e.crossHalf !== undefined) halfIn[i] = e.crossHalf;
    });
    const tmp = new Float32Array(4);
    for (let leg = 0; leg < NL; leg++) {
      const n = this.legNode[leg]!, e = this.legEdge[leg]!;
      const atA = this.edgeA[e] === n;
      this.legId[leg] = this.edgeId[e]! * 2 + (atA ? 0 : 1);
      this.legIndexOf.set(this.legId[leg]!, leg);
      const [t0, t1] = this.edgeTrims(e);
      const stop = atA ? t0 : t1;
      this.legStop[leg] = stop;
      const d = this.nodeLegStart[n + 1]! - this.nodeLegStart[n]!;
      const ci = crossIn[e * 2 + (atA ? 0 : 1)]!;
      let cross = Number.isNaN(ci) ? (d >= 3 ? stop - 2.8 : -1) : ci;
      if (cross >= 0) cross = Math.min(Math.max(cross, 0.5), Math.max(0.5, stop - 0.5));
      if (cross < 0 || d < 2 || stop < 2.5) cross = -1;
      this.legCross[leg] = cross;
      const half = Number.isNaN(halfIn[e]!) ? this.halfWidth(e) - 1 : halfIn[e]!;
      this.legHalf[leg] = half;
      // géométrie : sens sortant du nœud
      const dir = atA ? 1 : -1;
      const sAxis = atA ? Math.max(0, cross) : this.edgeLen[e]! - Math.max(0, cross);
      this.edgePoint(e, sAxis, dir, 0, tmp, 0);
      this.legX[leg] = tmp[0]!; this.legY[leg] = tmp[1]!; this.legZ[leg] = tmp[2]!;
      this.edgePoint(e, sAxis, dir, -half, tmp, 0);
      this.legAX[leg] = tmp[0]!; this.legAZ[leg] = tmp[2]!;
      this.edgePoint(e, sAxis, dir, half, tmp, 0);
      this.legBX[leg] = tmp[0]!; this.legBZ[leg] = tmp[2]!;
    }

    this.arcFirstLane = new Int32Array(E * 2).fill(-1);
    this.arcLaneCount = new Uint8Array(E * 2);
    this.buildLinks();
  }

  /** Index de branche d'un passage (identifiant stable `legId`), −1 si inconnu. */
  legIndex(id: number): number { return this.legIndexOf.get(id) ?? -1; }

  /** Distances nœud → début/fin des voies aux deux extrémités d'un tronçon [côté a, côté b] (m). */
  edgeTrims(e: number): [number, number] {
    const L = this.edgeLen[e]!;
    const sa = this.edgeStop[e * 2]!, sb = this.edgeStop[e * 2 + 1]!;
    let t0 = Number.isNaN(sa) ? this.nodeTrim[this.edgeA[e]!]! : sa;
    let t1 = Number.isNaN(sb) ? this.nodeTrim[this.edgeB[e]!]! : sb;
    if (t0 + t1 > L * 0.8) { const k = (L * 0.8) / (t0 + t1); t0 *= k; t1 *= k; }
    return [t0, t1];
  }

  nodeIndex(id: number): number { return this.nodeIndexOf.get(id) ?? -1; }
  edgeIndex(id: number): number { return this.edgeIndexOf.get(id) ?? -1; }

  halfWidth(e: number): number {
    return ((this.edgeLanes[e * 2]! + this.edgeLanes[e * 2 + 1]!) * this.edgeLaneWidth[e]! + this.edgeMedian[e]!) / 2 + 1;
  }

  /** Rognage d'un nœud de degré 2 selon l'angle (raccord en courbe), 0 si quasi aligné. */
  private kinkTrim(n: number, inc: number[]): number {
    const a = inc[0]!, b = inc[1]!;
    const [ax, az] = this.arcStartDir(this.edgeA[a] === n ? a * 2 : a * 2 + 1);
    const [bx, bz] = this.arcStartDir(this.edgeA[b] === n ? b * 2 : b * 2 + 1);
    const dot = ax * bx + az * bz; // -1 = alignés
    if (dot < -0.97) return 0;
    return Math.max(this.halfWidth(a), this.halfWidth(b)) * Math.min(1, (1 + dot) * 1.5);
  }

  /** Arc = tronçon*2 + sens (0 : a→b, 1 : b→a). */
  arcFrom(arc: number): number { const e = arc >> 1; return (arc & 1) === 0 ? this.edgeA[e]! : this.edgeB[e]!; }
  arcTo(arc: number): number { const e = arc >> 1; return (arc & 1) === 0 ? this.edgeB[e]! : this.edgeA[e]!; }

  /** Direction (unitaire XZ) au départ d'un arc. */
  arcStartDir(arc: number): [number, number] {
    const e = arc >> 1, p0 = this.edgePtStart[e]!, p1 = this.edgePtStart[e + 1]! - 1;
    let dx: number, dz: number;
    if ((arc & 1) === 0) { dx = this.ptX[p0 + 1]! - this.ptX[p0]!; dz = this.ptZ[p0 + 1]! - this.ptZ[p0]!; }
    else { dx = this.ptX[p1 - 1]! - this.ptX[p1]!; dz = this.ptZ[p1 - 1]! - this.ptZ[p1]!; }
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }
  /** Direction (unitaire XZ) à l'arrivée d'un arc (sens de marche). */
  arcEndDir(arc: number): [number, number] {
    const e = arc >> 1, p0 = this.edgePtStart[e]!, p1 = this.edgePtStart[e + 1]! - 1;
    let dx: number, dz: number;
    if ((arc & 1) === 0) { dx = this.ptX[p1]! - this.ptX[p1 - 1]!; dz = this.ptZ[p1]! - this.ptZ[p1 - 1]!; }
    else { dx = this.ptX[p0]! - this.ptX[p0 + 1]!; dz = this.ptZ[p0]! - this.ptZ[p0 + 1]!; }
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }

  /**
   * Point de l'axe d'un tronçon à l'abscisse s (depuis a), décalé latéralement de `off` à DROITE du sens
   * de marche `dir` (+1 : a→b, −1 : b→a). Écrit x, y, z, cap dans out[o..o+3].
   */
  edgePoint(e: number, s: number, dir: number, off: number, out: Float32Array, o: number): void {
    const p0 = this.edgePtStart[e]!, p1 = this.edgePtStart[e + 1]! - 1;
    const L = this.edgeLen[e]!;
    s = s < 0 ? 0 : s > L ? L : s;
    // recherche dichotomique du segment
    let lo = p0, hi = p1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.ptS[m]! <= s) lo = m; else hi = m; }
    const sa = this.ptS[lo]!, sb = this.ptS[hi]!;
    const t = sb > sa ? (s - sa) / (sb - sa) : 0;
    const ax = this.ptX[lo]!, az = this.ptZ[lo]!, bx = this.ptX[hi]!, bz = this.ptZ[hi]!;
    let dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    dx = (dx / l) * dir; dz = (dz / l) * dir;
    // droite du sens de marche (Y vers le haut) : (−dz, dx)
    out[o] = ax + (bx - ax) * t - dz * off;
    out[o + 1] = this.ptY[lo]! + (this.ptY[hi]! - this.ptY[lo]!) * t;
    out[o + 2] = az + (bz - az) * t + dx * off;
    out[o + 3] = Math.atan2(dx, dz);
  }

  /** Décalage à droite (m) du centre de la voie de rang r (0 = intérieur) pour un arc. */
  laneOffsetFor(arc: number, r: number): number {
    const e = arc >> 1;
    const fwd = this.edgeLanes[e * 2]!, back = this.edgeLanes[e * 2 + 1]!;
    const w = this.edgeLaneWidth[e]!;
    if (fwd === 0 || back === 0) {
      // sens unique : voies centrées sur l'axe ; rang 0 = la plus à gauche
      const n = fwd + back;
      return -(n * w) / 2 + (r + 0.5) * w;
    }
    return this.edgeMedian[e]! / 2 + (r + 0.5) * w;
  }

  /** Position (x, y, z, cap) à l'abscisse s d'un lien (voie ou connecteur), décalage latéral `lat` à droite. */
  linkPoint(link: number, s: number, lat: number, out: Float32Array, o: number): void {
    if (this.linkKind[link] === 0) {
      const arc = this.linkArc[link]!;
      const e = arc >> 1;
      const dir = (arc & 1) === 0 ? 1 : -1;
      const sAxis = this.linkS0[link]! + s;
      this.edgePoint(e, dir > 0 ? sAxis : this.edgeLen[e]! - sAxis, dir, this.linkOffset[link]! + lat, out, o);
      return;
    }
    const c = link - this.laneCount;
    const P = this.connP, b = c * 9;
    const L = this.linkLen[link]!;
    const t = L > 0 ? Math.max(0, Math.min(1, s / L)) : 1;
    const u = 1 - t;
    const x = u * u * P[b]! + 2 * u * t * P[b + 3]! + t * t * P[b + 6]!;
    const y = u * u * P[b + 1]! + 2 * u * t * P[b + 4]! + t * t * P[b + 7]!;
    const z = u * u * P[b + 2]! + 2 * u * t * P[b + 5]! + t * t * P[b + 8]!;
    let dx = 2 * u * (P[b + 3]! - P[b]!) + 2 * t * (P[b + 6]! - P[b + 3]!);
    let dz = 2 * u * (P[b + 5]! - P[b + 2]!) + 2 * t * (P[b + 8]! - P[b + 5]!);
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    out[o] = x - dz * lat; out[o + 1] = y; out[o + 2] = z + dx * lat;
    out[o + 3] = Math.atan2(dx, dz);
  }

  private buildLinks(): void {
    const E = this.edgeCount;
    // voies
    const laneArc: number[] = [], laneRank: number[] = [], laneOff: number[] = [], laneS0: number[] = [], laneLen: number[] = [], laneSpeed: number[] = [];
    for (let arc = 0; arc < E * 2; arc++) {
      const e = arc >> 1;
      const n = this.edgeLanes[arc]!;
      if (n === 0) continue;
      const L = this.edgeLen[e]!;
      const [ta, tb] = this.edgeTrims(e);
      const t0 = (arc & 1) === 0 ? ta : tb, t1 = (arc & 1) === 0 ? tb : ta;
      this.arcFirstLane[arc] = laneArc.length;
      this.arcLaneCount[arc] = n;
      for (let r = 0; r < n; r++) {
        laneArc.push(arc); laneRank.push(r); laneOff.push(this.laneOffsetFor(arc, r));
        laneS0.push(t0); laneLen.push(Math.max(0.5, L - t0 - t1)); laneSpeed.push(this.edgeSpeed[e]!);
      }
    }
    const nl = laneArc.length;
    this.laneCount = nl;
    // connecteurs
    const cFrom: number[] = [], cTo: number[] = [], cTurn: number[] = [], cArm: number[] = [], cP: number[] = [], cLen: number[] = [], cSpeed: number[] = [];
    const cOutLeg: number[] = [], cDegTwo: number[] = [];
    const tmp = new Float32Array(8);
    for (let l = 0; l < nl; l++) {
      const arc = laneArc[l]!;
      const node = this.arcTo(arc);
      const nIn = this.edgeLanes[arc]!;
      const rIn = laneRank[l]!;
      const [ax, az] = this.arcEndDir(arc);
      let armIdx = -1;
      for (let k = this.nodeArmStart[node]!; k < this.nodeArmStart[node + 1]!; k++) if (this.armArc[k] === arc) armIdx = k;
      const outs: { arc: number; turn: Turn }[] = [];
      for (let k = this.nodeOutStart[node]!; k < this.nodeOutStart[node + 1]!; k++) {
        const o = this.nodeOut[k]!;
        if ((o >> 1) === (arc >> 1)) continue; // demi-tour : seulement en impasse (plus bas)
        const [ox, oz] = this.arcStartDir(o);
        const cross = ax * oz - az * ox;
        const dot = ax * ox + az * oz;
        // Y vers le haut : la droite du conducteur orienté (dx, dz) est (−dz, dx) ; cross > 0 : virage à droite
        const turn = dot > 0.7 ? Turn.Straight : cross > 0 ? Turn.Right : Turn.Left;
        outs.push({ arc: o, turn });
      }
      if (outs.length === 0) {
        const back = arc ^ 1;
        if (this.edgeLanes[back]! > 0) outs.push({ arc: back, turn: Turn.UTurn });
      }
      const degTwo = outs.length === 1 && outs[0]!.turn !== Turn.UTurn;
      for (const o of outs) {
        const nOut = this.edgeLanes[o.arc]!;
        const allowed = degTwo || nIn === 1 || o.turn === Turn.Straight || o.turn === Turn.UTurn
          || (o.turn === Turn.Left && rIn === 0) || (o.turn === Turn.Right && rIn === nIn - 1);
        if (!allowed) continue;
        let rOut: number;
        if (o.turn === Turn.Straight || degTwo) rOut = Math.min(nOut - 1, Math.round((rIn * (nOut - 1)) / Math.max(1, nIn - 1)));
        else if (o.turn === Turn.Right) rOut = nOut - 1;
        else rOut = 0;
        const target = this.arcFirstLane[o.arc]! + rOut;
        // points : fin de la voie amont, début de la voie aval
        this.tmpLane(laneArc, laneRank, laneOff, laneS0, laneLen, l, laneLen[l]!, tmp, 0);
        this.tmpLane(laneArc, laneRank, laneOff, laneS0, laneLen, target, 0, tmp, 4);
        const p0x = tmp[0]!, p0y = tmp[1]!, p0z = tmp[2]!, p2x = tmp[4]!, p2y = tmp[5]!, p2z = tmp[6]!;
        const h0 = tmp[3]!, h2 = tmp[7]!;
        const d0x = Math.sin(h0), d0z = Math.cos(h0), d2x = Math.sin(h2), d2z = Math.cos(h2);
        // contrôle : intersection des tangentes, sinon milieu (alignées / demi-tour)
        let cx = (p0x + p2x) / 2, cz = (p0z + p2z) / 2;
        const den = d0x * d2z - d0z * d2x;
        if (Math.abs(den) > 0.05) {
          const t = ((p2x - p0x) * d2z - (p2z - p0z) * d2x) / den;
          const span = Math.hypot(p2x - p0x, p2z - p0z);
          if (t > 0 && t < span * 1.5) { cx = p0x + d0x * t; cz = p0z + d0z * t; }
        } else if (o.turn === Turn.UTurn) {
          const span = Math.hypot(p2x - p0x, p2z - p0z);
          cx += d0x * span; cz += d0z * span;
        }
        cP.push(p0x, p0y, p0z, cx, (p0y + p2y) / 2, cz, p2x, p2y, p2z);
        // longueur (échantillonnage)
        let len = 0, px = p0x, pz = p0z;
        for (let k = 1; k <= 8; k++) {
          const t = k / 8, u = 1 - t;
          const x = u * u * p0x + 2 * u * t * cx + t * t * p2x, z = u * u * p0z + 2 * u * t * cz + t * t * p2z;
          len += Math.hypot(x - px, z - pz); px = x; pz = z;
        }
        cFrom.push(l); cTo.push(target); cTurn.push(o.turn); cArm.push(armIdx); cLen.push(Math.max(0.3, len));
        let outLeg = -1;
        for (let k = this.nodeLegStart[node]!; k < this.nodeLegStart[node + 1]!; k++) if (this.legEdge[k] === (o.arc >> 1)) outLeg = k;
        cOutLeg.push(outLeg); cDegTwo.push(degTwo ? 1 : 0);
        const vIn = laneSpeed[l]!;
        cSpeed.push(o.turn === Turn.Straight || degTwo ? vIn : o.turn === Turn.UTurn ? 4 : o.turn === Turn.Right ? 5.5 : 7);
      }
    }
    const nc = cFrom.length;
    const N = nl + nc;
    this.linkCount = N;
    this.linkKind = new Uint8Array(N);
    this.linkLen = new Float32Array(N); this.linkSpeed = new Float32Array(N); this.linkArc = new Int32Array(N);
    this.linkRank = new Uint8Array(N); this.linkOffset = new Float32Array(N); this.linkS0 = new Float32Array(N);
    this.linkToNode = new Int32Array(N); this.linkFromNode = new Int32Array(N);
    for (let l = 0; l < nl; l++) {
      this.linkArc[l] = laneArc[l]!; this.linkRank[l] = laneRank[l]!; this.linkOffset[l] = laneOff[l]!;
      this.linkS0[l] = laneS0[l]!; this.linkLen[l] = laneLen[l]!; this.linkSpeed[l] = laneSpeed[l]!;
      this.linkFromNode[l] = this.arcFrom(laneArc[l]!); this.linkToNode[l] = this.arcTo(laneArc[l]!);
    }
    this.connFrom = Int32Array.from(cFrom); this.connTo = Int32Array.from(cTo); this.connTurn = Uint8Array.from(cTurn);
    this.connArm = Int32Array.from(cArm); this.connP = Float32Array.from(cP);
    this.connOutLeg = Int32Array.from(cOutLeg);
    this.connOutCrossS = new Float32Array(nc).fill(-1);
    for (let c = 0; c < nc; c++) {
      const leg = cOutLeg[c]!;
      if (leg >= 0 && this.legCross[leg]! >= 0) {
        // le passage de sortie occupe [cross − 2, cross + 2] depuis le nœud ; le connecteur finit à la ligne d'arrêt
        this.connOutCrossS[c] = Math.max(0, cLen[c]! - (this.legStop[leg]! - (this.legCross[leg]! - 2)));
        // mouvement protégé (tout droit) : sa phase interdit le passage aux piétons
        if ((cTurn[c] === Turn.Straight || cDegTwo[c]) && cArm[c]! >= 0) this.legPhaseMask[leg]! |= 1 << this.armPhase[cArm[c]!]!;
      }
    }
    for (let a = 0; a < this.armArc.length; a++) this.legPhaseMask[this.armLeg[a]!]! |= 1 << this.armPhase[a]!;
    for (let c = 0; c < nc; c++) {
      const L = nl + c;
      this.linkKind[L] = 1; this.linkLen[L] = cLen[c]!; this.linkSpeed[L] = cSpeed[c]!;
      this.linkArc[L] = laneArc[cTo[c]!]!;
      const node = this.arcTo(laneArc[cFrom[c]!]!);
      this.linkFromNode[L] = node; this.linkToNode[L] = node;
    }
    // connecteurs par voie (CSR)
    const deg = new Int32Array(nl + 1);
    for (let c = 0; c < nc; c++) deg[cFrom[c]! + 1]!++;
    for (let l = 0; l < nl; l++) deg[l + 1]! += deg[l]!;
    this.laneConnStart = deg;
    this.laneConns = new Int32Array(nc);
    const fill = new Int32Array(nl);
    for (let c = 0; c < nc; c++) { const l = cFrom[c]!; this.laneConns[deg[l]! + fill[l]!++] = nl + c; }
    // transitions d'arc à arc
    const nextSets: Set<number>[] = Array.from({ length: E * 2 }, () => new Set<number>());
    for (let c = 0; c < nc; c++) nextSets[laneArc[cFrom[c]!]!]!.add(laneArc[cTo[c]!]!);
    const as = new Int32Array(E * 2 + 1);
    for (let a = 0; a < E * 2; a++) as[a + 1] = as[a]! + nextSets[a]!.size;
    const an = new Int32Array(as[E * 2]!);
    for (let a = 0; a < E * 2; a++) an.set([...nextSets[a]!], as[a]!);
    this.arcNextStart = as;
    this.arcNext = an;
    this.buildConflicts();
  }

  private tmpLane(laneArc: number[], _rank: number[], laneOff: number[], laneS0: number[], _len: number[], l: number, s: number, out: Float32Array, o: number): void {
    const arc = laneArc[l]!;
    const e = arc >> 1, dir = (arc & 1) === 0 ? 1 : -1;
    const sAxis = laneS0[l]! + s;
    this.edgePoint(e, dir > 0 ? sAxis : this.edgeLen[e]! - sAxis, dir, laneOff[l]!, out, o);
  }

  /** Conflits entre connecteurs d'un même nœud : trajectoires sécantes ou même voie de sortie. */
  private buildConflicts(): void {
    const nl = this.laneCount, nc = this.linkCount - nl;
    const byNode = new Map<number, number[]>();
    for (let c = 0; c < nc; c++) {
      const n = this.linkToNode[nl + c]!;
      let l = byNode.get(n); if (!l) { l = []; byNode.set(n, l); } l.push(c);
    }
    const S = 8;
    const poly = new Float32Array(nc * (S + 1) * 2);
    for (let c = 0; c < nc; c++) {
      const b = c * 9, P = this.connP;
      for (let k = 0; k <= S; k++) {
        const t = k / S, u = 1 - t;
        poly[(c * (S + 1) + k) * 2] = u * u * P[b]! + 2 * u * t * P[b + 3]! + t * t * P[b + 6]!;
        poly[(c * (S + 1) + k) * 2 + 1] = u * u * P[b + 2]! + 2 * u * t * P[b + 5]! + t * t * P[b + 8]!;
      }
    }
    const lists: number[][] = Array.from({ length: nc }, () => []);
    const segX = (c: number, k: number): number => poly[(c * (S + 1) + k) * 2]!;
    const segZ = (c: number, k: number): number => poly[(c * (S + 1) + k) * 2 + 1]!;
    for (const conns of byNode.values()) {
      for (let i = 0; i < conns.length; i++) for (let j = i + 1; j < conns.length; j++) {
        const a = conns[i]!, b = conns[j]!;
        if (this.connFrom[a] === this.connFrom[b]) continue; // même voie d'origine : file (IDM)
        let conflict = this.connTo[a] === this.connTo[b];
        // distance minimale entre trajectoires (gabarit de 2,2 m)
        for (let p = 0; p < S && !conflict; p++) for (let q = 0; q < S && !conflict; q++) {
          if (segDist(segX(a, p), segZ(a, p), segX(a, p + 1), segZ(a, p + 1), segX(b, q), segZ(b, q), segX(b, q + 1), segZ(b, q + 1)) < 2.2) {
            // ignore le contact aux extrémités pour deux voies parallèles du même sens (départ côte à côte)
            const nearStart = p === 0 && q === 0, nearEnd = p === S - 1 && q === S - 1 && this.connTo[a] !== this.connTo[b];
            if (!nearStart && !nearEnd) conflict = true;
          }
        }
        if (conflict) { lists[a]!.push(b); lists[b]!.push(a); }
      }
    }
    const start = new Int32Array(nc + 1);
    for (let c = 0; c < nc; c++) start[c + 1] = start[c]! + lists[c]!.length;
    const flat = new Int32Array(start[nc]!);
    for (let c = 0; c < nc; c++) flat.set(lists[c]!, start[c]!);
    this.conflictStart = start;
    this.conflicts = flat;
  }

  /** Projection d'un point sur le réseau : tronçon le plus proche (distance ≤ maxDist), abscisse depuis a. */
  nearestEdge(x: number, z: number, maxDist: number, grid?: EdgeGrid): { edge: number; s: number; dist: number; side: number } | null {
    let best: { edge: number; s: number; dist: number; side: number } | null = null;
    const visit = (e: number): void => {
      const p0 = this.edgePtStart[e]!, p1 = this.edgePtStart[e + 1]!;
      for (let p = p0; p + 1 < p1; p++) {
        const ax = this.ptX[p]!, az = this.ptZ[p]!, bx = this.ptX[p + 1]!, bz = this.ptZ[p + 1]!;
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
        const qx = ax + dx * t, qz = az + dz * t;
        const d = Math.hypot(x - qx, z - qz);
        if (d <= maxDist && (!best || d < best.dist)) {
          const side = dx * (z - az) - dz * (x - ax); // > 0 : à droite du sens a→b
          best = { edge: e, s: this.ptS[p]! + Math.sqrt(l2) * t, dist: d, side: side > 0 ? 1 : -1 };
        }
      }
    };
    if (grid) grid.query(x, z, maxDist, visit);
    else for (let e = 0; e < this.edgeCount; e++) visit(e);
    return best;
  }
}

function segDist(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  // intersection ?
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const pd = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number => {
    const ux = rx - qx, uz = rz - qz, l2 = ux * ux + uz * uz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - qx) * ux + (pz - qz) * uz) / l2)) : 0;
    return Math.hypot(px - qx - ux * t, pz - qz - uz * t);
  };
  return Math.min(pd(ax, az, cx, cz, dx, dz), pd(bx, bz, cx, cz, dx, dz), pd(cx, cz, ax, az, bx, bz), pd(dx, dz, ax, az, bx, bz));
}

/** Grille spatiale des tronçons (cellules de `cell` m) pour les projections bâtiment → route. */
export class EdgeGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly g: TrafficGraph, private readonly cell = 64) {
    for (let e = 0; e < g.edgeCount; e++) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let p = g.edgePtStart[e]!; p < g.edgePtStart[e + 1]!; p++) {
        x0 = Math.min(x0, g.ptX[p]!); x1 = Math.max(x1, g.ptX[p]!); z0 = Math.min(z0, g.ptZ[p]!); z1 = Math.max(z1, g.ptZ[p]!);
      }
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const k = this.key(i, j);
        let l = this.cells.get(k); if (!l) { l = []; this.cells.set(k, l); } l.push(e);
      }
    }
  }
  private key(i: number, j: number): number { return (i + 32768) * 65536 + (j + 32768); }
  query(x: number, z: number, r: number, fn: (e: number) => void): void {
    const seen = new Set<number>();
    for (let i = Math.floor((x - r) / this.cell); i <= Math.floor((x + r) / this.cell); i++) for (let j = Math.floor((z - r) / this.cell); j <= Math.floor((z + r) / this.cell); j++) {
      const l = this.cells.get(this.key(i, j));
      if (l) for (const e of l) if (!seen.has(e)) { seen.add(e); fn(e); }
    }
  }
}

export { growF };
