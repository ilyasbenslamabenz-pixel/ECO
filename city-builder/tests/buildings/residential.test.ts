/**
 * Tests de la bibliothèque résidentielle : nombre et diversité des modèles, anti-placeholder,
 * LOD, empreinte, métadonnées, variantes, et fragment de catalogue produit (assets/catalog.buildings.residential.json).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MIN_TRIANGLES_LOD0, validateCatalog, type AssetCatalog, type CatalogAsset, type TextureSet } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';
import { buildLods, KIT_TEXTURES } from '../../tools/buildings/kit/index';
import { RESIDENTIAL, RESIDENTIAL_FRAGMENT } from '../../tools/buildings/residential/index';

const root = join(import.meta.dirname, '..', '..');
const assetsDir = join(root, 'assets');
const catalog = JSON.parse(readFileSync(join(assetsDir, 'catalog.json'), 'utf8')) as AssetCatalog;
const knownSets = new Set([...catalog.textureSets.map((t) => t.id), ...KIT_TEXTURES.map((t) => t.id)]);

test('au moins 15 bâtiments résidentiels distincts, répartis comme demandé', () => {
  const ids = RESIDENTIAL.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants en double');
  assert.ok(RESIDENTIAL.length >= 15, `${RESIDENTIAL.length} bâtiments`);
  const by = (c: string): number => RESIDENTIAL.filter((d) => d.category === c).length;
  assert.ok(by('house') >= 5, 'maisons individuelles < 5');
  assert.ok(new Set(RESIDENTIAL.filter((d) => d.category === 'house').map((d) => d.style)).size >= 5, 'moins de 5 styles de maisons');
  assert.ok(by('townhouse') >= 2, 'mitoyennes < 2');
  assert.ok(by('apartment_low') >= 2, 'petits immeubles < 2');
  const mid = RESIDENTIAL.filter((d) => d.category === 'apartment_mid');
  assert.ok(mid.length >= 2 && mid.every((d) => d.jobs > 0 && d.tags?.includes('commerces')), 'immeubles moyens à commerces < 2');
  const high = RESIDENTIAL.filter((d) => d.category === 'apartment_high');
  assert.ok(high.filter((d) => d.tags?.includes('tour')).length >= 2, 'tours < 2');
  assert.ok(high.filter((d) => !d.tags?.includes('tour')).length >= 2, 'haute densité (barres) < 2');
});

for (const def of RESIDENTIAL) {
  test(`${def.id} : géométrie détaillée, LOD décroissants, empreinte, matériaux texturés`, () => {
    const lods = buildLods(def);
    const t = lods.map((mb) => mb.triangles());
    assert.ok(t[0]! >= MIN_TRIANGLES_LOD0[def.category] * 3, `LOD0 ${t[0]} triangles : trop peu détaillé`);
    assert.ok(t[1]! < t[0]! && t[2]! < t[1]!, `LOD non décroissants ${t}`);
    assert.ok(t[2]! <= t[0]! * 0.4, `LOD2 trop lourd (${t[2]} / ${t[0]})`);
    const b = lods[0]!.bounds();
    const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
    assert.ok(w <= def.footprint.tilesX * TILE_SIZE + 0.5 && d <= def.footprint.tilesZ * TILE_SIZE + 0.5, `${w}×${d} hors empreinte`);
    assert.ok(Math.abs((b.min[0] + b.max[0]) / 2) < 1e-6 && Math.abs((b.min[2] + b.max[2]) / 2) < 1e-6 && Math.abs(b.min[1]) < 1e-6, 'non recentré');
    assert.ok(h > 3, 'trop bas');
    // anti-boîte : de nombreuses orientations de faces et plusieurs matériaux
    const normals = new Set<string>();
    let textured = 0;
    let total = 0;
    for (const [role, p] of lods[0]!.prims) {
      const m = def.palette[role];
      assert.ok(m, `rôle ${role} hors palette`);
      if (m.set) assert.ok(knownSets.has(m.set), `jeu de textures inconnu ${m.set}`);
      const n = p.idx.length / 3;
      total += n;
      if (m.set) textured += n;
      for (let i = 0; i < p.nor.length; i += 3) normals.add(p.nor.slice(i, i + 3).map((x) => x.toFixed(2)).join(','));
    }
    assert.ok(lods[0]!.prims.size >= 6, `seulement ${lods[0]!.prims.size} matériaux`);
    assert.ok(normals.size >= 12, `seulement ${normals.size} orientations de faces`);
    assert.ok(textured / total >= 0.6, `${((100 * textured) / total).toFixed(0)} % de triangles texturés`);
    assert.ok(lods[0]!.prims.has('verre'), 'aucun vitrage');
  });

  test(`${def.id} : métadonnées et variantes`, () => {
    assert.ok(def.cost > 0 && def.upkeepPerMonth > 0 && def.residents > 0, 'coût / entretien / habitants');
    assert.ok(def.nameFr.length > 5 && /^[a-z0-9_]+$/.test(def.id));
    assert.ok(def.variants.length >= 3, 'moins de 3 variantes');
    assert.equal(new Set(def.variants.map((v) => v.id)).size, def.variants.length);
    for (const v of def.variants) {
      for (const [role, o] of Object.entries(v.materialOverrides ?? {})) {
        assert.ok(def.palette[role], `variante ${v.id} : rôle ${role} inconnu`);
        if (o.textureSet) assert.ok(knownSets.has(o.textureSet), `variante ${v.id} : ${o.textureSet} inconnu`);
        if (o.color) assert.match(o.color, /^#[0-9a-f]{6}$/i);
      }
      if (v.heightScale !== undefined) assert.ok(v.heightScale >= 0.6 && v.heightScale <= 1.6);
    }
    assert.ok(def.source.startsWith('tools/buildings/residential/') && def.source.includes('#'));
  });
}

const fragPath = join(assetsDir, RESIDENTIAL_FRAGMENT);
test('fragment de catalogue : valide une fois fusionné, GLB présents, bornes = dimensions, triangles exacts', { skip: !existsSync(fragPath) && 'fragment non généré (npx tsx tools/buildings/residential/build.ts)' }, async () => {
  const frag = JSON.parse(readFileSync(fragPath, 'utf8')) as { assets: CatalogAsset[]; textureSets: TextureSet[] };
  assert.equal(frag.assets.length, RESIDENTIAL.length, 'fragment désynchronisé : relancer le générateur');
  const merged: AssetCatalog = { ...catalog, assets: [...catalog.assets.filter((a) => !frag.assets.some((f) => f.id === a.id)), ...frag.assets], textureSets: [...catalog.textureSets, ...frag.textureSets.filter((t) => !catalog.textureSets.some((c) => c.id === t.id))] };
  const issues = validateCatalog(merged).filter((i) => frag.assets.some((a) => a.id === i.assetId) || frag.textureSets.some((t) => t.id === i.assetId));
  assert.deepEqual(issues, []);
  for (const a of frag.assets) {
    assert.ok(a.frontage.some((f) => f.kind === 'pedestrian' && f.nz === 1), `${a.id} : pas d'entrée côté rue`);
    for (const f of a.frontage) {
      assert.ok(Math.abs(f.x) <= a.dimensions.width / 2 + 0.6 && Math.abs(f.z) <= a.dimensions.depth / 2 + 0.6, `${a.id} : accès ${f.kind} hors du bâtiment (${f.x}, ${f.z})`);
      assert.ok(Math.abs(Math.hypot(f.nx, f.nz) - 1) < 1e-6);
    }
    assert.ok(a.tags.some((t) => t.startsWith('densite:')) && a.tags.some((t) => t.startsWith('style:')), `${a.id} : tags densité/style`);
  }
  for (const t of frag.textureSets) for (const f of [t.albedo, t.normal, t.arm]) assert.ok(f && existsSync(join(assetsDir, f)), `texture manquante ${f}`);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const a of frag.assets) {
    for (const [i, l] of a.lods.entries()) {
      const p = join(assetsDir, l.file);
      assert.ok(existsSync(p), `${l.file} manquant`);
      const doc = await io.read(p);
      let tri = 0;
      for (const m of doc.getRoot().listMeshes()) for (const pr of m.listPrimitives()) tri += pr.getIndices()!.getCount() / 3;
      assert.equal(tri, l.triangles, `${a.id} LOD${i} triangles`);
      if (i === 0) {
        const b = getBounds(doc.getRoot().listScenes()[0]!);
        const dims = [b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!, b.max[2]! - b.min[2]!];
        assert.ok(Math.abs(dims[0]! - a.dimensions.width) < 0.05 && Math.abs(dims[1]! - a.dimensions.height) < 0.05 && Math.abs(dims[2]! - a.dimensions.depth) < 0.05, `${a.id} : bornes ${dims} ≠ ${JSON.stringify(a.dimensions)}`);
        assert.ok(b.min[1]! > -0.01 && b.min[1]! < 0.01, `${a.id} : base à ${b.min[1]}`);
        const mats = doc.getRoot().listMaterials();
        assert.ok(mats.filter((m) => m.getBaseColorTexture() && m.getNormalTexture()).length >= 5, `${a.id} : matériaux PBR texturés insuffisants`);
        for (const t of doc.getRoot().listTextures()) assert.ok((t.getSize()?.[0] ?? 0) >= 256, `${a.id} : texture ${t.getURI()} non décodée`);
      }
    }
  }
  // aucun fichier orphelin
  const files = readdirSync(join(assetsDir, 'buildings', 'residential')).filter((f) => f.endsWith('.glb'));
  assert.equal(files.length, frag.assets.length * 3);
});
