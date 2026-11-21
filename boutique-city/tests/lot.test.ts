/**
 * Réglages en lot (gestion centralisée) : aperçu sans effet, application par type ou à tous les commerces (prix par
 * coefficient ou par produit, réassort automatique, horaires, nettoyage de nuit), refus des réglages invalides.
 * Et grand livre : gains des placements inscrits chaque nuit, hors bénéfice d'exploitation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FURNITURE_BY_ID, PREMIUM, productsOf, type ServiceKind, type ShopType } from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { canPlace, layoutStats } from '../src/sim/layout';
import { Game, dayProfit, type BatchChange, type GameSave } from '../src/sim/game';

const LAYOUTS: Partial<Record<ShopType, string[]>> = {
  epicerie: ['caisse', 'rayon', 'rayon', 'frigo', 'plante'],
  cafe: ['caisse', 'machine', 'comptoir', 'vitrine', 'frigo', 'table'],
};

function goTo(g: Game, kind: ServiceKind): void {
  const b = serviceBuilding(g.district, kind)!;
  g.setPlace({ kind: 'service', service: kind, buildingId: b.id });
}

function openShop(g: Game, type: ShopType): number {
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  const r = g.rent(p.id, type);
  assert.ok(r.ok, r.ok ? '' : r.message);
  const id = r.data.id, s = g.shop(id)!;
  goTo(g, 'meubles');
  for (const f of LAYOUTS[type]!) {
    assert.ok(g.buyFurniture(f, 1, id).ok);
    const def = FURNITURE_BY_ID.get(f)!;
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(s.items, p.gridW, p.gridD, def, x, z, 0)) continue;
      const q = g.place(id, f, x, z, 0);
      if (q.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (q.ok) g.pickUp(id, q.data.uid);
    }
  }
  g.setPlace({ kind: 'rue' });
  return id;
}

function threeShops(): { g: Game; e1: number; e2: number; c: number } {
  const g = new Game(7, 'Test');
  g.cash = 200_000;
  const e1 = openShop(g, 'epicerie'), e2 = openShop(g, 'epicerie'), c = openShop(g, 'cafe');
  return { g, e1, e2, c };
}

test('lot : l’aperçu liste les changements sans rien modifier', () => {
  const { g, e1, e2, c } = threeShops();
  const before = JSON.stringify(g.shops), v = g.version;
  const r = g.previewBatch('epicerie', { priceFactor: 1.1, auto: true, hours: { open: 7, close: 21 }, cleanService: true });
  assert.ok(r.ok);
  assert.equal(JSON.stringify(g.shops), before, 'rien n’a changé');
  assert.equal(g.version, v);
  const shops = new Set(r.data.map((x) => x.shopId));
  assert.deepEqual([...shops].sort(), [e1, e2].sort(), 'seulement les épiceries');
  assert.ok(!shops.has(c));
  const n = productsOf('epicerie').length;
  for (const id of [e1, e2]) {
    const list: BatchChange[] = r.data.filter((x) => x.shopId === id);
    assert.equal(list.filter((x) => x.kind === 'prix').length, n);
    assert.equal(list.filter((x) => x.kind === 'auto').length, n);
    assert.equal(list.filter((x) => x.kind === 'horaires').length, 1);
    const cl = list.find((x) => x.kind === 'nettoyage')!;
    assert.equal(cl.perDay, g.cleanServiceCost(id), 'coût par jour annoncé');
    assert.ok(list.every((x) => x.from !== x.to && x.label.length > 0));
  }
});

test('lot : application à un type (coefficient, réassort, horaires, nettoyage)', () => {
  const { g, e1, e2, c } = threeShops();
  const cafe = JSON.stringify(g.shop(c)!);
  const r = g.applyBatch('epicerie', { priceFactor: 1.1, auto: true, hours: { open: 7, close: 21 }, cleanService: true });
  assert.ok(r.ok);
  assert.equal(r.data.shops, 2);
  for (const id of [e1, e2]) {
    const s = g.shop(id)!;
    for (const pr of productsOf('epicerie')) {
      assert.ok(Math.abs(s.products[pr.id]!.price - g.refPrice(pr, s) * 1.1) < 0.006, `${pr.id} au prix du quartier × 1,1`);
      assert.equal(s.products[pr.id]!.auto, true);
    }
    assert.equal(s.open, 7); assert.equal(s.close, 21);
    assert.equal(s.cleanService, true);
  }
  assert.equal(JSON.stringify(g.shop(c)!), cafe, 'le café n’est pas touché');
  // Réappliquer la même chose : plus rien à changer.
  const again = g.previewBatch('epicerie', { priceFactor: 1.1, auto: true, hours: { open: 7, close: 21 }, cleanService: true });
  assert.ok(again.ok && again.data.length === 0);
  assert.ok(g.notices.some((n) => n.text.startsWith('Réglages en lot appliqués')));
});

test('lot : tous les commerces, prix par produit, bornes de prix et gamme premium', () => {
  const { g, e1, e2, c } = threeShops();
  const pr = productsOf('epicerie')[0]!;
  const r = g.applyBatch('tous', { auto: false, cleanService: false, prices: { [pr.id]: pr.basePrice * 1.2 } });
  assert.ok(r.ok);
  for (const id of [e1, e2]) assert.ok(Math.abs(g.shop(id)!.products[pr.id]!.price - pr.basePrice * 1.2) < 0.006);
  assert.ok(productsOf('cafe').every((p) => !g.shop(c)!.products[p.id]!.auto), 'le café passe aussi en réassort manuel');
  // Prix par produit prioritaire sur le coefficient ; borné comme setPrice (×3 au plus).
  assert.ok(g.applyBatch('epicerie', { priceFactor: 0.9, prices: { [pr.id]: pr.basePrice * 10 } }).ok);
  assert.ok(Math.abs(g.shop(e1)!.products[pr.id]!.price - pr.basePrice * 3) < 0.006, 'plafonné à ×3');
  const other = productsOf('epicerie')[1]!;
  assert.ok(Math.abs(g.shop(e1)!.products[other.id]!.price - g.refPrice(other, g.shop(e1)!) * 0.9) < 0.006);
  // Gamme premium : le coefficient s'applique au prix du quartier premium.
  g.shop(e2)!.premium = true;
  assert.ok(g.applyBatch('epicerie', { priceFactor: 1 }).ok);
  assert.ok(Math.abs(g.shop(e2)!.products[other.id]!.price - other.basePrice * (g.rivals['epicerie'] ?? 1) * PREMIUM.priceMult) < 0.006);
});

test('lot : réglages invalides refusés, aucun commerce visé', () => {
  const { g } = threeShops();
  const before = JSON.stringify(g.shops);
  assert.equal(g.applyBatch('epicerie', { priceFactor: 5 }).ok, false);
  assert.equal(g.applyBatch('epicerie', { priceFactor: Number.NaN }).ok, false);
  assert.equal(g.applyBatch('tous', { hours: { open: 10, close: 12 } }).ok, false, 'moins de 4 h');
  assert.equal(g.applyBatch('tous', { hours: { open: 4, close: 20 } }).ok, false, 'avant 5 h');
  assert.equal(g.applyBatch('tous', { prices: { inconnu: 3 } }).ok, false);
  assert.equal(g.applyBatch('tous', { prices: { [productsOf('cafe')[0]!.id]: -1 } }).ok, false);
  assert.equal(g.applyBatch('fleuriste', { auto: true }).ok, false, 'aucun fleuriste');
  assert.equal(JSON.stringify(g.shops), before, 'rien n’a changé');
  const empty = g.applyBatch('tous', {});
  assert.ok(empty.ok && empty.data.changes === 0);
});

test('lot : réglages conservés à la sauvegarde', () => {
  const { g, e1 } = threeShops();
  assert.ok(g.applyBatch('tous', { priceFactor: 1.05, hours: { open: 6, close: 22 }, cleanService: true, auto: true }).ok);
  const h = new Game(7, 'Test', JSON.parse(JSON.stringify(g.save())) as GameSave);
  assert.deepEqual(h.shop(e1)!.products, g.shop(e1)!.products);
  assert.equal(h.shop(e1)!.open, 6); assert.equal(h.shop(e1)!.cleanService, true);
});

test('grand livre : intérêts et plus-values des placements inscrits chaque nuit, hors bénéfice', () => {
  const g = new Game(7, 'Test');
  g.cash = 50_000;
  assert.ok(g.deposit('epargne', 20_000).ok);
  assert.ok(g.deposit('fonds', 10_000).ok);
  const len = g.ledger.length;
  let before = g.invest.epargne + g.invest.fonds;
  for (let d = 0; d < 3; d++) {
    g.player.energy = 100; g.player.hunger = 100;
    g.advance(1440);
    const y = g.ledger.at(-1)!, now = g.invest.epargne + g.invest.fonds;
    assert.ok(y.investGain !== undefined && Math.abs(y.investGain - (now - before)) < 0.02, `jour ${y.day + 1} : ${y.investGain} CHF`);
    const p = dayProfit(y);
    assert.ok(Number.isFinite(p));
    before = now;
  }
  assert.equal(g.ledger.length, len + 3, 'une seule ligne de grand livre par jour');
  // Hors bénéfice : le résultat du jour ne compte pas les gains des placements.
  const y = g.ledger.at(-1)!;
  assert.equal(dayProfit(y), dayProfit({ ...y, investGain: 0 }));
});
