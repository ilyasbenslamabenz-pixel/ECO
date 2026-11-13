/**
 * Sauvegardes en ligne (src/save/cloud.ts) avec un faux `db` en mémoire : découpage/réassemblage,
 * empreinte, morceau manquant, la plus récente gagne, hors ligne, migration, limitation de fréquence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend } from '../../src/save/backends';
import { SaveStore } from '../../src/save/store';
import {
  CloudSlotProvider, attachCloudSaves, connectCollection, metaId, partId, sha256Hex, splitParts,
  type CloudSaveStatus, type CollectionLike, type DocRefLike, type Timers,
} from '../../src/save/cloud';
import type { SaveFile } from '../../src/shared/contracts';
import { buildTown, newTownSim, runDays } from '../sim/fixtures';

const DOC_LIMIT = 256 * 1024;

/** Faux runtime : documents JSON (copie à l'écriture, limite 256 Kio), compteurs, pannes simulées. */
class FakeDb {
  readonly docs = new Map<string, unknown>();
  writes: string[] = [];
  reads = 0;
  down = false;
  active = new Map<string, number>();
  maxConcurrentPerDoc = 0;

  private async op<T>(path: string, fn: () => T): Promise<T> {
    if (this.down) throw new Error('réseau coupé');
    const n = (this.active.get(path) ?? 0) + 1;
    this.active.set(path, n);
    this.maxConcurrentPerDoc = Math.max(this.maxConcurrentPerDoc, n);
    await new Promise((r) => setImmediate(r));
    try { return fn(); } finally { this.active.set(path, n - 1); }
  }

  collection(path: string): CollectionLike {
    const ref = (id: string): DocRefLike => {
      const full = `${path}/${id}`;
      assert.ok(full.split('/').length <= 16 && full.split('/').every((s) => s.length > 0 && s.length <= 200));
      return {
        get: () => this.op(full, () => {
          this.reads++;
          const v = this.docs.get(full);
          return { exists: v !== undefined, data: () => (v === undefined ? undefined : structuredClone(v)) };
        }),
        set: (o) => this.op(full, () => {
          const json = JSON.stringify(o);
          if (json.length > DOC_LIMIT) throw new Error('document trop gros');
          this.writes.push(id);
          this.docs.set(full, JSON.parse(json));
        }),
        delete: () => this.op(full, () => { this.writes.push(`-${id}`); this.docs.delete(full); }),
      };
    };
    return {
      doc: ref,
      where: (field, op, value) => ({
        get: () => this.op(path, () => {
          assert.equal(op, '==');
          const docs = [...this.docs].filter(([k, v]) => k.startsWith(`${path}/`) && (v as Record<string, unknown>)[field] === value)
            .map(([k, v]) => ({ id: k.slice(path.length + 1), data: () => structuredClone(v) }));
          return { docs };
        }),
      }),
    };
  }
}

function claudeFor(db: FakeDb | null, id: string | null = 'joueur-42') {
  return {
    use: async (name: string) => (name === 'db' ? db : name === 'user' ? { id: async () => id } : null),
  };
}

class ManualTimers implements Timers {
  pending: Array<{ fn: () => void; ms: number; id: number }> = [];
  private seq = 0;
  set(fn: () => void, ms: number): unknown { const id = ++this.seq; this.pending.push({ fn, ms, id }); return id; }
  clear(h: unknown): void { this.pending = this.pending.filter((p) => p.id !== h); }
  fire(): void { const p = this.pending.splice(0); for (const x of p) x.fn(); }
}

let town: ReturnType<typeof newTownSim> | null = null;
function saveAt(iso: string): SaveFile {
  if (!town) { town = newTownSim(); buildTown(town); runDays(town, 1); }
  return { ...town.toSave(), savedAt: iso };
}

async function setup(opts: { partChars?: number; db?: FakeDb | null; local?: SaveStore; now?: () => number; timers?: Timers } = {}) {
  const db = opts.db === undefined ? new FakeDb() : opts.db;
  const local = opts.local ?? new SaveStore(new MemoryBackend());
  const statuses: CloudSaveStatus[] = [];
  const col = db ? db.collection('data/users/joueur-42') : null;
  const cloud = new CloudSlotProvider(local, {
    col, partChars: opts.partChars, now: opts.now, timers: opts.timers ?? new ManualTimers(), onStatus: (s) => statuses.push(s),
  });
  return { db, local, cloud, statuses };
}

test('splitParts / empreinte : découpage exact, réassemblage identique', async () => {
  const text = 'x'.repeat(400_001);
  const parts = splitParts(text);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => p.length <= 180_000));
  assert.equal(parts.join(''), text);
  assert.deepEqual(splitParts(''), ['']);
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('envoi en morceaux (méta en dernier) puis réassemblage sur un autre appareil', async () => {
  const { db, cloud } = await setup({ partChars: 1000 });
  const r = await cloud.save('ma-ville', saveAt('2026-11-13T10:00:00.000Z'));
  assert.ok(r.ok);
  await cloud.idle();
  const meta = db!.docs.get(`data/users/joueur-42/${metaId('ma-ville')}`) as { parts: number; sha256: string; bytes: number };
  assert.ok(meta && meta.parts > 1, `plusieurs morceaux attendus (${meta?.parts})`);
  assert.equal(db!.writes.at(-1), metaId('ma-ville'), 'la méta est écrite en dernier');
  assert.equal(db!.writes.length, meta.parts + 1);
  assert.equal(db!.maxConcurrentPerDoc, 1);

  // Deuxième appareil : stockage local vide -> liste puis chargement depuis le cloud.
  const other = await setup({ db, partChars: 1000 });
  const list = await other.cloud.list();
  assert.deepEqual(list.map((l) => l.slot), ['ma-ville']);
  assert.ok(await other.cloud.has('ma-ville'));
  const l = await other.cloud.load('ma-ville');
  assert.ok(l.ok, l.ok ? '' : l.message);
  assert.equal(l.ok && l.value.savedAt, '2026-11-13T10:00:00.000Z');
  // Rapatriée localement, avec les mêmes octets (empreinte identique).
  const raw = await other.local.getRaw('ma-ville');
  assert.equal(raw && (await sha256Hex(raw.bytes)), meta.sha256);
});

test('rien n\'a changé -> aucune écriture ; version plus courte -> morceaux en trop supprimés', async () => {
  const { db, cloud } = await setup({ partChars: 1000 });
  await cloud.save('a', saveAt('2026-11-13T10:00:00.000Z'));
  await cloud.idle();
  const n = db!.writes.length;
  // Même contenu réécrit localement : l'empreinte est identique, aucun envoi.
  await cloud.putRaw('a', (await cloud.getRaw('a'))!.bytes, (await cloud.getRaw('a'))!.info);
  await (cloud as unknown as { enqueueUpload(s: string): Promise<void> }).enqueueUpload('a');
  await cloud.idle();
  assert.equal(db!.writes.length, n);
  // Envoi d'un contenu plus petit en 1 morceau : les anciens morceaux sont supprimés.
  const big = (db!.docs.get(`data/users/joueur-42/${metaId('a')}`) as { parts: number }).parts;
  const c2 = await setup({ db, local: cloud, partChars: 1_000_000 });
  await c2.cloud.save('a', saveAt('2026-11-13T11:00:00.000Z'));
  await c2.cloud.idle();
  assert.equal((db!.docs.get(`data/users/joueur-42/${metaId('a')}`) as { parts: number }).parts, 1);
  for (let k = 1; k < big; k++) assert.ok(!db!.docs.has(`data/users/joueur-42/${partId('a', k)}`));
});

test('morceau manquant ou empreinte fausse : sauvegarde en ligne ignorée, locale gardée', async () => {
  const { db, cloud } = await setup({ partChars: 1000 });
  await cloud.save('s', saveAt('2026-11-13T12:00:00.000Z'));
  await cloud.idle();
  const dev2 = await setup({ db, partChars: 1000 });
  await dev2.local.save('s', saveAt('2026-11-13T09:00:00.000Z')); // plus ancienne, locale
  db!.docs.delete(`data/users/joueur-42/${partId('s', 1)}`);
  let l = await dev2.cloud.load('s');
  assert.ok(l.ok && l.value.savedAt === '2026-11-13T09:00:00.000Z', 'morceau manquant -> locale');
  // Morceau présent mais altéré (même longueur) -> empreinte invalide -> locale.
  const p0 = db!.docs.get(`data/users/joueur-42/${partId('s', 0)}`) as { data: string };
  db!.docs.set(`data/users/joueur-42/${partId('s', 1)}`, { ...p0, n: 1 });
  l = await dev2.cloud.load('s');
  assert.ok(l.ok && l.value.savedAt === '2026-11-13T09:00:00.000Z', 'empreinte fausse -> locale');
  // Méta invalide : ignorée par la liste.
  db!.docs.set(`data/users/joueur-42/${metaId('t')}`, { kind: 'meta', format: 1, slot: 't', sha256: 'zz' });
  assert.ok(!(await dev2.cloud.list()).some((x) => x.slot === 't'));
});

test('la plus récente gagne (lecture comme écriture)', async () => {
  const { db, cloud } = await setup();
  await cloud.save('p', saveAt('2026-11-13T12:00:00.000Z'));
  await cloud.idle();
  // Appareil 2 : locale plus récente -> elle gagne au chargement et n'est pas écrasée.
  const dev2 = await setup({ db });
  await dev2.local.save('p', saveAt('2026-11-13T13:00:00.000Z'));
  let l = await dev2.cloud.load('p');
  assert.ok(l.ok && l.value.savedAt === '2026-11-13T13:00:00.000Z');
  // Appareil 3 : locale plus ancienne -> la version en ligne gagne.
  const dev3 = await setup({ db });
  await dev3.local.save('p', saveAt('2026-11-13T08:00:00.000Z'));
  assert.equal((await dev3.cloud.list())[0]!.savedAt, '2026-11-13T12:00:00.000Z');
  l = await dev3.cloud.load('p');
  assert.ok(l.ok && l.value.savedAt === '2026-11-13T12:00:00.000Z');
  // Un appareil en retard n'écrase pas une version en ligne plus récente.
  const stale = await setup({ db });
  await stale.local.save('p', saveAt('2026-11-13T07:00:00.000Z'));
  await (stale.cloud as unknown as { enqueueUpload(s: string): Promise<void> }).enqueueUpload('p');
  await stale.cloud.idle();
  const meta = db!.docs.get(`data/users/joueur-42/${metaId('p')}`) as { savedAt: string };
  assert.equal(meta.savedAt, '2026-11-13T12:00:00.000Z');
});

test('hors ligne : db null, utilisateur absent ou réseau coupé -> tout reste local, sans erreur', async () => {
  // Hors artifact : le SaveStore local est rendu tel quel.
  const local = new SaveStore(new MemoryBackend());
  const statuses: CloudSaveStatus[] = [];
  assert.equal(await attachCloudSaves(local, { claude: null, onStatus: (s) => statuses.push(s) }), local);
  assert.equal(statuses.at(-1)!.state, 'disabled');
  // Artifact sans connexion : fournisseur hors ligne, comportement local.
  for (const claude of [claudeFor(null), claudeFor(new FakeDb(), null), { use: async () => { throw new Error('refusé'); } }]) {
    const st: CloudSaveStatus[] = [];
    const p = await attachCloudSaves(new SaveStore(new MemoryBackend()), { claude, onStatus: (s) => st.push(s), noStart: true });
    assert.ok(p instanceof CloudSlotProvider && !p.online);
    assert.equal(st.at(-1)!.state, 'offline');
    assert.equal(st.at(-1)!.label, 'Hors ligne — sauvegarde locale');
    assert.ok((await p.save('x', saveAt('2026-11-13T10:00:00.000Z'))).ok);
    assert.ok((await p.load('x')).ok);
    assert.deepEqual((await p.list()).map((s) => s.slot), ['x']);
  }
  assert.equal(await connectCollection(claudeFor(new FakeDb(), 'a/b')), null, 'identifiant avec / refusé');
  // Réseau coupé : la sauvegarde locale réussit, l'état passe hors ligne, l'envoi est retenté plus tard.
  const timers = new ManualTimers();
  const { db, cloud, statuses: s2 } = await setup({ timers });
  db!.down = true;
  assert.ok((await cloud.save('y', saveAt('2026-11-13T10:00:00.000Z'))).ok);
  await cloud.idle();
  assert.equal(s2.at(-1)!.state, 'offline');
  assert.ok((await cloud.load('y')).ok);
  db!.down = false;
  timers.fire();
  await cloud.idle();
  assert.ok(db!.docs.has(`data/users/joueur-42/${metaId('y')}`), 'retenté au créneau suivant');
  assert.equal(s2.at(-1)!.state, 'online');
  assert.equal(s2.at(-1)!.label, 'Sauvegardé en ligne');
});

test('migration : premier lancement en ligne -> sauvegardes locales envoyées (une fois)', async () => {
  const local = new SaveStore(new MemoryBackend());
  await local.save('ancienne', saveAt('2026-11-01T10:00:00.000Z'));
  await local.save('auto-1', saveAt('2026-11-02T10:00:00.000Z'));
  const db = new FakeDb();
  const p = await attachCloudSaves(local, { claude: claudeFor(db), noStart: true, onStatus: () => undefined }) as CloudSlotProvider;
  assert.ok(p.online);
  const sent = await p.start();
  await p.idle();
  assert.deepEqual(sent.sort(), ['ancienne', 'auto-1']);
  assert.ok(db.docs.has(`data/users/joueur-42/${metaId('ancienne')}`) && db.docs.has(`data/users/joueur-42/${metaId('auto-1')}`));
  const n = db.writes.length;
  assert.deepEqual(await p.start(), [], 'deuxième lancement : rien à migrer');
  await p.idle();
  assert.equal(db.writes.length, n);
});

test('limitation : autosauvegardes envoyées au plus 1 fois / 2 min, flush à la sortie', async () => {
  let now = 1_000_000;
  const timers = new ManualTimers();
  const { db, cloud } = await setup({ timers, now: () => now });
  await cloud.save('auto-1', saveAt('2026-11-13T10:00:00.000Z'));
  assert.equal(db!.writes.length, 0, 'pas d\'envoi immédiat pour une autosauvegarde');
  assert.equal(timers.pending[0]!.ms, 0);
  timers.fire();
  await cloud.idle();
  assert.equal(db!.writes.filter((w) => w === metaId('auto-1')).length, 1);
  now += 10_000;
  await cloud.save('auto-2', saveAt('2026-11-13T10:00:10.000Z'));
  await cloud.save('auto-3', saveAt('2026-11-13T10:00:20.000Z'));
  assert.equal(timers.pending.length, 1, 'un seul créneau en attente');
  assert.equal(timers.pending[0]!.ms, 110_000, 'prochain envoi 2 min après le précédent');
  await cloud.idle();
  assert.ok(!db!.writes.includes(metaId('auto-2')));
  // Sortie de page : tout part, sans attendre le créneau.
  await cloud.flush();
  assert.ok(db!.writes.includes(metaId('auto-2')) && db!.writes.includes(metaId('auto-3')));
  assert.equal(timers.pending.length, 0);
  // Emplacement nommé : envoi immédiat (sans limitation), suppression propagée.
  await cloud.save('ma-partie', saveAt('2026-11-13T10:01:00.000Z'));
  await cloud.idle();
  assert.ok(db!.docs.has(`data/users/joueur-42/${metaId('ma-partie')}`));
  await cloud.remove('ma-partie');
  assert.ok(!(await cloud.list()).some((s) => s.slot === 'ma-partie'));
  await cloud.idle();
  assert.ok(![...db!.docs.keys()].some((k) => k.includes('ma-partie')));
  assert.equal(db!.maxConcurrentPerDoc, 1, 'une écriture à la fois par document');
});
