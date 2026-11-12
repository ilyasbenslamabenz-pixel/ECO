/**
 * Modèles Poly Haven -> GLB optimisés multi-LOD (assets/models/polyhaven/<catégorie>/<id>_lod{0,1,2}.glb).
 *
 * Étapes (gltf-transform 4 + meshoptimizer + sharp) :
 *  1. lecture du glTF 1k en cache, extraction des nœuds voulus (packs à plusieurs variantes) ;
 *  2. cuisson des transformations (flatten + clearNodeTransform), fusion des primitives (join), weld ;
 *  3. normalisation : origine au centre de l'empreinte, base à y = 0, rotation éventuelle (face vers +Z) ;
 *     feuillages BLEND -> MASK (alpha test, double face) : pas de tri de transparence sur des milliers d'instances ;
 *  4. LOD0/1/2 : budget de triangles par primitive — simplification meshopt pour les parties pleines ;
 *     pour les feuillages (cartes alpha), simplification + décimation d'îlots (feuilles) avec agrandissement
 *     des îlots conservés pour garder la couverture de la couronne ;
 *  5. textures redimensionnées (LOD0 = textureSize, LOD1 = /2, LOD2 = /4) et converties en WebP (EXT_texture_webp) ;
 *  6. dedup + prune, écriture GLB, mesure des triangles et de la boîte englobante (avec transformations).
 * Pas de quantification ni de compression meshopt : les GLB restent lisibles par GLTFLoader sans décodeur
 * et par les outils Node du projet (tools/lib/glb-inspect.ts).
 * Un cache de construction (.cache/polyhaven/built/<id>.json) évite de retraiter un modèle inchangé.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Document, type Node, NodeIO, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  clearNodeTransform, cloneDocument, compactPrimitive, dedup, flatten, getBounds, join as joinPrims,
  compressTexture, listTextureSlots, prune, simplifyPrimitive, transformPrimitive, weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import type { CatalogAsset } from '../../src/shared/catalog';
import { authorsOf, CACHE_DIR, cachedGltf, getInfo, phPageUrl, type PhInfo } from './polyhaven';
import type { ModelSpec } from './selection';

/** Incrémenter quand l'algorithme change (invalide le cache de construction). */
const PIPELINE_VERSION = 8;
const LOD_RATIOS = [1, 0.35, 0.1] as const;
const FOLIAGE_RE = /leaf|leaves|twig|foliage|needle|grass|shrub/i;
const TRUNK_RE = /trunk|bark|stem/i;

let io: NodeIO | null = null;
async function getIO(): Promise<NodeIO> {
  if (!io) {
    await MeshoptSimplifier.ready;
    io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  }
  return io;
}

export interface BuiltModel {
  asset: CatalogAsset;
  /** Mesures pour le rapport / le validateur. */
  report: { lodTriangles: number[]; lodBytes: number[]; phDimensions: number[] | null; warnings: string[] };
}

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------
function triCount(prim: Primitive): number {
  const idx = prim.getIndices();
  return idx ? idx.getCount() / 3 : (prim.getAttribute('POSITION')?.getCount() ?? 0) / 3;
}

function docTriangles(doc: Document): number {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) if (p.getMode() === 4) t += triCount(p);
  return t;
}

function isFoliage(prim: Primitive): boolean {
  const mat = prim.getMaterial();
  if (!mat) return false;
  return mat.getAlphaMode() === 'MASK' && FOLIAGE_RE.test(mat.getName());
}

/** Îlots de triangles connexes (union-find sur les sommets). Renvoie l'îlot de chaque triangle. */
function triangleIslands(prim: Primitive): { triIsland: Uint32Array; islands: number } {
  const idx = prim.getIndices()!.getArray()!;
  const n = prim.getAttribute('POSITION')!.getCount();
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; }
    return x;
  };
  for (let i = 0; i < idx.length; i += 3) {
    const a = find(idx[i]!);
    const b = find(idx[i + 1]!);
    const c = find(idx[i + 2]!);
    parent[b] = a;
    parent[c] = a;
  }
  const label = new Int32Array(n).fill(-1);
  let islands = 0;
  const triIsland = new Uint32Array(idx.length / 3);
  for (let t = 0; t < triIsland.length; t++) {
    const r = find(idx[t * 3]!);
    if (label[r] === -1) label[r] = islands++;
    triIsland[t] = label[r]!;
  }
  return { triIsland, islands };
}

/** Conserve un sous-ensemble d'îlots (choix déterministe bien réparti) et agrandit chacun autour de son centre. */
function decimateIslands(prim: Primitive, keepFrac: number, scale: number): void {
  const { triIsland, islands } = triangleIslands(prim);
  const idx = prim.getIndices()!.getArray()!;
  const posAcc = prim.getAttribute('POSITION')!;
  const pos = posAcc.getArray() as Float32Array;
  const keep = new Uint8Array(islands);
  const PHI = 0.6180339887498949;
  for (let i = 0; i < islands; i++) keep[i] = ((i + 0.5) * PHI) % 1 < keepFrac ? 1 : 0;
  // Centres des îlots (moyenne des sommets référencés).
  const sum = new Float64Array(islands * 4);
  const vIsland = new Int32Array(posAcc.getCount()).fill(-1);
  for (let t = 0; t < triIsland.length; t++) {
    const isl = triIsland[t]!;
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]!;
      if (vIsland[v] !== -1) continue;
      vIsland[v] = isl;
      sum[isl * 4] = sum[isl * 4]! + pos[v * 3]!;
      sum[isl * 4 + 1] = sum[isl * 4 + 1]! + pos[v * 3 + 1]!;
      sum[isl * 4 + 2] = sum[isl * 4 + 2]! + pos[v * 3 + 2]!;
      sum[isl * 4 + 3] = sum[isl * 4 + 3]! + 1;
    }
  }
  const newPos = pos.slice();
  for (let v = 0; v < vIsland.length; v++) {
    const isl = vIsland[v]!;
    if (isl < 0 || !keep[isl]) continue;
    const c = sum[isl * 4 + 3]!;
    for (let k = 0; k < 3; k++) {
      const m = sum[isl * 4 + k]! / c;
      newPos[v * 3 + k] = m + (pos[v * 3 + k]! - m) * scale;
    }
  }
  posAcc.setArray(newPos);
  const out: number[] = [];
  for (let t = 0; t < triIsland.length; t++) if (keep[triIsland[t]!]) out.push(idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!);
  prim.getIndices()!.setArray(new Uint32Array(out));
  compactPrimitive(prim);
}

/** Supprime les plus petits îlots (diagonale de boîte) jusqu'au budget. */
function dropSmallIslands(prim: Primitive, target: number, maxFrac: number): void {
  const { triIsland, islands } = triangleIslands(prim);
  const idx = prim.getIndices()!.getArray()!;
  const pos = prim.getAttribute('POSITION')!.getArray() as Float32Array;
  const bb = new Float64Array(islands * 6);
  for (let i = 0; i < islands; i++) { bb.fill(Infinity, i * 6, i * 6 + 3); bb.fill(-Infinity, i * 6 + 3, i * 6 + 6); }
  const count = new Uint32Array(islands);
  for (let t = 0; t < triIsland.length; t++) {
    const isl = triIsland[t]!;
    count[isl] = count[isl]! + 1;
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]!;
      for (let a = 0; a < 3; a++) {
        const x = pos[v * 3 + a]!;
        if (x < bb[isl * 6 + a]!) bb[isl * 6 + a] = x;
        if (x > bb[isl * 6 + 3 + a]!) bb[isl * 6 + 3 + a] = x;
      }
    }
  }
  const diag = (i: number): number => Math.hypot(bb[i * 6 + 3]! - bb[i * 6]!, bb[i * 6 + 4]! - bb[i * 6 + 1]!, bb[i * 6 + 5]! - bb[i * 6 + 2]!);
  const order = Array.from({ length: islands }, (_, i) => i).sort((a, b) => diag(a) - diag(b));
  // Ne jamais retirer une pièce structurante (tronc, base) : seuls les îlots < maxFrac de la diagonale totale.
  const pa = prim.getAttribute('POSITION')!;
  const mn = pa.getMin([]);
  const mx = pa.getMax([]);
  const maxDiag = maxFrac * Math.hypot(mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!);
  const removed = new Uint8Array(islands);
  let tris = triIsland.length;
  for (const i of order) {
    if (tris <= target || diag(i) > maxDiag) break;
    removed[i] = 1;
    tris -= count[i]!;
  }
  const out: number[] = [];
  for (let t = 0; t < triIsland.length; t++) if (!removed[triIsland[t]!]) out.push(idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!);
  prim.getIndices()!.setArray(new Uint32Array(out));
  compactPrimitive(prim);
}

function simplifyTo(prim: Primitive, target: number, lod: number): void {
  const errors = lod === 0 ? [0.002, 0.01, 0.03, 0.08] : lod === 1 ? [0.005, 0.02, 0.06, 0.15] : [0.01, 0.05, 0.15, 0.3];
  for (const error of errors) {
    const tris = triCount(prim);
    if (tris <= target * 1.05) return;
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Math.max(0.002, target / tris), error, lockBorder: false });
  }
}

function reducePrimitive(prim: Primitive, target: number, lod: number): void {
  if (triCount(prim) <= target) return;
  if (isFoliage(prim)) {
    // 1) Moins de triangles par feuille : simplification à erreur TRÈS faible (au-delà, meshopt fait
    //    disparaître des feuilles entières — vérifié : 0,005 du rayon supprime 99,9 % des feuilles).
    //    Les sommets conservés étant des sommets d'origine, le contour reste dans la zone opaque de la texture.
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Math.max(0.002, target / triCount(prim)), error: 0.002, lockBorder: false });
    // 2) Moins de feuilles, agrandies autour de leur centre pour garder la couverture de la couronne.
    const tris = triCount(prim);
    if (tris > target * 1.05) {
      const keep = target / tris;
      const maxScale = lod === 0 ? 1.7 : lod === 1 ? 2.3 : 3.0;
      decimateIslands(prim, keep, Math.min(maxScale, 1 / Math.sqrt(keep)));
    }
  } else {
    simplifyTo(prim, target, lod);
    if (triCount(prim) > target * 1.3) dropSmallIslands(prim, target, lod === 2 ? 0.3 : 0.15);
  }
}

/** Répartit un budget de triangles entre les primitives d'un document. */
function reduceDocument(doc: Document, budget: number, lod: number): void {
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).filter((p) => p.getMode() === 4);
  const tris = prims.map(triCount);
  const total = tris.reduce((a, b) => a + b, 0);
  if (total <= budget) return;
  // Poids par classe × racine du nombre de triangles : le tronc et les pièces pleines gardent une part
  // suffisante même face à des millions de triangles de feuillage.
  const w = prims.map((p, i) => Math.sqrt(tris[i]!) * (isFoliage(p) ? 2.5 : TRUNK_RE.test(p.getMaterial()?.getName() ?? '') ? 2 : 1.5));
  const wSum = w.reduce((a, b) => a + b, 0);
  let targets = prims.map((_, i) => Math.min(tris[i]!, (budget * w[i]!) / wSum));
  // Redistribution du budget non utilisé par les petites primitives.
  const spare = budget - targets.reduce((a, b) => a + b, 0);
  if (spare > 0) {
    const open = prims.map((_, i) => (targets[i]! < tris[i]! ? w[i]! : 0));
    const oSum = open.reduce((a, b) => a + b, 0);
    if (oSum > 0) targets = targets.map((t, i) => Math.min(tris[i]!, t + (spare * open[i]!) / oSum));
  }
  prims.forEach((p, i) => reducePrimitive(p, Math.max(12, Math.floor(targets[i]!)), lod));
}

// ---------------------------------------------------------------------------
// Préparation du document de base (LOD0 non réduit)
// ---------------------------------------------------------------------------
function disposeTree(n: Node): void {
  for (const c of n.listChildren()) disposeTree(c);
  n.dispose();
}

async function loadBase(spec: ModelSpec): Promise<Document> {
  const gltf = await cachedGltf(spec.ph, '1k');
  const doc = await (await getIO()).read(gltf);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error(`${spec.ph} : aucune scène`);
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  if (spec.nodes) {
    const kept = scene.listChildren().filter((n) => spec.nodes!.test(n.getName()));
    if (kept.length === 0) throw new Error(`${spec.id} : aucun nœud ne correspond à ${spec.nodes}`);
    for (const n of scene.listChildren()) if (!kept.includes(n)) disposeTree(n);
  }
  await doc.transform(flatten());
  for (const n of root.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  // Feuillages : alpha test (MASK) double face au lieu du mélange.
  for (const m of root.listMaterials()) {
    if (FOLIAGE_RE.test(m.getName()) && m.getAlphaMode() !== 'OPAQUE') {
      m.setAlphaMode('MASK').setAlphaCutoff(0.45).setDoubleSided(true);
    }
  }
  await doc.transform(prune(), joinPrims({ keepNamed: false }), weld(), prune());
  // Normalisation : centre de l'empreinte en (0, 0), base à y = 0, rotation Y éventuelle.
  const b = getBounds(scene);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const a = ((spec.rotateY ?? 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Matrice colonne (glTF) : R_y * T(-cx, -minY, -cz)
  const tx = -cx;
  const ty = -b.min[1];
  const tz = -cz;
  const m = [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    c * tx + s * tz, ty, -s * tx + c * tz, 1,
  ] as unknown as Parameters<typeof transformPrimitive>[1];
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) transformPrimitive(p, m);
  return doc;
}

/**
 * Textures -> WebP. Taille : textureSize >> lod ; les cartes de rugosité/ARM (basse fréquence) et,
 * pour les arbres, les écorces (vues de loin, petite surface écran) sont réduites de moitié.
 */
async function compressTextures(doc: Document, spec: ModelSpec, lod: number): Promise<void> {
  const foliageTex = new Set<unknown>();
  for (const m of doc.getRoot().listMaterials()) {
    if (m.getAlphaMode() === 'MASK' && FOLIAGE_RE.test(m.getName())) {
      for (const t of [m.getBaseColorTexture(), m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getOcclusionTexture()]) if (t) foliageTex.add(t);
    }
  }
  for (const tex of doc.getRoot().listTextures()) {
    const slots = listTextureSlots(tex);
    let size = spec.textureSize >> lod;
    if (slots.every((s) => s === 'metallicRoughnessTexture' || s === 'occlusionTexture')) size >>= 1;
    if (spec.category === 'tree' && !foliageTex.has(tex)) size >>= 1;
    size = Math.max(128, size);
    await compressTexture(tex, { encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: lod === 0 ? 85 : 80, effort: 70 });
  }
}

// ---------------------------------------------------------------------------
// Construction des LOD
// ---------------------------------------------------------------------------
function specHash(spec: ModelSpec): string {
  return createHash('sha1').update(JSON.stringify({ ...spec, nodes: spec.nodes?.source ?? null, v: PIPELINE_VERSION })).digest('hex').slice(0, 16);
}

function variantsFor(spec: ModelSpec): CatalogAsset['variants'] {
  const base = [{ id: 'standard', nameFr: 'Standard' }];
  if (!spec.heightVariants) return base;
  return spec.heightVariants.filter((h) => h !== 1).reduce((acc, h) => {
    acc.push({ id: `h${Math.round(h * 100)}`, nameFr: `Taille ×${h.toFixed(2).replace('.', ',')}`, heightScale: h });
    return acc;
  }, base as CatalogAsset['variants']);
}

export async function buildModel(spec: ModelSpec, assetsDir: string): Promise<BuiltModel> {
  const relDir = `models/polyhaven/${spec.category}`;
  const files = [0, 1, 2].map((l) => `${relDir}/${spec.id}_lod${l}.glb`);
  const stampFile = join(CACHE_DIR, 'built', `${spec.id}.json`);
  const hash = specHash(spec);
  if (existsSync(stampFile) && files.every((f) => existsSync(join(assetsDir, f)))) {
    const stamp = JSON.parse(readFileSync(stampFile, 'utf8')) as { hash: string; built: BuiltModel };
    if (stamp.hash === hash) return stamp.built;
  }
  const info: PhInfo = await getInfo(spec.ph);
  const base = await loadBase(spec);
  const ioi = await getIO();
  mkdirSync(join(assetsDir, relDir), { recursive: true });
  const warnings: string[] = [];
  const lodTriangles: number[] = [];
  const lodBytes: number[] = [];
  let dims = { width: 0, depth: 0, height: 0 };
  const baseTris = docTriangles(base);
  let prevTris = Infinity;
  for (let l = 0; l < 3; l++) {
    const doc = cloneDocument(base);
    const budget = Math.max(40, Math.floor(Math.min(baseTris, spec.lod0Triangles) * LOD_RATIOS[l]!));
    reduceDocument(doc, Math.min(budget, Math.floor(prevTris * 0.6)), l);
    await doc.transform(prune(), dedup());
    await compressTextures(doc, spec, l);
    const bin = await ioi.writeBinary(doc);
    writeFileSync(join(assetsDir, files[l]!), bin);
    const tris = docTriangles(doc);
    lodTriangles.push(tris);
    lodBytes.push(bin.byteLength);
    prevTris = tris;
    if (l === 0) {
      const b = getBounds(doc.getRoot().getDefaultScene()!);
      dims = {
        width: +(b.max[0] - b.min[0]).toFixed(3),
        depth: +(b.max[2] - b.min[2]).toFixed(3),
        height: +(b.max[1] - b.min[1]).toFixed(3),
      };
    }
  }
  // Contrôle d'échelle : Poly Haven fournit les dimensions réelles (mm, [x, y, z] Blender, z vertical).
  const ph = info.dimensions ?? null;
  if (ph && !spec.nodes) {
    const expH = ph[2]! / 1000;
    if (Math.abs(dims.height - expH) > 0.1 * expH + 0.05) warnings.push(`hauteur ${dims.height} m ≠ ${expH.toFixed(2)} m annoncés par Poly Haven`);
  }
  const asset: CatalogAsset = {
    id: spec.id,
    nameFr: spec.nameFr,
    category: spec.category,
    lods: files.map((file, i) => ({
      file,
      maxDistance: i === 0 ? spec.lodDistances[0] : i === 1 ? spec.lodDistances[1] : 1e9,
      triangles: lodTriangles[i],
    })),
    dimensions: dims,
    footprint: { tilesX: 0, tilesZ: 0 },
    cost: spec.cost ?? 0,
    upkeepPerMonth: 0,
    capacity: { residents: 0, jobs: 0 },
    frontage: [],
    variants: variantsFor(spec),
    textureSets: [],
    license: { spdx: 'CC0-1.0', source: phPageUrl(spec.ph), author: authorsOf(info) },
    tags: ['polyhaven', ...spec.tags],
  };
  const built: BuiltModel = { asset, report: { lodTriangles, lodBytes, phDimensions: ph, warnings } };
  mkdirSync(join(CACHE_DIR, 'built'), { recursive: true });
  writeFileSync(stampFile, JSON.stringify({ hash, built }, null, 1));
  return built;
}
