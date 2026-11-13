/**
 * Assets enveloppés en gzip au build (docs/COMPRESSION.md) : détection par en-tête, décompression native
 * (DecompressionStream) et repli fflate, fichiers non compressés passés tels quels, règle du gain minimal du build,
 * et lecture d'un GLB compressé par le chargeur du jeu (GLTFLoader + meshopt + gzip).
 * Lancer : npx tsx --test tests/unit/gzip-assets.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGltfLoader, gunzipIfNeeded, isGzip } from '../../src/render/gzip-assets';
// @ts-expect-error module JS du build, sans types
import { gzipIfWorth } from '../../scripts/optimize-glb.mjs';

const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

test('isGzip reconnaît l’en-tête gzip et seulement lui', () => {
  assert.equal(isGzip(gzipSync(Buffer.from('abc'))), true);
  assert.equal(isGzip(new TextEncoder().encode('glTF')), false);
  assert.equal(isGzip(new ArrayBuffer(0)), false);
});

test('gunzipIfNeeded : décompresse (natif puis repli fflate) et laisse passer le brut', async () => {
  const raw = new Uint8Array(50_000).map((_, i) => (i * 7) % 251);
  const gz = ab(gzipSync(raw, { level: 9 }));
  assert.deepEqual(new Uint8Array(await gunzipIfNeeded(gz)), raw);
  const native = globalThis.DecompressionStream;
  try {
    (globalThis as { DecompressionStream?: unknown }).DecompressionStream = undefined;
    assert.deepEqual(new Uint8Array(await gunzipIfNeeded(gz)), raw);
  } finally {
    (globalThis as { DecompressionStream?: unknown }).DecompressionStream = native;
  }
  const plain = ab(raw);
  assert.equal(await gunzipIfNeeded(plain), plain);
});

test('build : gzip gardé seulement s’il gagne au moins 10 %', () => {
  const text = Buffer.from('{"asset":{"version":"2.0"}}'.repeat(500));
  assert.equal(isGzip(gzipIfWorth(text)), true);
  const noise = Buffer.from(new Uint8Array(4096).map(() => Math.floor(Math.random() * 256)));
  assert.equal(gzipIfWorth(noise), noise);
});

test('le chargeur du jeu lit un GLB enveloppé en gzip comme le brut', async () => {
  const dir = 'assets/models/props';
  const file = readdirSync(dir).find((f) => f.endsWith('.glb'));
  assert.ok(file, 'aucun GLB de décor');
  const raw = readFileSync(join(dir, file));
  const loader = createGltfLoader();
  const parse = (buf: ArrayBuffer): Promise<number> => new Promise((ok, ko) => loader.parse(buf, '', (g) => {
    let n = 0;
    g.scene.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) n++; });
    ok(n);
  }, ko));
  // Images intégrées : on ne compare que la géométrie (pas de décodage d'image sous Node).
  const strip = (b: Buffer): ArrayBuffer => {
    const jl = b.readUInt32LE(12);
    const json = JSON.parse(b.subarray(20, 20 + jl).toString()) as { images?: unknown[]; textures?: unknown[]; materials?: Record<string, unknown>[] };
    delete json.images; delete json.textures;
    for (const m of json.materials ?? []) { delete m.pbrMetallicRoughness; delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; }
    let j = Buffer.from(JSON.stringify(json));
    j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
    const bin = b.subarray(20 + jl);
    const h = Buffer.alloc(20);
    h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + j.length + bin.length, 8);
    h.writeUInt32LE(j.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
    return ab(Buffer.concat([h, j, bin]));
  };
  const plain = strip(raw);
  const meshes = await parse(plain);
  assert.ok(meshes > 0);
  assert.equal(await parse(ab(gzipSync(Buffer.from(plain), { level: 9 }))), meshes);
});
