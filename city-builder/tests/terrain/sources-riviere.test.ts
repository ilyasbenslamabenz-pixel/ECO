/**
 * Sources de rivière (bord de la carte) et barrage hydroélectrique (src/sim/hydro, src/sim/power) : l'eau entre par
 * le bord et coule vers l'aval sur plusieurs jours ; le barrage produit selon chute × débit (0 sans débit) ; arrivées
 * des rivières de la carte identiques au rechargement ; rejeu d'une sauvegarde ; anciennes sauvegardes.
 *   npx tsx --test tests/terrain/sources-riviere.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { NO_WATER, type TerrainEdit } from '../../src/sim/terrain/index';
import { riverInlets } from '../../src/sim/hydro/system';
import { damPlantKw, DAM_PLANT_MAX_KW, damPlantUpkeepChf, FACILITY_SPECS } from '../../src/shared/power/model';
import { townCatalog } from '../sim/fixtures';
import { powerTown } from '../electricite/fixtures';

type Priv = { naturalHeights: Float32Array };

function sim(): Simulation {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed: 7, mapChunks: 8, startMoney: 500_000_000, cityName: 'Riviere-Test' });
  return s;
}

const idx = (s: Simulation, x: number, z: number): number => {
  const t = s.terrain!;
  return Math.round((z - t.originZ) / t.spacing) * t.samplesX + Math.round((x - t.originX) / t.spacing);
};
const nat = (s: Simulation, x: number, z: number): number => (s as unknown as Priv).naturalHeights[idx(s, x, z)]!;
const ws = (s: Simulation, x: number, z: number): number => s.terrain!.waterSurface[idx(s, x, z)]!;

/**
 * Vallée synthétique qui part du bord ouest de la carte (x = originX) et descend vers +x sur 300 m, fermée à l'aval
 * par un mur (l'eau s'accumule loin de l'arrivée) ; versants à 50 %. Préparation du test : relief écrit directement.
 */
function edgeValley(s: Simulation, cz: number, floor0 = 40): number {
  const t = s.terrain!;
  const x0 = t.originX;
  const N = (s as unknown as Priv).naturalHeights;
  for (let j = 0; j < t.samplesZ; j++) for (let i = 0; i < t.samplesX; i++) {
    const x = t.originX + i * t.spacing, z = t.originZ + j * t.spacing;
    if (x - x0 > 300 || Math.abs(z - cz) > 120) continue;
    const k = j * t.samplesX + i;
    let h = floor0 + (x0 + 300 - x) * 0.03 + 0.5 * Math.abs(z - cz);
    if (x > x0 + 260) h += (x - (x0 + 260)) * 3;
    N[k] = h; t.heights[k] = h; t.waterSurface[k] = NO_WATER;
  }
  return x0;
}

function carveValley(s: Simulation, cx: number, cz: number, floor0 = 40): void {
  const t = s.terrain!;
  const N = (s as unknown as Priv).naturalHeights;
  for (let j = 0; j < t.samplesZ; j++) for (let i = 0; i < t.samplesX; i++) {
    const x = t.originX + i * t.spacing, z = t.originZ + j * t.spacing;
    if (Math.abs(x - cx) > 200 || Math.abs(z - cz) > 150) continue;
    const k = j * t.samplesX + i;
    let h = floor0 + (cx + 200 - x) * 0.03 + 0.5 * Math.abs(z - cz);
    if (x < cx - 180) h += (cx - 180 - x) * 3;
    N[k] = h; t.heights[k] = h; t.waterSurface[k] = NO_WATER;
  }
}

test('source de rivière au bord : aimantée sur le bord, l\'eau entre et coule vers l\'aval sur plusieurs jours', () => {
  const s = sim();
  const cz = 0;
  const x0 = edgeValley(s, cz);
  // Clic à 30 m du bord : aimanté sur le bord ; loin du bord : refusé.
  const far = s.terrainEdit({ edit: { k: 'source', x: x0 + 200, z: cz, q: 40, e: 1 }, dryRun: true });
  assert.ok(!far.ok && /bord/.test(far.error.message), far.ok ? 'accepté' : far.error.message);
  const edit: TerrainEdit = { k: 'source', x: x0 + 30, z: cz, q: 40, e: 1 };
  const dry = s.terrainEdit({ edit, dryRun: true });
  assert.ok(dry.ok, dry.ok ? '' : dry.error.message);
  if (!dry.ok) return;
  assert.equal(dry.data.x, x0, 'aimantée sur le bord');
  assert.ok(dry.data.water && dry.data.water.areaM2 > 0, `aperçu : l'eau s'étend (${dry.data.water?.areaM2} m²)`);
  assert.ok(s.terrainEdit({ edit }).ok);
  assert.equal(s.hydro.edgeSourceCount, 1);
  assert.equal(s.hydro.plainSourceCount, 0);
  const down = x0 + 240;
  assert.equal(ws(s, x0 + 120, cz + 100), NO_WATER, 'versant sec');
  const levels: number[] = [];
  for (let d = 0; d < 3; d++) {
    for (let i = 0; i < 6 * 24; i++) s.tick(10);
    levels.push(ws(s, down, cz));
  }
  assert.ok(levels[0]! > nat(s, down, cz) + 0.05, `de l'eau en aval après un jour (${levels[0]} > ${nat(s, down, cz)})`);
  assert.ok(levels[2]! >= levels[0]!, `le niveau aval ne baisse pas (${levels.join(' → ')})`);
  console.log(`# mesure : niveau aval (sol ${nat(s, down, cz).toFixed(2)} m) après 1/2/3 jours : ${levels.map((l) => l.toFixed(2)).join(' / ')} m`);
});

test('production du barrage : proportionnelle à chute × débit, plafonnée ; 0 sans débit ni chute ; entretien', () => {
  const nom = FACILITY_SPECS.hydro.nominalKw;
  assert.equal(damPlantKw(0, 60, 'printemps'), 0);
  assert.equal(damPlantKw(10, 0, 'printemps'), 0);
  const a = damPlantKw(5, 20, 'printemps');
  assert.ok(a > 0);
  assert.ok(Math.abs(damPlantKw(10, 20, 'printemps') - 2 * a) < 1e-6, 'double chute → double puissance');
  assert.ok(Math.abs(damPlantKw(5, 40, 'printemps') - 2 * a) < 1e-6, 'double débit → double puissance');
  assert.equal(damPlantKw(500, 500, 'printemps'), DAM_PLANT_MAX_KW);
  assert.equal(damPlantUpkeepChf(0, 0), 0);
  assert.ok(damPlantUpkeepChf(10, 60) >= 1_000);
  assert.ok(nom > 0);
});

test('outil Barrage : sans débit, 0 MW et message ; avec source, MW prévus > 0 et barrage = centrale du réseau', () => {
  const { sim: s, elec } = powerTown();
  const cx = 250, cz = 330;
  carveValley(s, cx, cz, 45);
  const dam: TerrainEdit = { k: 'dam', ax: cx, az: cz - 90, bx: cx, bz: cz + 90, hh: 14 };
  const dry = s.terrainEdit({ edit: dam, dryRun: true });
  assert.ok(dry.ok, dry.ok ? '' : dry.error.message);
  if (!dry.ok) return;
  assert.equal(dry.data.water?.flowM3s, 0);
  assert.equal(dry.data.water?.powerMW, 0, 'aucun débit : 0 MW prévu');
  assert.ok(s.terrainEdit({ edit: dam }).ok);
  const ctx = (s as unknown as { plugins: { contextOf(id: string): unknown } }).plugins.contextOf('electricite')!;
  const sys = (elec as unknown as { systemOf?(c: unknown): unknown }).systemOf?.(ctx) ?? (elec as unknown as { system: unknown }).system;
  type F = { id: number; kind: string; dam?: boolean; damId?: number; siteOk: boolean; nominalKw: number };
  const scan = (): F[] => [...(sys as { scanFacilities(c: unknown): Map<number, F> }).scanFacilities(ctx).values()];
  assert.equal(scan().filter((f) => f.dam).length, 0, 'barrage sans débit : pas de centrale');
  // Source en amont : la retenue se remplit, le barrage produit.
  assert.ok(s.terrainEdit({ edit: { k: 'source', x: cx - 120, z: cz, q: 60 } }).ok);
  for (let i = 0; i < 200 * 6 && !(s.hydro.steady && !s.hydro.dirty); i++) s.tick(10);
  const m = s.hydro.service.damNear(cx, cz, 30)!;
  assert.ok(m.headM > 8 && m.flowM3s === 60, `chute ${m.headM} m, débit ${m.flowM3s} m³/s`);
  const dams = scan().filter((f) => f.dam);
  assert.equal(dams.length, 1, 'le barrage est une centrale');
  const f = dams[0]!;
  assert.ok(f.id < 0 && f.kind === 'hydro' && f.siteOk);
  const season = (ctx as { clock: { season: string } }).clock.season;
  const kw = (sys as { availableKw(c: unknown, f: unknown, w: number, sun: number): number }).availableKw(ctx, f, 0, 0);
  assert.ok(Math.abs(kw - damPlantKw(m.headM, m.flowM3s, season)) < 1e-6, `production ${kw} kW`);
  assert.ok(kw > 0);
  console.log(`# mesure : barrage de vallée : chute ${m.headM} m, débit ${m.flowM3s} m³/s → ${(kw / 1000).toFixed(1)} MW (${season}) ; aperçu à vide ${dry.data.water?.powerMW} MW`);
  // Centrale au pied du barrage : elle remplace la centrale de l'ouvrage (pas de double comptage).
  const pad = { x: cx + 44, z: cz + 44 };
  assert.ok(s.terrainEdit({ edit: { k: 'flatten', x: pad.x, z: pad.z, r: 34, s: 1 } }).ok);
  const pr = s.placeBuilding({ assetId: 'barrage', x: pad.x, z: pad.z, rot: 0 });
  assert.ok(pr.ok, pr.ok ? '' : pr.error.message);
  const after = scan().filter((o) => o.kind === 'hydro');
  assert.equal(after.length, 1, `une seule centrale hydro (${after.map((o) => o.id).join(', ')})`);
  assert.ok(after[0]!.id > 0 && after[0]!.damId === m.id);
});

test('rejeu : source de rivière et arrivées des rivières identiques après rechargement ; ancienne source inchangée', () => {
  const s = sim();
  const cz = 0;
  edgeValley(s, cz);
  const inlets = riverInlets(s.terrain!);
  assert.deepEqual(s.hydro.inlets, inlets);
  assert.ok(s.terrainEdit({ edit: { k: 'source', x: s.terrain!.originX + 20, z: cz, q: 30, e: 1 } }).ok);
  for (let i = 0; i < 40; i++) s.tick(10);
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.equal(save.terrainEdits[0].e, 1);
  const s2 = new Simulation();
  s2.setCatalog(townCatalog());
  const orig = (s2 as unknown as { replayEdit(e: TerrainEdit): void }).replayEdit.bind(s2);
  let carved = false;
  (s2 as unknown as { replayEdit(e: TerrainEdit): void }).replayEdit = (e) => { if (!carved) { edgeValley(s2, cz); carved = true; } orig(e); };
  assert.equal(s2.fromSave(save), null);
  assert.equal(s2.hydro.edgeSourceCount, 1);
  const a = s.terrain!.waterSurface, b = s2.terrain!.waterSurface;
  let diff = 0;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
  assert.equal(diff, 0, 'même surface d\'eau');
  // Ancienne sauvegarde : une source sans `e` reste une source ordinaire ; arrivées recalculées du terrain.
  const s3 = sim();
  assert.ok(s3.terrainEdit({ edit: { k: 'source', x: -450, z: 300, q: 20 } }).ok);
  const old = JSON.parse(JSON.stringify(s3.toSave()));
  const s4 = new Simulation();
  s4.setCatalog(townCatalog());
  assert.equal(s4.fromSave(old), null);
  assert.equal(s4.hydro.plainSourceCount, 1);
  assert.equal(s4.hydro.edgeSourceCount, 0);
  assert.deepEqual(s4.hydro.inlets, s3.hydro.inlets);
});

test('rivières de la carte : une arrivée par rivière, au bord quand la rivière touche le bord, débit > 0', () => {
  const s = sim();
  const t = s.terrain!;
  const inl = s.hydro.inlets;
  assert.ok(inl.length > 0 && inl.length <= t.rivers.length, `${inl.length} arrivées / ${t.rivers.length} rivières`);
  for (const o of inl) assert.ok(o.q > 0 && o.auto && o.id < 0);
  // Un barrage sur la rivière : son débit vient de l'arrivée suivie vers l'aval.
  const r = t.rivers[0]!;
  const P = r.points;
  const v = 18;
  const x = P[v * 4]!, z = P[v * 4 + 2]!;
  const dx = P[(v + 1) * 4]! - x, dz = P[(v + 1) * 4 + 2]! - z, L = Math.hypot(dx, dz);
  const nx = -dz / L, nz = dx / L;
  // Préparation (comme tests/terrain/eau-dynamique.test.ts) : versants hauts autour du cours amont, lit intact.
  const N = (s as unknown as Priv).naturalHeights;
  for (let k = 0; k < N.length; k++) {
    const px = t.originX + (k % t.samplesX) * t.spacing, pz = t.originZ + Math.floor(k / t.samplesX) * t.spacing;
    if (px < x - 160 || px > x + 160 || pz < z - 230 || pz > z + 20) continue;
    if (t.waterSurface[k]! > N[k]! + 0.05) continue;
    N[k] = Math.max(N[k]!, 40); t.heights[k] = N[k]!;
  }
  const dry = s.terrainEdit({ edit: { k: 'dam', ax: x - nx * 30, az: z - nz * 30, bx: x + nx * 30, bz: z + nz * 30, hh: 6 }, dryRun: true });
  assert.ok(dry.ok, dry.ok ? '' : dry.error.message);
  if (dry.ok) {
    assert.ok((dry.data.water?.flowM3s ?? 0) > 0, `débit ${dry.data.water?.flowM3s} m³/s`);
    console.log(`# mesure : barrage sur la rivière 0 : chute ${dry.data.water?.headM} m, débit ${dry.data.water?.flowM3s} m³/s, ${dry.data.water?.powerMW} MW (${dry.data.water?.season})`);
  }
});
