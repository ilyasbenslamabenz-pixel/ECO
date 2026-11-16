/**
 * Zones spécialisées (docs/ZONAGE.md §8) : exploitation forestière (forêt naturelle, bois, déforestation et
 * repousse), agricole (sol fertile et plat, nourriture), mixte (commerces + logements : demandes R et C),
 * module « ressources » (économie, demande, sauvegarde facultative).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssetCatalog } from '../../src/shared/catalog';
import { zoneCode } from '../../src/shared/protocol-ext/zonage';
import type { RessourcesDelta } from '../../src/shared/protocol-ext/ressources';
import { Simulation } from '../../src/sim/world';
import { createZonagePlugin, type ZonagePlugin } from '../../src/sim/plugins/zonage';
import { createRessourcesPlugin, type RessourcesPlugin } from '../../src/sim/plugins/ressources';
import type { PluginContext } from '../../src/sim/plugins';
import { buildZoneCatalog, specialZonesForAsset } from '../../src/sim/zoning';
import { DEFAULT_RESSOURCES_TUNING, fertilityValue, regrow, resourceDemand, seasonYield } from '../../src/sim/ressources/model';
import { migrateRessources } from '../../src/sim/ressources/save';
import { asset, zoningCatalog } from './fixtures';

type SaveWithPlugins = ReturnType<Simulation['toSave']> & { plugins?: Record<string, { v: number; data: unknown }> };

/** Catalogue du zonage + modèles des zones spécialisées (réutilisés : ateliers, silos, immeubles à commerces). */
function catalog(): AssetCatalog {
  const c = zoningCatalog();
  c.assets.push(
    asset('scierie', 'industrial', 2, 2, 0, 16, ['industrie', 'bois', 'artisanat']),
    asset('depot_grumes', 'industrial', 2, 2, 0, 30, ['industrie', 'entrepot']),
    asset('ferme', 'industrial', 2, 2, 0, 12, ['agriculture']),
    asset('silo', 'industrial', 2, 2, 0, 24, ['service:stockage_agricole']),
    asset('rdc_commerce', 'apartment_low', 2, 2, 16, 6, ['commerces']),
    asset('immeuble_commerces', 'apartment_mid', 2, 2, 36, 12, ['commerces']),
  );
  return c;
}

interface Town {
  sim: Simulation; zonage: ZonagePlugin; ress: RessourcesPlugin; zctx: PluginContext; rctx: PluginContext;
  cmd(plugin: string, name: string, payload?: unknown): { ok: boolean; data?: unknown };
}

function town(seed = 11): Town {
  const zonage = createZonagePlugin(), ress = createRessourcesPlugin();
  const sim = new Simulation([zonage, ress]);
  sim.setCatalog(catalog());
  sim.newGame({ seed, mapChunks: 4, startMoney: 20_000_000, cityName: 'Bourg-Bois', terrain: { forest: 1 } });
  return {
    sim, zonage, ress, zctx: sim.plugins.contextOf('zonage')!, rctx: sim.plugins.contextOf('ressources')!,
    cmd: (plugin, name, payload) => { const r = sim.plugins.command(plugin, name, payload); return r.ok ? { ok: true, data: r.data.data } : { ok: false }; },
  };
}

/**
 * Rue horizontale de 280 m qui maximise `score` sur la bande zonée au nord (z + 12), et que la simulation accepte
 * (pente, eau) ; renvoie ses extrémités.
 */
function bestStreet(t: Town, score: (x: number, z: number) => number, skipZ: number[] = []): { x0: number; x1: number; z: number; mean: number } {
  const cands: { x0: number; z: number; mean: number }[] = [];
  for (let z = -400; z <= 400; z += 16) {
    if (skipZ.some((s) => Math.abs(s - z) < 60)) continue;
    for (let x0 = -420; x0 <= 140; x0 += 20) {
      let s = 0;
      for (let x = x0; x <= x0 + 280; x += 8) s += score(x, z + 12);
      cands.push({ x0, z, mean: s / 36 });
    }
  }
  cands.sort((a, b) => b.mean - a.mean);
  for (const c of cands.slice(0, 400)) {
    if (t.sim.buildRoad({ type: 'street', points: [c.x0, c.z, c.x0 + 280, c.z] }).ok) return { x0: c.x0, x1: c.x0 + 280, z: c.z, mean: c.mean };
  }
  throw new Error('aucune rue constructible');
}

/** Terrain sec et plat (0..1). */
function flat(t: Town): (x: number, z: number) => number {
  const ter = t.zctx.terrain;
  return (x, z) => {
    if (ter.isWet(x, z)) return 0;
    const s = Math.abs(ter.heightAt(x + 8, z) - ter.heightAt(x - 8, z)) + Math.abs(ter.heightAt(x, z + 8) - ter.heightAt(x, z - 8));
    return Number.isFinite(s) ? Math.max(0, 1 - s / 3) : 0;
  };
}

/** Quartier résidentiel (main-d'œuvre) sur une rue plate, à l'écart des rues déjà choisies. */
function housing(t: Town, skipZ: number[] = []): { x0: number; x1: number; z: number } {
  const r = bestStreet(t, flat(t), skipZ);
  t.cmd('zonage', 'paint', { points: [r.x0, r.z, r.x1, r.z], zone: 'res_moyen', depth: 3 });
  return r;
}

const days = (sim: Simulation, n: number): void => { for (let i = 0; i < n * 144; i++) sim.tick(10); };

/* ------------------------------ Catalogue, formules ------------------------------ */

test('zones spécialisées : catalogue (modèles existants réutilisés) et formules pures', () => {
  const z = buildZoneCatalog(catalog());
  assert.deepEqual(z.foret.map((e) => e.asset.id).sort(), ['depot_grumes', 'scierie']);
  assert.deepEqual(z.agricole.map((e) => e.asset.id).sort(), ['ferme', 'silo']);
  assert.deepEqual(z.mixte.map((e) => e.asset.id).sort(), ['immeuble_commerces', 'rdc_commerce']);
  assert.ok(z.mixte.every((e) => e.asset.capacity.residents > 0 && e.asset.capacity.jobs > 0), 'mixte : logements ET emplois');
  // Un modèle garde sa zone ordinaire : les immeubles à commerces restent du résidentiel.
  assert.ok(z.res_moyen.some((e) => e.asset.id === 'rdc_commerce') && z.industrie.some((e) => e.asset.id === 'scierie'));
  assert.deepEqual(specialZonesForAsset(asset('usine_polluante', 'industrial', 2, 2, 0, 50, ['bois', 'pollution:2'])), []);
  assert.deepEqual(specialZonesForAsset(asset('bureau', 'commercial', 2, 2, 4, 40, ['bureaux'])), []);
  // Formules.
  assert.equal(fertilityValue(true, 0, 0, false), 1);
  assert.equal(fertilityValue(true, 1, 0, true), 0, 'eau : stérile');
  assert.equal(fertilityValue(true, 1, 0.5, false), 0, 'pente forte : stérile');
  assert.ok(fertilityValue(false, 0.6, 0, false) > fertilityValue(false, 0.3, 0, false));
  assert.ok(seasonYield('ete') > seasonYield('printemps') && seasonYield('printemps') > seasonYield('hiver'));
  assert.ok(regrow(0, 1) > 0, 'semis : une coupe rase repousse');
  assert.ok(regrow(0.5, 1) > regrow(0.1, 1) - 0.1 && regrow(1, 1) === 1, 'logistique bornée par la capacité');
  assert.ok(resourceDemand(0, 0, 50) > resourceDemand(0, 50, 50), 'le manque relève la demande');
  assert.ok(resourceDemand(0, 500, 10) < 0, 'un gros excédent la fait baisser');
});

/* ------------------------------------ Forêt ------------------------------------ */

test('forêt : zonage sur la forêt seulement, bois produit, déforestation puis repousse, recette municipale', () => {
  const t = town();
  const sys = t.zonage.systemOf(t.zctx);
  const forestAt = t.zctx.terrain.forestAt!;
  const f = bestStreet(t, forestAt);
  assert.ok(f.mean > 0.4, `forêt dense trouvée (${f.mean.toFixed(2)})`);
  // Plaine dégagée (forêt quasi nulle au centre) : refusée.
  const plain = bestStreet(t, (x, z) => 1 - forestAt(x, z) - Math.abs(z) / 1000, [f.z]);
  assert.equal((t.cmd('zonage', 'paint', { points: [plain.x0, plain.z, plain.x1, plain.z], zone: 'foret', depth: 3 }).data as { changed: number }).changed, 0, 'pas de forêt : pas de zone');
  const n = (t.cmd('zonage', 'paint', { points: [f.x0, f.z, f.x1, f.z], zone: 'foret', depth: 3 }).data as { changed: number }).changed;
  assert.ok(n > 30, `${n} cases forestières`);
  for (const idx of sys.grid.cellsOf(zoneCode('foret'))) assert.ok(forestAt(sys.grid.centerX(idx), sys.grid.centerZ(idx)) >= DEFAULT_RESSOURCES_TUNING.foretMin);
  housing(t, [f.z, plain.z]);
  days(t.sim, 12);
  const rs = t.ress.systemOf(t.rctx);
  const exploitations = [...sys.owned].filter(([, o]) => o.zone === zoneCode('foret')).map(([id]) => id);
  assert.ok(exploitations.length > 0, 'exploitations nées de la zone');
  for (const id of exploitations) assert.ok(['scierie', 'depot_grumes'].includes(t.sim.catalog!.assets[t.sim.buildings.assetIndex[t.sim.buildings.indexOf(id)]!]!.id));
  assert.ok(rs.bois.totalProduced > 0, `bois produit : ${rs.bois.totalProduced} m³`);
  assert.ok(rs.tracked >= n * 0.9, 'stocks suivis par case');
  // Surexploitation : coupe beaucoup plus forte → cases déboisées (le rendu retire les arbres).
  rs.tuning.coupeParEmploye = 2; rs.tuning.coupeMaxCase = 0.5; rs.tuning.repousse = 0;
  t.sim.takeDelta();
  t.cmd('ressources', 'simulate', { days: 8 });
  assert.ok(rs.cleared.size > 0, `${rs.cleared.size} cases déboisées`);
  const d = t.ress.takeDelta!(t.rctx) as RessourcesDelta;
  assert.ok(d.cleared && d.cleared.length === 2 * rs.cleared.size, 'cases déboisées envoyées au rendu (x, z)');
  const snap = t.ress.snapshot!(t.rctx) as RessourcesDelta;
  assert.ok(snap.tints && snap.tints.length >= 2 * exploitations.length, 'bâtiments à teinter (instantané du rendu)');
  for (const id of exploitations) assert.ok(snap.tints!.some((v, k) => k % 2 === 0 && v === id && snap.tints![k + 1] === zoneCode('foret')));
  // Repousse : plus d'exploitation, la forêt revient.
  for (const id of exploitations) t.sim.demolish({ buildingId: id });
  rs.tuning = { ...DEFAULT_RESSOURCES_TUNING };
  t.zonage.systemOf(t.zctx).setGrowth(false);
  t.cmd('ressources', 'simulate', { days: 200 });
  assert.ok(rs.regrownTotal > 0 && rs.cleared.size < 5, `repousse : ${rs.regrownTotal} cases, ${rs.cleared.size} encore déboisées`);
  assert.deepEqual(t.sim.plugins.errors, []);
});

test('forêt : l\'excédent exporté rapporte une part fiscale à la ville', () => {
  const t = town(5);
  const f = bestStreet(t, t.zctx.terrain.forestAt!);
  t.cmd('zonage', 'paint', { points: [f.x0, f.z, f.x1, f.z], zone: 'foret', depth: 3 });
  housing(t, [f.z]);
  days(t.sim, 10);
  const rs = t.ress.systemOf(t.rctx);
  rs.tuning.coupeParEmploye = 0.2; // production nettement supérieure à la consommation
  const money0 = t.sim.economy.money;
  const before = rs.recetteMois + rs.recetteMoisPrecedent;
  const s = t.cmd('ressources', 'simulate', { days: 3 }).data as { bois: { exported: number } };
  assert.ok(s.bois.exported > 0, 'bois exporté');
  assert.ok(rs.recetteMois + rs.recetteMoisPrecedent > before, 'recette des exportations');
  assert.ok(t.sim.economy.money > money0, 'versée à la trésorerie');
});

/* ----------------------------------- Agricole ----------------------------------- */

test('agricole : sol fertile et plat seulement, fermes, nourriture selon la saison', () => {
  const t = town();
  const sys = t.zonage.systemOf(t.zctx);
  const fert = t.zctx.terrain.fertilityAt!;
  const a = bestStreet(t, fert);
  assert.ok(a.mean > 0.45, `terre fertile trouvée (${a.mean.toFixed(2)})`);
  const n = (t.cmd('zonage', 'paint', { points: [a.x0, a.z, a.x1, a.z], zone: 'agricole', depth: 3 }).data as { changed: number }).changed;
  assert.ok(n > 30, `${n} cases agricoles`);
  for (const idx of sys.grid.cellsOf(zoneCode('agricole'))) assert.ok(fert(sys.grid.centerX(idx), sys.grid.centerZ(idx)) >= DEFAULT_RESSOURCES_TUNING.fertiliteMin);
  // Terrain stérile : refusé.
  const poor = bestStreet(t, (x, z) => 1 - fert(x, z), [a.z]);
  assert.ok(poor.mean > 0.8);
  const np = (t.cmd('zonage', 'paint', { points: [poor.x0, poor.z, poor.x1, poor.z], zone: 'agricole', depth: 3 }).data as { changed: number }).changed;
  assert.ok(np < n / 4, `sol pauvre : ${np} cases seulement`);
  housing(t, [a.z, poor.z]);
  days(t.sim, 12);
  const rs = t.ress.systemOf(t.rctx);
  const farms = [...sys.owned].filter(([, o]) => o.zone === zoneCode('agricole'));
  assert.ok(farms.length > 0, 'fermes nées de la zone');
  assert.ok(rs.nourriture.totalProduced > 0, `nourriture produite : ${rs.nourriture.totalProduced} t`);
  assert.ok(rs.nourriture.consumption > 0, 'la ville consomme de la nourriture');
  // Demande agricole publiée au zonage : le manque de nourriture la relève.
  const prov = t.zctx.use<{ demand(z: 'foret' | 'agricole', i: number): number | null }>('ressources:demande')!;
  rs.nourriture = { ...rs.nourriture, production: 0, consumption: 100 };
  const short = prov.demand('agricole', 0)!;
  rs.nourriture = { ...rs.nourriture, production: 400, consumption: 10 };
  assert.ok(short > prov.demand('agricole', 0)!, 'manque de nourriture : demande agricole plus forte');
  assert.deepEqual(t.sim.plugins.errors, []);
});

/* ------------------------------------- Mixte ------------------------------------- */

test('mixte : commerces au rez-de-chaussée et logements, comptés dans les demandes R et C', () => {
  const t = town();
  const sys = t.zonage.systemOf(t.zctx);
  const r = bestStreet(t, flat(t));
  t.cmd('zonage', 'paint', { points: [r.x0, r.z, r.x1, r.z], zone: 'mixte', depth: 2 });
  // La zone mixte pousse si R OU C est demandé ; elle recule si les deux sont saturés.
  sys.demand = { R: 0, C: 0.6, B: 0, I: 0 };
  assert.ok(sys.zoneDemand('mixte') > 0.2);
  sys.demand = { R: -0.4, C: -0.2, B: 0, I: 0 };
  assert.ok(sys.zoneDemand('mixte') < 0);
  days(t.sim, 6);
  const mixed = [...sys.owned].filter(([, o]) => o.zone === zoneCode('mixte')).map(([id]) => id);
  assert.ok(mixed.length > 3, `${mixed.length} immeubles mixtes`);
  let res = 0, jobs = 0;
  for (const id of mixed) {
    const a = t.sim.buildings.indexOf(id) >= 0 ? t.zctx.buildings.assetOf(id)! : null;
    assert.ok(a && a.capacity.residents > 0 && a.capacity.jobs > 0, 'logements et commerces');
    res += a!.capacity.residents; jobs += a!.capacity.jobs;
  }
  // Demande : les logements comptent dans l'offre résidentielle, les emplois dans le commerce.
  const inp = sys.readInputs(t.zctx);
  assert.ok(inp.jobsBySector.C >= jobs, `emplois de commerce ${inp.jobsBySector.C} ≥ ${jobs}`);
  assert.ok(inp.housingCapacity >= res, `logements ${inp.housingCapacity} ≥ ${res}`);
  t.cmd('ressources', 'simulate', { days: 1 });
  const st = t.ress.systemOf(t.rctx).stats(t.rctx);
  assert.equal(st.mixte.batiments, mixed.length);
  assert.ok(st.mixte.logements > 0, 'habitants dans les immeubles mixtes');
});

/* ---------------------------------- Sauvegarde ---------------------------------- */

test('ressources : inerte sans zone spécialisée ; section facultative fidèle ; anciennes sauvegardes chargées', () => {
  const empty = town();
  housing(empty);
  days(empty.sim, 2);
  assert.equal(empty.ress.takeDelta!(empty.rctx), undefined, 'aucun delta');
  assert.equal(empty.ress.snapshot!(empty.rctx), undefined, 'aucun instantané');
  assert.equal((empty.sim.toSave() as SaveWithPlugins).plugins?.['ressources'], undefined, 'aucune section');

  const t = town();
  const f = bestStreet(t, t.zctx.terrain.forestAt!);
  t.cmd('zonage', 'paint', { points: [f.x0, f.z, f.x1, f.z], zone: 'foret', depth: 3 });
  housing(t, [f.z]);
  days(t.sim, 6);
  const rs = t.ress.systemOf(t.rctx);
  rs.tuning.coupeParEmploye = 1; rs.tuning.coupeMaxCase = 0.5;
  t.cmd('ressources', 'simulate', { days: 4 });
  const save = JSON.parse(JSON.stringify(t.sim.toSave())) as SaveWithPlugins;
  const sec = save.plugins?.['ressources'];
  assert.ok(sec && sec.v === 1, 'section ressources v1');
  const t2 = town();
  assert.equal(t2.sim.fromSave(JSON.parse(JSON.stringify(save))), null);
  const r2 = t2.ress.systemOf(t2.rctx);
  assert.equal(r2.tracked, rs.tracked);
  assert.deepEqual([...r2.cleared].sort(), [...rs.cleared].sort());
  assert.deepEqual(r2.bois, rs.bois);
  for (const [idx, s] of rs.stock) assert.ok(Math.abs(r2.stock.get(idx)! - s) < 1e-3);
  // Ancienne sauvegarde (sans section) : chargée, stocks relus sur le terrain.
  const old = JSON.parse(JSON.stringify(save)) as SaveWithPlugins;
  delete old.plugins!['ressources'];
  const t3 = town();
  assert.equal(t3.sim.fromSave(old), null);
  t3.cmd('ressources', 'simulate', { days: 1 });
  assert.ok(t3.ress.systemOf(t3.rctx).tracked > 0);
  assert.deepEqual(t3.sim.plugins.errors, []);
  // Section abîmée : refusée proprement par la migration.
  assert.throws(() => migrateRessources({ forest: [1, 2] }, 1), /forêt invalide/);
  assert.throws(() => migrateRessources({}, 2), /plus récente/);
});
