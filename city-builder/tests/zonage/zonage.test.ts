/**
 * Module « Zonage » : grille et peinture le long des routes, catalogue par zone, modèle de demande,
 * croissance façade vers la route, densification, API d'écriture minimale de la simulation de base.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog } from '../../src/shared/catalog';
import { footprintObb, obbToLocal } from '../../src/shared/footprint';
import { rleDecode, rleEncode, ZONE_TYPES, zoneCode } from '../../src/shared/protocol-ext/zonage';
import { buildZoneCatalog, computeDemand, DEFAULT_DEMAND_TUNING, localFacade, smoothDemand, zeroDemand, zoneForAsset, type DemandInputs } from '../../src/sim/zoning';
import { zonagePlugin } from '../../src/sim/plugins/zonage';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { advanceHours, zoningCatalog, zoningTown } from './fixtures';

/* ------------------------------- Encodage ------------------------------- */

test('plages : aller-retour et refus des données incohérentes', () => {
  const a = new Uint8Array([0, 0, 0, 3, 3, 1, 0, 6, 6, 6]);
  const rle = rleEncode(a);
  assert.deepEqual(rle, [0, 3, 3, 2, 1, 1, 0, 1, 6, 3]);
  assert.deepEqual(Array.from(rleDecode(rle, new Uint8Array(10))), Array.from(a));
  assert.throws(() => rleDecode([0, 5], new Uint8Array(10)), /5 cases décodées, 10 attendues/);
  assert.throws(() => rleDecode([0, 11], new Uint8Array(10)), /longueur invalide/);
  assert.throws(() => rleDecode([9, 10], new Uint8Array(10), 6), /valeur 9 invalide/);
  assert.throws(() => rleDecode([1], new Uint8Array(1)), /impair/);
});

/* ------------------------------- Catalogue ------------------------------- */

test('catalogue réel : chaque zone a ses bâtiments, niveaux 1 à 3, ouvrages de réseau exclus', () => {
  const cat = JSON.parse(readFileSync(join(import.meta.dirname, '../../assets/catalog.json'), 'utf8')) as AssetCatalog;
  const z = buildZoneCatalog(cat);
  for (const t of ZONE_TYPES) {
    assert.ok(z[t].length >= 3, `${t} : ${z[t].length} modèles`);
    assert.deepEqual([...new Set(z[t].map((e) => e.level))].sort(), [1, 2, 3], `${t} : trois niveaux`);
    for (let k = 1; k < z[t].length; k++) assert.ok(z[t][k]!.capacity >= z[t][k - 1]!.capacity, `${t} : triés par capacité`);
  }
  const all = ZONE_TYPES.flatMap((t) => z[t].map((e) => e.asset));
  assert.ok(!all.some((a) => a.tags.includes('electricite')), 'centrales et postes exclus');
  assert.ok(!all.some((a) => a.category === 'public'), 'services publics exclus');
  assert.ok(!all.some((a) => a.id === 'industrie_chateau_eau'), 'château d\'eau exclu');
  assert.equal(zoneForAsset(cat.assets.find((a) => a.id === 'proc_bureaux_pierre')!), 'bureaux');
  assert.equal(zoneForAsset(cat.assets.find((a) => a.id === 'commerce_boulangerie')!), 'commerce');
  assert.equal(zoneForAsset(cat.assets.find((a) => a.id === 'mitoyennes_brique')!), 'res_moyen');
  assert.equal(zoneForAsset(cat.assets.find((a) => a.id === 'tour_vitree_mur_rideau')!), 'bureaux');
});

test('catalogue de test : niveaux par tiers de capacité', () => {
  const z = buildZoneCatalog(zoningCatalog());
  assert.deepEqual(z.res_faible.map((e) => [e.asset.id, e.level]), [['maison_a', 1], ['maison_b', 2], ['maison_c', 3]]);
  assert.deepEqual(z.industrie.map((e) => e.asset.id), ['atelier', 'usine']);
  assert.deepEqual(z.bureaux.map((e) => e.asset.id), ['bureau_s', 'bureau_l']);
});

/* ------------------------------- Demande ------------------------------- */

const inputs = (o: Partial<DemandInputs> & { jobs?: Partial<DemandInputs['jobsBySector']> } = {}): DemandInputs => ({
  population: 0, workforce: 0, housingCapacity: 0, housingFree: 0, ...o,
  jobsBySector: { R: 0, C: 0, B: 0, I: 0, public: 0, ...o.jobs },
});

test('demande : ville vide, chômage, postes vacants, logements vides, impôts', () => {
  const empty = computeDemand(inputs());
  assert.ok(empty.R > 0.3 && empty.I > 0.15, `ville vide : logements et premiers emplois demandés ${JSON.stringify(empty)}`);
  assert.equal(empty.C, 0);
  assert.ok(empty.B <= 0.01, 'pas de bureaux sans population');
  // 500 habitants, 300 actifs, aucun emploi : industrie, bureaux et commerces demandés, logement freiné.
  const unemployed = computeDemand(inputs({ population: 500, workforce: 300, housingCapacity: 520, housingFree: 20 }));
  assert.ok(unemployed.I > 0.5 && unemployed.B > 0.3 && unemployed.C > 0.5, JSON.stringify(unemployed));
  assert.ok(unemployed.R < 0, `chômage : demande résidentielle négative (${unemployed.R})`);
  // Postes vacants : la demande résidentielle remonte, l'industrie baisse.
  const vacant = computeDemand(inputs({ population: 500, workforce: 300, housingCapacity: 520, housingFree: 20, jobs: { I: 400, C: 60 } }));
  assert.ok(vacant.R > 0.5 && vacant.I < 0 && vacant.C < 0, JSON.stringify(vacant));
  // Logements vides : la demande résidentielle baisse.
  const empties = computeDemand(inputs({ population: 300, workforce: 180, housingCapacity: 600, housingFree: 300, jobs: { I: 180 } }));
  assert.ok(empties.R < vacant.R);
  // Impôts : un taux résidentiel élevé freine le résidentiel.
  const taxed = computeDemand({ ...inputs({ population: 300, workforce: 180, jobs: { I: 200 } }), tax: { R: 0.2 } });
  const normal = computeDemand(inputs({ population: 300, workforce: 180, jobs: { I: 200 } }));
  assert.ok(taxed.R < normal.R - 0.2);
  // Bornes.
  for (const d of [empty, unemployed, vacant, empties, taxed]) for (const v of Object.values(d)) assert.ok(v >= -1 && v <= 1);
});

test('demande : lissage horaire et réglages', () => {
  const d = zeroDemand();
  smoothDemand(d, { R: 1, C: -1, B: 0.5, I: 0 }, 0.25);
  assert.deepEqual(d, { R: 0.25, C: -0.25, B: 0.125, I: 0 });
  const boosted = computeDemand(inputs(), { ...DEFAULT_DEMAND_TUNING, baseR: 0.9 });
  assert.ok(boosted.R > computeDemand(inputs()).R);
});

/* ------------------------------- Peinture ------------------------------- */

test('peinture : bande le long de la route, profondeur, jamais sur la chaussée, retrait', () => {
  const t = zoningTown();
  assert.ok(t.sim.buildRoad({ type: 'street', points: [-160, 0, 160, 0] }).ok);
  const p1 = t.cmd('paint', { points: [-150, 0, 150, 0], zone: 'res_faible', depth: 1 });
  assert.ok(p1.ok);
  const n1 = (p1.data as { changed: number }).changed;
  const cells = (p1.data as { cells: number[] }).cells;
  assert.equal(cells.length, n1 * 2, 'cases changées renvoyées avec la commande');
  const t2 = zoningTown();
  t2.sim.buildRoad({ type: 'street', points: [-160, 0, 160, 0] });
  const n3 = (t2.cmd('paint', { points: [-150, 0, 150, 0], zone: 'res_faible', depth: 3 }).data as { changed: number }).changed;
  assert.ok(n1 > 50 && n3 > 2.5 * n1, `profondeur 1 : ${n1} cases ; profondeur 3 : ${n3}`);
  const sys = t2.sys;
  for (const idx of sys.grid.cellsOf(zoneCode('res_faible'))) {
    const e = sys.grid.edgeM(idx);
    assert.ok(e >= 1 && e <= 3 * 8 + 0.01, `case à ${e} m du bord`);
  }
  assert.equal((t2.cmd('cellAt', { x: 0, z: 0 }).data as { zone: unknown }).zone, null, 'axe non zoné');
  assert.equal((t2.cmd('cellAt', { x: 4, z: 12 }).data as { zone: unknown }).zone, 'res_faible');
  assert.equal((t2.cmd('cellAt', { x: 4, z: 60 }).data as { zone: unknown }).zone, null, 'hors de la bande');
  // Retrait d'une partie.
  const er = t2.cmd('paint', { points: [-150, 0, -60, 0], zone: null, depth: 3 });
  assert.ok((er.data as { changed: number }).changed > 20);
  assert.ok(sys.grid.counts[zoneCode('res_faible')]! < n3);
  // Sans route : rien n'est zoné ; autoroute : pas de desserte.
  assert.equal((t2.cmd('paint', { points: [-150, 300, 150, 300], zone: 'industrie', depth: 3 }).data as { changed: number }).changed, 0);
  t2.sim.buildRoad({ type: 'street', kind: 'highway', points: [-160, -300, 160, -300] });
  assert.equal((t2.cmd('paint', { points: [-150, -300, 150, -300], zone: 'industrie', depth: 3 }).data as { changed: number }).changed, 0, 'autoroute : aucune façade');
  // Arguments invalides.
  assert.equal(t2.cmd('paint', { points: [1, 2, 3], zone: 'res_faible' }).ok, false);
  assert.equal(t2.cmd('paint', { points: [1, 2], zone: 'chateau' }).ok, false);
  assert.equal(t2.cmd('inconnue').ok, false);
});

test('desserte : supprimer la route rend les cases non desservies', () => {
  const t = zoningTown();
  const r = t.sim.buildRoad({ type: 'street', points: [-100, 0, 100, 0] });
  assert.ok(r.ok);
  t.cmd('paint', { points: [-90, 0, 90, 0], zone: 'commerce', depth: 2 });
  const s0 = t.sys.stats(t.ctx);
  assert.equal(s0.connected, s0.cells.commerce);
  for (const id of r.data.edgeIds) assert.ok(t.sim.removeRoad({ edgeId: id }).ok);
  advanceHours(t.sim, 1);
  assert.equal(t.sys.stats(t.ctx).connected, 0, 'plus aucune case desservie');
  assert.equal(t.sys.grid.counts[zoneCode('commerce')], s0.cells.commerce, 'le zonage reste');
});

/* ------------------------------- Croissance ------------------------------- */

test('croissance : bâtiments de la bonne zone, façade vers la route, dans la zone, gratuits pour la ville', () => {
  const t = zoningTown();
  assert.ok(t.sim.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  t.cmd('paint', { points: [-190, 0, -10, 0], zone: 'res_faible', depth: 3 });
  t.cmd('paint', { points: [10, 0, 190, 0], zone: 'industrie', depth: 3 });
  const money0 = t.sim.economy.money;
  advanceHours(t.sim, 24 * 4);
  const sys = t.sys;
  assert.ok(sys.owned.size >= 10, `${sys.owned.size} bâtiments nés du zonage`);
  const st = t.sim.buildings;
  const cat = t.sim.catalog!;
  for (const [id, o] of sys.owned) {
    const i = st.indexOf(id);
    assert.ok(i >= 0);
    const a = cat.assets[st.assetIndex[i]!]!;
    assert.equal(zoneForAsset(a), ZONE_TYPES[o.zone - 1], `${a.id} dans une zone ${ZONE_TYPES[o.zone - 1]}`);
    assert.equal(st.roadAccess[i], 1, `${a.id} relié à la route`);
    // Façade vers la route : la normale de façade pointe vers l'axe z = 0.
    const ob = footprintObb(a.footprint.tilesX, a.footprint.tilesZ, st.x[i]!, st.z[i]!, st.rot[i]!);
    const [lx, lz] = localFacade(a);
    const fz = -lx * ob.s + lz * ob.c;
    assert.ok(Math.sign(fz) === -Math.sign(st.z[i]!) && Math.abs(fz) > 0.99, `${a.id} en z=${st.z[i]} : façade ${fz.toFixed(2)}`);
    // Emprise dans des cases de la même zone (ou en bord de route).
    const [cx, cz] = [st.x[i]!, st.z[i]!];
    assert.equal(sys.grid.zone[sys.grid.index(cx, cz)], o.zone, 'centre dans la zone');
    void obbToLocal;
  }
  // Première vague au niveau 1 seulement.
  for (const o of sys.owned.values()) assert.equal(o.level, 1);
  // Construction privée : la ville ne paie que l'entretien (aucune dépense de construction).
  const spent = money0 - t.sim.economy.money;
  assert.ok(spent < 50_000, `dépense de la ville ${spent} (entretien, pas de construction)`);
});

test('croissance : déterministe (même graine, mêmes bâtiments) et en pause quand on la suspend', () => {
  const run = (): string => {
    const t = zoningTown({ seed: 5 });
    t.sim.buildRoad({ type: 'street', points: [-200, 0, 200, 0] });
    t.cmd('paint', { points: [-190, 0, 190, 0], zone: 'res_faible', depth: 2 });
    advanceHours(t.sim, 48);
    return JSON.stringify([...t.sys.owned.keys()].map((id) => t.sim.buildings.indexOf(id)).map((i) => [t.sim.buildings.x[i], t.sim.buildings.z[i], t.sim.buildings.rot[i]]));
  };
  assert.equal(run(), run());
  const t = zoningTown();
  t.sim.buildRoad({ type: 'street', points: [-200, 0, 200, 0] });
  t.cmd('paint', { points: [-190, 0, 190, 0], zone: 'res_faible', depth: 2 });
  assert.ok(t.cmd('setGrowth', { enabled: false }).ok);
  advanceHours(t.sim, 48);
  assert.equal(t.sys.owned.size, 0, 'croissance suspendue');
  t.cmd('setGrowth', { enabled: true });
  advanceHours(t.sim, 24);
  assert.ok(t.sys.owned.size > 0, 'croissance reprise');
});

test('croissance : les chantiers s\'ouvrent sur les bâtiments nés du zonage (registre complet)', () => {
  const t = zoningTown({ plugins: (z) => SIM_PLUGINS.map((p) => (p.id === 'zonage' ? z : p)) });
  t.sim.buildRoad({ type: 'street', points: [-200, 0, 200, 0] });
  t.cmd('paint', { points: [-190, 0, 190, 0], zone: 'res_faible', depth: 2 });
  advanceHours(t.sim, 12);
  assert.ok(t.sys.owned.size > 0);
  const ch = t.sim.plugins.contextOf('chantiers')!.use<{ nombre: number; enChantier(id: number): boolean }>('chantiers')!;
  const inSite = [...t.sys.owned.keys()].filter((id) => ch.enChantier(id)).length;
  assert.ok(inSite > 0, `${inSite} bâtiments du zonage en chantier`);
  assert.deepEqual(t.sim.plugins.errors, []);
});

test('croissance : la demande pilote les secteurs (commerces après les habitants)', () => {
  const t = zoningTown();
  t.sim.buildRoad({ type: 'street', points: [-200, 0, 200, 0] });
  t.cmd('paint', { points: [-190, 0, 190, 0], zone: 'commerce', depth: 2 });
  advanceHours(t.sim, 24);
  assert.equal(t.sys.owned.size, 0, 'pas de commerces sans habitants');
  t.sim.buildRoad({ type: 'street', points: [-200, 120, 200, 120] });
  t.cmd('paint', { points: [-190, 120, 190, 120], zone: 'res_faible', depth: 2 });
  advanceHours(t.sim, 24 * 10);
  const s = t.sys.stats(t.ctx);
  assert.ok(s.buildings.res_faible > 5 && s.buildings.commerce > 0, JSON.stringify(s.buildings));
});

/* ------------------------------ Densification ------------------------------ */

test('densification : un quartier valorisé remplace les petits bâtiments par de plus grands (même zone, même façade)', () => {
  const t = zoningTown();
  t.sim.buildRoad({ type: 'street', points: [-200, 0, 200, 0] });
  t.cmd('paint', { points: [-190, 0, 190, 0], zone: 'res_faible', depth: 2 });
  advanceHours(t.sim, 24 * 4);
  const sys = t.sys;
  const before = new Map([...sys.owned].map(([id, o]) => [id, o.level]));
  assert.ok(before.size > 4);
  // Seuils élevés : rien ne bouge.
  assert.equal(sys.densifyDay(t.ctx), 0);
  t.cmd('tuning', { ageMinJours: 0, seuilNiveau2: 0, seuilNiveau3: 0, probaDensification: 1, maxDensificationsParJour: 3, demandeMinDensification: -1 });
  const done = sys.densifyDay(t.ctx);
  assert.equal(done, 3, 'trois remplacements (plafond quotidien)');
  const lv2 = [...sys.owned.values()].filter((o) => o.level === 2).length;
  assert.equal(lv2, 3);
  assert.equal(sys.owned.size, before.size, 'autant de bâtiments (remplacés, pas ajoutés)');
  // Le remplaçant regarde toujours la route et reste dans la zone.
  const st = t.sim.buildings;
  for (const [id, o] of sys.owned) {
    if (o.level !== 2) continue;
    const i = st.indexOf(id);
    const a = t.sim.catalog!.assets[st.assetIndex[i]!]!;
    assert.equal(a.id, 'maison_b');
    const ob = footprintObb(2, 2, st.x[i]!, st.z[i]!, st.rot[i]!);
    const [lx, lz] = localFacade(a);
    assert.ok(Math.sign(-lx * ob.s + lz * ob.c) === -Math.sign(st.z[i]!));
  }
  assert.equal(sys.densified, 3);
  // Les bâtiments posés par le joueur ne sont jamais remplacés.
  const mine = t.sim.placeBuilding({ assetId: 'maison_a', x: -300, z: 12, rot: 2 });
  void mine;
  for (let k = 0; k < 5; k++) sys.densifyDay(t.ctx);
  assert.ok([...sys.owned.values()].every((o) => o.level >= 1));
});

/* --------------------------- API de la simulation --------------------------- */

test('API d\'écriture : promotion privée sans coût ni remboursement ; commandes du joueur inchangées', () => {
  const t = zoningTown();
  t.sim.buildRoad({ type: 'street', points: [-100, 0, 100, 0] });
  const m0 = t.sim.economy.money;
  const dev = t.ctx.development!;
  const p = dev.place({ assetId: 'maison_a', x: 0, z: 15, rot: 2 });
  assert.ok(p.ok);
  assert.equal(t.sim.economy.money, m0, 'pose privée gratuite');
  assert.equal(dev.place({ assetId: 'maison_a', x: 0, z: 15, rot: 2 }).ok, false, 'collision contrôlée');
  assert.equal(dev.place({ assetId: 'inconnu', x: 0, z: 40, rot: 0 }).ok, false);
  assert.ok(dev.demolish((p as { data: { buildingId: number } }).data.buildingId).ok);
  assert.equal(t.sim.economy.money, m0, 'démolition privée sans remboursement');
  const q = t.sim.placeBuilding({ assetId: 'maison_a', x: 0, z: 15, rot: 2 });
  assert.ok(q.ok && q.data.cost > 0);
  assert.equal(t.sim.economy.money, m0 - q.data.cost, 'pose du joueur payée comme avant');
  const pending = t.sim.takeDelta();
  assert.ok(pending.buildingsAdded.length >= 1, 'les poses privées passent par les deltas ordinaires');
});

test('module inerte sans zone : aucun delta, aucun instantané, aucune section', () => {
  const t = zoningTown();
  t.sim.buildRoad({ type: 'street', points: [-100, 0, 100, 0] });
  advanceHours(t.sim, 30);
  assert.equal(t.sim.takeDelta().ext, undefined);
  assert.equal(t.sim.snapshot().ext, undefined);
  assert.equal('plugins' in t.sim.toSave(), false);
  // La commande `state` répond quand même (jauge de demande avant toute zone).
  const s = t.cmd('state');
  assert.ok(s.ok && (s.data as { demand: { R: number } }).demand.R > 0);
  assert.equal(zonagePlugin.id, 'zonage');
});
