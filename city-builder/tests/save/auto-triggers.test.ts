/**
 * Sauvegarde entièrement automatique (src/save/auto-triggers.ts) : actions importantes (≤ 1/min avec
 * rattrapage), arrière-plan / fermeture / menu (sauvegarde + envoi en ligne), « Continuer » = partie
 * la plus récente, y compris retrouvée en ligne sur un autre appareil ; autosauvegarde envoyée en ligne.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoSaveTriggers, IMPORTANT_COMMANDS, latestSlot } from '../../src/save/auto-triggers';
import { Autosaver } from '../../src/save/autosave';
import { MemoryBackend } from '../../src/save/backends';
import { CloudSlotProvider, metaId, type CollectionLike, type Timers } from '../../src/save/cloud';
import { SaveStore } from '../../src/save/store';
import type { SaveFile } from '../../src/shared/contracts';
import { buildTown, newTownSim, runDays } from '../sim/fixtures';

class ManualTimers implements Timers {
  pending: Array<{ fn: () => void; ms: number; id: number }> = [];
  private seq = 0;
  set(fn: () => void, ms: number): unknown { const id = ++this.seq; this.pending.push({ fn, ms, id }); return id; }
  clear(h: unknown): void { this.pending = this.pending.filter((p) => p.id !== h); }
  fire(): void { for (const x of this.pending.splice(0)) x.fn(); }
}

/** Faux db minimal (mêmes conventions que cloud.test.ts). */
function fakeCol(docs: Map<string, unknown>): CollectionLike {
  const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
  return {
    doc: (id) => ({
      get: async () => { await tick(); const v = docs.get(id); return { exists: v !== undefined, data: () => structuredClone(v) }; },
      set: async (o) => { await tick(); docs.set(id, JSON.parse(JSON.stringify(o))); },
      delete: async () => { await tick(); docs.delete(id); },
    }),
    where: (f, _op, v) => ({ get: async () => { await tick(); return { docs: [...docs].filter(([, d]) => (d as Record<string, unknown>)[f] === v).map(([id, d]) => ({ id, data: () => structuredClone(d) })) }; } }),
  };
}

let town: ReturnType<typeof newTownSim> | null = null;
function saveAt(iso: string): SaveFile {
  if (!town) { town = newTownSim(); buildTown(town); runDays(town, 1); }
  return { ...town.toSave(), savedAt: iso };
}

test('actions importantes : sauvegarde immédiate puis au plus 1/min, avec rattrapage', async () => {
  let now = 0;
  const timers = new ManualTimers();
  let saved = 0;
  let active = true;
  const t = new AutoSaveTriggers({ saveNow: async () => { saved++; }, isActive: () => active, now: () => now, timers });
  assert.ok(IMPORTANT_COMMANDS.has('placeBuilding') && IMPORTANT_COMMANDS.has('demolish') && !IMPORTANT_COMMANDS.has('setSpeed'));
  await t.noteAction();
  assert.equal(saved, 1, 'première action : sauvegarde immédiate');
  now = 5_000;
  await t.noteAction();
  now = 20_000;
  await t.noteAction();
  assert.equal(saved, 1);
  assert.equal(timers.pending.length, 1, 'un seul rattrapage programmé');
  assert.equal(timers.pending[0]!.ms, 55_000, 'rattrapage une minute après la précédente');
  now = 60_000;
  timers.fire();
  await new Promise((r) => setImmediate(r));
  assert.equal(saved, 2);
  // Hors partie (menu principal, démonstration) : rien.
  active = false;
  now = 500_000;
  await t.noteAction();
  await t.saveAndFlush();
  assert.equal(saved, 2);
});

test('arrière-plan / fermeture / menu : sauvegarde locale puis envoi en ligne immédiat', async () => {
  const order: string[] = [];
  const timers = new ManualTimers();
  let now = 0;
  const t = new AutoSaveTriggers({
    saveNow: async () => { order.push('save'); }, flushCloud: async () => { order.push('flush'); },
    isActive: () => true, now: () => now, timers,
  });
  const listeners = new Map<string, () => void>();
  const doc = { visibilityState: 'visible', addEventListener: (k: string, f: () => void) => listeners.set(`doc:${k}`, f) };
  t.install({ addEventListener: (k, f) => listeners.set(`win:${k}`, f) }, doc);
  await t.noteAction();
  now = 1000;
  await t.noteAction(); // rattrapage programmé…
  assert.equal(timers.pending.length, 1);
  doc.visibilityState = 'hidden';
  listeners.get('doc:visibilitychange')!();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['save', 'save', 'flush']);
  assert.equal(timers.pending.length, 0, '…remplacé par la sauvegarde de sortie');
  listeners.get('win:pagehide')!();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order.slice(3), ['save', 'flush']);
  await t.saveAndFlush(); // retour au menu
  assert.deepEqual(order.slice(5), ['save', 'flush']);
});

test('« Continuer » : la partie la plus récente, locale ou en ligne (autre appareil retrouvé)', async () => {
  assert.equal(latestSlot([]), null);
  assert.equal(latestSlot([{ slot: 'a', savedAt: '2026-01-01' }, { slot: 'b', savedAt: '2026-03-01' }, { slot: 'c', savedAt: '2026-02-01' }]), 'b');
  const docs = new Map<string, unknown>();
  // Appareil 1 : l'autosauvegarde périodique part aussi en ligne (sans action du joueur).
  const timers1 = new ManualTimers();
  const dev1 = new CloudSlotProvider(new SaveStore(new MemoryBackend()), { col: fakeCol(docs), timers: timers1, onStatus: () => undefined });
  let clock = 0;
  const auto = new Autosaver(async () => saveAt(new Date(Date.UTC(2026, 10, 13, 10, clock++)).toISOString()), dev1);
  assert.ok((await auto.saveNow()).ok);
  timers1.fire();
  await dev1.idle();
  assert.ok(docs.has(metaId('auto-1')), 'autosauvegarde envoyée en ligne');
  assert.ok((await auto.saveNow()).ok);
  await dev1.flush(); // sortie de page
  assert.ok(docs.has(metaId('auto-2')));
  // Appareil 2 : une vieille partie locale ; la plus récente (en ligne) est proposée et se charge.
  const local2 = new SaveStore(new MemoryBackend());
  await local2.save('vieille', saveAt('2026-11-01T00:00:00.000Z'));
  const dev2 = new CloudSlotProvider(local2, { col: fakeCol(docs), timers: new ManualTimers(), onStatus: () => undefined });
  const slot = latestSlot(await dev2.list());
  assert.equal(slot, 'auto-2');
  const l = await dev2.load(slot!);
  assert.ok(l.ok && l.value.savedAt === '2026-11-13T10:01:00.000Z');
});
