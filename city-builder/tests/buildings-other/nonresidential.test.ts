/**
 * Tests de la bibliothèque NON résidentielle (commerces, bureaux, gratte-ciel, industrie, équipements publics, parc) :
 * répartition demandée, anti-placeholder (triangles, matériaux, orientations de faces, part texturée), LOD,
 * empreinte, recentrage, métadonnées de jeu (coût, entretien, emplois, service), variantes, diversité des silhouettes,
 * déterminisme, briques complémentaires (police matricielle, points d'accès recentrés) et fragment de catalogue produit.
 *   npx tsx --test tests/buildings-other/*.test.ts
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
import { buildLods, KIT_TEXTURES, type BuildingDef } from '../../tools/buildings/kit/index';
import { NONRESIDENTIAL, OTHER_DIR, OTHER_FRAGMENT, withCenteredFrontage } from '../../tools/buildings/nonresidential/index';
import { GLYPHS, glyphRuns } from '../../tools/buildings/nonresidential/font';
import { litSeed } from '../../tools/buildings/nonresidential/parts';

const root = join(import.meta.dirname, '..', '..');
const assetsDir = join(root, 'assets');
const catalog = JSON.parse(readFileSync(join(assetsDir, 'catalog.json'), 'utf8')) as AssetCatalog;
const knownSets = new Set([...catalog.textureSets.map((t) => t.id), ...KIT_TEXTURES.map((t) => t.id)]);
const has = (d: BuildingDef, tag: string): boolean => d.tags?.includes(tag) ?? false;

test('au moins 17 bâtiments non résidentiels distincts, répartis comme demandé', () => {
  const ids = NONRESIDENTIAL.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants en double');
  assert.ok(NONRESIDENTIAL.length >= 17, `${NONRESIDENTIAL.length} bâtiments`);
  const shops = NONRESIDENTIAL.filter((d) => d.category === 'commercial' && has(d, 'commerce'));
  assert.ok(shops.length >= 5, `commerces : ${shops.length}`);
  for (const t of ['boulangerie', 'parking', 'terrasse', 'carburant', 'galerie_marchande']) assert.ok(shops.some((d) => has(d, t)), `commerce « ${t} » manquant`);
  const offices = NONRESIDENTIAL.filter((d) => has(d, 'bureaux'));
  assert.ok(offices.length >= 4, `bureaux / gratte-ciel : ${offices.length}`);
  assert.ok(NONRESIDENTIAL.filter((d) => d.category === 'skyscraper').length >= 3, 'gratte-ciel < 3');
  for (const t of ['mur_rideau', 'retraits', 'couronne']) assert.ok(offices.some((d) => has(d, t)), `tour « ${t} » manquante`);
  const indus = NONRESIDENTIAL.filter((d) => d.category === 'industrial');
  assert.ok(indus.length >= 4, `industrie : ${indus.length}`);
  for (const t of ['sheds', 'quais', 'eau', 'silos', 'atelier']) assert.ok(indus.some((d) => has(d, t)), `industrie « ${t} » manquante`);
  const pub = NONRESIDENTIAL.filter((d) => d.category === 'public');
  assert.ok(pub.filter((d) => !has(d, 'parc')).length >= 5, 'équipements publics < 5');
  for (const t of ['mairie', 'ecole', 'pompiers', 'police', 'hopital', 'musee', 'eglise', 'gare', 'parc']) assert.ok(pub.some((d) => has(d, t)), `public « ${t} » manquant`);
});

test('silhouettes variées : pas deux bâtiments aux dimensions quasi identiques', () => {
  const dims = NONRESIDENTIAL.map((d) => {
    const b = buildLods(d)[0]!.bounds();
    return { id: d.id, w: b.max[0] - b.min[0], d: b.max[2] - b.min[2], h: b.max[1] - b.min[1] };
  });
  for (let i = 0; i < dims.length; i++) for (let j = i + 1; j < dims.length; j++) {
    const a = dims[i]!, b = dims[j]!;
    const same = Math.abs(a.w - b.w) < 1 && Math.abs(a.d - b.d) < 1 && Math.abs(a.h - b.h) < 1;
    assert.ok(!same, `${a.id} et ${b.id} ont la même boîte englobante`);
  }
  const heights = dims.map((d) => d.h);
  assert.ok(Math.max(...heights) > 150 && Math.min(...heights) < 12, 'gamme de hauteurs trop étroite');
});

for (const def of NONRESIDENTIAL) {
  test(`${def.id} : géométrie détaillée, LOD décroissants, empreinte, matériaux texturés`, () => {
    const lods = buildLods(def);
    const t = lods.map((mb) => mb.triangles());
    assert.ok(t[0]! >= MIN_TRIANGLES_LOD0[def.category] * 3, `LOD0 ${t[0]} triangles : trop peu détaillé`);
    assert.ok(t[1]! < t[0]! && t[2]! < t[1]!, `LOD non décroissants ${t}`);
    assert.ok(t[2]! <= t[0]! * 0.4, `LOD2 trop lourd (${t[2]} / ${t[0]})`);
    assert.ok(t[0]! <= 40000, `LOD0 trop lourd (${t[0]})`);
    const b = lods[0]!.bounds();
    const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
    assert.ok(w <= def.footprint.tilesX * TILE_SIZE + 0.5 && d <= def.footprint.tilesZ * TILE_SIZE + 0.5, `${w}×${d} hors empreinte`);
    // le modèle occupe réellement son emprise (pas un petit objet perdu sur une grande case)
    assert.ok(w >= def.footprint.tilesX * TILE_SIZE * 0.8 && d >= def.footprint.tilesZ * TILE_SIZE * 0.8, `${w.toFixed(1)}×${d.toFixed(1)} : emprise sous-utilisée`);
    assert.ok(Math.abs((b.min[0] + b.max[0]) / 2) < 1e-6 && Math.abs((b.min[2] + b.max[2]) / 2) < 1e-6 && Math.abs(b.min[1]) < 1e-6, 'non recentré');
    assert.ok(h > 3, 'trop bas');
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
      for (const v of p.pos) assert.ok(Number.isFinite(v), `${role} : coordonnée non finie`);
    }
    assert.ok(lods[0]!.prims.size >= 8, `seulement ${lods[0]!.prims.size} matériaux`);
    assert.ok(normals.size >= 16, `seulement ${normals.size} orientations de faces`);
    assert.ok(textured / total >= 0.6, `${((100 * textured) / total).toFixed(0)} % de triangles texturés`);
    assert.ok([...lods[0]!.prims.keys()].some((k) => def.palette[k]?.kind === 'glass' || !def.palette[k]?.set), 'aucun vitrage');
  });

  test(`${def.id} : métadonnées de jeu, service et variantes`, () => {
    assert.ok(def.cost > 0 && def.upkeepPerMonth > 0 && def.jobs > 0, 'coût / entretien / emplois');
    assert.ok(def.nameFr.length > 5 && /^[a-z0-9_]+$/.test(def.id));
    assert.ok(def.tags?.some((t) => t.startsWith('service:')), 'tag service:… manquant');
    for (const t of def.tags ?? []) if (/^(rayon|capacite_service|attractivite|pollution):/.test(t)) assert.match(t, /:\d+$/);
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
    assert.ok(def.source.startsWith('tools/buildings/nonresidential/') && def.source.includes('#'));
  });
}

test('déterminisme : deux constructions donnent exactement la même géométrie', () => {
  for (const def of NONRESIDENTIAL.slice(0, 6)) {
    const a = buildLods(def), b = buildLods(def);
    for (let l = 0; l < 3; l++) {
      for (const [k, p] of a[l]!.prims) assert.deepEqual(p.pos, b[l]!.prims.get(k)!.pos, `${def.id} LOD${l} ${k}`);
    }
  }
});

test('police matricielle : glyphes 5 colonnes, lettres accentuées, segments cohérents', () => {
  for (const [ch, g] of Object.entries(GLYPHS)) {
    assert.ok(g.length === 7 || g.length === 9, `${ch} : ${g.length} lignes`);
    for (const row of g) assert.equal(row.length, 5, `${ch} : ligne « ${row} »`);
  }
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ÉÈÔÂ') assert.ok(ch in GLYPHS, `glyphe ${ch} manquant`);
  const runs = glyphRuns('H');
  assert.equal(runs.reduce((s, r) => s + r[1], 0), 17, 'H : 17 pixels');
  assert.ok(glyphRuns('É').some((r) => r[2] >= 7), 'accent au-dessus de la capitale');
  assert.deepEqual(glyphRuns('?'), [], 'caractère inconnu = espace');
});

test('graines d\'allumage déterministes dans [0, 1[', () => {
  for (let i = 0; i < 200; i++) {
    const s = litSeed(i, i * 3, 7);
    assert.ok(s >= 0 && s < 1);
    assert.equal(s, litSeed(i, i * 3, 7));
  }
});

test('points d\'accès déplacés avec le recentrage', () => {
  const def = NONRESIDENTIAL.find((d) => d.frontage && d.frontage.length > 0)!;
  const b = buildLods(def)[0]!.bounds();
  const c = withCenteredFrontage(def);
  const dx = -(b.min[0] + b.max[0]) / 2;
  assert.ok(Math.abs(c.frontage![0]!.x - (def.frontage![0]!.x + dx)) < 0.011);
});

const fragPath = join(assetsDir, OTHER_FRAGMENT);
test('fragment de catalogue : valide une fois fusionné, GLB présents, bornes = dimensions, triangles exacts, textures', { skip: !existsSync(fragPath) && 'fragment non généré (npx tsx tools/buildings/nonresidential/build.ts)' }, async () => {
  const frag = JSON.parse(readFileSync(fragPath, 'utf8')) as { assets: CatalogAsset[]; textureSets: TextureSet[] };
  assert.equal(frag.assets.length, NONRESIDENTIAL.length, 'fragment désynchronisé : relancer le générateur');
  const merged: AssetCatalog = { ...catalog, assets: [...catalog.assets.filter((a) => !frag.assets.some((f) => f.id === a.id)), ...frag.assets], textureSets: [...catalog.textureSets, ...frag.textureSets.filter((t) => !catalog.textureSets.some((c) => c.id === t.id))] };
  const issues = validateCatalog(merged).filter((i) => frag.assets.some((a) => a.id === i.assetId));
  assert.deepEqual(issues, []);
  for (const a of frag.assets) {
    assert.ok(a.frontage.length > 0, `${a.id} : aucun accès`);
    for (const f of a.frontage) {
      assert.ok(Math.abs(f.x) <= a.dimensions.width / 2 + 0.6 && Math.abs(f.z) <= a.dimensions.depth / 2 + 0.6, `${a.id} : accès ${f.kind} hors du bâtiment (${f.x}, ${f.z})`);
      assert.ok(Math.abs(Math.hypot(f.nx, f.nz) - 1) < 1e-6);
    }
    assert.equal(a.license.spdx, 'CC0-1.0');
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  let bytes = 0;
  for (const a of frag.assets) {
    for (const [i, l] of a.lods.entries()) {
      const p = join(assetsDir, l.file);
      assert.ok(existsSync(p), `${l.file} manquant`);
      bytes += readFileSync(p).length;
      const doc = await io.read(p);
      let tri = 0;
      for (const m of doc.getRoot().listMeshes()) for (const pr of m.listPrimitives()) tri += pr.getIndices()!.getCount() / 3;
      assert.equal(tri, l.triangles, `${a.id} LOD${i} triangles`);
      if (i === 0) {
        const b = getBounds(doc.getRoot().listScenes()[0]!);
        const dims = [b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!, b.max[2]! - b.min[2]!];
        assert.ok(Math.abs(dims[0]! - a.dimensions.width) < 0.05 && Math.abs(dims[1]! - a.dimensions.height) < 0.05 && Math.abs(dims[2]! - a.dimensions.depth) < 0.05, `${a.id} : bornes ${dims} ≠ ${JSON.stringify(a.dimensions)}`);
        const mats = doc.getRoot().listMaterials();
        assert.ok(mats.filter((m) => m.getBaseColorTexture() && m.getNormalTexture()).length >= 6, `${a.id} : matériaux PBR texturés insuffisants`);
        for (const t of doc.getRoot().listTextures()) assert.ok((t.getSize()?.[0] ?? 0) >= 256, `${a.id} : texture ${t.getURI()} non décodée`);
      }
    }
  }
  assert.ok(bytes < 12 * 1048576, `poids total ${(bytes / 1048576).toFixed(1)} Mo > 12 Mo`);
  const files = readdirSync(join(assetsDir, OTHER_DIR)).filter((f) => f.endsWith('.glb'));
  assert.equal(files.length, frag.assets.length * 3, 'fichiers GLB orphelins');
});
