/** Sauvegarde : format v2, continuation déterministe, migration v1, fichiers corrompus, codec, emplacements, autosave. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { CURRENT_SAVE_VERSION, validateSave } from '../../src/sim/save-format';
import { decodeSave, encodeSave, compressionAvailable, isGzip } from '../../src/save/codec';
import { LocalStorageBackend, MemoryBackend, openBestBackend, type StorageLike } from '../../src/save/backends';
import { SaveStore } from '../../src/save/store';
import { Autosaver } from '../../src/save/autosave';
import { buildTown, newTownSim, runDays, townCatalog } from './fixtures';

function town(days = 12): Simulation {
  const s = newTownSim();
  buildTown(s);
  s.runExt('setTaxRate', { sector: 'commercial', rate: 0.12 });
  const loan = s.runExt('takeLoan', { amount: 200_000, months: 36 });
  assert.ok(loan.ok);
  runDays(s, days);
  return s;
}

function fingerprint(s: Simulation): unknown {
  const r = s.report(true);
  return {
    money: s.economy.money, rng: s.rng.getState(), pop: r.demography.population, hh: r.demography.households,
    employed: r.demography.employed, month: r.demography.month, history: r.economy.history, loans: r.economy.loans,
    citizens: s.demography!.citizens.toJSON(), sched: s.scheduler.toJSON(), minutes: s.clock.totalMinutes,
    occupancy: Array.from(s.buildings.residents.subarray(0, s.buildings.count)),
  };
}

function freshSim(): Simulation {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  return s;
}

test('aller-retour v2 : la partie rechargée se poursuit à l\'identique (PRNG, planificateur, population, finances)', () => {
  const a = town(40);
  const save = JSON.parse(JSON.stringify(a.toSave()));
  assert.equal(save.version, CURRENT_SAVE_VERSION);
  assert.ok(save.population.citizens.id.length > 100);
  const b = freshSim();
  assert.equal(b.fromSave(save), null);
  assert.deepEqual(fingerprint(b), fingerprint(a), 'état identique juste après le chargement');
  assert.deepEqual(b.buildingRecords(), a.buildingRecords());
  assert.deepEqual(b.roadRecords(), a.roadRecords());
  assert.equal(b.economy.monthlyUpkeep, a.economy.monthlyUpkeep, 'entretien recalculé à l\'identique');
  runDays(a, 35);
  runDays(b, 35);
  assert.deepEqual(fingerprint(b), fingerprint(a), 'même évolution 35 jours plus tard');
});

test('migration v1 -> v2 : bâtiments, routes et argent conservés, population vide, valeurs par défaut', () => {
  const a = town(5);
  const v2 = a.toSave();
  const v1 = {
    format: 'aube-urbaine-save', version: 1, savedAt: v2.savedAt, params: v2.params, clock: v2.clock,
    economy: { money: 123_456 }, buildings: v2.buildings, roads: v2.roads, nextIds: v2.nextIds,
  };
  const v = validateSave(JSON.parse(JSON.stringify(v1)));
  assert.ok(v.ok && v.migratedFrom === 1 && v.save.version === 2);
  const b = freshSim();
  assert.equal(b.fromSave(JSON.parse(JSON.stringify(v1))), null);
  assert.equal(b.economy.money, 123_456);
  assert.equal(b.economy.taxRates.residential, 0.09);
  assert.equal(b.demography!.population, 0);
  assert.equal(b.buildings.count, a.buildings.count);
  assert.ok(b.notices.some((n) => /version 1/.test(n.message)));
  runDays(b, 3);
  assert.ok(b.demography!.population > 0, 'la ville migrée se repeuple');
  assert.ok(b.scheduler.size >= 5, 'événements récurrents replanifiés');
});

test('fichiers corrompus : message explicite, aucune exception, partie en cours intacte', () => {
  const a = town(5);
  const good = JSON.parse(JSON.stringify(a.toSave()));
  const before = fingerprint(a);
  const mutate = (f: (s: any) => void): unknown => { const c = JSON.parse(JSON.stringify(good)); f(c); return c; };
  const cases: [string, unknown, RegExp][] = [
    ['non objet', 42, /objet JSON/],
    ['tableau', [], /objet JSON/],
    ['format', mutate((s) => { s.format = 'autre-jeu'; }), /non reconnu/],
    ['version future', mutate((s) => { s.version = 99; }), /plus récente/],
    ['version texte', mutate((s) => { s.version = '2'; }), /Version/],
    ['bâtiment NaN', mutate((s) => { s.buildings[0].x = null; }), /Bâtiment/],
    ['rotation', mutate((s) => { s.buildings[0].rot = 7; }), /Bâtiment/],
    ['id en double', mutate((s) => { s.buildings[1].id = s.buildings[0].id; }), /double/],
    ['tronçon orphelin', mutate((s) => { s.roads.edges[0].a = 99999; }), /inexistant/],
    ['type de route', mutate((s) => { s.roads.edges[0].type = 'autoroute_volante'; }), /Tronçon/],
    ['compteurs', mutate((s) => { s.nextIds.building = 1; }), /Compteur/],
    ['taux', mutate((s) => { s.economy.taxRates.residential = 3; }), /imposition/],
    ['emprunt', mutate((s) => { s.economy.loans[0].remaining = -5; }), /Emprunt/],
    ['colonne tronquée', mutate((s) => { s.population.citizens.age = undefined; s.population.citizens.income.pop(); }), /longueur|colonne/],
    ['citoyen sans logement valide', mutate((s) => { s.population.citizens.home[0] = 987654; }), /inexistant/],
    ['citoyen sans ménage', mutate((s) => { s.population.citizens.household[0] = 987654; }), /ménage/],
    ['éducation', mutate((s) => { s.population.citizens.education[0] = 9; }), /éducation/],
    ['prng', mutate((s) => { s.sim.rng = [1, 2]; }), /aléatoire/],
    ['événement', mutate((s) => { s.sim.scheduler.events[0].at = 'demain'; }), /Événement/],
  ];
  for (const [name, raw, re] of cases) {
    const r = validateSave(raw);
    assert.ok(!r.ok, `${name} : devrait être refusé`);
    assert.match(r.ok ? '' : r.message, re, name);
    const err = a.fromSave(raw);
    assert.equal(err?.code, 'BAD_SAVE', name);
  }
  // Incohérence détectable seulement au chargement : deux bâtiments superposés -> restauration.
  const overlap = mutate((s) => { s.buildings[1].x = s.buildings[0].x; s.buildings[1].z = s.buildings[0].z; s.buildings[1].assetId = s.buildings[0].assetId; });
  const e2 = a.fromSave(overlap);
  assert.equal(e2?.code, 'BAD_SAVE');
  assert.match(e2!.message, /superposés/);
  assert.deepEqual(fingerprint(a), before, 'la partie en cours est restaurée intacte');
  const unknown = mutate((s) => { s.buildings[0].assetId = 'tour_inconnue'; });
  assert.match(a.fromSave(unknown)!.message, /absent du catalogue/);
});

test('codec : gzip si CompressionStream, détection automatique, octets corrompus refusés', async () => {
  assert.ok(compressionAvailable(), 'Node 22 fournit CompressionStream');
  const a = town(3);
  const data = a.toSave();
  const z = await encodeSave(data, true);
  const raw = await encodeSave(data, false);
  assert.ok(z.compressed && isGzip(z.bytes));
  assert.ok(z.bytes.length < raw.bytes.length / 3, `compression ${raw.bytes.length} -> ${z.bytes.length}`);
  for (const bytes of [z.bytes, raw.bytes]) {
    const d = await decodeSave(bytes);
    assert.ok(d.ok);
    assert.deepEqual(d.ok && d.value.data.buildings, JSON.parse(JSON.stringify(data.buildings)));
  }
  const truncated = await decodeSave(z.bytes.subarray(0, z.bytes.length >> 1));
  assert.ok(!truncated.ok && /endommagé|illisible/.test(truncated.message));
  const junk = await decodeSave(new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4, 5]));
  assert.ok(!junk.ok);
  const text = await decodeSave(new TextEncoder().encode('{"format":"aube-urbaine-save","version":2'));
  assert.ok(!text.ok && /JSON/.test(text.message));
  const bin = await decodeSave(new Uint8Array([0xff, 0xfe, 0x00, 0xd8]));
  assert.ok(!bin.ok);
});

class FakeStorage implements StorageLike {
  private m = new Map<string, string>();
  constructor(private quota = Infinity) {}
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void {
    let used = v.length; for (const [kk, vv] of this.m) if (kk !== k) used += vv.length;
    if (used > this.quota) throw new Error('QuotaExceededError');
    this.m.set(k, v);
  }
  removeItem(k: string): void { this.m.delete(k); }
}

test('emplacements : sauvegarder, lister, charger, supprimer (mémoire et localStorage), quota géré', async () => {
  const a = town(3);
  for (const backend of [new MemoryBackend(), new LocalStorageBackend(new FakeStorage())]) {
    const store = new SaveStore(backend);
    const r1 = await store.save('partie-1', a.toSave());
    assert.ok(r1.ok && r1.value.compressed && r1.value.population === a.demography!.population);
    runDays(a, 1);
    assert.ok((await store.save('partie-2', a.toSave())).ok);
    const list = await store.list();
    assert.deepEqual(list.map((l) => l.slot).sort(), ['partie-1', 'partie-2']);
    assert.equal(list[0]!.cityName, 'Bourg-Test');
    const l = await store.load('partie-2');
    assert.ok(l.ok);
    const b = freshSim();
    assert.equal(b.fromSave(l.ok ? l.value : null), null);
    assert.equal(b.clock.totalMinutes, a.clock.totalMinutes);
    await store.remove('partie-1');
    assert.equal((await store.list()).length, 1);
    const missing = await store.load('partie-1');
    assert.ok(!missing.ok && /Aucune sauvegarde/.test(missing.message));
    assert.ok(!(await store.save('../evil', a.toSave())).ok);
  }
  // Données corrompues dans le stockage : message, pas d'exception.
  const mem = new MemoryBackend();
  await mem.put('data:x', new Uint8Array([1, 2, 3]));
  const bad = await new SaveStore(mem).load('x');
  assert.ok(!bad.ok);
  // Quota dépassé : message français.
  const tiny = new SaveStore(new LocalStorageBackend(new FakeStorage(100)));
  const q = await tiny.save('a', a.toSave());
  assert.ok(!q.ok && /insuffisant/.test(q.message));
  // Choix du support : sans IndexedDB -> localStorage ; sans rien -> mémoire.
  assert.equal((await openBestBackend({ indexedDB: undefined, localStorage: new FakeStorage() })).kind, 'localstorage');
  assert.equal((await openBestBackend({ indexedDB: undefined, localStorage: undefined })).kind, 'memory');
});

test('export / import de fichier : gzip et JSON lisible, fichier étranger refusé', async () => {
  const a = town(3);
  const store = new SaveStore(new MemoryBackend());
  const { blob, filename } = await store.exportFile(a.toSave());
  assert.match(filename, /^aube-urbaine-Bourg-Test-.*\.aube\.gz$/);
  const back = await store.importFile(blob);
  assert.ok(back.ok && back.value.buildings.length === a.buildings.count);
  const plain = new SaveStore(new MemoryBackend(), false);
  const exp2 = await plain.exportFile(a.toSave());
  assert.match(exp2.filename, /\.aube\.json$/);
  assert.ok((await plain.importFile(await exp2.blob.arrayBuffer())).ok);
  const foreign = await store.importFile(new TextEncoder().encode('{"hello":"world"}'));
  assert.ok(!foreign.ok && /non reconnu/.test(foreign.message));
  assert.ok(!(await store.importFile(new Uint8Array(0))).ok);
});

test('autosave : rotation sur 3 emplacements, jamais deux écritures simultanées, erreurs remontées', async () => {
  const a = town(2);
  const store = new SaveStore(new MemoryBackend());
  let tickFn: (() => void) | null = null;
  const errors: string[] = [];
  const saved: string[] = [];
  const auto = new Autosaver(async () => a.toSave(), store, {
    intervalMs: 60_000, slots: 3,
    timers: { set: (fn) => { tickFn = fn; return 1; }, clear: () => { tickFn = null; } },
    onSaved: (i) => saved.push(i.slot), onError: (m) => errors.push(m),
  });
  auto.start();
  assert.ok(auto.running && tickFn);
  for (let k = 0; k < 4; k++) assert.ok((await auto.saveNow()).ok);
  assert.deepEqual(saved, ['auto-1', 'auto-2', 'auto-3', 'auto-1']);
  const p1 = auto.saveNow();
  const p2 = await auto.saveNow();
  assert.ok(!p2.ok && /déjà en cours/.test(p2.message));
  assert.ok((await p1).ok);
  auto.stop();
  assert.ok(!auto.running);
  const failing = new Autosaver(async () => { throw new Error('worker arrêté'); }, store, { onError: (m) => errors.push(m) });
  assert.ok(!(await failing.saveNow()).ok);
  assert.ok(errors.some((e) => /worker arrêté/.test(e)));
  // Un nouvel autosaver reprend la rotation sur l'emplacement le plus ancien.
  const auto2 = new Autosaver(async () => a.toSave(), store, { slots: 3 });
  const r = await auto2.saveNow();
  assert.ok(r.ok && r.value.slot === 'auto-3', r.ok ? r.value.slot : r.message);
});
