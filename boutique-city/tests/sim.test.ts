/**
 * Simulation de Boutique City : quartier, aménagement, ventes, employés, stocks, finances, sauvegarde, équilibrage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECONOMY, FURNITURE_BY_ID, productsOf, type ShopType } from '../src/sim/catalog';
import { generateDistrict } from '../src/sim/district';
import { canPlace, layoutStats, unreachable, type PlacedItem } from '../src/sim/layout';
import { Game } from '../src/sim/game';

const DAY = 1440;

/** Meilleur local libre (passage le plus fort). */
function bestFree(g: Game): number {
  return g.district.premises.filter((p) => g.isFree(p)).sort((a, b) => b.footfall - a.footfall)[0]!.id;
}

/** Aménagement type d'un commerce : caisse(s) contre le mur du fond, meubles de présentation, décoration. */
function furnish(g: Game, shopId: number, type: ShopType): void {
  const s = g.shop(shopId)!;
  const p = g.premise(s.premiseId)!;
  const want: string[] = type === 'epicerie' ? ['caisse', 'rayon', 'rayon', 'rayon', 'frigo', 'frigo', 'plante', 'plante']
    : type === 'cafe' ? ['caisse', 'machine', 'comptoir', 'vitrine', 'frigo', 'table', 'table', 'table', 'plante']
    : ['caisse', 'portant', 'portant', 'portant', 'portant', 'rayon', 'plante', 'lampe'];
  for (const id of want) {
    const def = FURNITURE_BY_ID.get(id)!;
    let placed = false;
    for (let z = 0; z < p.gridD && !placed; z += 2) {
      for (let x = 0; x < p.gridW && !placed; x++) {
        if (canPlace(s.items, p.gridW, p.gridD, def, x, z, 0)) continue;
        const r = g.place(shopId, id, x, z, 0);
        if (r.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) placed = true;
        else if (r.ok) g.removeItem(shopId, r.data.uid);
      }
    }
    assert.ok(placed, `meuble ${id} posé`);
  }
}

function stockUp(g: Game, shopId: number): void {
  const s = g.shop(shopId)!;
  for (const pr of productsOf(s.type)) { const r = g.order(shopId, pr.id, 1000); assert.ok(r.ok, `commande ${pr.id} : ${r.ok ? '' : r.message}`); g.setAuto(shopId, pr.id, true); }
}

test('quartier : déterministe, locaux avec loyer et passage, concurrents, parc', () => {
  const a = generateDistrict(42), b = generateDistrict(42);
  assert.deepEqual(a, b);
  assert.ok(a.buildings.length > 100, `${a.buildings.length} immeubles`);
  assert.ok(a.premises.length >= 25, `${a.premises.length} locaux`);
  for (const p of a.premises) {
    assert.ok(p.footfall >= 180 && p.footfall <= 1100);
    assert.ok(p.rent > 500 && p.rent < 8000, `loyer ${p.rent}`);
    assert.ok(p.gridW >= 6 && p.gridD >= 6);
  }
  const comp = a.premises.filter((p) => p.competitor).length;
  assert.ok(comp > 0 && comp < a.premises.length * 0.7, `${comp} concurrents`);
  // Plus de passage => loyer au m² plus élevé.
  const sorted = [...a.premises].sort((x, y) => x.footfall - y.footfall);
  assert.ok(sorted.at(-1)!.rent / sorted.at(-1)!.area > sorted[0]!.rent / sorted[0]!.area);
});

test('aménagement : hors local, chevauchement, entrée dégagée, meuble inaccessible', () => {
  const caisse = FURNITURE_BY_ID.get('caisse')!, rayon = FURNITURE_BY_ID.get('rayon')!;
  const items: PlacedItem[] = [{ uid: 1, def: 'rayon', x: 0, z: 0, rot: 0 }];
  assert.equal(canPlace(items, 8, 8, caisse, 7, 0, 0), 'Hors du local');
  assert.equal(canPlace(items, 8, 8, caisse, 1, 0, 0), 'Place déjà occupée');
  assert.equal(canPlace(items, 8, 8, caisse, 3, 7, 0), "Laissez l'entrée dégagée");
  assert.equal(canPlace(items, 8, 8, rayon, 0, 2, 1), null);
  // Un rayon enfermé derrière un mur de rayons n'est pas accessible et ne compte pas.
  const walled: PlacedItem[] = [
    { uid: 1, def: 'rayon', x: 0, z: 0, rot: 0 }, { uid: 2, def: 'rayon', x: 0, z: 1, rot: 0 }, { uid: 3, def: 'rayon', x: 3, z: 0, rot: 1 },
  ];
  assert.deepEqual(unreachable(walled, 8, 8), [1]);
  const st = layoutStats(walled, 8, 8);
  assert.equal(st.capacity.rayon, 160, 'seuls les deux rayons accessibles comptent');
});

test('partie : louer, aménager, embaucher, commander, vendre une semaine', () => {
  const g = new Game(7, 'Testeur SA');
  const cash0 = g.cash;
  const pid = bestFree(g);
  const r = g.rent(pid, 'epicerie', 'Épicerie Test');
  assert.ok(r.ok);
  const shop = r.data;
  assert.equal(g.cash, cash0 - g.premise(pid)!.rent, 'dépôt de garantie payé');
  assert.equal(g.rent(pid, 'cafe').ok, false, 'local déjà loué');
  furnish(g, shop.id, 'epicerie');
  // Sans employé : magasin ouvert mais personne pour encaisser.
  stockUp(g, shop.id);
  g.advance(2 * DAY); // stock livré le lendemain à 7 h
  assert.equal(shop.history.at(-1)?.customers ?? 0, 0);
  assert.ok((shop.history.at(-1)?.lostStaff ?? 0) > 0, 'clients perdus faute de personnel');
  assert.ok(g.notices.some((n) => n.text.includes("personne n'y travaille")));
  const c = g.candidates[0]!;
  assert.ok(g.hire(c.id, shop.id).ok);
  g.advance(7 * DAY);
  const week = shop.history.slice(-7);
  const revenue = week.reduce((a, d) => a + d.revenue, 0);
  const customers = week.reduce((a, d) => a + d.customers, 0);
  assert.ok(customers > 300, `${customers} clients en 7 jours`);
  assert.ok(revenue > 3000, `${revenue.toFixed(0)} CHF de ventes en 7 jours`);
  assert.ok(week.every((d) => d.wages > 0 && d.rent > 0));
  assert.ok(shop.reputation > 0.5, `réputation ${shop.reputation.toFixed(2)}`);
  // Les stocks baissent et le réassort automatique a recommandé.
  assert.ok(g.ledger.some((d) => d.purchases > 0 && d.day > 1), 'réassort automatique');
});

test('stocks : capacité des meubles, remise de gros, livraison le lendemain à 7 h', () => {
  const g = new Game(3);
  const rented = g.rent(bestFree(g), 'epicerie');
  assert.ok(rented.ok);
  const s = rented.data;
  assert.equal(g.order(s.id, 'lait', 10).ok, false, 'aucun frigo : aucune place');
  furnish(g, s.id, 'epicerie');
  const lait = productsOf('epicerie').find((p) => p.id === 'lait')!;
  const cap = g.storageFor(s, lait);
  assert.equal(cap, 60, 'deux frigos (120 unités) partagés entre lait et boissons');
  const o = g.order(s.id, 'lait', 9999);
  assert.ok(o.ok);
  assert.equal(o.data.qty, cap, 'commande limitée à la place libre');
  assert.equal(g.order(s.id, 'lait', 1).ok, false, 'plus de place');
  assert.equal(g.orderCost('lait', ECONOMY.bulkQty), Math.round(ECONOMY.bulkQty * lait.cost * (1 - ECONOMY.bulkDiscount) * 100) / 100);
  g.advance(DAY);
  assert.equal(s.products['lait']!.stock > 0, true, 'livré');
});

test('sauvegarde : rechargement identique puis même suite', () => {
  const g = new Game(11, 'Sauve');
  const sh = g.rent(bestFree(g), 'cafe');
  assert.ok(sh.ok);
  furnish(g, sh.data.id, 'cafe');
  stockUp(g, sh.data.id);
  g.hire(g.candidates[0]!.id, sh.data.id);
  g.advance(2 * DAY + 333);
  const save = JSON.parse(JSON.stringify(g.save()));
  const h = new Game(11, 'x', save);
  assert.deepEqual(h.save(), g.save());
  g.advance(DAY); h.advance(DAY);
  assert.deepEqual(h.save(), g.save());
});

test('équilibrage : chaque type de commerce bien géré est rentable au meilleur emplacement', () => {
  const out: string[] = [];
  for (const type of ['epicerie', 'cafe', 'vetements'] as const) {
    const g = new Game(5);
    const sh = g.rent(bestFree(g), type);
    assert.ok(sh.ok);
    furnish(g, sh.data.id, type);
    stockUp(g, sh.data.id);
    g.hire(g.candidates.sort((a, b) => b.skill - a.skill)[0]!.id, sh.data.id);
    const cash0 = g.cash;
    g.advance(14 * DAY);
    const days = g.shop(sh.data.id)!.history.slice(-7);
    if (process.env.EQ) console.log(type, JSON.stringify(days.map((d) => ({ c: d.customers, ls: d.lostStock, lc: d.lostCapacity, lf: d.lostStaff, rev: Math.round(d.revenue), cos: Math.round(d.costOfSales), w: d.wages, rent: d.rent }))), 'rep', g.shop(sh.data.id)!.reputation.toFixed(2), 'att', g.attractiveness(g.shop(sh.data.id)!).toFixed(2), 'foot', g.premise(g.shop(sh.data.id)!.premiseId)!.footfall, 'comp', g.competition(g.premise(g.shop(sh.data.id)!.premiseId)!, type));
    const margin = days.reduce((a, d) => a + d.revenue - d.costOfSales - d.wages - d.rent, 0) / 7;
    out.push(`${type} : ${Math.round(days.reduce((a, d) => a + d.revenue, 0) / 7)} CHF/j de ventes, ${Math.round(days.reduce((a, d) => a + d.customers, 0) / 7)} clients/j, résultat ${Math.round(margin)} CHF/j, trésorerie ${Math.round(cash0)} → ${Math.round(g.cash)}`);
    assert.ok(margin > 50, `${type} rentable : ${margin.toFixed(0)} CHF/j`);
    assert.ok(margin < 3000, `${type} pas trop facile : ${margin.toFixed(0)} CHF/j`);
  }
  console.log(out.join('\n'));
});
