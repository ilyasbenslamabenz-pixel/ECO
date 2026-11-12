/**
 * Inspection des assets dans le navigateur (porte de validation visuelle).
 * Appelée par tests/e2e/validate-visual.mjs via la page en mode ?validate.
 * Pour chaque asset du catalogue : chargement GLB réel, maillages, triangles,
 * boîte englobante, détection « boîte », textures décodées, rendu d'une vignette
 * et mesure de la couverture en pixels (l'objet est-il réellement visible ?).
 */
import * as THREE from 'three';
import { MIN_TRIANGLES_LOD0, isBuildingCategory, type CatalogAsset } from '../shared/catalog';
import type { AssetLibrary } from './assets';

export interface AssetReport {
  id: string;
  nameFr: string;
  category: string;
  ok: boolean;
  errors: string[];
  meshes: number;
  triangles: number;
  uniqueVertices: number;
  bbox: [number, number, number];
  materials: number;
  texturedTriangleRatio: number;
  texturesDecoded: number;
  normalMaps: number;
  pixelCoverage: number;
}

function imageSize(img: unknown): [number, number] {
  if (!img) return [0, 0];
  const o = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return [o.naturalWidth ?? o.width ?? 0, o.naturalHeight ?? o.height ?? 0];
}

export async function inspectAsset(lib: AssetLibrary, a: CatalogAsset): Promise<{ report: AssetReport; root: THREE.Object3D | null }> {
  const r: AssetReport = {
    id: a.id, nameFr: a.nameFr, category: a.category, ok: false, errors: [], meshes: 0, triangles: 0, uniqueVertices: 0,
    bbox: [0, 0, 0], materials: 0, texturedTriangleRatio: 0, texturesDecoded: 0, normalMaps: 0, pixelCoverage: 0,
  };
  let root: THREE.Object3D;
  try {
    root = await lib.load(a.id, 0);
  } catch (e) {
    r.errors.push(`chargement GLB impossible : ${e instanceof Error ? e.message : String(e)}`);
    return { report: r, root: null };
  }
  root.updateMatrixWorld(true);
  const mats = new Set<THREE.Material>();
  const uniq = new Set<string>();
  let texturedTris = 0;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    r.meshes++;
    const g = m.geometry;
    const tris = g.index ? g.index.count / 3 : g.attributes['position']!.count / 3;
    r.triangles += tris;
    const pos = g.attributes['position']!;
    for (let i = 0; i < pos.count && uniq.size < 5000; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      uniq.add(`${Math.round(v.x * 100)},${Math.round(v.y * 100)},${Math.round(v.z * 100)}`);
    }
    const list = Array.isArray(m.material) ? m.material : [m.material];
    let textured = false;
    for (const mat of list) {
      mats.add(mat);
      const sm = mat as THREE.MeshStandardMaterial;
      if (sm.map) textured = true;
    }
    if (textured) texturedTris += tris;
  });
  r.uniqueVertices = uniq.size;
  r.materials = mats.size;
  r.texturedTriangleRatio = r.triangles > 0 ? texturedTris / r.triangles : 0;
  for (const mat of mats) {
    const sm = mat as THREE.MeshStandardMaterial;
    for (const [slot, tex] of [['map', sm.map], ['normalMap', sm.normalMap], ['roughnessMap', sm.roughnessMap], ['metalnessMap', sm.metalnessMap], ['aoMap', sm.aoMap]] as const) {
      if (!tex) continue;
      const [w, h] = imageSize(tex.image);
      if (w < 4 || h < 4) r.errors.push(`texture ${slot} du matériau « ${mat.name} » non décodée (${w}x${h})`);
      else r.texturesDecoded++;
      if (slot === 'normalMap') r.normalMaps++;
    }
  }
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  r.bbox = [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)];

  const minTris = MIN_TRIANGLES_LOD0[a.category];
  if (r.meshes === 0) r.errors.push('aucun maillage');
  if (r.triangles < minTris) r.errors.push(`triangles ${r.triangles} < seuil ${minTris} (${a.category})`);
  if (r.uniqueVertices <= 24) r.errors.push('maillage réduit à une boîte (≤ 24 sommets distincts)');
  if (size.x < 0.05 || size.y < 0.05 || size.z < 0.05) r.errors.push('boîte englobante triviale');
  const d = a.dimensions;
  const tol = 0.25;
  if (Math.abs(size.x - d.width) > d.width * tol || Math.abs(size.y - d.height) > d.height * tol || Math.abs(size.z - d.depth) > d.depth * tol) {
    r.errors.push(`dimensions mesurées ${r.bbox.join('x')} ≠ catalogue ${d.width}x${d.height}x${d.depth} (±25 %)`);
  }
  if (r.texturesDecoded === 0) r.errors.push('aucune texture décodée');
  if (r.normalMaps === 0) r.errors.push('aucune normalMap');
  if (r.texturedTriangleRatio < 0.5) r.errors.push(`seulement ${(r.texturedTriangleRatio * 100).toFixed(0)} % des triangles texturés`);
  return { report: r, root };
}

/** Rend une vignette de l'objet ; renvoie la couverture (part des pixels non fond). */
export function renderThumbnail(renderer: THREE.WebGLRenderer, root: THREE.Object3D, size: number, env: THREE.Texture | null): number {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20242b);
  scene.environment = env;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const holder = new THREE.Group();
  holder.add(root.clone());
  scene.add(holder);
  const box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const radius = Math.max(0.5, s.length() / 2);
  const cam = new THREE.PerspectiveCamera(35, 1, radius / 50, radius * 20);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(17.5));
  cam.position.set(c.x + dist * 0.62, c.y + dist * 0.45, c.z + dist * 0.64);
  cam.lookAt(c);
  renderer.setSize(size, size, false);
  renderer.render(scene, cam);
  const gl = renderer.getContext();
  const px = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let cover = 0;
  for (let i = 0; i < px.length; i += 4) {
    const dr = Math.abs(px[i]! - 0x20), dg = Math.abs(px[i + 1]! - 0x24), db = Math.abs(px[i + 2]! - 0x2b);
    if (dr + dg + db > 24) cover++;
  }
  return cover / (size * size);
}

export interface ValidationResult {
  reports: AssetReport[];
  /** Planche-contact PNG en data URL. */
  contactSheet: string;
  buildingCount: number;
}

export async function validateAllAssets(lib: AssetLibrary, thumb = 192): Promise<ValidationResult> {
  const assets = lib.catalog.assets;
  const cols = Math.max(1, Math.ceil(Math.sqrt(assets.length * 1.4)));
  const rows = Math.max(1, Math.ceil(assets.length / cols));
  const label = 34;
  const sheet = document.createElement('canvas');
  sheet.width = cols * thumb;
  sheet.height = rows * (thumb + label);
  const g2 = sheet.getContext('2d')!;
  g2.fillStyle = '#14171c';
  g2.fillRect(0, 0, sheet.width, sheet.height);
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const reports: AssetReport[] = [];
  for (let k = 0; k < assets.length; k++) {
    const a = assets[k]!;
    const { report, root } = await inspectAsset(lib, a);
    if (root) {
      report.pixelCoverage = renderThumbnail(renderer, root, thumb, env);
      if (report.pixelCoverage < 0.02) report.errors.push(`objet quasi invisible en vignette (${(report.pixelCoverage * 100).toFixed(1)} % de pixels)`);
      const x = (k % cols) * thumb;
      const y = Math.floor(k / cols) * (thumb + label);
      g2.drawImage(canvas, x, y, thumb, thumb);
    }
    report.ok = report.errors.length === 0;
    const x = (k % cols) * thumb;
    const y = Math.floor(k / cols) * (thumb + label) + thumb;
    g2.fillStyle = report.ok ? '#d9e2ec' : '#ff6b6b';
    g2.font = '12px sans-serif';
    g2.fillText(`${a.nameFr}`.slice(0, 30), x + 4, y + 14);
    g2.fillStyle = '#8a96a3';
    g2.fillText(`${a.category} · ${report.triangles} tri`, x + 4, y + 28);
    reports.push(report);
  }
  pmrem.dispose();
  renderer.dispose();
  return {
    reports,
    contactSheet: sheet.toDataURL('image/png'),
    buildingCount: assets.filter((a) => isBuildingCategory(a.category)).length,
  };
}
