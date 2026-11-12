/**
 * Tests du kit modulaire de bâtiments (tools/buildings/kit) : orientation des faces, transformations,
 * triangulation, murs percés, écriture GLB (relue par gltf-transform, comme les validateurs du pipeline).
 * Lancer : npx tsx --test tests/buildings/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import type { AssetCatalog } from '../../src/shared/catalog';
import {
  basePalette, frameRing, MeshBuilder, reveals, sideFrame, triangulate, wall, writeGlb, type Ctx, type PrimData, type UvMode,
} from '../../tools/buildings/kit/index';

const root = join(import.meta.dirname, '..', '..');

function builder(): MeshBuilder {
  const pal = basePalette();
  const uv: Record<string, UvMode> = {};
  for (const [k, m] of Object.entries(pal)) uv[k] = m.uv ?? 'meters';
  return new MeshBuilder(uv, new Set(['verre', 'verre_gc']));
}

/** Normales et centres de chaque triangle d'une primitive. */
function tris(p: PrimData): { n: number[]; c: number[]; area: number }[] {
  const out: { n: number[]; c: number[]; area: number }[] = [];
  for (let i = 0; i < p.idx.length; i += 3) {
    const [a, b, c] = [p.idx[i]!, p.idx[i + 1]!, p.idx[i + 2]!].map((k) => [p.pos[k * 3]!, p.pos[k * 3 + 1]!, p.pos[k * 3 + 2]!]) as [number[], number[], number[]];
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    out.push({ n: n.map((x) => x / l), c: [0, 1, 2].map((k) => (a[k]! + b[k]! + c[k]!) / 3), area: l / 2 });
  }
  return out;
}

test('box : toutes les faces sont orientées vers l’extérieur (normales géométriques et stockées)', () => {
  const mb = builder();
  mb.box('facade', -1, 0, -2, 3, 5, 2);
  const p = mb.prims.get('facade')!;
  assert.equal(p.idx.length / 3, 12);
  const center = [1, 2.5, 0];
  for (const t of tris(p)) {
    const d = t.c.map((x, k) => x - center[k]!);
    assert.ok(t.n[0]! * d[0]! + t.n[1]! * d[1]! + t.n[2]! * d[2]! > 0, `face mal orientée ${t.n}`);
  }
  // normale stockée = normale géométrique
  for (let i = 0; i < p.idx.length; i += 3) {
    const k = p.idx[i]!;
    const t = tris({ ...p, idx: [p.idx[i]!, p.idx[i + 1]!, p.idx[i + 2]!] })[0]!;
    assert.ok(Math.abs(p.nor[k * 3]! * t.n[0]! + p.nor[k * 3 + 1]! * t.n[1]! + p.nor[k * 3 + 2]! * t.n[2]! - 1) < 1e-6);
  }
});

test('push/pop : rotation Y conforme à three.js (+X tourne vers −Z pour +90°)', () => {
  const mb = builder();
  mb.push(10, 0, 0, Math.PI / 2);
  const p = mb.apply([1, 0, 0]);
  assert.ok(Math.abs(p[0] - 10) < 1e-9 && Math.abs(p[2] + 1) < 1e-9, `obtenu ${p}`);
  mb.push(0, 0, 1, 0);
  const q = mb.apply([0, 0, 0]);
  assert.ok(Math.abs(q[0] - 11) < 1e-9 && Math.abs(q[2]) < 1e-9, `obtenu ${q}`);
  mb.pop();
  mb.pop();
  assert.deepEqual(mb.apply([1, 2, 3]), [1, 2, 3]);
});

test('triangulation par oreilles : polygone en L (concave), aire conservée, triangles vers +Y', () => {
  const L: [number, number][] = [[0, 0], [4, 0], [4, -1], [1, -1], [1, -3], [0, -3]];
  const t = triangulate(L);
  assert.equal(t.length, 4);
  let area = 0;
  for (const [i, j, k] of t) {
    const a = L[i]!, b = L[j]!, c = L[k]!;
    // aire signée dans (x, -z)
    const s = ((b[0] - a[0]) * (-c[1] + a[1]) - (-b[1] + a[1]) * (c[0] - a[0])) / 2;
    assert.ok(s > 0, 'triangle retourné');
    area += s;
  }
  assert.ok(Math.abs(area - 6) < 1e-9, `aire ${area}`);
  // même résultat (aire) dans l'autre sens
  assert.equal(triangulate([...L].reverse()).length, 4);
});

test('mur percé : aire = mur − baies, aucune face dans les trous, normales vers l’extérieur', () => {
  const mb = builder();
  const ctx: Ctx = { mb, lod: 0, r: () => 0.5 };
  const f = sideFrame(-5, -3, 5, 3, 0, 6, 'E'); // façade +X : largeur 6 m
  const holes = [{ u0: 1, u1: 2.2, v0: 1, v1: 2.5 }, { u0: 3.5, u1: 5, v0: 0, v1: 2.2 }];
  wall(ctx, 'facade', f, holes);
  const ts = tris(mb.prims.get('facade')!);
  const area = ts.reduce((s, t) => s + t.area, 0);
  assert.ok(Math.abs(area - (36 - 1.2 * 1.5 - 1.5 * 2.2)) < 1e-6, `aire ${area}`);
  for (const t of ts) {
    assert.ok(t.n[0]! > 0.999, 'normale ≠ +X');
    const u = 3 - t.c[2]!; // u = z1 - z
    const v = t.c[1]!;
    for (const h of holes) assert.ok(!(u > h.u0 && u < h.u1 && v > h.v0 && v < h.v1), 'triangle dans une baie');
  }
});

test('tableaux et dormant : faces tournées vers le centre de la baie', () => {
  const mb = builder();
  const ctx: Ctx = { mb, lod: 0, r: () => 0.5 };
  const f = sideFrame(-5, -3, 5, 3, 0, 6, 'S');
  const r = { u0: 2, u1: 3.2, v0: 1, v1: 2.4 };
  reveals(ctx, 'facade', f, r, 0.2);
  frameRing(ctx, 'menuiserie', f, r, 0.06, -0.15, -0.1);
  const cx = -5 + 2.6;
  const cy = 1.7;
  for (const t of tris(mb.prims.get('facade')!)) {
    const d = [cx - t.c[0]!, cy - t.c[1]!];
    assert.ok(t.n[0]! * d[0]! + t.n[1]! * d[1]! > 0, 'tableau tourné vers l’extérieur de la baie');
  }
  for (const t of tris(mb.prims.get('menuiserie')!)) {
    if (Math.abs(t.n[2]!) > 0.99) { assert.ok(t.n[2]! > 0, 'face avant du dormant vers l’intérieur'); continue; }
    const d = [cx - t.c[0]!, cy - t.c[1]!];
    assert.ok(t.n[0]! * d[0]! + t.n[1]! * d[1]! > 0, 'retour de dormant mal orienté');
  }
});

test('UV en mètres : continuité entre faces coplanaires, orientation non miroir', () => {
  const mb = builder();
  mb.quad('facade', [0, 0, 1], [2, 0, 1], [2, 3, 1], [0, 3, 1]);
  mb.quad('facade', [2, 0, 1], [5, 0, 1], [5, 3, 1], [2, 3, 1]);
  const p = mb.prims.get('facade')!;
  // sommet (2,0,1) partagé : même UV dans les deux quads
  assert.deepEqual([p.uv[2], p.uv[3]], [p.uv[8], p.uv[9]]);
  // u croît vers la droite (vu de +Z), v (image) décroît vers le haut
  assert.ok(p.uv[2]! > p.uv[0]!);
  assert.ok(p.uv[7]! < p.uv[1]!);
});

test('writeGlb : relu par gltf-transform (textures externes, quantification, _LIT, bornes exactes)', async () => {
  const cat = JSON.parse(readFileSync(join(root, 'assets', 'catalog.json'), 'utf8')) as AssetCatalog;
  const sets = new Map(cat.textureSets.map((t) => [t.id, t]));
  const pal = basePalette({ facade: { set: 'enduit_blanc' }, toiture: { set: 'toit_tuiles' } });
  const mb = builder();
  mb.box('facade', -4, 0, -3, 4, 6, 3, 'ny');
  mb.box('toiture', -4.5, 6, -3.5, 4.5, 6.3, 3.5);
  mb.lit = 0.25;
  mb.quad('verre', [-1, 1, 3.01], [1, 1, 3.01], [1, 2, 3.01], [-1, 2, 3.01]);
  const dir = mkdtempSync(join(tmpdir(), 'kit-'));
  try {
    // le GLB est écrit dans assets/ pour que les URI relatives des textures se résolvent
    const file = join(root, 'assets', 'buildings', `__test_${process.pid}.glb`);
    const st = writeGlb(mb, pal, sets, file, join(root, 'assets'));
    assert.equal(st.triangles, 10 + 12 + 2);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(file);
    rmSync(file);
    const r = doc.getRoot();
    const b = getBounds(r.listScenes()[0]!);
    const exp = mb.bounds();
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(b.min[k]! - exp.min[k]!) < 0.003, `min[${k}] ${b.min[k]} ≠ ${exp.min[k]}`);
      assert.ok(Math.abs(b.max[k]! - exp.max[k]!) < 0.003, `max[${k}] ${b.max[k]} ≠ ${exp.max[k]}`);
    }
    const mats = r.listMaterials();
    assert.deepEqual(mats.map((m) => m.getName()).sort(), ['facade', 'toiture', 'verre']);
    const fac = mats.find((m) => m.getName() === 'facade')!;
    assert.ok(fac.getBaseColorTexture() && fac.getNormalTexture() && fac.getMetallicRoughnessTexture());
    const tex = fac.getBaseColorTexture()!;
    assert.ok((tex.getImage()?.byteLength ?? 0) > 1000, 'texture externe non résolue');
    assert.ok(tex.getURI().startsWith('../textures/'), tex.getURI());
    const glassPrim = r.listMeshes()[0]!.listPrimitives().find((p) => p.getMaterial()?.getName() === 'verre')!;
    const lit = glassPrim.getAttribute('_LIT');
    assert.ok(lit, '_LIT absent');
    assert.equal(lit.getScalar(0), 0.25);
    assert.equal(glassPrim.getAttribute('POSITION')!.getComponentType(), 5122);
    assert.ok(r.listExtensionsUsed().some((e) => e.extensionName === 'KHR_mesh_quantization'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
