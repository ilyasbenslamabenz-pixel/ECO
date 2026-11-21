/**
 * Propreté des commerces (salissure par client et par heure, effet sur l'attrait et la réputation, alerte
 * quotidienne, nettoyage sur place, service de nuit, avis « c'est sale ») et revêtements de sol et de murs
 * (prix selon la surface, bonus d'attrait, pose sur place), sauvegarde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEANING, FLOORINGS, FURNITURE_BY_ID, WALLINGS, cleanAppeal, productsOf, surfaceArea, type ServiceKind } from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { canPlace, layoutStats } from '../src/sim/layout';
import { Game, dayProfit, type GameSave } from '../src/sim/game';

const LAYOUT = ['caisse', 'rayon', 'rayon', 'rayon', 'frigo', 'frigo', 'plante', 'plante'];

function goTo(g: Game, kind: ServiceKind): void {
  const b = serviceBuilding(g.district, kind)!;
  g.setPlace({ kind: 'service', service: kind, buildingId: b.id });
}
function keepAlive(g: Game): void { g.player.energy = 100; g.player.hunger = 100; }

/** Épicerie aménagée, approvisionnée (réassort auto) et tenue par un employé. */
function openShop(g: Game): number {
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  const r = g.rent(p.id, 'epicerie');
  assert.ok(r.ok);
  const id = r.data.id, s = g.shop(id)!;
  goTo(g, 'meubles');
  for (const f of LAYOUT) assert.ok(g.buyFurniture(f, 1, id).ok);
  for (const f of LAYOUT) {
    const def = FURNITURE_BY_ID.get(f)!;
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(s.items, p.gridW, p.gridD, def, x, z, 0)) continue;
      const q = g.place(id, f, x, z, 0);
      if (q.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (q.ok) g.pickUp(id, q.data.uid);
    }
  }
  for (const pr of productsOf('epicerie')) { g.order(id, pr.id, Math.max(20, g.room(s, pr.id))); g.setAuto(id, pr.id, true); }
  goTo(g, 'emploi');
  assert.ok(g.hire(g.candidates[0]!.id, id).ok);
  g.setPlace({ kind: 'rue' });
  return id;
}

test('propreté : 100 % au départ, baisse avec les clients et les heures, moins d’attrait quand c’est sale', () => {
  const g = new Game(7, 'Test');
  const id = openShop(g), s = g.shop(id)!;
  assert.equal(g.cleanliness(s), 100);
  // Effet sur l'attrait (rayons garnis à 15 h, après la livraison de 14 h) : nul au-dessus du seuil, jusqu'à −20 % à 0 %.
  keepAlive(g); g.advance(8 * 60);
  const c0 = g.cleanliness(s);
  s.clean = 100; const a100 = g.attractiveness(s);
  assert.ok(a100 > 0);
  s.clean = CLEANING.fine; assert.ok(Math.abs(g.attractiveness(s) - a100) < 1e-9, 'aucun effet au-dessus du seuil');
  s.clean = 0; const a0 = g.attractiveness(s);
  assert.ok(Math.abs(a0 / a100 - CLEANING.minAppeal) < 1e-9, `attrait ×${(a0 / a100).toFixed(2)} à 0 %`);
  assert.equal(cleanAppeal(50), CLEANING.minAppeal + (1 - CLEANING.minAppeal) * 50 / CLEANING.fine);
  s.clean = c0;
  keepAlive(g); g.advance(1440 - 8 * 60);
  keepAlive(g); g.advance(18 * 60);
  const served = s.history.at(-1)!.customers + s.today.customers;
  assert.ok(served > 50, `des clients servis (${served})`);
  const c = g.cleanliness(s);
  assert.ok(c < 100 - served * CLEANING.perCustomer * 0.9, `propreté en baisse (${c.toFixed(1)} %)`);
});

test('propreté : alerte une fois par jour sous le seuil, avis « c’est sale », réputation visée plus basse', () => {
  const g = new Game(7, 'Test');
  const id = openShop(g), s = g.shop(id)!;
  keepAlive(g); g.advance(1440);
  const before = g.notices.length;
  g.feedback.length = 0;
  s.clean = 20;
  keepAlive(g); g.advance(10 * 60);
  const alerts = g.notices.slice(before).filter((n) => n.text.includes('est sale'));
  assert.equal(alerts.length, 1, 'une seule alerte dans la journée');
  assert.ok(g.feedback.some((f) => f.shopId === id && f.kind === 'sale'), 'des clients se plaignent de la saleté');
  // Réputation : deux commerces identiques, l'un propre, l'autre sale.
  const clean = new Game(7, 'Test'), dirty = new Game(7, 'Test');
  const ic = openShop(clean), idd = openShop(dirty);
  for (let d = 0; d < 3; d++) {
    clean.shop(ic)!.clean = 100; dirty.shop(idd)!.clean = 5;
    keepAlive(clean); keepAlive(dirty); clean.advance(1440); dirty.advance(1440);
  }
  assert.ok(dirty.shop(idd)!.reputation < clean.shop(ic)!.reputation - 0.02, `réputation : sale ${dirty.shop(idd)!.reputation.toFixed(2)} < propre ${clean.shop(ic)!.reputation.toFixed(2)}`);
});

test('nettoyer : sur place seulement, prend du temps de jeu et de l’énergie, refusé si impeccable', () => {
  const g = new Game(7, 'Test');
  const id = openShop(g), s = g.shop(id)!;
  keepAlive(g); g.advance(600);
  s.clean = 30;
  assert.equal(g.cleanShop(id).ok, false, 'hors du commerce');
  g.setPlace({ kind: 'commerce', shopId: id });
  const t0 = g.total, e0 = g.player.energy;
  const r = g.cleanShop(id);
  assert.ok(r.ok);
  assert.equal(g.total - t0, CLEANING.playerMinutes, 'le temps passe');
  assert.ok(g.cleanliness(s) > 30 + CLEANING.playerGain - 5 && g.cleanliness(s) <= 30 + CLEANING.playerGain);
  assert.ok(g.player.energy < e0);
  s.clean = 100;
  assert.equal(g.cleanShop(id).ok, false, 'déjà impeccable');
});

test('service de nettoyage de nuit : forfait selon la surface, magasin remis à 100 % chaque nuit', () => {
  const g = new Game(7, 'Test');
  const id = openShop(g), s = g.shop(id)!, p = g.premise(s.premiseId)!;
  const fee = g.cleanServiceCost(id);
  assert.equal(fee, Math.max(CLEANING.serviceMin, Math.round(p.area * CLEANING.servicePerM2)));
  assert.ok(g.setCleanService(id, true).ok);
  keepAlive(g); g.advance(1440);
  keepAlive(g); g.advance(16 * 60);
  s.clean = 10;
  const wagesBefore = s.today.wages;
  keepAlive(g); g.advance(2 * 60);
  assert.equal(s.history.at(-1)!.wages - wagesBefore >= fee - 0.01, true, 'forfait compté dans la journée');
  assert.ok(g.cleanliness(s) > 99, 'impeccable au matin');
  assert.ok(g.setCleanService(id, false).ok);
  assert.equal(s.cleanService, false);
});

test('revêtements : prix selon la surface, pose sur place, bonus d’attrait, sans effet si déjà en place', () => {
  const g = new Game(7, 'Test');
  const id = openShop(g), s = g.shop(id)!, p = g.premise(s.premiseId)!;
  keepAlive(g); g.advance(600);
  assert.ok(FLOORINGS.length >= 3 && FLOORINGS.length <= 5 && WALLINGS.length >= 3 && WALLINGS.length <= 5);
  for (const list of [FLOORINGS, WALLINGS]) for (let k = 1; k < list.length; k++) {
    assert.ok(list[k]!.perM2 > list[k - 1]!.perM2 && list[k]!.appeal > list[k - 1]!.appeal, 'plus cher = plus attirant');
  }
  const cost = g.surfaceCost(id, 'sol', 'marbre');
  assert.equal(cost, Math.round(FLOORINGS.at(-1)!.perM2 * surfaceArea('sol', p.gridW, p.gridD)));
  assert.equal(g.setSurface(id, 'sol', 'marbre').ok, false, 'hors du commerce');
  g.setPlace({ kind: 'commerce', shopId: id });
  assert.equal(g.setSurface(id, 'sol', 'inconnu').ok, false);
  const a0 = g.attractiveness(s), cash = g.cash;
  const r = g.setSurface(id, 'sol', 'marbre');
  assert.ok(r.ok && r.data === cost);
  assert.ok(Math.abs(g.cash - (cash - cost)) < 0.01, 'payé');
  assert.ok(g.setSurface(id, 'murs', 'brique').ok);
  assert.equal(s.floorId, 'marbre'); assert.equal(s.wallId, 'brique');
  const bonus = FLOORINGS.at(-1)!.appeal + WALLINGS.at(-1)!.appeal;
  assert.ok(Math.abs(g.attractiveness(s) / a0 - (1 + bonus)) < 1e-9, `attrait +${Math.round(bonus * 100)} %`);
  const c2 = g.cash;
  assert.ok(g.setSurface(id, 'sol', 'marbre').ok);
  assert.equal(g.cash, c2, 'déjà en place : gratuit');
});

test('sauvegarde : propreté et revêtements conservés ; anciennes sauvegardes : 100 % et revêtements d’origine', () => {
  const g = new Game(7, 'Test');
  const id = openShop(g), s = g.shop(id)!;
  s.clean = 42; s.floorId = 'chene'; s.wallId = 'papier'; s.cleanService = true;
  const save = JSON.parse(JSON.stringify(g.save())) as GameSave;
  const h = new Game(7, 'Test', save);
  const t = h.shop(id)!;
  assert.equal(h.cleanliness(t), 42); assert.equal(t.floorId, 'chene'); assert.equal(t.wallId, 'papier'); assert.equal(t.cleanService, true);
  for (const x of save.shops) { delete x.clean; delete x.floorId; delete x.wallId; delete x.cleanService; }
  const old = new Game(7, 'Test', save);
  assert.equal(old.cleanliness(old.shop(id)!), 100);
  assert.equal(old.surfaceAppeal(old.shop(id)!), 0);
});

test('trois jours sans nettoyer : les ventes restent correctes', () => {
  const g = new Game(7, 'Test');
  const id = openShop(g), s = g.shop(id)!;
  for (let d = 0; d < 3; d++) { keepAlive(g); g.advance(720); keepAlive(g); g.advance(720); }
  const [d1, d2, d3] = s.history.slice(-3) as [typeof s.today, typeof s.today, typeof s.today];
  assert.ok(d3.revenue > d2.revenue * 0.75, `jour 3 : ${Math.round(d3.revenue)} CHF contre ${Math.round(d2.revenue)} au jour 2`);
  assert.ok(dayProfit(g.ledger.at(-1)!) > -500 && d1.customers > 0);
});
