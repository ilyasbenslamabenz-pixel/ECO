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
import { LAYERS, buildJunction, buildRoundaboutIsland, buildSegment, newOutput, type BuildContext, type DecorItem, type DecorKind, type LayerId } from './builder';

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

/** Distances (m) : version proche du décor jusqu'à la distance du LOD du catalogue (au moins DECOR_LOD0), par
 *  instance ; masqué au-delà de DECOR_HIDE (du bord approximatif du chunk). Les arbres d'alignement Poly Haven
 *  font 16-20 k triangles au LOD0 (mesure de la scène de démo) : version proche = leur LOD1. */
const DECOR_LOD0 = 40;
const DECOR_HIDE = 1400;
/** Lampadaire en pavés au-delà de cette distance 3D (m) à la caméra (≈ 20 px de haut en 1080p). */
const LAMP_PROXY = 200;

/**
 * Lot de décor d'un chunk (un asset) : un maillage instancié par niveau et sous-maillage, chaque niveau avec ses
 * propres matrices. Près de la caméra, chaque instance choisit son niveau selon SA distance (`limits`) ; loin,
 * tout le lot est au dernier niveau. Avant, le niveau valait pour tout le chunk (256 m) : en vue rue, chaque
 * lampadaire du chunk de la caméra était dessiné au LOD0 (8 000 triangles), image et carte d'ombre.
 */
interface DecorBatch {
  meshes: THREE.InstancedMesh[][]; // [niveau][sous-maillage]
  /** Matrices de toutes les instances (16 par instance) et positions (3 par instance). */
  mats: Float32Array;
  pos: Float32Array;
  /** Matrices compactées de chaque niveau. */
  attrs: THREE.InstancedBufferAttribute[];
  /** Distance 3D maximale (m) de chaque niveau sauf le dernier. */
  limits: number[];
  /** Mode courant : niveau unique (0, 1, 2…), -1 = par instance, -2 = masqué. */
  mode: number;
}

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
  /** Hauteurs extrêmes du décor du chunk (distance 3D à la boîte du chunk). */
  decorMinY: number;
  decorMaxY: number;
  /** Position de caméra du dernier tri par instance (recalcul après ≥ 2 m de déplacement). */
  lastX: number; lastY: number; lastZ: number;
}

/** Couleurs de repli (sans bibliothèque de matériaux : tests isolés). */
const FALLBACK: Record<LayerId, number> = {
  asphalt: 0x34363a, asphaltWorn: 0x45474a, sidewalk: 0x9a958c, curb: 0x8c8a86, pavers: 0x8a7f72,
  grass: 0x4b6a2e, concrete: 0xa29f98, metal: 0xb8bcc0, paint: 0xe8e8e2, skirt: 0x6e6559,
  talus: 0x6f7f45, sand: 0xc9b48a, tunnel: 0x1b1c1e,
};

/** Marqueur : « ce LOD est un imposteur » (la vraie géométrie, avec sa teinte par instance, est créée par lot). */
const IMPOSTOR_QUAD = new THREE.BufferGeometry();
function disposeDecorMesh(m: THREE.InstancedMesh): void {
  if (m.geometry.userData['ownedByBatch']) m.geometry.dispose();
  m.dispose();
}
const LAMP_GLASS_COLOR = new THREE.Color(0xffc887);

type DecorPart = { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] };

/** UV du sommet de `g` le plus proche de `p` (couleur réelle du modèle à cet endroit). */
function uvNear(g: THREE.BufferGeometry, x: number, y: number, z: number): [number, number] {
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
  if (!uv) return [0.5, 0.5];
  let best = Infinity, k = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = (pos.getX(i) - x) ** 2 + (pos.getY(i) - y) ** 2 + (pos.getZ(i) - z) ** 2;
    if (d < best) { best = d; k = i; }
  }
  return [uv.getX(k), uv.getY(k)];
}

/** Pavé [x0,x1]×[y0,y1]×[z0,z1] (12 triangles) dont toutes les UV pointent sur `uv` : teinte unie prise au modèle. */
function proxyBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, uv: [number, number]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const a = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, uv[0], uv[1]);
  return g;
}

/**
 * Lampadaire vu de très loin (au-delà de LAMP_PROXY, quelques pixels de haut) : 3 pavés (mât, lanterne vitrée,
 * chapeau) au lieu des 797 triangles du dernier LOD, mêmes matériaux (vitrage allumé la nuit). Dérivé des
 * boîtes englobantes du dernier LOD ; null si sa structure n'est pas celle attendue (mât + vitrage).
 */
function lampFarProxy(parts: readonly DecorPart[], isGlass: (m: THREE.Material) => boolean): DecorPart[] | null {
  const glass = parts.find((p) => !Array.isArray(p.material) && isGlass(p.material));
  const posts = parts.filter((p) => p !== glass && !Array.isArray(p.material));
  if (!glass || posts.length === 0) return null;
  const post = posts.reduce((a, b) => (b.geometry.getAttribute('position').count > a.geometry.getAttribute('position').count ? b : a));
  post.geometry.computeBoundingBox(); glass.geometry.computeBoundingBox();
  const pb = post.geometry.boundingBox!, gb = glass.geometry.boundingBox!;
  if (!(gb.min.y > pb.min.y && gb.max.y <= pb.max.y)) return null;
  const cx = (pb.min.x + pb.max.x) / 2, cz = (pb.min.z + pb.max.z) / 2, r = 0.06;
  const gx = (gb.max.x - gb.min.x) / 2, gz = (gb.max.z - gb.min.z) / 2;
  const midY = (pb.min.y + gb.min.y) / 2;
  return [
    { geometry: proxyBox(cx - r, cx + r, pb.min.y, gb.min.y, cz - r, cz + r, uvNear(post.geometry, cx, midY, cz)), material: post.material },
    { geometry: proxyBox(gb.min.x, gb.max.x, gb.min.y, gb.max.y, gb.min.z, gb.max.z, uvNear(glass.geometry, cx, (gb.min.y + gb.max.y) / 2, cz)), material: glass.material },
    { geometry: proxyBox(cx - gx * 1.1, cx + gx * 1.1, gb.max.y, Math.max(gb.max.y + 0.05, pb.max.y), cz - gz * 1.1, cz + gz * 1.1, uvNear(post.geometry, cx, pb.max.y, cz)), material: post.material },
  ];
}

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
  /** Distance 3D (m) jusqu'à laquelle chaque décor garde sa version proche (LOD du catalogue). */
  private readonly decorNear = new Map<string, number>();
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
    // Talus : mêmes textures que le terrain (herbe, sable au bord de l'eau) pour un raccord sans couture visible.
    pick('talus', 'terrain_herbe', 'worldXZ', { color: '#9aae6c' });
    pick('sand', 'terrain_sable', 'worldXZ');
    this.materials.set('tunnel', new THREE.MeshStandardMaterial({ name: 'tunnel_interieur', color: 0x1d1e20, roughness: 0.95, metalness: 0 }));
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
      // Lampadaires (≈ 750 dans la démo, dessinés jusqu'à 1,4 km et dans la carte d'ombre) : version pavés au-delà de LAMP_PROXY.
      if (id === 'lampadaire_fonte' && lods.length === 2) {
        const proxy = lampFarProxy(lods[1]!, (m) => this.lampGlass.includes(m as THREE.MeshStandardMaterial));
        if (proxy) lods.push(proxy);
      }
      this.decorNear.set(id, Math.max(DECOR_LOD0, a.lods[near]?.maxDistance ?? DECOR_LOD0));
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
      this.net.addSegment(e.a, e.b, kind, curve, e.id, e.elev ?? 0);
      if (e.ring) this.net.setRing(e.id, e.ring);
      // Profil validé par la simulation (prioritaire sur un recalcul à partir du terrain, peut-être nivelé).
      if (e.profile && e.profile.length >= 2) this.net.setProfile(e.id, e.profile, e.bridgeRuns ?? [], e.tunnelRuns ?? [], e.walls ?? []);
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

  /**
   * Le terrain a changé dans la zone (patch de nivellement) : les talus et murs des tronçons proches suivent le
   * nouveau relief (ils sont raccordés au terrain RENDU).
   */
  terrainChanged(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const ids = this.net.segmentsIn(minX - 24, minZ - 24, maxX + 24, maxZ + 24, []);
    if (ids.length === 0) return;
    this.markSegments(ids);
    this.flush();
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
      c = { key, cx, cz, group, segs: new Set(), nodes: new Set(), layerMeshes: [], decor: [], batches: [], pools: null, lod: 0, decorMinY: 0, decorMaxY: 0, lastX: NaN, lastY: NaN, lastZ: NaN };
      this.chunks.set(key, c);
    }
    return c;
  }

  private assignSeg(id: number): void {
    if (this.segChunk.has(id)) return;
    const c = this.net.curve(id);
    const ring = this.net.ringOf(id);
    // Anneau de giratoire : tous ses tronçons dans le chunk du centre (l'îlot est remaillé avec eux).
    const mx = ring ? ring[0] : (c[0]! + 3 * c[2]! + 3 * c[4]! + c[6]!) / 8, mz = ring ? ring[1] : (c[1]! + 3 * c[3]! + 3 * c[5]! + c[7]!) / 8;
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
    // Îlots centraux des giratoires dont le centre est dans ce chunk.
    const rings = new Map<string, readonly [number, number, number]>();
    for (const sid of c.segs) {
      const r = this.net.hasSegment(sid) ? this.net.ringOf(sid) : null;
      if (r && this.chunkKey(r[0], r[1]) === c.key) rings.set(`${r[0].toFixed(2)},${r[1].toFixed(2)}`, r);
    }
    for (const r of rings.values()) buildRoundaboutIsland(out, ctx, r[0], r[1], r[2]);
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
    c.decorMinY = Infinity; c.decorMaxY = -Infinity;
    for (const d of c.decor) { c.decorMinY = Math.min(c.decorMinY, d.y); c.decorMaxY = Math.max(c.decorMaxY, d.y + 5); }
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
      const pos = new Float32Array(items.length * 3);
      items.forEach((d, i) => { pos[i * 3] = d.x; pos[i * 3 + 1] = d.y; pos[i * 3 + 2] = d.z; });
      const near = this.decorNear.get(id) ?? DECOR_LOD0;
      const batch: DecorBatch = {
        meshes: [], mats: matrix.array as Float32Array, pos, attrs: [], mode: -3,
        limits: proto.length > 2 ? [near, Math.max(near, LAMP_PROXY)] : [near],
      };
      proto.forEach((parts, lod) => {
        // Matrices propres au niveau (compactées par applyLod) ; le niveau 0 garde d'abord toutes les instances.
        const levelMatrix = lod === 0 ? matrix : new THREE.InstancedBufferAttribute((matrix.array as Float32Array).slice(), 16);
        levelMatrix.setUsage(THREE.DynamicDrawUsage);
        batch.attrs.push(levelMatrix);
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
          im.instanceMatrix = levelMatrix; // matrices partagées entre sous-maillages d'un même niveau
          im.name = `roads_decor_${id}_${impostor ? 'imposteur' : `lod${lod}`}`;
          im.castShadow = !impostor;
          im.receiveShadow = !impostor;
          im.frustumCulled = true;
          // Imposteur : le quad est déplacé par le shader ; on reprend la sphère englobante du LOD détaillé.
          const ref = impostor ? batch.meshes[0]?.[0] : undefined;
          // Sphère calculée sur TOUTES les instances (matrices complètes à ce stade) : reste valable après compactage.
          if (ref?.boundingSphere) im.boundingSphere = ref.boundingSphere.clone();
          else im.computeBoundingSphere();
          im.visible = lod === 0;
          c.group.add(im);
          list.push(im);
        }
        batch.meshes.push(list);
      });
      batch.mats = (matrix.array as Float32Array).slice();
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
    c.lastX = NaN;
    this.applyLod(c);
  }

  private applyLod(c: Chunk): void {
    const cam = this.cam;
    // Masquage lointain : inchangé (distance horizontale au chunk).
    const hidden = Math.max(0, Math.hypot(cam.x - c.cx, cam.z - c.cz) - CHUNK_SIZE * 0.5) > DECOR_HIDE;
    // Distance 3D exacte à la boîte du décor du chunk : aucune instance n'est plus proche.
    const h = CHUNK_SIZE / 2;
    const ax = Math.max(0, Math.abs(cam.x - c.cx) - h), az = Math.max(0, Math.abs(cam.z - c.cz) - h);
    const ay = cam.y > c.decorMaxY ? cam.y - c.decorMaxY : cam.y < c.decorMinY ? c.decorMinY - cam.y : 0;
    const dc = Math.hypot(ax, ay, az);
    const moved = !(Math.abs(cam.x - c.lastX) < 2 && Math.abs(cam.y - c.lastY) < 2 && Math.abs(cam.z - c.lastZ) < 2);
    let sorted = false;
    for (const b of c.batches) {
      const last = b.meshes.length - 1;
      const mode = hidden ? -2 : dc >= b.limits[b.limits.length - 1]! ? last : -1;
      if (mode === b.mode && (mode !== -1 || !moved)) continue;
      if (mode === -1) { this.sortInstances(b); sorted = true; }
      else if (mode >= 0) this.singleLevel(b, mode);
      else for (const list of b.meshes) for (const m of list) m.visible = false;
      b.mode = mode;
    }
    if (sorted || moved) { c.lastX = cam.x; c.lastY = cam.y; c.lastZ = cam.z; }
  }

  /** Toutes les instances du lot au niveau `lvl` (matrices complètes recopiées si besoin). */
  private singleLevel(b: DecorBatch, lvl: number): void {
    const n = b.pos.length / 3;
    b.meshes.forEach((list, i) => {
      if (i === lvl) {
        const at = b.attrs[i]!;
        (at.array as Float32Array).set(b.mats);
        at.clearUpdateRanges(); at.needsUpdate = true;
        for (const m of list) { m.count = n; m.visible = n > 0; }
      } else for (const m of list) m.visible = false;
    });
  }

  /** Niveau de chaque instance selon sa distance 3D à la caméra ; matrices compactées par niveau. */
  private sortInstances(b: DecorBatch): void {
    const cam = this.cam, n = b.pos.length / 3, nl = b.meshes.length;
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(b.pos[i * 3]! - cam.x, b.pos[i * 3 + 1]! - cam.y, b.pos[i * 3 + 2]! - cam.z);
      let lvl = 0;
      while (lvl < b.limits.length && d > b.limits[lvl]!) lvl++;
      if (lvl >= nl) lvl = nl - 1;
      const k = counts[lvl]!++;
      (b.attrs[lvl]!.array as Float32Array).set(b.mats.subarray(i * 16, i * 16 + 16), k * 16);
    }
    b.meshes.forEach((list, i) => {
      const k = counts[i]!;
      const at = b.attrs[i]!;
      if (k > 0) { at.clearUpdateRanges(); at.addUpdateRange(0, k * 16); at.needsUpdate = true; }
      for (const m of list) { m.count = k; m.visible = k > 0; }
    });
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
