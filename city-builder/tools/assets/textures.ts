/**
 * Jeux de textures PBR et HDRI Poly Haven -> assets/textures/<id>/ et assets/hdri/.
 * Sources 1k JPEG (albedo, normale OpenGL, ARM = AO/Roughness/Metalness empaquetés),
 * réencodées en WebP (albedo et normale 1024 px, ARM 512 px). Rien n'est réencodé si
 * la sortie est plus récente que la source en cache.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { HdriEntry, TextureSet } from '../../src/shared/catalog';
import { authorsOf, CACHE_DIR, cachedFile, getFiles, getInfo, phPageUrl } from './polyhaven';
import type { HdriSpec, TextureSpec } from './selection';

function fresh(out: string, src: string): boolean {
  return existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;
}

/** Réglages d'encodage mémorisés : changer la taille ou la qualité force le réencodage. */
const STAMP_DIR = join(CACHE_DIR, 'built', 'textures');
function stampOk(out: string, settings: string): boolean {
  const f = join(STAMP_DIR, `${out.replace(/[^a-z0-9_.-]+/gi, '_')}.txt`);
  return existsSync(f) && readFileSync(f, 'utf8') === settings;
}
function writeStamp(out: string, settings: string): void {
  mkdirSync(STAMP_DIR, { recursive: true });
  writeFileSync(join(STAMP_DIR, `${out.replace(/[^a-z0-9_.-]+/gi, '_')}.txt`), settings);
}

async function encode(src: string, out: string, size: number, quality: number): Promise<void> {
  const settings = `webp ${size} q${quality}`;
  if (fresh(out, src) && stampOk(out, settings)) return;
  await sharp(src)
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    .webp({ quality, smartSubsample: true, effort: 5 })
    .toFile(out);
  writeStamp(out, settings);
}

export async function buildTextureSet(spec: TextureSpec, assetsDir: string): Promise<TextureSet> {
  const [files, info] = await Promise.all([getFiles(spec.ph), getInfo(spec.ph)]);
  const pick = (map: string): string => {
    const f = files[map]?.['1k']?.['jpg'];
    if (!f) throw new Error(`${spec.ph} : carte ${map} 1k jpg introuvable sur Poly Haven`);
    return map;
  };
  const dir = join(assetsDir, 'textures', spec.id);
  mkdirSync(dir, { recursive: true });
  const size = spec.size ?? 1024;
  const src = {
    albedo: await cachedFile(files[pick('Diffuse')]!['1k']!['jpg']!, `textures/${spec.ph}/${spec.ph}_diff_1k.jpg`),
    normal: await cachedFile(files[pick('nor_gl')]!['1k']!['jpg']!, `textures/${spec.ph}/${spec.ph}_nor_gl_1k.jpg`),
    arm: await cachedFile(files[pick('arm')]!['1k']!['jpg']!, `textures/${spec.ph}/${spec.ph}_arm_1k.jpg`),
  };
  const rel = (k: string): string => `textures/${spec.id}/${spec.id}_${k}.webp`;
  await encode(src.albedo, join(assetsDir, rel('albedo')), size, 82);
  await encode(src.normal, join(assetsDir, rel('normal')), size, 80);
  await encode(src.arm, join(assetsDir, rel('arm')), Math.max(256, size / 2), 85);
  // Poly Haven : dimensions réelles en mm [largeur, hauteur].
  const tileSizeM = info.dimensions?.[0] ? Math.round(info.dimensions[0]) / 1000 : 2;
  return {
    id: spec.id,
    nameFr: spec.nameFr,
    albedo: rel('albedo'),
    normal: rel('normal'),
    arm: rel('arm'),
    tileSizeM,
    license: { spdx: 'CC0-1.0', source: phPageUrl(spec.ph), author: authorsOf(info) },
  };
}

export async function buildHdri(spec: HdriSpec, assetsDir: string): Promise<HdriEntry> {
  const [files, info] = await Promise.all([getFiles(spec.ph), getInfo(spec.ph)]);
  const f = files['hdri']?.['1k']?.['hdr'];
  if (!f) throw new Error(`${spec.ph} : HDRI 1k .hdr introuvable`);
  const src = await cachedFile(f, `hdri/${spec.ph}_1k.hdr`);
  const rel = `hdri/${spec.id}_1k.hdr`;
  const out = join(assetsDir, rel);
  mkdirSync(join(assetsDir, 'hdri'), { recursive: true });
  if (!fresh(out, src)) copyFileSync(src, out);
  return { id: spec.id, nameFr: spec.nameFr, file: rel, license: { spdx: 'CC0-1.0', source: phPageUrl(spec.ph), author: authorsOf(info) } };
}
