/**
 * Copies de secours en fichier (src/save/file-transfer.ts) : aller-retour identique (gzip et JSON),
 * fichier corrompu refusé, migration v1, nom de fichier, emplacement d'import, livraison
 * (artifact / partage / téléchargement), rappel ~30 min, stockage persistant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BackupReminder, REMINDER_OFF_KEY, deliverFile, exportMeknes, importMeknes, importSlotName, meknesFilename,
  requestPersistentStorage, resolveDownloads, type ExportFile,
} from '../../src/save/file-transfer';
import { isGzip } from '../../src/save/codec';
import { Simulation } from '../../src/sim/world';
import { buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';

function town() { const s = newTownSim(); buildTown(s); runDays(s, 3); return s; }

test('export -> import : aller-retour identique (gzip .meknes et JSON .meknes.json de l\'artifact)', async () => {
  const s = town();
  const save = { ...s.toSave(), savedAt: '2026-11-13T15:42:10.000Z' };
  const gz = await exportMeknes(save);
  assert.ok(gz.compressed && isGzip(gz.bytes));
  assert.equal(gz.filename, 'Meknes-City_Bourg-Test_2026-11-13_15-42.meknes');
  const back = await importMeknes(new Blob([gz.bytes as BlobPart]));
  assert.ok(back.ok, back.ok ? '' : back.message);
  assert.deepEqual(back.value, save, 'aller-retour identique');
  // La simulation reprend exactement au même point.
  const sim = new Simulation();
  sim.setCatalog(townCatalog());
  assert.equal(sim.fromSave(back.value), null);
  assert.equal(sim.clock.totalMinutes, s.clock.totalMinutes);
  assert.equal(sim.buildings.count, s.buildings.count);
  const js = await exportMeknes(save, { artifact: true });
  assert.ok(!js.compressed && js.filename.endsWith('.meknes.json'));
  assert.doesNotThrow(() => JSON.parse(new TextDecoder().decode(js.bytes)));
  const back2 = await importMeknes(js.bytes.buffer.slice(0) as ArrayBuffer);
  assert.ok(back2.ok && JSON.stringify(back2.value) === JSON.stringify(save));
});

test('import : fichier corrompu, tronqué, vide ou étranger refusé avec un message', async () => {
  const gz = await exportMeknes(town().toSave());
  const truncated = gz.bytes.slice(0, Math.floor(gz.bytes.length / 2));
  const flipped = gz.bytes.slice();
  flipped[Math.floor(flipped.length / 2)]! ^= 0xff;
  for (const [label, bytes] of [
    ['tronqué', truncated], ['altéré', flipped], ['vide', new Uint8Array(0)],
    ['étranger', new TextEncoder().encode('{"hello":"world"}')], ['texte', new TextEncoder().encode('pas une sauvegarde')],
  ] as const) {
    const r = await importMeknes(bytes);
    assert.ok(!r.ok, `${label} : doit être refusé`);
    assert.ok(!r.ok && r.message.length > 0);
  }
  // Champ invalide dans une sauvegarde par ailleurs bien formée.
  const bad = JSON.parse(new TextDecoder().decode((await exportMeknes(town().toSave(), { artifact: true })).bytes)) as Record<string, unknown>;
  bad['buildings'] = 'oops';
  assert.ok(!(await importMeknes(new TextEncoder().encode(JSON.stringify(bad)))).ok);
});

test('import : migration d\'une ancienne version (v1 -> courante)', async () => {
  const v2 = town().toSave() as unknown as Record<string, unknown>;
  const v1: Record<string, unknown> = { ...v2, version: 1 };
  for (const k of ['population', 'economy2', 'plugins']) delete v1[k];
  const r = await importMeknes(new TextEncoder().encode(JSON.stringify(v1)));
  assert.ok(r.ok, r.ok ? '' : r.message);
  assert.ok(r.ok && r.value.version > 1, 'version migrée');
});

test('noms : fichier sûr et emplacement d\'import libre', () => {
  assert.equal(meknesFilename('Fès / Médina !', '2026-01-02T03:04:05Z'), 'Meknes-City_Fes-Medina_2026-01-02_03-04.meknes');
  assert.equal(meknesFilename('', 'n/a'), 'Meknes-City_ville_sans-date.meknes');
  assert.equal(importSlotName('Méknès', []), 'import-meknes');
  assert.equal(importSlotName('Méknès', ['import-meknes', 'import-meknes-2']), 'import-meknes-3');
});

test('livraison : artifact (downloads), partage mobile, sinon téléchargement ; annulation respectée', async () => {
  const f: ExportFile = { bytes: new Uint8Array([1, 2, 3]), filename: 'x.meknes', mime: 'application/gzip', compressed: true };
  const saved: Array<{ filename: string }> = [];
  assert.equal(await deliverFile(f, { downloads: { save: async (r) => { saved.push(r); return { status: 'saved' }; } } }), 'artifact');
  assert.equal(saved[0]!.filename, 'x.meknes');
  assert.equal(await deliverFile(f, { downloads: { save: async () => { throw { code: 'declined' }; } } }), 'cancelled');
  await assert.rejects(deliverFile(f, { downloads: { save: async () => { throw { code: 'rejected_extension' }; } } }), /rejected_extension/);
  const shared: string[] = [];
  const nav = { canShare: () => true, share: async (d: { files: File[] }) => { shared.push(d.files[0]!.name); } };
  assert.equal(await deliverFile(f, { nav, preferShare: true, fallback: () => assert.fail('pas de repli') }), 'share');
  assert.deepEqual(shared, ['x.meknes']);
  const abort = { canShare: () => true, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } };
  assert.equal(await deliverFile(f, { nav: abort, preferShare: true, fallback: () => assert.fail('pas de repli') }), 'cancelled');
  let dl = '';
  assert.equal(await deliverFile(f, { nav, preferShare: false, fallback: (_b, n) => { dl = n; } }), 'download');
  assert.equal(dl, 'x.meknes');
  assert.equal(await deliverFile(f, { nav: { canShare: () => false, share: async () => undefined }, preferShare: true, fallback: (_b, n) => { dl = `2:${n}`; } }), 'download');
  assert.equal(dl, '2:x.meknes');
  assert.equal(await resolveDownloads(null), null);
  assert.equal(await resolveDownloads({ use: async () => null }), null);
});

test('rappel ~30 min de jeu sans sauvegarde en ligne, désactivable ; stockage persistant demandé', async () => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  let playing = true, cloud = false, shown = 0;
  const r = new BackupReminder({ isPlaying: () => playing, hasCloud: () => cloud, remind: () => { shown++; }, storage });
  for (let i = 0; i < 29; i++) r.tick();
  assert.equal(shown, 0);
  r.tick();
  assert.equal(shown, 1, 'rappel après 30 min de jeu');
  playing = false;
  for (let i = 0; i < 60; i++) r.tick();
  assert.equal(shown, 1, 'jeu en pause / menu : le temps ne compte pas');
  playing = true;
  cloud = true;
  for (let i = 0; i < 60; i++) r.tick();
  assert.equal(shown, 1, 'sauvegarde en ligne active : pas de rappel');
  cloud = false;
  for (let i = 0; i < 20; i++) r.tick();
  r.reset(); // une copie vient d'être faite
  for (let i = 0; i < 29; i++) r.tick();
  assert.equal(shown, 1);
  r.disable();
  assert.equal(mem.get(REMINDER_OFF_KEY), '1');
  for (let i = 0; i < 100; i++) r.tick();
  assert.equal(shown, 1, 'désactivé (mémorisé)');
  assert.ok(new BackupReminder({ isPlaying: () => true, hasCloud: () => false, remind: () => undefined, storage }).disabled);

  let asked = 0;
  assert.equal(await requestPersistentStorage({ storage: { persisted: async () => false, persist: async () => { asked++; return true; } } }), true);
  assert.equal(await requestPersistentStorage({ storage: { persisted: async () => true, persist: async () => { asked++; return true; } } }), true);
  assert.equal(asked, 1, 'déjà persistant : pas de nouvelle demande');
  assert.equal(await requestPersistentStorage({}), null);
});
