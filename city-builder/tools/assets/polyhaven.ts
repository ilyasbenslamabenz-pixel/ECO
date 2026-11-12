/**
 * Client Poly Haven (API publique, assets CC0) avec cache disque.
 *  - API : https://api.polyhaven.com/{assets,info/<id>,files/<id>}
 *  - Fichiers : https://dl.polyhaven.org/...
 * Le cache vit dans `.cache/polyhaven/` (ignoré par git, jamais copié dans dist) :
 * un fichier téléchargé n'est jamais retéléchargé si sa taille (et son md5 quand l'API le fournit) correspond.
 * Téléchargement par `curl` (respecte HTTPS_PROXY) ; repli sur fetch() si curl est absent.
 * AUCUNE autre source que Poly Haven n'est contactée ici.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const POLYHAVEN_ALLOWED_HOSTS = ['api.polyhaven.com', 'dl.polyhaven.org', 'cdn.polyhaven.com'] as const;

export interface PhFile { url: string; size: number; md5?: string; include?: Record<string, PhFile> }
export interface PhInfo {
  name: string;
  type: number; // 0 = hdri, 1 = texture, 2 = model
  authors: Record<string, string>;
  date_published: number;
  categories: string[];
  tags: string[];
  polycount?: number;
  /** Dimensions en millimètres (modèles : [x, y, z] Blender, z = hauteur ; textures : [largeur, hauteur]). */
  dimensions?: number[];
}

const root = join(import.meta.dirname, '..', '..');
export const CACHE_DIR = join(root, '.cache', 'polyhaven');

let hasCurl: boolean | null = null;
function curlAvailable(): boolean {
  hasCurl ??= spawnSync('curl', ['--version'], { stdio: 'ignore' }).status === 0;
  return hasCurl;
}

function assertAllowed(url: string): void {
  const host = new URL(url).hostname;
  if (!(POLYHAVEN_ALLOWED_HOSTS as readonly string[]).includes(host)) {
    throw new Error(`Hôte non autorisé (seul Poly Haven est permis) : ${host}`);
  }
}

function md5(file: string): string {
  return createHash('md5').update(readFileSync(file)).digest('hex');
}

async function download(url: string, dest: string): Promise<void> {
  assertAllowed(url);
  if (process.env['POLYHAVEN_OFFLINE'] === '1') throw new Error(`POLYHAVEN_OFFLINE=1 et fichier absent du cache : ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  if (curlAvailable()) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = spawnSync('curl', ['-sSfL', '--retry', '3', '--connect-timeout', '20', '-o', tmp, url], { stdio: ['ignore', 'ignore', 'pipe'] });
      if (r.status === 0) { renameSync(tmp, dest); return; }
      if (attempt === 3) throw new Error(`curl a échoué (${r.status}) pour ${url} : ${r.stderr?.toString().trim()}`);
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  renameSync(tmp, dest);
}

/** JSON d'API mis en cache (rafraîchi si `refresh`). */
export async function apiJson<T>(path: string, refresh = false): Promise<T> {
  const file = join(CACHE_DIR, 'api', `${path.replace(/[^a-z0-9_.-]+/gi, '_')}.json`);
  if (refresh || !existsSync(file)) await download(`https://api.polyhaven.com/${path}`, file);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export const getInfo = (id: string): Promise<PhInfo> => apiJson<PhInfo>(`info/${id}`);
export const getFiles = (id: string): Promise<Record<string, Record<string, Record<string, PhFile>>>> => apiJson(`files/${id}`);

/** Télécharge (ou reprend du cache) un fichier ; renvoie le chemin local. */
export async function cachedFile(f: PhFile, localRel: string): Promise<string> {
  const dest = join(CACHE_DIR, localRel);
  if (existsSync(dest) && statSync(dest).size === f.size && (!f.md5 || md5(dest) === f.md5)) return dest;
  await download(f.url, dest);
  const size = statSync(dest).size;
  if (size !== f.size) throw new Error(`Taille inattendue pour ${f.url} : ${size} != ${f.size}`);
  if (f.md5 && md5(dest) !== f.md5) throw new Error(`md5 invalide pour ${f.url}`);
  return dest;
}

/** Télécharge un glTF et ses fichiers inclus (bin, textures) en respectant l'arborescence relative. */
export async function cachedGltf(id: string, res: string): Promise<string> {
  const files = await getFiles(id);
  const g = files['gltf']?.[res]?.['gltf'];
  if (!g) throw new Error(`${id} : pas de glTF ${res} sur Poly Haven`);
  const dir = `models/${id}_${res}`;
  for (const [rel, inc] of Object.entries(g.include ?? {})) await cachedFile(inc, `${dir}/${rel}`);
  return cachedFile(g, `${dir}/${id}_${res}.gltf`);
}

export function phPageUrl(id: string): string {
  return `https://polyhaven.com/a/${id}`;
}

export function authorsOf(info: PhInfo): string {
  return Object.keys(info.authors).join(', ');
}
