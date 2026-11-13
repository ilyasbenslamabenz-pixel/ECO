/**
 * Générateur de quartiers (src/sim/districts/**) : déterminisme, six types, lots valides (hors voies, sans
 * chevauchement), diversité mesurée, profils distincts, application réelle dans une `Simulation`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../../src/sim/world';
import { TILE_SIZE } from '../../src/shared/constants';
import { halfWidth } from '../../src/sim/roads/types';
import type { AssetCatalog } from '../../src/shared/catalog';
import {
  applyPlan, DISTRICT_TYPES, generateDistrict, measureDiversity, type DistrictActions, type DistrictPlan, type DistrictType,
} from '../../src/sim/districts/index';

const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'assets', 'catalog.json'), 'utf8')) as AssetCatalog;

function plan(type: DistrictType, seed = 7, over: Partial<{ x: number; z: number; width: number; depth: number; rot: number }> = {}): DistrictPlan {
  return generateDistrict({ type, seed, x: over.x ?? 0, z: over.z ?? 0, width: over.width ?? 320, depth: over.depth ?? 240, ...(over.rot === undefined ? {} : { rot: over.rot }) }, catalog);
}

/** Adaptateur Simulation -> DistrictActions (les opérations exactes du joueur). */
function actionsOf(s: Simulation): DistrictActions {
  return {
    buildRoad: (a) => s.buildRoad(a),
    placeBuilding: (a) => s.placeBuilding(a),
    demolish: (a) => s.demolish(a),
  };
}

test('quartiers : déterminisme (même graine -> plan identique, graine différente -> plan différent)', () => {
  for (const t of DISTRICT_TYPES) {
    assert.deepEqual(plan(t, 42), plan(t, 42), t);
  }
  const a = plan('faubourg', 1);
  const b = plan('faubourg', 2);
  assert.notDeepEqual(a.lots, b.lots);
});

test('quartiers : les six types produisent routes, lots et équipements avec le catalogue du jeu', () => {
  for (const t of DISTRICT_TYPES) {
    const p = plan(t);
    assert.ok(p.stats.roads >= 8, `${t} : ${p.stats.roads} tronçons`);
    assert.ok(p.stats.lots >= 20, `${t} : ${p.stats.lots} lots`);
    assert.ok(p.stats.distinctAssets >= 5, `${t} : ${p.stats.distinctAssets} modèles distincts`);
    assert.ok(p.stats.roadLength > 500, `${t} : ${p.stats.roadLength} m de voirie`);
    for (const l of p.lots) {
      assert.ok(catalog.assets.some((a) => a.id === l.assetId), `${t} : modèle inconnu ${l.assetId}`);
      assert.ok(Number.isInteger(l.rot) && l.rot >= 0 && l.rot < 4, `${t} : rotation ${l.rot}`);
    }
  }
});

test('quartiers : lots sans chevauchement, à l\'écart des voies et dans l\'emprise', () => {
  for (const t of DISTRICT_TYPES) {
    const p = plan(t);
    const rects = p.lots.map((l) => {
      const a = catalog.assets.find((x) => x.id === l.assetId)!;
      const swap = l.rot % 2 === 1;
      const w = (swap ? a.footprint.tilesZ : a.footprint.tilesX) * TILE_SIZE;
      const d = (swap ? a.footprint.tilesX : a.footprint.tilesZ) * TILE_SIZE;
      return { x0: l.x - w / 2, x1: l.x + w / 2, z0: l.z - d / 2, z1: l.z + d / 2 };
    });
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!;
      assert.ok(r.x0 >= p.bounds.minX - 0.5 && r.x1 <= p.bounds.maxX + 0.5 && r.z0 >= p.bounds.minZ - 0.5 && r.z1 <= p.bounds.maxZ + 0.5,
        `${t} : lot hors de l'emprise`);
      for (let j = i + 1; j < rects.length; j++) {
        const q = rects[j]!;
        assert.ok(!(r.x0 < q.x1 - 0.02 && r.x1 > q.x0 + 0.02 && r.z0 < q.z1 - 0.02 && r.z1 > q.z0 + 0.02),
          `${t} : lots ${i} et ${j} se recouvrent`);
      }
      for (const road of p.roads) {
        const [ax, az, bx, bz] = road.points;
        const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx), sz0 = Math.min(az, bz), sz1 = Math.max(az, bz);
        const d = Math.hypot(Math.max(0, r.x0 - sx1, sx0 - r.x1), Math.max(0, r.z0 - sz1, sz0 - r.z1));
        assert.ok(d >= halfWidth(road.kind) + 0.4, `${t} : lot à ${d.toFixed(2)} m de l'axe d'une ${road.kind}`);
      }
    }
  }
});

test('quartiers : terrain contraignant — voies inondées écartées, lots toujours desservis', () => {
  const s = new Simulation();
  s.setCatalog(catalog);
  s.newGame({ seed: 12, mapChunks: 8, startMoney: 5e9, cityName: 'Rivière', terrain: { hydrology: 'lac', rivers: 1 } });
  const env = { heightAt: (x: number, z: number) => s.groundHeight(x, z), isWet: (x: number, z: number) => s.isWet(x, z) };
  const libre = generateDistrict({ type: 'faubourg', seed: 11, x: 160, z: -80, width: 320, depth: 240 }, catalog);
  const contraint = generateDistrict({ type: 'faubourg', seed: 11, x: 160, z: -80, width: 320, depth: 240 }, catalog, env);
  assert.ok(contraint.roads.length < libre.roads.length, 'des voies sont écartées par l\'eau');
  const rep = applyPlan(contraint, actionsOf(s));
  assert.equal(rep.roadsRefused, 0, `routes refusées : ${rep.errors.join(' | ')}`);
  assert.ok(rep.lotsOk >= contraint.lots.length * 0.95, `${rep.lotsOk}/${contraint.lots.length}`);
  let access = 0;
  for (let i = 0; i < s.buildings.count; i++) if (s.buildings.roadAccess[i]) access++;
  assert.equal(access, s.buildings.count, 'tous les bâtiments sont desservis');
  // Chaque lot référence la voie qu'il borde.
  for (const l of contraint.lots) assert.ok(l.road >= 0 && l.road < contraint.roads.length, `voie ${l.road}`);
});

test('quartiers : diversité mesurée sous le seuil de chaque type', () => {
  // Seuils : part moyenne de voisins (40 m) portant le même modèle.
  const seuils: Record<DistrictType, number> = {
    centre_historique: 0.3, faubourg: 0.3, pavillonnaire: 0.35, affaires: 0.3, activites: 0.4, grands_ensembles: 0.35,
  };
  for (const t of DISTRICT_TYPES) {
    const p = plan(t);
    assert.ok(p.stats.repetitionIndex <= seuils[t], `${t} : indice de répétition ${p.stats.repetitionIndex.toFixed(3)}`);
    assert.equal(p.stats.adjacentTwinRate, 0, `${t} : ${p.stats.adjacentTwinRate} de voisins contigus identiques`);
    assert.ok(p.stats.styles >= 3, `${t} : ${p.stats.styles} styles`);
  }
});

test('diversité : 1 sur une rangée de clones, 0 sur des modèles tous différents', () => {
  const clones = Array.from({ length: 10 }, (_, i) => ({ assetId: 'maison', variant: 0, x: i * 16, z: 0, size: 16 }));
  const d1 = measureDiversity(clones);
  assert.equal(d1.repetitionIndex, 1);
  assert.equal(d1.distinctAssets, 1);
  assert.equal(d1.adjacentTwinRate, 1);
  const uniques = Array.from({ length: 10 }, (_, i) => ({ assetId: `m${i}`, variant: 0, x: i * 16, z: 0, size: 16 }));
  const d2 = measureDiversity(uniques);
  assert.equal(d2.repetitionIndex, 0);
  assert.equal(d2.distinctAssets, 10);
  assert.ok(d2.entropy > 0.99);
});

test('quartiers : profils distincts (hauteur, densité, voirie)', () => {
  const aff = plan('affaires');
  const pav = plan('pavillonnaire');
  const gra = plan('grands_ensembles');
  const act = plan('activites');
  const centre = plan('centre_historique');
  assert.ok(aff.stats.meanHeight > pav.stats.meanHeight * 2, `affaires ${aff.stats.meanHeight} vs pavillonnaire ${pav.stats.meanHeight}`);
  assert.ok(gra.stats.meanHeight > pav.stats.meanHeight, 'grands ensembles plus hauts que le pavillonnaire');
  assert.ok(centre.stats.lots > act.stats.lots, 'centre historique plus dense que la zone d\'activités');
  assert.ok(centre.stats.roadLength > act.stats.roadLength, 'maille du centre plus fine que celle des activités');
  assert.ok(centre.roads.some((r) => r.kind === 'pedestrian'), 'rue piétonne dans le centre historique');
  assert.ok(aff.roads.some((r) => r.kind === 'boulevard'), 'boulevard dans le quartier d\'affaires');
  // Résidentiel vs activités : les habitants sont dans les quartiers d'habitation.
  assert.ok(gra.stats.residents > act.stats.residents, 'grands ensembles plus habités que la zone d\'activités');
  assert.ok(act.stats.jobs > pav.stats.jobs, 'emplois en zone d\'activités');
});

test('quartiers : rotation du rectangle (quarts de tour) et bornes de taille', () => {
  const p = plan('faubourg', 5, { rot: 1, width: 300, depth: 180 });
  assert.equal(p.rot, 1);
  // Rotation d'un quart de tour : l'enveloppe échange largeur et profondeur.
  assert.ok(Math.abs((p.bounds.maxX - p.bounds.minX) - 180) < 1, `${p.bounds.maxX - p.bounds.minX}`);
  assert.ok(Math.abs((p.bounds.maxZ - p.bounds.minZ) - 300) < 1);
  assert.ok(p.stats.lots > 10);
  const small = plan('faubourg', 5, { width: 10, depth: 10 });
  assert.equal(small.size[0], 96, 'taille minimale appliquée');
  assert.throws(() => generateDistrict({ type: 'inconnu' as DistrictType, seed: 1, x: 0, z: 0, width: 200, depth: 200 }, catalog), /Type de quartier inconnu/);
});

test('quartiers : un plan s\'exécute réellement dans la simulation (routes, bâtiments, accès route)', () => {
  const s = new Simulation();
  s.setCatalog(catalog);
  s.newGame({ seed: 99, mapChunks: 8, startMoney: 5e9, cityName: 'Quartiers', terrain: { hydrology: 'aucune', rivers: 0 } });
  const p = generateDistrict({ type: 'faubourg', seed: 11, x: 0, z: 0, width: 320, depth: 240 }, catalog, {
    heightAt: (x, z) => s.groundHeight(x, z),
    isWet: (x, z) => s.isWet(x, z),
  });
  const rep = applyPlan(p, actionsOf(s));
  assert.ok(rep.roadsOk >= p.roads.length * 0.9, `${rep.roadsOk}/${p.roads.length} tronçons construits : ${rep.errors.join(' | ')}`);
  const rate = rep.lotsOk / p.lots.length;
  assert.ok(rate >= 0.8, `${rep.lotsOk}/${p.lots.length} bâtiments posés (${(rate * 100).toFixed(0)} %) : ${rep.errors.join(' | ')}`);
  assert.equal(s.buildings.count, rep.lotsOk);
  let access = 0;
  for (let i = 0; i < s.buildings.count; i++) if (s.buildings.roadAccess[i]) access++;
  assert.ok(access / s.buildings.count >= 0.95, `${access}/${s.buildings.count} bâtiments avec accès route`);
  assert.ok(rep.cost > 0);
});
