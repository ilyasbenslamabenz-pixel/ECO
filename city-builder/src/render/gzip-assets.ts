/**
 * Assets compressés gzip au build (scripts/optimize-glb.mjs, docs/COMPRESSION.md).
 *
 * Le build enveloppe en gzip les GLB et les HDRI de dist/assets quand le gain est réel, SANS changer leur nom :
 * le catalogue, les manifestes et les sauvegardes restent identiques. Le contenu est reconnu à son en-tête
 * (1f 8b) : un fichier non compressé (build --dev, sources, hébergeur qui aurait déjà décompressé) passe tel quel.
 *
 * Décompression : DecompressionStream natif (Chromium, Safari ≥ 16.4), sinon fflate (fourni par three).
 */
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { gunzipSync } from 'three/addons/libs/fflate.module.js';
import type * as THREE from 'three';

/** Vrai si le tampon commence par l'en-tête gzip (1f 8b 08). */
export function isGzip(data: ArrayBuffer | Uint8Array): boolean {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data, 0, Math.min(3, data.byteLength));
  return b.length >= 3 && b[0] === 0x1f && b[1] === 0x8b && b[2] === 0x08;
}

/** Décompresse un tampon gzip ; renvoie le tampon tel quel s'il n'est pas compressé. */
export async function gunzipIfNeeded(data: ArrayBuffer): Promise<ArrayBuffer> {
  if (!isGzip(data)) return data;
  if (typeof DecompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function') {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
      return await new Response(stream).arrayBuffer();
    } catch {
      // repli fflate ci-dessous
    }
  }
  const out = gunzipSync(new Uint8Array(data));
  return out.byteOffset === 0 && out.byteLength === out.buffer.byteLength ? (out.buffer as ArrayBuffer) : (out.slice().buffer as ArrayBuffer);
}

/** Télécharge un asset binaire et le décompresse si besoin. */
export async function fetchAssetBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} : ${url}`);
  return gunzipIfNeeded(await res.arrayBuffer());
}

/**
 * GLTFLoader qui accepte les GLB enveloppés en gzip. `load`/`loadAsync` passent par `parse` :
 * les chemins relatifs (textures partagées ../../textures/…) restent résolus depuis l'URL d'origine.
 */
export class GzipGLTFLoader extends GLTFLoader {
  override parse(data: ArrayBuffer | string, path: string, onLoad: (gltf: GLTF) => void, onError?: (event: ErrorEvent) => void): void {
    if (typeof data !== 'string' && isGzip(data)) {
      gunzipIfNeeded(data).then(
        (raw) => super.parse(raw, path, onLoad, onError),
        (e: unknown) => onError?.(e as ErrorEvent),
      );
      return;
    }
    super.parse(data, path, onLoad, onError);
  }
}

/** Chargeur GLB du jeu : meshopt (décodeur JS de three, sans WASM externe) + gzip. */
export function createGltfLoader(manager?: THREE.LoadingManager): GLTFLoader {
  return new GzipGLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
}

/** Charge un HDRI (Radiance .hdr), éventuellement enveloppé en gzip. */
export async function loadHdrTexture(url: string, type?: THREE.TextureDataType): Promise<THREE.DataTexture> {
  const loader = new HDRLoader();
  if (type !== undefined) loader.setDataType(type);
  const buf = await fetchAssetBuffer(url);
  const blobUrl = URL.createObjectURL(new Blob([buf]));
  try {
    return await loader.loadAsync(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
