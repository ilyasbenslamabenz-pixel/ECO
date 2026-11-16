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
/** `control` : réglage du joueur pour un carrefour (absent = automatique) — voir JUNCTION_MODES. */
export interface TrafficNodeInput { id: number; x: number; y: number; z: number; control?: JunctionMode }
/** Réglages de carrefour offerts au joueur : feux, stop (tout le monde cède), priorité (passage libre). */
export type JunctionMode = 'signal' | 'stop' | 'priority';
export const JUNCTION_MODES: readonly JunctionMode[] = ['signal', 'stop', 'priority'];
export interface TrafficNetworkInput { nodes: TrafficNodeInput[]; edges: TrafficEdgeInput[] }

export const enum Control { None = 0, Priority = 1, Yield = 2, Signal = 3, DeadEnd = 4 }
export const enum Turn { Straight = 0, Left = 1, Right = 2, UTurn = 3 }

const growF = (a: Float32Array, n: number): Float32Array => { const b = new Float32Array(n); b.set(a.subarray(0, Math.min(a.length, n))); return b; };

/**
 * Axe principal d'un carrefour réglé en « priorité » : la paire de bras entrants la plus alignée (en face l'un de
 * l'autre), départagée par le rang de route puis le nombre de voies ; à défaut de paire (sens uniques), le bras de
 * plus haut rang. Renvoie les indices des bras prioritaires.
 */
export function mainAxis(arms: readonly { angle: number; rank: number; lanes: number }[]): Set<number> {
  let best: [number, number] | null = null, bestScore = -Infinity;
  for (let i = 0; i < arms.length; i++) {
    for (let j = i + 1; j < arms.length; j++) {
      let da = Math.abs(arms[i]!.angle - arms[j]!.angle) % (Math.PI * 2);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < Math.PI * 0.6) continue; // pas « en face »
      const score = (arms[i]!.rank + arms[j]!.rank) * 100 + (arms[i]!.lanes + arms[j]!.lanes) * 10 + da;
      if (score > bestScore) { bestScore = score; best = [i, j]; }
    }
  }
  if (best) return new Set(best);
  let k = -1;
  arms.forEach((a, i) => { if (k < 0 || a.rank > arms[k]!.rank || (a.rank === arms[k]!.rank && a.lanes > arms[k]!.lanes)) k = i; });
  return new Set(k >= 0 ? [k] : []);
}

export class TrafficGraph {
  /* ---------- nœuds ---------- */
  readonly nodeCount: number;
  readonly nodeId: Int32Array;
  readonly nodeX: Float32Array;
  readonly nodeY: Float32Array;
  readonly nodeZ: Float32Array;
  readonly nodeControl: Uint8Array;
  /** 1 : carrefour réglé en « stop » par le joueur (arrêt complet obligatoire à la ligne pour chaque branche). */
  readonly nodeStop: Uint8Array;
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
  /** Index des passages par identifiant stable, construit à la première demande. */
  private legIndexOf: Map<number, number> | null = null;

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

  /** Entrées des tronçons retenus (index de tronçon), le temps de la construction (clés du cache). */
  private edgeInputs: TrafficEdgeInput[] | null = null;
  /** Passage piéton imposé par l'entrée (2 par tronçon : [a, b]) et demi-largeur traversée ; NaN = par défaut. */
  private crossIn: Float32Array | null = null;
  private halfIn: Float32Array | null = null;
  /** Nombre de carrefours recalculés / réutilisés lors de la construction (diagnostic, bancs, tests). */
  nodesComputed = 0;
  nodesReused = 0;

  /**
   * `cache` (facultatif, conservé par le système de circulation d'une reconstruction à l'autre) : tout ce qui est
   * calculé PAR CARREFOUR (régime, bras, phases, branches et passages, connecteurs et leur géométrie, conflits,
   * transitions d'arc à arc) est mémorisé par identifiant de nœud avec sa clé : réglage du nœud, entrées des tronçons
   * incidents (dans l'ordre) et rognage des nœuds voisins. Une édition ne touche que quelques carrefours : seuls ceux
   * dont la clé a changé sont recalculés, les autres sont recopiés tels quels. Le reste de la construction (tronçons,
   * voies, assemblage des tableaux) est linéaire et sans géométrie coûteuse. Résultat identique à un calcul complet
   * (test « graphe incrémental » de tests/sim/scale.test.ts).
   */
  constructor(input: TrafficNetworkInput, cache?: ConflictCache) {
    const nodes = input.nodes;
    this.nodeCount = nodes.length;
    this.nodeId = new Int32Array(nodes.length);
    this.nodeX = new Float32Array(nodes.length);
    this.nodeY = new Float32Array(nodes.length);
    this.nodeZ = new Float32Array(nodes.length);
    nodes.forEach((n, i) => { this.nodeId[i] = n.id; this.nodeX[i] = n.x; this.nodeY[i] = n.y; this.nodeZ[i] = n.z; this.nodeIndexOf.set(n.id, i); });
    const edges = input.edges.filter((e) => this.nodeIndexOf.has(e.a) && this.nodeIndexOf.has(e.b) && e.a !== e.b && e.points.length >= 6 && e.lanesForward + e.lanesBackward > 0);
    this.edgeInputs = edges;
    const E = edges.length;
    const N = this.nodeCount;
    this.edgeCount = E;
    this.edgeId = new Int32Array(E); this.edgeA = new Int32Array(E); this.edgeB = new Int32Array(E);
    this.edgeLen = new Float32Array(E); this.edgeSpeed = new Float32Array(E); this.edgeRank = new Uint8Array(E);
    this.edgeLanes = new Uint8Array(E * 2); this.edgeLaneWidth = new Float32Array(E); this.edgeMedian = new Float32Array(E);
    this.edgeStop = new Float32Array(E * 2).fill(NaN);
    this.edgePtStart = new Int32Array(E + 1);
    const crossIn = (this.crossIn = new Float32Array(E * 2).fill(NaN)), halfIn = (this.halfIn = new Float32Array(E).fill(NaN));
    let np = 0;
    for (const e of edges) np += e.points.length / 3;
    this.ptX = new Float32Array(np); this.ptY = new Float32Array(np); this.ptZ = new Float32Array(np); this.ptS = new Float32Array(np);
    let k = 0;
    for (let i = 0; i < E; i++) {
      const e = edges[i]!;
      this.edgeId[i] = e.id; this.edgeIndexOf.set(e.id, i);
      this.edgeA[i] = this.nodeIndexOf.get(e.a)!; this.edgeB[i] = this.nodeIndexOf.get(e.b)!;
      this.edgeSpeed[i] = Math.max(1, e.speedKmh / 3.6); this.edgeRank[i] = e.rank;
      this.edgeLanes[i * 2] = e.lanesForward; this.edgeLanes[i * 2 + 1] = e.lanesBackward;
      this.edgeLaneWidth[i] = e.laneWidth; this.edgeMedian[i] = e.median;
      if (e.stopA !== undefined && e.stopA >= 0) this.edgeStop[i * 2] = e.stopA;
      if (e.stopB !== undefined && e.stopB >= 0) this.edgeStop[i * 2 + 1] = e.stopB;
      if (e.crossA !== undefined) crossIn[i * 2] = e.crossA;
      if (e.crossB !== undefined) crossIn[i * 2 + 1] = e.crossB;
      if (e.crossHalf !== undefined) halfIn[i] = e.crossHalf;
      this.edgePtStart[i] = k;
      const pts = e.points;
      // polyligne en float32 et abscisses cumulées : mémorisées par polyligne (même tableau = mêmes valeurs)
      let pre = POLYLINES.get(pts);
      if (!pre) {
        const n = pts.length / 3;
        pre = new Float32Array(n * 4 + 1);
        let s = 0;
        for (let p = 0, q = 0; q < n; p += 3, q++) {
          // (point courant en double, précédent relu en float32 : mêmes arrondis que le calcul d'origine)
          const x = pts[p]!, z = pts[p + 2]!;
          if (q > 0) s += Math.hypot(x - pre[(q - 1) * 4]!, z - pre[(q - 1) * 4 + 2]!);
          pre[q * 4] = x; pre[q * 4 + 1] = pts[p + 1]!; pre[q * 4 + 2] = z; pre[q * 4 + 3] = s;
        }
        pre[n * 4] = s;
        POLYLINES.set(pts, pre);
      }
      const n = pts.length / 3;
      for (let q = 0; q < n; q++, k++) { this.ptX[k] = pre[q * 4]!; this.ptY[k] = pre[q * 4 + 1]!; this.ptZ[k] = pre[q * 4 + 2]!; this.ptS[k] = pre[q * 4 + 3]!; }
      this.edgeLen[i] = pre[n * 4]!;
    }
    this.edgePtStart[E] = k;

    // arcs sortants par nœud ; branches (tronçons incidents, dans l'ordre des tronçons) par nœud
    const deg = new Int32Array(N + 1);
    this.nodeLegStart = new Int32Array(N + 1);
    for (let e = 0; e < E; e++) {
      this.nodeLegStart[this.edgeA[e]! + 1]!++; this.nodeLegStart[this.edgeB[e]! + 1]!++;
      if (this.edgeLanes[e * 2]! > 0) deg[this.edgeA[e]! + 1]!++;
      if (this.edgeLanes[e * 2 + 1]! > 0) deg[this.edgeB[e]! + 1]!++;
    }
    for (let i = 0; i < N; i++) { deg[i + 1]! += deg[i]!; this.nodeLegStart[i + 1]! += this.nodeLegStart[i]!; }
    this.nodeOutStart = deg;
    this.nodeOut = new Int32Array(deg[N]!);
    const NL = this.nodeLegStart[N]!;
    this.legNode = new Int32Array(NL); this.legEdge = new Int32Array(NL); this.legId = new Int32Array(NL); this.legArm = new Int32Array(NL).fill(-1);
    /** Branche de chaque extrémité de tronçon : [e*2] côté a, [e*2+1] côté b. */
    const legAt = new Int32Array(E * 2);
    {
      const fill = new Int32Array(N), lfill = new Int32Array(N);
      for (let e = 0; e < E; e++) {
        const a = this.edgeA[e]!, b = this.edgeB[e]!;
        if (this.edgeLanes[e * 2]! > 0) this.nodeOut[deg[a]! + fill[a]!++] = e * 2;
        if (this.edgeLanes[e * 2 + 1]! > 0) this.nodeOut[deg[b]! + fill[b]!++] = e * 2 + 1;
        const la = this.nodeLegStart[a]! + lfill[a]!++; this.legNode[la] = a; this.legEdge[la] = e; legAt[e * 2] = la;
        const lb = this.nodeLegStart[b]! + lfill[b]!++; this.legNode[lb] = b; this.legEdge[lb] = e; legAt[e * 2 + 1] = lb;
      }
    }

    // rognage des voies aux carrefours (dépend des seuls tronçons incidents)
    this.nodeTrim = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const l0 = this.nodeLegStart[n]!, d = this.nodeLegStart[n + 1]! - l0;
      let maxHalf = 0;
      for (let li = 0; li < d; li++) maxHalf = Math.max(maxHalf, this.halfWidth(this.legEdge[l0 + li]!));
      this.nodeTrim[n] = d >= 3 ? maxHalf + 1.5 : d === 2 ? Math.min(4, this.kinkTrim(n, this.legEdge[l0]!, this.legEdge[l0 + 1]!)) : 0;
    }

    // carrefours : recalculés si leur clé a changé, sinon repris du cache
    const blocks: NodeBlock[] = new Array(N);
    for (let n = 0; n < N; n++) {
      const id = this.nodeId[n]!;
      const hit = cache?.get(id);
      if (hit && this.blockMatches(hit, n, nodes[n]!)) { blocks[n] = hit; this.nodesReused++; continue; }
      const b = this.computeNode(n, nodes[n]!);
      blocks[n] = b;
      this.nodesComputed++;
      cache?.set(id, b);
    }
    // Nœuds disparus : oubliés.
    if (cache && cache.size > N) for (const key of cache.keys()) if (!this.nodeIndexOf.has(key)) cache.delete(key);

    // assemblage : régime, bras, branches
    this.nodeControl = new Uint8Array(N);
    this.nodeStop = new Uint8Array(N);
    this.nodePhases = new Uint8Array(N);
    this.nodeGreen = new Float32Array(N * 4);
    this.nodeArmStart = new Int32Array(N + 1);
    let NA = 0;
    for (let n = 0; n < N; n++) NA += blocks[n]!.armLeg.length;
    this.armArc = new Int32Array(NA); this.armPhase = new Uint8Array(NA); this.armRankPrio = new Uint8Array(NA);
    this.armAngle = new Float32Array(NA); this.armLeg = new Int32Array(NA);
    this.legStop = new Float32Array(NL); this.legCross = new Float32Array(NL); this.legHalf = new Float32Array(NL);
    this.legX = new Float32Array(NL); this.legY = new Float32Array(NL); this.legZ = new Float32Array(NL);
    this.legAX = new Float32Array(NL); this.legAZ = new Float32Array(NL); this.legBX = new Float32Array(NL); this.legBZ = new Float32Array(NL);
    this.legPhaseMask = new Uint8Array(NL);
    let arm = 0;
    for (let n = 0; n < N; n++) {
      const b = blocks[n]!;
      const l0 = this.nodeLegStart[n]!;
      this.nodeControl[n] = b.control; this.nodeStop[n] = b.stop; this.nodePhases[n] = b.phases;
      for (let p = 0; p < 4; p++) this.nodeGreen[n * 4 + p] = b.green[p]!;
      this.nodeArmStart[n] = arm;
      for (let i = 0; i < b.armLeg.length; i++, arm++) {
        const leg = l0 + b.armLeg[i]!, e = this.legEdge[leg]!;
        this.armArc[arm] = this.edgeB[e] === n ? e * 2 : e * 2 + 1;
        this.armPhase[arm] = b.armPhase[i]!; this.armRankPrio[arm] = b.armPrio[i]!; this.armAngle[arm] = b.armAngle[i]!;
        this.armLeg[arm] = leg; this.legArm[leg] = arm;
      }
      for (let li = 0, d = b.legStop.length; li < d; li++) {
        const L = l0 + li;
        this.legStop[L] = b.legStop[li]!; this.legCross[L] = b.legCross[li]!; this.legHalf[L] = b.legHalf[li]!;
        this.legX[L] = b.legX[li]!; this.legY[L] = b.legY[li]!; this.legZ[L] = b.legZ[li]!;
        this.legAX[L] = b.legAX[li]!; this.legAZ[L] = b.legAZ[li]!; this.legBX[L] = b.legBX[li]!; this.legBZ[L] = b.legBZ[li]!;
        this.legPhaseMask[L] = b.legPhaseMask[li]!;
      }
    }
    this.nodeArmStart[N] = arm;
    for (let leg = 0; leg < NL; leg++) {
      const n = this.legNode[leg]!, e = this.legEdge[leg]!;
      this.legId[leg] = this.edgeId[e]! * 2 + (this.edgeA[e] === n ? 0 : 1);
    }

    // voies (par arc, dans l'ordre des arcs)
    this.arcFirstLane = new Int32Array(E * 2).fill(-1);
    this.arcLaneCount = new Uint8Array(E * 2);
    let nl = 0;
    for (let a = 0; a < E * 2; a++) nl += this.edgeLanes[a]!;
    let nc = 0;
    for (let n = 0; n < N; n++) nc += blocks[n]!.cOut.length;
    const NLK = nl + nc;
    this.laneCount = nl;
    this.linkCount = NLK;
    this.linkKind = new Uint8Array(NLK);
    this.linkLen = new Float32Array(NLK); this.linkSpeed = new Float32Array(NLK); this.linkArc = new Int32Array(NLK);
    this.linkRank = new Uint8Array(NLK); this.linkOffset = new Float32Array(NLK); this.linkS0 = new Float32Array(NLK);
    this.linkToNode = new Int32Array(NLK); this.linkFromNode = new Int32Array(NLK);
    {
      let l = 0;
      for (let a = 0; a < E * 2; a++) {
        const e = a >> 1;
        const n = this.edgeLanes[a]!;
        if (n === 0) continue;
        const L = this.edgeLen[e]!;
        const [ta, tb] = this.edgeTrims(e);
        const t0 = (a & 1) === 0 ? ta : tb, t1 = (a & 1) === 0 ? tb : ta;
        this.arcFirstLane[a] = l;
        this.arcLaneCount[a] = n;
        const from = this.arcFrom(a), to = this.arcTo(a);
        for (let r = 0; r < n; r++, l++) {
          this.linkArc[l] = a; this.linkRank[l] = r; this.linkOffset[l] = this.laneOffsetFor(a, r);
          this.linkS0[l] = t0; this.linkLen[l] = Math.max(0.5, L - t0 - t1); this.linkSpeed[l] = this.edgeSpeed[e]!;
          this.linkFromNode[l] = from; this.linkToNode[l] = to;
        }
      }
    }

    // connecteurs : dans l'ordre des voies amont (comme un calcul complet), recopiés des carrefours
    this.connFrom = new Int32Array(nc); this.connTo = new Int32Array(nc); this.connTurn = new Uint8Array(nc);
    this.connArm = new Int32Array(nc); this.connP = new Float32Array(nc * 9);
    this.connOutLeg = new Int32Array(nc); this.connOutCrossS = new Float32Array(nc);
    this.laneConnStart = new Int32Array(nl + 1);
    this.laneConns = new Int32Array(nc);
    // connecteur global de chaque connecteur local (décalage par nœud) et inverse
    const nodeConnOff = new Int32Array(N + 1);
    for (let n = 0; n < N; n++) nodeConnOff[n + 1] = nodeConnOff[n]! + blocks[n]!.cOut.length;
    const globalOf = new Int32Array(nc), localOf = new Int32Array(nc);
    {
      let c = 0;
      for (let l = 0; l < nl; l++) {
        this.laneConnStart[l] = c;
        const a = this.linkArc[l]!, r = this.linkRank[l]!;
        const n = this.arcTo(a);
        const b = blocks[n]!;
        const l0 = this.nodeLegStart[n]!;
        const li = legAt[(a >> 1) * 2 + ((a & 1) === 0 ? 1 : 0)]! - l0; // branche d'arrivée de l'arc
        const ll = b.legLane0[li]! + r;
        for (let j = b.laneConn[ll]!; j < b.laneConn[ll + 1]!; j++, c++) {
          const oe = this.legEdge[l0 + b.cOut[j]!]!;
          const oArc = this.edgeA[oe] === n ? oe * 2 : oe * 2 + 1;
          const to = this.arcFirstLane[oArc]! + b.cROut[j]!;
          this.connFrom[c] = l; this.connTo[c] = to; this.connTurn[c] = b.cTurn[j]!;
          this.connArm[c] = b.cArm[j]! >= 0 ? this.nodeArmStart[n]! + b.cArm[j]! : -1;
          this.connOutLeg[c] = l0 + b.cOut[j]!;
          this.connOutCrossS[c] = b.cCrossS[j]!;
          for (let q = 0; q < 9; q++) this.connP[c * 9 + q] = b.cP[j * 9 + q]!;
          const L = nl + c;
          this.linkKind[L] = 1; this.linkLen[L] = b.cLen[j]!; this.linkSpeed[L] = b.cSpeed[j]!;
          this.linkArc[L] = oArc; this.linkFromNode[L] = n; this.linkToNode[L] = n;
          this.laneConns[c] = L;
          globalOf[nodeConnOff[n]! + j] = c; localOf[c] = j;
        }
      }
      this.laneConnStart[nl] = c;
    }
    // conflits : listes locales triées, donc listes globales triées (ordre local = ordre global)
    {
      const start = new Int32Array(nc + 1);
      for (let c = 0; c < nc; c++) {
        const b = blocks[this.linkToNode[nl + c]!]!, j = localOf[c]!;
        start[c + 1] = start[c]! + b.confStart[j + 1]! - b.confStart[j]!;
      }
      const flat = new Int32Array(start[nc]!);
      for (let c = 0; c < nc; c++) {
        const n = this.linkToNode[nl + c]!, b = blocks[n]!, j = localOf[c]!, off = nodeConnOff[n]!;
        let w = start[c]!;
        for (let q = b.confStart[j]!; q < b.confStart[j + 1]!; q++) flat[w++] = globalOf[off + b.conf[q]!]!;
      }
      this.conflictStart = start;
      this.conflicts = flat;
    }
    // transitions d'arc à arc (ordre d'insertion d'un calcul complet)
    {
      const as = new Int32Array(E * 2 + 1);
      for (let a = 0; a < E * 2; a++) {
        let cnt = 0;
        if (this.edgeLanes[a]! > 0) {
          const n = this.arcTo(a), b = blocks[n]!, li = legAt[(a >> 1) * 2 + ((a & 1) === 0 ? 1 : 0)]! - this.nodeLegStart[n]!;
          cnt = b.nextStart[li + 1]! - b.nextStart[li]!;
        }
        as[a + 1] = as[a]! + cnt;
      }
      const an = new Int32Array(as[E * 2]!);
      for (let a = 0; a < E * 2; a++) {
        if (this.edgeLanes[a]! === 0) continue;
        const n = this.arcTo(a), b = blocks[n]!, l0 = this.nodeLegStart[n]!, li = legAt[(a >> 1) * 2 + ((a & 1) === 0 ? 1 : 0)]! - l0;
        let w = as[a]!;
        for (let q = b.nextStart[li]!; q < b.nextStart[li + 1]!; q++) {
          const oe = this.legEdge[l0 + b.next[q]!]!;
          an[w++] = this.edgeA[oe] === n ? oe * 2 : oe * 2 + 1;
        }
      }
      this.arcNextStart = as;
      this.arcNext = an;
    }
    this.edgeInputs = null; this.crossIn = null; this.halfIn = null;
  }

  /** Vrai si le bloc mémorisé d'un carrefour vaut pour le nœud `n` du réseau en construction (même clé). */
  private blockMatches(b: NodeBlock, n: number, node: TrafficNodeInput): boolean {
    if (b.x !== node.x || b.y !== node.y || b.z !== node.z || b.mode !== node.control) return false;
    const l0 = this.nodeLegStart[n]!, d = this.nodeLegStart[n + 1]! - l0;
    if (b.edges.length !== d) return false;
    const inputs = this.edgeInputs!;
    for (let li = 0; li < d; li++) {
      const e = this.legEdge[l0 + li]!;
      const far = this.edgeA[e] === n ? this.edgeB[e]! : this.edgeA[e]!;
      if (b.far[li] !== this.nodeTrim[far]) return false;
      const ein = inputs[e]!;
      if (b.edges[li] !== ein) {
        if (!sameEdgeInput(b.edges[li]!, ein)) return false;
        b.edges[li] = ein; // mêmes valeurs : la prochaine comparaison se fera par identité
      }
    }
    return true;
  }

  /**
   * Calcul complet d'un carrefour (nœud `n`), en indices LOCAUX (branche = rang du tronçon incident, bras = rang
   * parmi les branches entrantes) : régime, phases, bras, branches et passages, connecteurs (géométrie, règles de
   * voie), conflits et transitions. Ne lit que les tronçons incidents et le rognage des nœuds voisins (clé du cache).
   */
  private computeNode(n: number, node: TrafficNodeInput): NodeBlock {
    const l0 = this.nodeLegStart[n]!, d = this.nodeLegStart[n + 1]! - l0;
    const inc: number[] = [];
    for (let li = 0; li < d; li++) inc.push(this.legEdge[l0 + li]!);
    const far: number[] = [];
    for (let li = 0; li < d; li++) { const e = inc[li]!; far.push(this.nodeTrim[this.edgeA[e] === n ? this.edgeB[e]! : this.edgeA[e]!]!); }
    // bras entrants
    const nodeArms: { arc: number; angle: number; rank: number; lanes: number; leg: number }[] = [];
    const armOfLeg: number[] = [];
    for (let li = 0; li < d; li++) {
      const e = inc[li]!;
      armOfLeg.push(-1);
      const arcIn = this.edgeB[e] === n ? e * 2 : e * 2 + 1;
      if (this.edgeLanes[arcIn]! === 0) continue; // pas de voie entrante (sens unique sortant)
      const [dx, dz] = this.arcEndDir(arcIn);
      armOfLeg[li] = nodeArms.length;
      nodeArms.push({ arc: arcIn, angle: Math.atan2(dx, dz), rank: this.edgeRank[e]!, lanes: this.edgeLanes[arcIn]!, leg: li });
    }
    let control = Control.None;
    let stop = 0;
    const ov = node.control;
    let allWay = false;
    // Bras prioritaires imposés (réglage « priorité ») : indices dans nodeArms ; null = par rang de route.
    let mainArms: Set<number> | null = null;
    if (d === 1) control = Control.DeadEnd;
    else if (d >= 3 && ov) {
      // Réglage du joueur (outil Carrefour) : prioritaire sur le choix automatique.
      //  - « stop » : toutes les branches cèdent et marquent l'arrêt complet ;
      //  - « priorité » : un axe principal passe sans arrêt, les autres branches lui cèdent le passage
      //    (et non une priorité à droite).
      control = ov === 'signal' ? Control.Signal : Control.Yield;
      allWay = ov === 'stop';
      if (ov === 'stop') stop = 1;
      if (ov === 'priority') mainArms = mainAxis(nodeArms);
    } else if (d >= 3) {
      const big = inc.filter((e) => Math.max(this.edgeLanes[e * 2]!, this.edgeLanes[e * 2 + 1]!) >= 2).length;
      const ranks = inc.map((e) => this.edgeRank[e]!);
      const maxR = Math.max(...ranks), minR = Math.min(...ranks);
      // feux : croisement de deux axes à plusieurs voies, ou carrefour à 4 branches touchant un axe principal
      if (maxR >= 4) control = Control.Yield; // giratoire (rang 4, adapters.ts) : cédez-le-passage aux entrées
      else if (big >= 3 || (d >= 4 && maxR >= 1)) control = Control.Signal;
      else if (maxR > minR) control = Control.Yield;
      else control = Control.Priority;
    }
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
    const green: number[] = [];
    const maxRank = nodeArms.reduce((m, a) => Math.max(m, a.rank), 0);
    for (let p = 0; p < 4; p++) {
      let lanes = 1;
      for (let i = 0; i < nodeArms.length; i++) if (phaseOf[i] === p) lanes = Math.max(lanes, nodeArms[i]!.lanes);
      green.push(14 + 5 * lanes);
    }
    const NAr = nodeArms.length;
    const armLeg: number[] = [], armPhase: number[] = [], armPrio: number[] = [], armAngle: number[] = [];
    for (let i = 0; i < NAr; i++) {
      const a = nodeArms[i]!;
      armLeg.push(a.leg); armPhase.push(Math.min(3, phaseOf[i]!)); armAngle.push(a.angle);
      armPrio.push(control === Control.Yield && !allWay && (mainArms ? mainArms.has(i) : a.rank === maxRank) ? 1 : 0);
    }

    // lignes d'arrêt effectives (mêmes proportions que le rognage des voies) et passages piétons
    // (10 valeurs par branche : arrêt, passage, demi-largeur, centre x y z, extrémités ax az bx bz ; lues en float32
    // comme dans les tableaux du graphe)
    const legF: number[] = [];
    const legPhaseMask: number[] = [];
    const crossIn = this.crossIn!, halfIn = this.halfIn!;
    const tmp = TMP8;
    for (let li = 0; li < d; li++) {
      const e = inc[li]!;
      const atA = this.edgeA[e] === n;
      const [t0, t1] = this.edgeTrims(e);
      const stopD = atA ? t0 : t1;
      const ci = crossIn[e * 2 + (atA ? 0 : 1)]!;
      let cross = Number.isNaN(ci) ? (d >= 3 ? stopD - 2.8 : -1) : ci;
      if (cross >= 0) cross = Math.min(Math.max(cross, 0.5), Math.max(0.5, stopD - 0.5));
      if (cross < 0 || d < 2 || stopD < 2.5) cross = -1;
      const half = Number.isNaN(halfIn[e]!) ? this.halfWidth(e) - 1 : halfIn[e]!;
      legF.push(stopD, cross, half);
      // géométrie : sens sortant du nœud
      const dir = atA ? 1 : -1;
      const sAxis = atA ? Math.max(0, cross) : this.edgeLen[e]! - Math.max(0, cross);
      this.edgePoint(e, sAxis, dir, 0, tmp, 0);
      legF.push(tmp[0]!, tmp[1]!, tmp[2]!);
      this.edgePoint(e, sAxis, dir, -half, tmp, 0);
      legF.push(tmp[0]!, tmp[2]!);
      this.edgePoint(e, sAxis, dir, half, tmp, 0);
      legF.push(tmp[0]!, tmp[2]!);
      legPhaseMask.push(0);
    }

    // connecteurs : par branche entrante, voie (rang) puis sortie, comme le calcul complet
    const legLane0: number[] = [];
    const laneConn: number[] = [0];
    const cOut: number[] = [], cROut: number[] = [], cTurn: number[] = [], cArm: number[] = [], cP: number[] = [], cLen: number[] = [], cSpeed: number[] = [], cCross: number[] = [];
    const cFromLocal: number[] = [], cToKey: number[] = [];
    const nextStart: number[] = [0];
    const next: number[] = [];
    let localLane = 0;
    for (let li = 0; li < d; li++) {
      const e = inc[li]!;
      const arc = this.edgeB[e] === n ? e * 2 : e * 2 + 1;
      const nIn = this.edgeLanes[arc]!;
      const nextSeen: number[] = [];
      legLane0.push(nIn > 0 ? localLane : -1);
      if (nIn > 0) {
        const [ax, az] = this.arcEndDir(arc);
        const armIdx = armOfLeg[li]!;
        const L = this.edgeLen[e]!;
        const [ta, tb] = this.edgeTrims(e);
        const t0 = (arc & 1) === 0 ? ta : tb, t1 = (arc & 1) === 0 ? tb : ta;
        const laneLen = Math.max(0.5, L - t0 - t1);
        const dirIn = (arc & 1) === 0 ? 1 : -1;
        const outs: { li: number; arc: number; turn: Turn }[] = [];
        for (let lo = 0; lo < d; lo++) {
          const oe = inc[lo]!;
          const o = this.edgeA[oe] === n ? oe * 2 : oe * 2 + 1;
          if (this.edgeLanes[o]! === 0) continue;
          if (oe === e) continue; // demi-tour : seulement en impasse (plus bas)
          const [ox, oz] = this.arcStartDir(o);
          const cr = ax * oz - az * ox;
          const dot = ax * ox + az * oz;
          // Y vers le haut : la droite du conducteur orienté (dx, dz) est (−dz, dx) ; cross > 0 : virage à droite
          const turn = dot > 0.7 ? Turn.Straight : cr > 0 ? Turn.Right : Turn.Left;
          outs.push({ li: lo, arc: o, turn });
        }
        if (outs.length === 0) {
          const back = arc ^ 1;
          if (this.edgeLanes[back]! > 0) outs.push({ li, arc: back, turn: Turn.UTurn });
        }
        const degTwo = outs.length === 1 && outs[0]!.turn !== Turn.UTurn;
        const vIn = this.edgeSpeed[e]!;
        for (let rIn = 0; rIn < nIn; rIn++, localLane++) {
          for (const o of outs) {
            const nOut = this.edgeLanes[o.arc]!;
            const allowed = degTwo || nIn === 1 || o.turn === Turn.Straight || o.turn === Turn.UTurn
              || (o.turn === Turn.Left && rIn === 0) || (o.turn === Turn.Right && rIn === nIn - 1);
            if (!allowed) continue;
            let rOut: number;
            if (o.turn === Turn.Straight || degTwo) rOut = Math.min(nOut - 1, Math.round((rIn * (nOut - 1)) / Math.max(1, nIn - 1)));
            else if (o.turn === Turn.Right) rOut = nOut - 1;
            else rOut = 0;
            // points : fin de la voie amont, début de la voie aval
            const sIn = t0 + laneLen;
            this.edgePoint(e, dirIn > 0 ? sIn : L - sIn, dirIn, this.laneOffsetFor(arc, rIn), tmp, 0);
            {
              const oe = o.arc >> 1, oL = this.edgeLen[oe]!;
              const [oa, ob] = this.edgeTrims(oe);
              const os0 = (o.arc & 1) === 0 ? oa : ob;
              const odir = (o.arc & 1) === 0 ? 1 : -1;
              const sOut = os0 + 0;
              this.edgePoint(oe, odir > 0 ? sOut : oL - sOut, odir, this.laneOffsetFor(o.arc, rOut), tmp, 4);
            }
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
            for (let q = 1; q <= 8; q++) {
              const t = q / 8, u = 1 - t;
              const x = u * u * p0x + 2 * u * t * cx + t * t * p2x, z = u * u * p0z + 2 * u * t * cz + t * t * p2z;
              len += Math.hypot(x - px, z - pz); px = x; pz = z;
            }
            len = Math.max(0.3, len);
            const outLeg = o.li;
            let crossS = -1;
            const oCross = Math.fround(legF[outLeg * 10 + 1]!);
            if (oCross >= 0) {
              // le passage de sortie occupe [cross − 2, cross + 2] depuis le nœud ; le connecteur finit à la ligne d'arrêt
              crossS = Math.max(0, len - (Math.fround(legF[outLeg * 10]!) - (oCross - 2)));
              // mouvement protégé (tout droit) : sa phase interdit le passage aux piétons
              if ((o.turn === Turn.Straight || degTwo) && armIdx >= 0) legPhaseMask[outLeg]! |= 1 << armPhase[armIdx]!;
            }
            cOut.push(o.li); cROut.push(rOut); cTurn.push(o.turn); cArm.push(armIdx); cLen.push(len); cCross.push(crossS);
            cSpeed.push(o.turn === Turn.Straight || degTwo ? vIn : o.turn === Turn.UTurn ? 4 : o.turn === Turn.Right ? 5.5 : 7);
            cFromLocal.push(localLane); cToKey.push(o.li * 256 + rOut);
            if (!nextSeen.includes(o.li)) nextSeen.push(o.li);
          }
          laneConn.push(cOut.length);
        }
      }
      for (const x of nextSeen) next.push(x);
      nextStart[li + 1] = next.length;
    }
    for (let a = 0; a < NAr; a++) legPhaseMask[armLeg[a]!]! |= 1 << armPhase[a]!;

    // conflits entre connecteurs du carrefour : trajectoires sécantes ou même voie de sortie
    const m = cOut.length;
    const S = 8;
    if (scratchPoly.length < m * (S + 1) * 2) { scratchPoly = new Float32Array(m * (S + 1) * 4); scratchBox = new Float64Array(m * 8); }
    if (scratchPair.length < m * m) scratchPair = new Uint8Array(m * m * 2);
    const poly = scratchPoly, box = scratchBox, pair = scratchPair;
    const f = Math.fround;
    for (let c = 0; c < m; c++) {
      const b = c * 9;
      // points de contrôle lus en float32 (comme dans connP)
      const P0 = f(cP[b]!), P2 = f(cP[b + 2]!), P3 = f(cP[b + 3]!), P5 = f(cP[b + 5]!), P6 = f(cP[b + 6]!), P8 = f(cP[b + 8]!);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let q = 0; q <= S; q++) {
        const t = q / S, u = 1 - t;
        const o = (c * (S + 1) + q) * 2;
        poly[o] = u * u * P0 + 2 * u * t * P3 + t * t * P6;
        poly[o + 1] = u * u * P2 + 2 * u * t * P5 + t * t * P8;
        const x = poly[o]!, z = poly[o + 1]!;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      box[c * 4] = x0; box[c * 4 + 1] = z0; box[c * 4 + 2] = x1; box[c * 4 + 3] = z1;
    }
    // matrice des conflits (symétrique) puis listes triées par connecteur
    pair.fill(0, 0, m * m);
    let K = 0;
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
      if (cFromLocal[i] === cFromLocal[j]) continue; // même voie d'origine : file (IDM)
      let conflict = cToKey[i] === cToKey[j];
      // Boîtes séparées de plus que le gabarit : aucune paire de segments ne peut être à moins de 2,2 m
      // (élagage exact : la distance entre segments est au moins l'écart entre leurs boîtes).
      if (!conflict && !boxesApart(box, i, j, CONFLICT_GAUGE)) conflict = this.trajectoriesMeet(poly, S, i, j, cToKey[i] !== cToKey[j]);
      if (conflict) { pair[i * m + j] = 1; pair[j * m + i] = 1; K += 2; }
    }

    // Tout le bloc dans un seul tampon (une allocation par carrefour au lieu d'une trentaine).
    const nLanes = laneConn.length - 1, J = next.length;
    const nF = d + 4 + NAr + 10 * d + 12 * m;
    const nI = NAr + d + (nLanes + 1) + 2 * m + (m + 1) + K + (d + 1) + J;
    const nB = 2 * NAr + d + 2 * m;
    const buf = new ArrayBuffer((nF + nI) * 4 + nB);
    let fo = 0, io = nF * 4, bo = (nF + nI) * 4;
    const F = (len: number, src?: readonly number[]): Float32Array => { const a = new Float32Array(buf, fo, len); fo += len * 4; if (src) for (let i = 0; i < len; i++) a[i] = src[i]!; return a; };
    const I = (len: number, src?: readonly number[]): Int32Array => { const a = new Int32Array(buf, io, len); io += len * 4; if (src) for (let i = 0; i < len; i++) a[i] = src[i]!; return a; };
    const B = (len: number, src: readonly number[]): Uint8Array => { const a = new Uint8Array(buf, bo, len); bo += len; for (let i = 0; i < len; i++) a[i] = src[i]!; return a; };
    const legCol = (k: number): Float32Array => { const a = F(d); for (let li = 0; li < d; li++) a[li] = legF[li * 10 + k]!; return a; };
    const confStart = I(m + 1), conf = I(K);
    for (let i = 0, w = 0; i < m; i++) {
      for (let j = 0; j < m; j++) if (pair[i * m + j]) conf[w++] = j;
      confStart[i + 1] = w;
    }
    return {
      x: node.x, y: node.y, z: node.z, mode: node.control, edges: inc.map((e) => this.edgeInputs![e]!), far: F(d, far),
      control, stop, phases: control === Control.Signal ? phases : 0, green: F(4, green),
      armLeg: I(NAr, armLeg), armPhase: B(NAr, armPhase), armPrio: B(NAr, armPrio), armAngle: F(NAr, armAngle),
      legStop: legCol(0), legCross: legCol(1), legHalf: legCol(2), legX: legCol(3), legY: legCol(4), legZ: legCol(5),
      legAX: legCol(6), legAZ: legCol(7), legBX: legCol(8), legBZ: legCol(9), legPhaseMask: B(d, legPhaseMask),
      legLane0: I(d, legLane0), laneConn: I(nLanes + 1, laneConn),
      cOut: I(m, cOut), cROut: B(m, cROut), cTurn: B(m, cTurn), cArm: I(m, cArm),
      cP: F(9 * m, cP), cLen: F(m, cLen), cSpeed: F(m, cSpeed), cCrossS: F(m, cCross),
      confStart, conf, nextStart: I(d + 1, nextStart), next: I(J, next),
    };
  }

  /**
   * Vrai si deux trajectoires échantillonnées (S segments) passent à moins du gabarit l'une de l'autre, hors contact
   * aux extrémités de deux voies parallèles (départ côte à côte ; arrivée côte à côte si les voies de sortie diffèrent).
   */
  private trajectoriesMeet(poly: Float32Array, S: number, a: number, b: number, distinctTo: boolean): boolean {
    const g = CONFLICT_GAUGE;
    const oa = a * (S + 1) * 2, ob = b * (S + 1) * 2;
    for (let p = 0; p < S; p++) {
      const ax = poly[oa + p * 2]!, az = poly[oa + p * 2 + 1]!, bx = poly[oa + p * 2 + 2]!, bz = poly[oa + p * 2 + 3]!;
      const sx0 = Math.min(ax, bx) - g, sx1 = Math.max(ax, bx) + g, sz0 = Math.min(az, bz) - g, sz1 = Math.max(az, bz) + g;
      for (let q = 0; q < S; q++) {
        const cx = poly[ob + q * 2]!, cz = poly[ob + q * 2 + 1]!, dx = poly[ob + q * 2 + 2]!, dz = poly[ob + q * 2 + 3]!;
        // élagage exact par boîtes (marge de 1 mm au-delà du gabarit contre les arrondis)
        if (Math.max(cx, dx) < sx0 - 1e-3 || Math.min(cx, dx) > sx1 + 1e-3 || Math.max(cz, dz) < sz0 - 1e-3 || Math.min(cz, dz) > sz1 + 1e-3) continue;
        if (segDist(ax, az, bx, bz, cx, cz, dx, dz) < g) {
          const nearStart = p === 0 && q === 0, nearEnd = p === S - 1 && q === S - 1 && distinctTo;
          if (!nearStart && !nearEnd) return true;
        }
      }
    }
    return false;
  }

  /** Index de branche d'un passage (identifiant stable `legId`), −1 si inconnu. */
  legIndex(id: number): number {
    if (!this.legIndexOf) { this.legIndexOf = new Map(); for (let leg = 0; leg < this.legId.length; leg++) this.legIndexOf.set(this.legId[leg]!, leg); }
    return this.legIndexOf.get(id) ?? -1;
  }

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
  private kinkTrim(n: number, a: number, b: number): number {
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

/**
 * Carrefour calculé (indices locaux : branche = rang du tronçon incident dans l'ordre des tronçons, bras = rang parmi
 * les branches entrantes, connecteur = rang dans le carrefour) avec sa clé de validité.
 */
export interface NodeBlock {
  /* clé */
  x: number; y: number; z: number; mode: JunctionMode | undefined;
  /** Entrées des tronçons incidents, dans l'ordre. */
  edges: TrafficEdgeInput[];
  /** Rognage du nœud voisin, par branche. */
  far: Float32Array;
  /* régime */
  control: number; stop: number; phases: number; green: Float32Array;
  /* bras */
  armLeg: Int32Array; armPhase: Uint8Array; armPrio: Uint8Array; armAngle: Float32Array;
  /* branches et passages */
  legStop: Float32Array; legCross: Float32Array; legHalf: Float32Array;
  legX: Float32Array; legY: Float32Array; legZ: Float32Array; legAX: Float32Array; legAZ: Float32Array; legBX: Float32Array; legBZ: Float32Array;
  legPhaseMask: Uint8Array;
  /* connecteurs : CSR par voie entrante locale (première voie de chaque branche : legLane0, −1 si aucune) */
  legLane0: Int32Array; laneConn: Int32Array;
  cOut: Int32Array; cROut: Uint8Array; cTurn: Uint8Array; cArm: Int32Array; cP: Float32Array; cLen: Float32Array; cSpeed: Float32Array; cCrossS: Float32Array;
  /** Conflits (CSR, connecteurs locaux triés). */
  confStart: Int32Array; conf: Int32Array;
  /** Branches de sortie atteignables depuis chaque branche (ordre d'insertion). */
  nextStart: Int32Array; next: Int32Array;
}

/** Carrefours mémorisés par identifiant de nœud du monde (voir le constructeur de `TrafficGraph`). */
export type ConflictCache = Map<number, NodeBlock>;

/** Gabarit (m) : deux trajectoires plus proches que cela sont en conflit. */
const CONFLICT_GAUGE = 2.2;
/** Polylignes déjà converties (x, y, z, s par point, puis longueur), par tableau de points d'entrée. */
const POLYLINES = new WeakMap<readonly number[], Float32Array>();
/** Tampons de travail du calcul d'un carrefour (worker mono-thread : réutilisés d'un nœud à l'autre). */
const TMP8 = new Float32Array(8);
let scratchPoly = new Float32Array(1024);
let scratchBox = new Float64Array(256);
let scratchPair = new Uint8Array(4096);

/** Vrai si les boîtes des connecteurs i et j sont séparées de plus de `gap` (+ 1 mm d'arrondi) selon x ou z. */
function boxesApart(box: Float64Array, i: number, j: number, gap: number): boolean {
  const g = gap + 1e-3;
  return box[j * 4]! - box[i * 4 + 2]! > g || box[i * 4]! - box[j * 4 + 2]! > g
    || box[j * 4 + 1]! - box[i * 4 + 3]! > g || box[i * 4 + 1]! - box[j * 4 + 3]! > g;
}

/** Égalité de valeur de deux entrées de tronçon (mêmes champs, même polyligne). */
export function sameEdgeInput(p: TrafficEdgeInput, q: TrafficEdgeInput): boolean {
  if (p === q) return true;
  if (p.id !== q.id || p.a !== q.a || p.b !== q.b || p.lanesForward !== q.lanesForward || p.lanesBackward !== q.lanesBackward
    || p.laneWidth !== q.laneWidth || p.median !== q.median || p.speedKmh !== q.speedKmh || p.rank !== q.rank
    || p.stopA !== q.stopA || p.stopB !== q.stopB || p.crossA !== q.crossA || p.crossB !== q.crossB || p.crossHalf !== q.crossHalf) return false;
  const a = p.points, b = q.points;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
