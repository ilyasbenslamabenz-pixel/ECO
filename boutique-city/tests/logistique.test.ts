/**
 * Logistique : entrepôts réservés sur la carte, étagères, importateur (palettes, minimum, délai, prix), tournées de
 * nuit vers les commerces sous le minimum (capacité du véhicule, coût), alertes d'entrepôt vide, sauvegarde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FURNITURE_BY_ID, LOGISTICS, PRODUCT_BY_ID, productsOf } from '../src/sim/catalog';
import { generateDistrict, serviceBuilding } from '../src/sim/district';
import { canPlace } from '../src/sim/layout';
import { Game } from '../src/sim/game';
import {
  autoMins, buyRacks, capacityOf, importQuote, importUnit, minOf, palletOf, placeImport, releaseWarehouse, rentWarehouse, runTours,
  sellRack, setMin, setTransport, stow, takeOut, warehouseAt, warehousePremises,
} from '../src/sim/logistics';

const DAY = 1440;
const keepAlive = (g: Game): void => { g.player.energy = 100; g.player.hunger = 100; };
function goToHour(g: Game, h: number): void {
  const now = g.total % DAY, target = h * 60;
  keepAlive(g);
  g.advance(target > now ? target - now : DAY - now + target);
}

/** Épicerie aménagée (sans stock) sur le meilleur local libre. */
function shop(g: Game): number {
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  const r = g.rent(p.id, 'epicerie');
  if (!r.ok) throw new Error(r.message);
  const id = r.data.id, s = g.shop(id)!;
  const b = serviceBuilding(g.district, 'meubles')!;
  g.setPlace({ kind: 'service', service: 'meubles', buildingId: b.id });
  for (const f of ['caisse', 'rayon', 'rayon', 'frigo']) {
    assert.ok(g.buyFurniture(f, 1, id).ok);
    const def = FURNITURE_BY_ID.get(f)!;
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(s.items, p.gridW, p.gridD, def, x, z, 0)) continue;
      done = g.place(id, f, x, z, 0).ok;
    }
  }
  g.setPlace({ kind: 'rue' });
  return id;
}

test('entrepôts : 1 à 3 locaux réservés, en périphérie, hors des locaux à louer en boutique', () => {
  const d = generateDistrict(7);
  const w = d.premises.filter((p) => p.warehouse);
  assert.ok(w.length >= 1 && w.length <= 3, `${w.length} entrepôts`);
  const g = new Game(7);
  for (const p of warehousePremises(g)) {
    assert.equal(g.isFree(p), false, 'pas un local de boutique');
    assert.equal(p.competitor, null);
  }
  const best = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  assert.ok(w.every((p) => p.footfall < best.footfall));
  // Les identifiants des locaux ne changent pas (début de partie inchangé).
  d.premises.forEach((p, k) => assert.equal(p.id, k + 1));
  assert.equal(g.rent(w[0]!.id, 'epicerie').ok, false);
});

test('location, étagères, importateur : minimum, prix, délai, arrivage', () => {
  const g = new Game(7);
  g.cash = 100_000;
  const wp = warehousePremises(g)[0]!;
  assert.equal(placeImport(g, 1, { pain: 10 }).ok, false, 'pas d’entrepôt : pas d’importateur');
  const r = rentWarehouse(g, wp.id);
  assert.ok(r.ok);
  const w = r.data;
  assert.equal(rentWarehouse(g, wp.id).ok, false, 'déjà loué');
  // Sans étagères : pas de place.
  assert.equal(placeImport(g, w.id, { pain: 5 }).ok, false);
  assert.ok(buyRacks(g, w.id, 2).ok);
  assert.equal(capacityOf(w), 2 * LOGISTICS.rackCapacity);
  // Minimum de palettes.
  const small = placeImport(g, w.id, { pain: 2 });
  assert.equal(small.ok, false);
  if (!small.ok) assert.match(small.message, /minimale/);
  // Moins cher que le grossiste (même avec la remise de gros).
  const pain = PRODUCT_BY_ID.get('pain')!;
  assert.ok(importUnit(pain) < g.orderCost('pain', 100) / 100);
  const q = importQuote(g, { pain: 3, lait: 2 });
  assert.equal(q.units, 3 * palletOf(pain) + 2 * palletOf(PRODUCT_BY_ID.get('lait')!));
  assert.equal(q.days, 1);
  const cash = g.cash;
  const o = placeImport(g, w.id, { pain: 3, lait: 2 });
  assert.ok(o.ok, o.ok ? '' : o.message);
  assert.ok(Math.abs(cash - g.cash - q.total) < 0.01, 'payé à la commande');
  // Trop gros pour la place libre.
  assert.equal(placeImport(g, w.id, { conserves: 5 }).ok, false);
  // Arrivage le lendemain à 14 h.
  goToHour(g, 13);
  if (g.day === 0) goToHour(g, 13);
  assert.equal(w.stock.pain ?? 0, 0);
  goToHour(g, 15);
  assert.equal(warehouseAt(g, wp.id)!.stock.pain, 300);
  assert.equal(warehouseAt(g, wp.id)!.stock.lait, 200);
  assert.equal(sellRack(g, w.id).ok, false, 'étagères pleines : revente refusée');
});

test('tournée de nuit : produits sous le minimum, capacité du véhicule, coût, alerte entrepôt vide', () => {
  const g = new Game(7);
  g.cash = 200_000;
  const id = shop(g), s = g.shop(id)!;
  const w = rentWarehouse(g, warehousePremises(g)[0]!.id);
  assert.ok(w.ok);
  const wh = w.data;
  assert.ok(buyRacks(g, wh.id, 8).ok);
  wh.stock = { pain: 500, lait: 400, fruits: 300 };
  assert.ok(autoMins(g, id).ok);
  for (const pr of productsOf('epicerie')) assert.ok(minOf(g, id, pr.id) > 0);
  // Sans transport : rien ne bouge.
  assert.equal(runTours(g).length, 0);
  assert.equal(s.products.pain!.stock, 0);
  // Transporteur : rayons remplis, coût visible et compté.
  assert.ok(setTransport(g, wh.id, 'service').ok);
  const purchases = g.today.purchases, cash = g.cash;
  const before = g.notices.length;
  const reps = runTours(g, true);
  assert.equal(reps.length, 1);
  const rep = reps[0]!;
  assert.ok(rep.units > 0 && rep.units <= LOGISTICS.service.cargo);
  assert.equal(rep.stops, 1);
  assert.ok(Math.abs(rep.cost - (LOGISTICS.service.base + LOGISTICS.service.perStop + LOGISTICS.service.perUnit * rep.units)) < 0.01);
  assert.ok(Math.abs(cash - g.cash - rep.cost) < 0.01);
  assert.ok(g.today.purchases > purchases);
  assert.equal(s.products.pain!.stock, g.storageFor(s, PRODUCT_BY_ID.get('pain')!), 'rayon plein');
  assert.ok(s.products.lait!.stock > 0);
  // Produits sans stock à l'entrepôt : alerte.
  assert.ok(g.notices.slice(before).some((n) => /Entrepôt vide/.test(n.text)), 'alerte entrepôt vide');
  assert.ok(rep.missing.includes('boissons'));
  // Au-dessus du minimum : pas de nouvelle livraison.
  const stockPain = wh.stock.pain;
  runTours(g, true);
  assert.equal(wh.stock.pain, stockPain);
  // Véhicule assigné : capacité limitée par la soute.
  s.products.pain!.stock = 0; s.products.fruits!.stock = 0; s.products.lait!.stock = 0;
  const b = serviceBuilding(g.district, 'garage')!;
  g.setPlace({ kind: 'service', service: 'garage', buildingId: b.id });
  const v = g.buyVehicle('scooter');
  assert.ok(v.ok);
  assert.ok(setTransport(g, wh.id, 'vehicule', v.ok ? v.data.id : null).ok);
  const r2 = runTours(g, true)[0]!;
  assert.equal(r2.units, 60, 'scooter : 60 unités');
  assert.equal(r2.cost, LOGISTICS.own.base + LOGISTICS.own.perStop);
  // Tournée automatique à l'heure fixe.
  s.products.pain!.stock = 0;
  goToHour(g, LOGISTICS.tourHour + 1);
  assert.ok(s.products.pain!.stock > 0, 'tournée de nuit');
  assert.ok(g.logi.tours.some((t) => !t.manual));
});

test('déchargement et chargement sur place, résiliation', () => {
  const g = new Game(7);
  g.cash = 50_000;
  const wp = warehousePremises(g)[0]!;
  const w = rentWarehouse(g, wp.id);
  assert.ok(w.ok);
  assert.ok(buyRacks(g, w.data.id, 2).ok);
  g.player.carry = { pain: 20 };
  assert.equal(stow(g, w.data.id).ok, false, 'pas sur place');
  g.setPlace({ kind: 'local', premiseId: wp.id });
  assert.ok(stow(g, w.data.id).ok);
  assert.equal(w.data.stock.pain, 20);
  assert.deepEqual(g.player.carry, {});
  assert.ok(takeOut(g, w.data.id, 'pain', 5, 'pied').ok);
  assert.equal(g.player.carry.pain, 5);
  const cash = g.cash;
  assert.ok(releaseWarehouse(g, w.data.id).ok);
  assert.ok(g.cash > cash);
  assert.equal(g.logi.warehouses.length, 0);
});

test('sauvegarde : logistique rechargée à l’identique ; anciennes sauvegardes sans logistique', () => {
  const g = new Game(7);
  g.cash = 100_000;
  const id = shop(g);
  const w = rentWarehouse(g, warehousePremises(g)[0]!.id);
  assert.ok(w.ok);
  assert.ok(buyRacks(g, w.data.id, 6).ok);
  assert.ok(placeImport(g, w.data.id, { pain: 5, lait: 2 }).ok);
  assert.ok(setMin(g, id, 'pain', 40).ok);
  assert.ok(setTransport(g, w.data.id, 'service').ok);
  keepAlive(g);
  g.advance(DAY * 2);
  const save = JSON.parse(JSON.stringify(g.save()));
  assert.equal(save.v, 2);
  const h = new Game(7, 'x', save);
  assert.deepEqual(h.logi, g.logi);
  assert.deepEqual(JSON.parse(JSON.stringify(h.save())), save);
  // Les deux parties évoluent pareil.
  keepAlive(g); keepAlive(h);
  g.advance(DAY); h.advance(DAY);
  assert.deepEqual(h.logi, g.logi);
  assert.equal(h.cash, g.cash);
  // Ancienne sauvegarde : pas de champ logi.
  delete save.logi;
  const old = new Game(7, 'x', save);
  assert.deepEqual(old.logi.warehouses, []);
  assert.deepEqual(old.logi.mins, {});
});
