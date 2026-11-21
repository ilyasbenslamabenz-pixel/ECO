/**
 * Concurrence active : entreprises rivales tirées de la graine, calme du début de partie, ouvertures, promotions
 * bornées, faillite (locaux libérés), rachat d'un commerce ou d'une entreprise, sauvegarde à l'identique.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RIVALS } from '../src/sim/catalog';
import { competitorsNear } from '../src/sim/district';
import { Game } from '../src/sim/game';
import type { Rng } from '../src/sim/rng';
import type { RivalCo } from '../src/sim/rivals';

const DAY = 1440;
const live = (g: Game, days: number): void => { for (let d = 0; d < days; d++) { g.player.energy = 100; g.player.hunger = 100; g.advance(DAY); } };

test('début de partie : 2 à 4 entreprises rivales, chacune avec des commerces ; tous les concurrents sont suivis', () => {
  for (const seed of [1, 3, 7, 11, 42]) {
    const g = new Game(seed), rv = g.rivalry;
    assert.ok(rv.cos.length >= RIVALS.countMin && rv.cos.length <= RIVALS.countMax, `seed ${seed} : ${rv.cos.length} rivaux`);
    assert.equal(new Set(rv.cos.map((c) => c.name)).size, rv.cos.length);
    for (const co of rv.cos) assert.ok(rv.shopsOf(co.id).length >= 1, `${co.name} a au moins un commerce`);
    const comp = g.district.premises.filter((p) => p.competitor);
    assert.equal(comp.length, rv.shops.length);
    for (const p of comp) assert.equal(rv.shopAt(p.id)?.name, p.competitorName);
  }
});

test('calme jusqu’au jour 10 : concurrence identique à l’ancienne règle, ni ouverture ni promotion', () => {
  const g = new Game(7), rv = g.rivalry;
  const free = g.district.premises.filter((p) => g.isFree(p)).slice(0, 12);
  for (const p of free) for (const t of ['epicerie', 'cafe', 'fastfood'] as const) assert.equal(g.competition(p, t), competitorsNear(g.district, p, t));
  const before = rv.shops.map((s) => s.premiseId).join(',');
  live(g, RIVALS.startDay - 1);
  assert.ok(g.day < RIVALS.startDay);
  assert.equal(rv.shops.map((s) => s.premiseId).join(','), before, 'aucune ouverture ni fermeture');
  assert.ok(rv.shops.every((s) => s.promo === 0 && s.price === 1), 'ni promotion ni changement de prix');
  assert.ok(rv.shops.every((s) => s.revenue.length > 0), 'chiffre d’affaires estimé chaque nuit');
});

test('après le jour 10 : les rivaux agissent (ouvertures, promotions ou prix) de façon déterministe', () => {
  const run = (): string => { const g = new Game(7); live(g, 45); return JSON.stringify(g.rivalry.save()); };
  const a = run();
  assert.equal(a, run(), 'même graine, même concurrence');
  const g = new Game(7), start = g.rivalry.shops.length;
  live(g, 45);
  const rv = g.rivalry;
  const acted = rv.shops.length !== start || rv.shops.some((s) => s.price !== 1 || s.opened > 0) || rv.cos.some((c) => c.gone);
  assert.ok(acted, 'au moins une action rivale en 45 jours');
  assert.ok(rv.shops.filter((s) => s.co).length <= rv.cos.length * RIVALS.maxShops);
  assert.ok(g.district.premises.filter((p) => g.isFree(p)).length > RIVALS.minFreeLeft, 'des locaux restent libres pour le joueur');
});

test('promotion rivale : effet borné et lisible sur le commerce du joueur du même type à proximité', () => {
  const g = new Game(7), rv = g.rivalry;
  // Un commerce rival et le local libre le plus proche, loué par le joueur avec le même type.
  const rs = rv.shops.find((s) => s.co)!;
  const rp = g.premise(rs.premiseId)!;
  const near = g.district.premises.filter((p) => g.isFree(p)).sort((a, b) => Math.hypot(a.doorX - rp.doorX, a.doorZ - rp.doorZ) - Math.hypot(b.doorX - rp.doorX, b.doorZ - rp.doorZ))[0]!;
  const r = g.rent(near.id, rs.type);
  assert.ok(r.ok);
  const s = r.data;
  assert.equal(rv.promoFactor(s), 1);
  for (const x of rv.shops) if (x.type === rs.type) x.promo = 4;
  const f = rv.promoFactor(s);
  assert.ok(f < 1 && f >= 1 - RIVALS.promoMax - 1e-9, `facteur ${f}`);
  // Promotion plus chère pour le rival, mais plus de clients chez lui.
  const withPromo = rv.estimate(rs);
  rs.promo = 0;
  const without = rv.estimate(rs);
  assert.ok(withPromo.customers > without.customers);
});

test('ouverture près d’un commerce du joueur : notification d’alerte', () => {
  const g = new Game(3), rv = g.rivalry;
  live(g, RIVALS.startDay);
  const co = rv.active[0]!;
  const type = co.types[0]!;
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  assert.ok(g.rent(p.id, type).ok);
  co.types = [type]; co.cash = 1e6;
  const n = rv.shops.length;
  // Ouverture forcée (méthode privée) avec un tirage neutre.
  const priv = rv as unknown as { open: (c: RivalCo, rng: Rng) => boolean };
  assert.ok(priv.open(co, { next: () => 0.5, pick: <T>(l: readonly T[]) => l[0]!, int: (a: number) => a } as unknown as Rng));
  assert.equal(rv.shops.length, n + 1);
  const opened = rv.shops.at(-1)!, q = g.premise(opened.premiseId)!;
  assert.equal(q.competitor, type);
  const d = Math.hypot(q.doorX - p.doorX, q.doorZ - p.doorZ);
  const last = g.notices.at(-1)!;
  if (d < RIVALS.nearRadius) { assert.equal(last.level, 'warn'); assert.match(last.text, /ouvre à \d+ m de votre/); }
  else { assert.equal(last.level, 'info'); assert.match(last.text, /Nouvelle ouverture/); }
});

test('faillite : l’entreprise disparaît et ses locaux redeviennent libres', () => {
  const g = new Game(7), rv = g.rivalry;
  live(g, RIVALS.startDay);
  const co = rv.active[0]!;
  const premises = rv.shopsOf(co.id).map((s) => s.premiseId);
  co.cash = RIVALS.bankruptCash - 50_000;
  live(g, 1);
  assert.equal(co.gone, true);
  assert.equal(rv.shopsOf(co.id).length, 0);
  for (const id of premises) assert.ok(g.isFree(g.premise(id)!), `local ${id} libre`);
  assert.ok(g.notices.some((n) => n.text.startsWith(`Faillite : ${co.name}`)));
});

test('rachat d’un commerce rival : meublé, approvisionné, employés en option, prix affiché payé', () => {
  const g = new Game(7), rv = g.rivalry;
  live(g, 3);
  const rs = rv.shops.find((s) => s.co)!;
  const q = rv.quote(rs.premiseId)!;
  assert.ok(q.price >= RIVALS.buyMin && q.total === q.price + q.deposit);
  g.cash = 5000;
  assert.equal(rv.buy(rs.premiseId, true).ok, false, 'trésorerie insuffisante refusée');
  g.cash = q.total + 10_000;
  const staffBefore = g.employees.length;
  const r = rv.buy(rs.premiseId, true);
  assert.ok(r.ok);
  const s = r.data;
  assert.ok(Math.abs(g.cash - 10_000) < 1e-6, `payé ${q.total}`);
  assert.equal(g.shopAt(rs.premiseId), s);
  assert.equal(s.type, rs.type);
  assert.equal(s.name, rs.name);
  assert.equal(rv.shopAt(rs.premiseId), undefined);
  assert.equal(g.premise(rs.premiseId)!.competitor, null);
  const st = g.stats(s);
  assert.ok(st.registers >= 1 && st.blocked.length === 0, 'caisse posée, tout accessible');
  assert.ok(Object.values(s.products).some((p) => p.stock > 0), 'stock de départ');
  assert.equal(g.employees.length - staffBefore, q.staff);
  // Le commerce racheté vend dès le lendemain.
  live(g, 1);
  assert.ok((s.history.at(-1)?.customers ?? 0) > 0, 'des clients le premier jour');
});

test('rachat d’une entreprise entière', () => {
  const g = new Game(7), rv = g.rivalry;
  const co = rv.active[0]!;
  const q = rv.companyQuote(co.id)!;
  const n = rv.shopsOf(co.id).length;
  g.cash = q.total + 1;
  const r = rv.buyCompany(co.id, false);
  assert.ok(r.ok && r.data === n);
  assert.equal(co.gone, true);
  assert.equal(co.bought, true);
  assert.equal(g.shops.length, n);
  assert.ok(g.cash > -1 && g.cash < 2 + 1e-6);
});

test('sauvegarde et rechargement à l’identique (concurrence comprise) ; anciennes sauvegardes acceptées', () => {
  const g = new Game(11, 'Riv SA');
  live(g, 24);
  const s1 = g.save();
  assert.ok(s1.rivalry && s1.rivalry.cos.length >= 2);
  const h = new Game(11, 'Riv SA', structuredClone(s1));
  assert.deepEqual(h.save(), s1);
  live(g, 6); live(h, 6);
  assert.deepEqual(h.save(), g.save());
  for (const p of h.district.premises) assert.equal(p.competitor, g.premise(p.id)!.competitor);
  // Sauvegarde sans le champ : rivaux tirés de la graine.
  const old = structuredClone(s1);
  delete old.rivalry;
  const o = new Game(11, 'Riv SA', old);
  assert.ok(o.rivalry.cos.length >= RIVALS.countMin);
});
