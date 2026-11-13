/**
 * Rendu du réseau routier (Three.js). Implémente IRoadRenderer.
 *
 * - Maillage procédural (builder.ts) fusionné PAR CHUNK de 256 m et par matériau : un maillage par
 *   couche et par chunk (frustum culling natif par chunk, quelques draw calls par chunk).
 * - Reconstruction incrémentale : seuls les chunks touchés (tronçon ajouté/supprimé et ses voisins
 *   de carrefour) sont remaillés.
 * - Matériaux PBR partagés (MaterialLibrary, textures Poly Haven CC0) : asphalte, trottoir en dalles,
 *   bordures granit, pavés, béton, herbe ; peinture de marquage dédiée.
 * - Décor instancié par chunk (InstancedMesh par sous-maillage GLB) : lampadaires « lampadaire_fonte »,
 *   arbres d'alignement, mobilier des rues piétonnes ; LOD par distance du chunk ; matrices partagées
 *   entre LOD (aucune copie).
 * - Nuit : vitrage des lanternes émissif + halos lumineux au sol (instanciés, additifs), via setNight().
 */
import * as THREE from 'three';
import { WATER_LEVEL, CHUNK_SIZE } from '../../shared/constants';
import type { IRoadRenderer, RoadEdgeRecord, RoadNodeRecord } from '../../shared/contracts';
import { RoadNetwork, cubic, isRoadKind, type RoadEdgeRecordEx, type RoadKindId } from '../../sim/roads';
import type { AssetLibrary } from '../assets';
import { MaterialLibrary } from '../materials';
import { LAYERS, buildJunction, buildSegment, newOutput, type BuildContext, type DecorItem, type DecorKind, type LayerId } from './builder';

export interface RoadRendererDeps {
  /** Bibliothèque d'assets (GLB du décor ; sert aussi à créer la MaterialLibrary si absente). */
  lib?: AssetLibrary;
  materials?: MaterialLibrary;
  waterLevel?: number;
  /**
   * Matériau d'imposteur orienté caméra d'un arbre (fourni par la végétation), ou null. S'il existe, il remplace
   * le dernier LOD en « cartes croisées » des arbres d'alignement lointains (lamelles vues du dessus).
   */
  treeImpostor?: (assetId: string) => THREE.Material | null;
}

/** Assets du catalogue utilisés pour le décor routier. */
export const DECOR_ASSETS: Record<DecorKind, string[]> = {
  lamp: ['lampadaire_fonte'],
  tree: ['arbre_feuillu_jeune', 'arbre_feuillu_rond', 'arbre_platane'],
  // Variantes du mobilier phase 2C (docs/requests/mobilier.md §3) : même mécanisme de choix déterministe.
  bench: ['banc_bois', 'banc_modulaire', 'banc_beton'],
  planter: ['jardiniere_plante_a', 'jardiniere_plante_b', 'jardiniere_bac_bois', 'jardiniere_haute_bois', 'jardiniere_beton'],
  bin: ['poubelle_metal', 'poubelles_tri'],
};

/** Distance (m) caméra-chunk au-delà de laquelle le décor passe au LOD le plus léger. */
/** Distances (m, du bord approximatif du chunk) : LOD0 -> LOD1 -> LOD2 -> masqué. Réglées par l'intégration :
 *  les arbres d'alignement Poly Haven font 16-20 k triangles au LOD0 (mesure de la scène de démo). */
const DECOR_LOD0 = 40;
const DECOR_NEAR = 300;
const DECOR_HIDE = 1400;

interface DecorBatch { meshes: THREE.InstancedMesh[][]; } // [lod][sous-maillage]

interface Chunk {
  key: number;
  cx: number;
  cz: number;
  group: THREE.Group;
  segs: Set<number>;
  nodes: Set<number>;
  layerMeshes: THREE.Mesh[];
  decor: DecorItem[];
  batches: DecorBatch[];
  pools: THREE.InstancedMesh | null;
  lod: number;
}

/** Couleurs de repli (sans bibliothèque de matériaux : tests isolés). */
const FALLBACK: Record<LayerId, number> = {
  asphalt: 0x34363a, asphaltWorn: 0x45474a, sidewalk: 0x9a958c, curb: 0x8c8a86, pavers: 0x8a7f72,
  grass: 0x4b6a2e, concrete: 0xa29f98, metal: 0xb8bcc0, paint: 0xe8e8e2, skirt: 0x6e6559,
};

/** Marqueur : « ce LOD est un imposteur » (la vraie géométrie, avec sa teinte par instance, est créée par lot). */
const IMPOSTOR_QUAD = new THREE.BufferGeometry();
function disposeDecorMesh(m: THREE.InstancedMesh): void {
  if (m.geometry.userData['ownedByBatch']) m.geometry.dispose();
  m.dispose();
}
const LAMP_GLASS_COLOR = new THREE.Color(0xffc887);

export class RoadNetworkRenderer implements IRoadRenderer {
  readonly group = new THREE.Group();
  net: RoadNetwork;
  private ownsNetwork = true;
  private readonly chunks = new Map<number, Chunk>();
  private readonly segChunk = new Map<number, number>();
  private readonly nodeChunk = new Map<number, number>();
  private readonly dirty = new Set<number>();
  private readonly materials: Map<LayerId, THREE.Material> = new Map();
  private matLib: MaterialLibrary | null = null;
  private readonly lib: AssetLibrary | null;
  /** Prototypes de décor : par asset, par LOD, liste (géométrie, matériau). */
  private readonly decorProto = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[][]>();
  private decorReady: Promise<void> = Promise.resolve();
  private readonly treeImpostor: ((assetId: string) => THREE.Material | null) | null;
  private avoid: number[] = [];
  private avoidKeys = new Map<number, string>();
  private night = 0;
  private readonly lampGlass: THREE.MeshStandardMaterial[] = [];
  private readonly poolMaterial: THREE.MeshBasicMaterial;
  private readonly poolGeometry: THREE.PlaneGeometry;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private cam = new THREE.Vector3(0, 300, 400);
  /**
   * Nœuds devenus orphelins lors de la dernière suppression : un même delta de la simulation retire
   * un tronçon coupé par un carrefour PUIS ajoute ses morceaux, qui réutilisent ces nœuds existants
   * (absents de `roadNodesAdded`). On garde leur position pour les recréer à l'ajout.
   */
  private readonly orphanPos = new Map<number, { x: number; y: number; z: number }>();
  /** Diagnostic : nombre de reconstructions de chunks, durée cumulée (ms). */
  rebuilds = 0;
  rebuildMs = 0;

  constructor(scene: THREE.Scene, heightAt: (x: number, z: number) => number, deps: RoadRendererDeps = {}) {
    this.group.name = 'roads';
    scene.add(this.group);
    this.net = new RoadNetwork({ heightAt, waterLevel: deps.waterLevel ?? WATER_LEVEL });
    this.lib = deps.lib ?? null;
    this.treeImpostor = deps.treeImpostor ?? null;
    this.matLib = deps.materials ?? (deps.lib ? new MaterialLibrary(deps.lib.catalog, new URL('.', deps.lib.url('catalog.json'))) : null);
    this.initMaterials();
    this.poolGeometry = new THREE.PlaneGeometry(1, 1);
    this.poolGeometry.rotateX(-Math.PI / 2);
    this.poolMaterial = new THREE.MeshBasicMaterial({
      map: makePoolTexture(), color: 0xffc27a, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false,
    });
    if (this.lib) this.decorReady = this.loadDecor(this.lib);
  }

  private initMaterials(): void {
    const ml = this.matLib;
    const pick = (layer: LayerId, set: string, uv: 'worldXZ' | 'box', extra: { color?: string; tileSizeM?: number; normalScale?: number } = {}): void => {
      if (ml && ml.has(set)) this.materials.set(layer, ml.get(set, { uv, ...extra }));
      else this.materials.set(layer, new THREE.MeshStandardMaterial({ color: FALLBACK[layer], roughness: 0.85, metalness: 0 }));
    };
    // L'albédo Poly Haven est un asphalte clair et usé : teinte assombrie pour un enrobé urbain.
    pick('asphalt', 'route_asphalte', 'worldXZ', { color: '#8e8c88' });
    pick('asphaltWorn', 'route_asphalte_use', 'worldXZ', { color: '#c8c6c2' });
    pick('sidewalk', 'trottoir_dalles', 'worldXZ');
    pick('curb', 'bordure_granit', 'box', { tileSizeM: 1.2 });
    pick('pavers', 'paves_granit', 'worldXZ');
    pick('grass', 'terrain_herbe', 'worldXZ', { color: '#a3b884' });
    pick('concrete', 'sol_beton_brut', 'box', { tileSizeM: 3 });
    pick('skirt', 'terrain_terre', 'box', { tileSizeM: 2.5 });
    // Peinture routière (rétroréfléchissante mate) et métal galvanisé : matériaux propres au module.
    this.materials.set('paint', new THREE.MeshStandardMaterial({
      name: 'peinture_route', color: 0xeeeee6, roughness: 0.62, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    if (ml && ml.has('metal_rideau')) this.materials.set('metal', ml.get('metal_rideau', { uv: 'box', tileSizeM: 1, color: '#d8dde2' }));
    else this.materials.set('metal', new THREE.MeshStandardMaterial({ name: 'acier_galvanise', color: 0xb9bec4, roughness: 0.38, metalness: 1 }));
  }

  private async loadDecor(lib: AssetLibrary): Promise<void> {
    const ids = [...new Set(Object.values(DECOR_ASSETS).flat())].filter((id) => lib.get(id));
    await Promise.all(ids.map(async (id) => {
      const a = lib.get(id)!;
      const lods: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[][] = [];
      // Proche : LOD0 (LOD1 pour les arbres, très denses) ; loin : dernier LOD.
      const near = a.category === 'tree' ? Math.min(1, a.lods.length - 1) : 0;
      let far = a.lods.length - 1;
      const cards = a.category === 'tree' && far > near && (a.lods[far]?.triangles ?? 1e9) <= 16;
      const imp = cards ? this.treeImpostor?.(id) ?? null : null;
      // Sans imposteur, jamais les « cartes » : elles comportent une plaque horizontale visible de côté.
      if (cards && !imp) far = near;
      for (const lod of [near, far]) {
        if (imp && lod === far) {
          // Loin : imposteur de la végétation (quad orienté caméra ; la géométrie est créée par lot, voir rebuildDecor).
          lods.push([{ geometry: IMPOSTOR_QUAD, material: imp }]);
          continue;
        }
        const root = await lib.load(id, lod);
        root.updateMatrixWorld(true);
        const parts: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[] = [];
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const g = m.geometry.clone();
          g.applyMatrix4(m.matrixWorld);
          let mat = m.material;
          if (id === 'lampadaire_fonte' && !Array.isArray(mat) && /glass/i.test(mat.name)) {
            // Vitrage de lanterne : copie émissive pilotée par setNight().
            const gm = (mat as THREE.MeshStandardMaterial).clone();
            gm.emissive = LAMP_GLASS_COLOR.clone();
            gm.emissiveIntensity = 0;
            this.lampGlass.push(gm);
            mat = gm;
          }
          parts.push({ geometry: g, material: mat });
        });
        lods.push(parts);
      }
      this.decorProto.set(id, lods);
    }));
    this.setNight(this.night);
    for (const c of this.chunks.values()) this.rebuildDecor(c);
  }

  /** Résout quand le décor GLB et les textures sont chargés. */
  async whenReady(): Promise<void> {
    await this.decorReady;
    await this.matLib?.whenReady();
  }

  get materialLibrary(): MaterialLibrary | null { return this.matLib; }

  /* ---------------------------- IRoadRenderer ---------------------------- */

  addRoads(nodes: readonly RoadNodeRecord[], edges: readonly RoadEdgeRecord[]): void {
    for (const n of nodes) if (!this.net.hasNode(n.id)) this.net.addNode(n.x, n.z, n.y, n.id);
    const touched: number[] = [];
    for (const e0 of edges) {
      const e = e0 as RoadEdgeRecordEx;
      for (const nid of [e.a, e.b]) {
        const o = this.orphanPos.get(nid);
        if (o && !this.net.hasNode(nid)) this.net.addNode(o.x, o.z, o.y, nid);
      }
      if (this.net.hasSegment(e.id) || !this.net.hasNode(e.a) || !this.net.hasNode(e.b) || e.a === e.b) continue;
      const kind: RoadKindId = e.kind && isRoadKind(e.kind) ? e.kind : isRoadKind(e.type) ? e.type : 'street';
      let curve;
      if (e.c1 && e.c2) {
        const a = this.net.nodePos(e.a), b = this.net.nodePos(e.b);
        curve = cubic(a.x, a.z, e.c1[0], e.c1[1], e.c2[0], e.c2[1], b.x, b.z);
      }
      this.net.addSegment(e.a, e.b, kind, curve, e.id);
      // Profil validé par la simulation (prioritaire sur un recalcul à partir du terrain, peut-être nivelé).
      if (e.profile && e.profile.length >= 2) this.net.setProfile(e.id, e.profile, e.bridgeRuns ?? []);
      touched.push(e.id);
    }
    this.orphanPos.clear();
    this.net.takeChanges();
    this.markSegments(touched);
    this.flush();
  }

  removeRoadEdges(edgeIds: readonly number[]): void {
    const ends: number[] = [];
    this.orphanPos.clear();
    for (const id of edgeIds) {
      if (!this.net.hasSegment(id)) continue;
      const [a, b] = this.net.endpoints(id);
      const pa = this.net.nodePos(a), pb = this.net.nodePos(b);
      this.markChunkOfSeg(id);
      this.unassignSeg(id);
      ends.push(a, b);
      const orphans = this.net.removeSegment(id);
      for (const o of orphans) {
        this.unassignNode(o);
        this.orphanPos.set(o, o === a ? { ...pa } : { ...pb });
      }
    }
    for (const n of ends) if (this.net.hasNode(n)) this.markNode(n);
    this.net.takeChanges();
    this.flush();
  }

  /**
   * Mode direct : affiche un réseau construit ailleurs (démo, outils). Le réseau n'est pas copié ;
   * appeler `refresh(segIds)` après l'avoir modifié (ou sans argument pour tout reconstruire).
   */
  showNetwork(net: RoadNetwork): void {
    for (const c of [...this.chunks.values()]) this.disposeChunk(c);
    this.chunks.clear(); this.segChunk.clear(); this.nodeChunk.clear();
    this.net = net;
    this.ownsNetwork = false;
    this.refresh();
  }

  /** Remaille les tronçons donnés (et leurs voisins), ou tout le réseau. */
  refresh(segIds?: readonly number[]): void {
    if (!segIds) {
      for (const c of [...this.chunks.values()]) this.disposeChunk(c);
      this.chunks.clear(); this.segChunk.clear(); this.nodeChunk.clear();
      segIds = this.net.segmentIds();
    }
    this.markSegments(segIds.filter((id) => this.net.hasSegment(id)));
    this.flush();
  }

  /* ------------------------------ Chunks ------------------------------ */

  private chunkKey(x: number, z: number): number {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    return (cx + 512) * 1024 + (cz + 512);
  }

  private getChunk(key: number): Chunk {
    let c = this.chunks.get(key);
    if (!c) {
      const cx = (Math.floor(key / 1024) - 512 + 0.5) * CHUNK_SIZE, cz = ((key % 1024) - 512 + 0.5) * CHUNK_SIZE;
      const group = new THREE.Group();
      group.name = `roads_chunk_${key}`;
      this.group.add(group);
      c = { key, cx, cz, group, segs: new Set(), nodes: new Set(), layerMeshes: [], decor: [], batches: [], pools: null, lod: 0 };
      this.chunks.set(key, c);
    }
    return c;
  }

  private assignSeg(id: number): void {
    if (this.segChunk.has(id)) return;
    const c = this.net.curve(id);
    const mx = (c[0]! + 3 * c[2]! + 3 * c[4]! + c[6]!) / 8, mz = (c[1]! + 3 * c[3]! + 3 * c[5]! + c[7]!) / 8;
    const key = this.chunkKey(mx, mz);
    this.getChunk(key).segs.add(id);
    this.segChunk.set(id, key);
  }

  private unassignSeg(id: number): void {
    const key = this.segChunk.get(id);
    if (key === undefined) return;
    this.chunks.get(key)?.segs.delete(id);
    this.segChunk.delete(id);
  }

  private assignNode(id: number): void {
    if (this.nodeChunk.has(id)) return;
    const p = this.net.nodePos(id);
    const key = this.chunkKey(p.x, p.z);
    this.getChunk(key).nodes.add(id);
    this.nodeChunk.set(id, key);
  }

  private unassignNode(id: number): void {
    const key = this.nodeChunk.get(id);
    if (key === undefined) return;
    this.chunks.get(key)?.nodes.delete(id);
    this.dirty.add(key);
    this.nodeChunk.delete(id);
  }

  private markChunkOfSeg(id: number): void {
    const k = this.segChunk.get(id);
    if (k !== undefined) this.dirty.add(k);
  }

  /** Un nœud change : sa dalle et tous les tronçons incidents (reculs) sont à refaire. */
  private markNode(id: number): void {
    this.assignNode(id);
    this.dirty.add(this.nodeChunk.get(id)!);
    for (const s of this.net.incident(id)) { this.assignSeg(s); this.markChunkOfSeg(s); }
  }

  private markSegments(ids: readonly number[]): void {
    for (const id of ids) {
      this.assignSeg(id);
      this.markChunkOfSeg(id);
      const [a, b] = this.net.endpoints(id);
      this.markNode(a); this.markNode(b);
    }
  }

  /**
   * Obstacles que le décor routier doit éviter : pieds des mâts de feux tricolores (x, z) et nœud de leur
   * carrefour. Seuls les carrefours dont les obstacles ont changé sont remaillés (lecture seule de la
   * disposition des feux : rien n'est modifié côté feux).
   */
  setDecorObstacles(xz: ArrayLike<number>, nodeIds: ArrayLike<number>): void {
    const next = new Map<number, string>();
    const flat: number[] = [];
    for (let i = 0; i < nodeIds.length; i++) {
      const x = xz[i * 2]!, z = xz[i * 2 + 1]!;
      flat.push(x, z);
      const n = nodeIds[i]!;
      next.set(n, `${next.get(n) ?? ''}${x.toFixed(1)},${z.toFixed(1)};`);
    }
    const changed: number[] = [];
    for (const [n, k] of next) if (this.avoidKeys.get(n) !== k) changed.push(n);
    for (const n of this.avoidKeys.keys()) if (!next.has(n)) changed.push(n);
    this.avoid = flat;
    this.avoidKeys = next;
    for (const n of changed) if (this.net.hasNode(n)) this.markNode(n);
    this.flush();
  }

  /** Décor posé (diagnostic, tests) : type et position de chaque élément. */
  decorItems(): { kind: DecorKind; x: number; z: number }[] {
    const res: { kind: DecorKind; x: number; z: number }[] = [];
    for (const c of this.chunks.values()) for (const d of c.decor) res.push({ kind: d.kind, x: d.x, z: d.z });
    return res;
  }

  /** Reconstruit les chunks en attente. */
  flush(): void {
    if (this.dirty.size === 0) return;
    const t0 = performance.now();
    const ctx: BuildContext = { net: this.net, junctions: new Map(), avoid: this.avoid };
    for (const key of this.dirty) {
      const c = this.chunks.get(key);
      if (!c) continue;
      this.rebuildChunk(c, ctx);
    }
    this.dirty.clear();
    this.rebuildMs += performance.now() - t0;
  }

  private rebuildChunk(c: Chunk, ctx: BuildContext): void {
    for (const m of c.layerMeshes) { m.geometry.dispose(); c.group.remove(m); }
    c.layerMeshes = [];
    if (c.segs.size === 0 && c.nodes.size === 0) { this.disposeChunk(c); return; }
    const out = newOutput();
    for (const s of c.segs) if (this.net.hasSegment(s)) buildSegment(out, ctx, s);
    for (const n of c.nodes) if (this.net.hasNode(n)) buildJunction(out, ctx, n);
    for (const layer of LAYERS) {
      const b = out.layers.get(layer)!;
      if (b.idx.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setIndex(b.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.materials.get(layer)!);
      mesh.name = `roads_${layer}`;
      mesh.receiveShadow = true;
      mesh.castShadow = layer === 'concrete' || layer === 'curb' || layer === 'metal';
      c.group.add(mesh);
      c.layerMeshes.push(mesh);
    }
    c.decor = out.decor;
    this.rebuildDecor(c);
    this.rebuilds++;
  }

  private rebuildDecor(c: Chunk): void {
    for (const b of c.batches) for (const lod of b.meshes) for (const m of lod) { c.group.remove(m); disposeDecorMesh(m); }
    c.batches = [];
    if (c.pools) { c.group.remove(c.pools); c.pools.dispose(); c.pools = null; }
    if (this.decorProto.size === 0 || c.decor.length === 0) return;
    // Regroupe par asset (variante choisie de façon déterministe par position).
    const byAsset = new Map<string, DecorItem[]>();
    for (const d of c.decor) {
      const options = DECOR_ASSETS[d.kind].filter((id) => this.decorProto.has(id));
      if (options.length === 0) continue;
      const id = options[Math.abs(Math.floor(d.x * 7.13 + d.z * 3.71)) % options.length]!;
      let l = byAsset.get(id);
      if (!l) { l = []; byAsset.set(id, l); }
      l.push(d);
    }
    for (const [id, items] of byAsset) {
      const proto = this.decorProto.get(id)!;
      const matrix = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 16), 16);
      items.forEach((d, i) => {
        this.tmpQ.setFromAxisAngle(this.up, d.rot);
        this.tmpV.set(d.x, d.y, d.z);
        this.tmpS.setScalar(d.scale);
        this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
        this.tmpM.toArray(matrix.array as Float32Array, i * 16);
      });
      const batch: DecorBatch = { meshes: [] };
      proto.forEach((parts, lod) => {
        const list: THREE.InstancedMesh[] = [];
        for (const p of parts) {
          const impostor = p.geometry === IMPOSTOR_QUAD;
          let geometry = p.geometry;
          if (impostor) {
            // Quad propre au lot : l'attribut instancié de teinte (blanc) a la taille du lot.
            geometry = new THREE.PlaneGeometry(2, 2);
            geometry.setAttribute('instanceTint', new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3).fill(1), 3));
            geometry.userData['ownedByBatch'] = true;
          }
          const im = new THREE.InstancedMesh(geometry, p.material, items.length);
          im.instanceMatrix = matrix; // matrices partagées entre LOD et sous-maillages
          im.name = `roads_decor_${id}_${impostor ? 'imposteur' : `lod${lod}`}`;
          im.castShadow = !impostor;
          im.receiveShadow = !impostor;
          im.frustumCulled = true;
          // Imposteur : le quad est déplacé par le shader ; on reprend la sphère englobante du LOD détaillé.
          const ref = impostor ? batch.meshes[0]?.[0] : undefined;
          if (ref?.boundingSphere) im.boundingSphere = ref.boundingSphere.clone();
          else im.computeBoundingSphere();
          im.visible = lod === 0;
          c.group.add(im);
          list.push(im);
        }
        batch.meshes.push(list);
      });
      c.batches.push(batch);
      if (id === 'lampadaire_fonte') {
        // Halos au sol (nuit) : décalés vers la chaussée.
        const pools = new THREE.InstancedMesh(this.poolGeometry, this.poolMaterial, items.length);
        items.forEach((d, i) => {
          const r = 9 * d.scale;
          this.tmpQ.identity();
          this.tmpV.set(d.x + Math.sin(d.rot) * 1.5, d.y + 0.05, d.z + Math.cos(d.rot) * 1.5);
          this.tmpS.set(r, 1, r);
          this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
          pools.setMatrixAt(i, this.tmpM);
        });
        pools.name = 'roads_lamp_pools';
        pools.renderOrder = 2;
        pools.visible = this.night > 0.01;
        pools.computeBoundingSphere();
        c.group.add(pools);
        c.pools = pools;
      }
    }
    c.lod = -1;
    this.applyLod(c);
  }

  private applyLod(c: Chunk): void {
    const d = Math.max(0, Math.hypot(this.cam.x - c.cx, this.cam.z - c.cz) - CHUNK_SIZE * 0.5);
    const lod = d > DECOR_HIDE ? 3 : d > DECOR_NEAR ? 2 : d > DECOR_LOD0 ? 1 : 0;
    if (lod === c.lod) return;
    c.lod = lod;
    for (const b of c.batches) b.meshes.forEach((list, i) => { const want = Math.min(lod, b.meshes.length - 1); for (const m of list) m.visible = lod < 3 && i === want; });
  }

  private disposeChunk(c: Chunk): void {
    for (const m of c.layerMeshes) m.geometry.dispose();
    for (const b of c.batches) for (const lod of b.meshes) for (const m of lod) disposeDecorMesh(m);
    c.pools?.dispose();
    c.group.removeFromParent();
    this.chunks.delete(c.key);
  }

  /** LOD du décor selon la caméra (appelé par frame ; sans allocation). */
  update(cameraX: number, cameraY: number, cameraZ: number): void {
    this.cam.set(cameraX, cameraY, cameraZ);
    this.flush();
    for (const c of this.chunks.values()) this.applyLod(c);
  }

  /** Éclairage de nuit : 0 = jour, 1 = pleine nuit. */
  setNight(f: number): void {
    this.night = Math.min(1, Math.max(0, f));
    for (const m of this.lampGlass) m.emissiveIntensity = this.night * 3.2;
    this.poolMaterial.opacity = this.night * 0.55;
    for (const c of this.chunks.values()) if (c.pools) c.pools.visible = this.night > 0.01;
  }

  /** Facteur de nuit d'après l'heure de jeu (crépuscule 19 h-21 h, aube 5 h-7 h). */
  static nightFactorForHour(hour: number): number {
    if (hour >= 21 || hour < 5) return 1;
    if (hour >= 19) return (hour - 19) / 2;
    if (hour < 7) return 1 - (hour - 5) / 2;
    return 0;
  }

  /** Statistiques (diagnostic, tests). */
  stats(): { chunks: number; meshes: number; triangles: number; decorInstances: number; segments: number; nodes: number } {
    let meshes = 0, tris = 0, decor = 0;
    for (const c of this.chunks.values()) {
      for (const m of c.layerMeshes) { meshes++; tris += (m.geometry.index?.count ?? 0) / 3; }
      decor += c.decor.length;
    }
    return { chunks: this.chunks.size, meshes, triangles: tris, decorInstances: decor, segments: this.net.segCount, nodes: this.net.nodeCount };
  }

  dispose(): void {
    for (const c of [...this.chunks.values()]) this.disposeChunk(c);
    this.chunks.clear();
    this.materials.get('paint')?.dispose();
    for (const m of this.lampGlass) m.dispose();
    this.poolMaterial.map?.dispose();
    this.poolMaterial.dispose();
    this.poolGeometry.dispose();
    for (const lods of this.decorProto.values()) for (const parts of lods) for (const p of parts) p.geometry.dispose();
    if (this.ownsNetwork) this.net.clear();
    this.group.removeFromParent();
  }
}

/** Texture radiale (halo de lampadaire) générée procéduralement. */
function makePoolTexture(): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const dx = (i + 0.5) / N * 2 - 1, dz = (j + 0.5) / N * 2 - 1;
      const r = Math.min(1, Math.hypot(dx, dz));
      const v = Math.pow(1 - r, 2.2);
      const k = (j * N + i) * 4;
      data[k] = 255; data[k + 1] = 255; data[k + 2] = 255; data[k + 3] = Math.round(v * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
