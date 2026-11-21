/**
 * Simulation de Boutique City : quartier et services, aménagement, achats sur place (meubles, marchandise portée ou
 * chargée), ventes, employés, personnage (faim, énergie, sommeil), banque, publicité, sauvegarde, équilibrage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECONOMY, FURNITURE_BY_ID, LOAN_OFFERS, SERVICES, productsOf, type ServiceKind, type ShopType } from '../src/sim/catalog';
import { generateDistrict, serviceBuilding } from '../src/sim/district';
import { canPlace, layoutStats, neighbourCells, registerSides, unreachable, type PlacedItem } from '../src/sim/layout';
import { Game, dayProfit } from '../src/sim/game';
import { Collider } from '../src/world/collide';
import { findPath } from '../src/world/pathfind';

const DAY = 1440;

function bestFree(g: Game): number {
  return g.district.premises.filter((p) => g.isFree(p)).sort((a, b) => b.footfall - a.footfall)[0]!.id;
}
function goTo(g: Game, kind: ServiceKind): void {
  const b = serviceBuilding(g.district, kind)!;
  g.setPlace({ kind: 'service', service: kind, buildingId: b.id });
}
const LAYOUTS: Record<ShopType, string[]> = {
  epicerie: ['caisse', 'rayon', 'rayon', 'rayon', 'frigo', 'frigo', 'plante', 'plante'],
  cafe: ['caisse', 'machine', 'comptoir', 'vitrine', 'frigo', 'table', 'table', 'table', 'plante'],
  vetements: ['caisse', 'portant', 'portant', 'portant', 'portant', 'rayon', 'plante', 'lampe'],
  fleuriste: ['caisse', 'frigo', 'frigo', 'rayon', 'plante', 'lampe', 'tapis'],
  boulangerie: ['caisse', 'rayon', 'rayon', 'vitrine', 'vitrine', 'frigo', 'table', 'plante'],
  fastfood: ['caisse', 'comptoir', 'comptoir', 'vitrine', 'frigo', 'table', 'table', 'plante'],
  primeur: ['caisse', 'rayon', 'rayon', 'rayon', 'rayon', 'frigo', 'plante'],
};

/** Achète au magasin de meubles puis pose chaque meuble à la première place qui garde tout accessible. */
function furnish(g: Game, shopId: number, type: ShopType): void {
  goTo(g, 'meubles');
  for (const id of LAYOUTS[type]) assert.ok(g.buyFurniture(id, 1, shopId).ok);
  const s = g.shop(shopId)!;
  const p = g.premise(s.premiseId)!;
  for (const id of LAYOUTS[type]) {
    const def = FURNITURE_BY_ID.get(id)!;
    let placed = false;
    for (let z = 0; z < p.gridD && !placed; z += 2) {
      for (let x = 0; x < p.gridW && !placed; x++) {
        if (canPlace(s.items, p.gridW, p.gridD, def, x, z, 0)) continue;
        const r = g.place(shopId, id, x, z, 0);
        if (r.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) placed = true;
        else if (r.ok) g.pickUp(shopId, r.data.uid);
      }
    }
    assert.ok(placed, `meuble ${id} posé`);
  }
  assert.deepEqual(s.storage, {}, 'réserve vide après la pose');
}

function stockUp(g: Game, shopId: number): void {
  const s = g.shop(shopId)!;
  for (const pr of productsOf(s.type)) { const r = g.order(shopId, pr.id, 1000); assert.ok(r.ok, `commande ${pr.id} : ${r.ok ? '' : r.message}`); g.setAuto(shopId, pr.id, true); }
}

function staff(g: Game, shopId: number, n = 1): void {
  goTo(g, 'emploi');
  for (let k = 0; k < n; k++) assert.ok(g.hire(g.candidates[0]!.id, shopId).ok);
}

/** Le personnage reste nourri et reposé (les tests d'économie ne doivent pas s'évanouir). */
function keepAlive(g: Game): void { g.player.energy = 100; g.player.hunger = 100; }

test('quartier : déterministe, services uniques et répartis, logements, locaux', () => {
  const a = generateDistrict(42), b = generateDistrict(42);
  assert.deepEqual(a, b);
  for (const s of SERVICES) assert.ok(serviceBuilding(a, s.id), `service ${s.id}`);
  assert.equal(a.buildings.filter((x) => x.service === 'snack').length, 2);
  const svc = a.buildings.filter((x) => x.service);
  for (const x of svc) assert.equal(x.premise, null, 'un service n’est pas un local à louer');
  let minD = Infinity;
  for (const x of svc) for (const y of svc) if (x !== y) minD = Math.min(minD, Math.hypot(x.doorX - y.doorX, x.doorZ - y.doorZ));
  assert.ok(minD > 60, `services espacés (${minD.toFixed(0)} m)`);
  assert.ok(a.homes.length >= 4 && a.startHome === a.homes[0]!.id);
  assert.ok(a.premises.length >= 20, `${a.premises.length} locaux`);
  a.premises.forEach((p, k) => assert.equal(p.id, k + 1));
  for (const p of a.premises) assert.ok(p.rent > 500 && p.rent < 8000);
});

test('aménagement : règles, rotations, côtés de caisse', () => {
  const caisse = FURNITURE_BY_ID.get('caisse')!, rayon = FURNITURE_BY_ID.get('rayon')!;
  const items: PlacedItem[] = [{ uid: 1, def: 'rayon', x: 0, z: 0, rot: 0 }];
  assert.equal(canPlace(items, 8, 8, caisse, 7, 0, 0), 'Hors du local');
  assert.equal(canPlace(items, 8, 8, caisse, 1, 0, 0), 'Place déjà occupée');
  assert.equal(canPlace(items, 8, 8, caisse, 3, 7, 0), "Laissez l'entrée dégagée");
  assert.equal(canPlace(items, 8, 8, rayon, 0, 2, 3), null);
  const walled: PlacedItem[] = [{ uid: 1, def: 'rayon', x: 0, z: 0, rot: 0 }, { uid: 2, def: 'rayon', x: 0, z: 1, rot: 0 }, { uid: 3, def: 'rayon', x: 3, z: 0, rot: 1 }];
  assert.deepEqual(unreachable(walled, 8, 8), [1]);
  // Caisse face à la porte (rot 0) : client devant (z + 1), employé derrière (z − 1).
  const reg: PlacedItem = { uid: 9, def: 'caisse', x: 2, z: 3, rot: 0 };
  assert.deepEqual(registerSides(reg, caisse), { front: [[2, 4], [3, 4]], back: [[2, 2], [3, 2]] });
  const r2 = registerSides({ ...reg, rot: 2 }, caisse);
  assert.deepEqual(r2.front, [[2, 2], [3, 2]]);
  assert.deepEqual(neighbourCells(reg, caisse)[0], [2, 4], 'voisin avant en premier');
});

test('chemins et collisions', () => {
  const p = findPath(5, 5, (x, z) => x === 2 && z < 4, [0, 0], [4, 0])!;
  assert.ok(p && p.length === 12, `contournement (${p?.length})`);
  assert.equal(findPath(3, 3, (x) => x === 1, [0, 0], [2, 0]), null);
  const d = generateDistrict(5);
  const col = Collider.fromDistrict(d);
  const b = d.buildings[0]!;
  const r = col.resolve(b.x, b.z, 0.4);
  assert.ok(r.hit && (Math.abs(r.x - b.x) >= b.w / 2 || Math.abs(r.z - b.z) >= b.d / 2), 'sorti de l’immeuble');
  const free = col.resolve(b.doorX, b.doorZ, 0.4);
  assert.ok(!free.hit, 'la porte (trottoir) est libre');
});

test('achats sur place : refus hors du service, meubles en réserve, marchandise portée puis rangée', () => {
  const g = new Game(7, 'Testeur SA');
  const shop = g.rent(bestFree(g), 'epicerie');
  assert.ok(shop.ok);
  if (!shop.ok) return;
  g.setPlace({ kind: 'rue' });
  assert.equal(g.buyFurniture('caisse', 1, shop.data.id).ok, false, 'refus hors du magasin de meubles');
  assert.equal(g.place(shop.data.id, 'caisse', 0, 0, 0).ok, false, 'rien en réserve');
  furnish(g, shop.data.id, 'epicerie');
  // Grossiste à pied : limité à ce qu'on peut porter.
  goTo(g, 'grossiste');
  const r = g.buyStock('pain', 100, 'pied');
  assert.ok(r.ok && r.data === ECONOMY.carryOnFoot, 'à pied : 24 unités');
  assert.equal(g.buyStock('lait', 5, 'pied').ok, false, 'bras pleins');
  assert.equal(g.unload(shop.data.id).ok, false, 'il faut être dans le commerce');
  g.setPlace({ kind: 'commerce', shopId: shop.data.id });
  const u = g.unload(shop.data.id);
  assert.ok(u.ok && u.data === 24);
  assert.equal(g.shop(shop.data.id)!.products['pain']!.stock, 24);
  assert.deepEqual(g.player.carry, {});
});

test('véhicule : achat au garage, chargement devant le grossiste, déchargement devant le commerce', () => {
  const g = new Game(7);
  goTo(g, 'garage');
  const v = g.buyVehicle('camionnette');
  assert.ok(v.ok);
  if (!v.ok) return;
  const shop = g.rent(bestFree(g), 'epicerie');
  assert.ok(shop.ok);
  if (!shop.ok) return;
  furnish(g, shop.data.id, 'epicerie');
  goTo(g, 'grossiste');
  assert.equal(g.buyStock('pain', 50, v.data.id).ok, false, 'camionnette trop loin');
  const gb = serviceBuilding(g.district, 'grossiste')!;
  g.setVehiclePose(v.data.id, gb.doorX + 4, gb.doorZ, 0);
  assert.ok(g.buyStock('pain', 50, v.data.id).ok);
  assert.ok(g.buyStock('lait', 40, v.data.id).ok);
  const p = g.premise(shop.data.premiseId)!;
  g.setVehiclePose(v.data.id, p.doorX + 5, p.doorZ, 0);
  g.setPlace({ kind: 'commerce', shopId: shop.data.id });
  assert.equal(g.unloadable(shop.data.id), 90);
  const u = g.unload(shop.data.id);
  assert.ok(u.ok && u.data === 90);
  assert.deepEqual(g.vehicle(v.data.id)!.cargo, {});
});

test('partie : une semaine de ventes, le joueur tient la caisse puis embauche', () => {
  const g = new Game(7, 'Testeur SA');
  const shop = g.rent(bestFree(g), 'epicerie');
  assert.ok(shop.ok);
  if (!shop.ok) return;
  const id = shop.data.id;
  furnish(g, id, 'epicerie');
  stockUp(g, id);
  g.advance(DAY + 2 * 60); // livraison à 7 h le lendemain ; il est 9 h, épicerie ouverte
  keepAlive(g);
  assert.ok(g.shop(id)!.products['pain']!.stock > 0, 'livré');
  g.advance(60);
  assert.equal(g.shop(id)!.today.customers, 0, 'personne à la caisse : aucun client servi');
  assert.ok(g.shop(id)!.today.lostStaff > 0);
  g.setPlace({ kind: 'commerce', shopId: id });
  assert.ok(g.tend(id).ok);
  g.advance(120);
  const served = g.shop(id)!.today.customers;
  assert.ok(served > 5, `le joueur sert ${served} clients`);
  assert.ok(g.events.length > 0 && g.events[0]!.products.length > 0, 'événements avec panier');
  g.setPlace({ kind: 'rue' });
  assert.equal(g.player.tending, null, 'quitter le commerce lâche la caisse');
  staff(g, id);
  for (let d = 0; d < 7; d++) { keepAlive(g); g.advance(DAY); }
  const week = g.shop(id)!.history.slice(-7);
  const sales = week.reduce((a, x) => a + x.revenue, 0);
  assert.ok(sales > 1500, `ventes de la semaine ${sales.toFixed(0)} CHF`);
  assert.ok(week.every((x) => x.rent > 0 && x.wages > 0));
});

test('personnage : faim, fatigue, repas, sommeil, évanouissement', () => {
  const g = new Game(3);
  g.player.energy = 50; g.player.hunger = 50;
  g.setPlace({ kind: 'rue' });
  g.advance(120);
  assert.ok(g.player.energy < 50 && g.player.hunger < 50);
  assert.equal(g.eat('menu').ok, false, 'manger au snack seulement');
  goTo(g, 'snack');
  const h0 = g.player.hunger, c0 = g.cash;
  assert.ok(g.eat('menu').ok);
  assert.ok(g.player.hunger > h0 && g.cash < c0);
  assert.equal(g.sleep().ok, false, 'dormir chez soi seulement');
  g.setPlace({ kind: 'logement', homeId: g.player.home! });
  g.player.energy = 30;
  assert.ok(g.sleep().ok);
  g.advance(5 * 60 - 6);
  assert.equal(g.player.sleeping, false, 'réveillé une fois reposé');
  assert.ok(g.player.energy > 99, `énergie ${g.player.energy}`);
  // Évanouissement : énergie à zéro, retour au logement payé.
  g.setPlace({ kind: 'rue' });
  g.player.energy = 0.01;
  const cash = g.cash;
  g.advance(1);
  assert.ok(g.player.sleeping && g.player.teleportHome);
  assert.equal(Math.round(cash - g.cash), ECONOMY.faintCost);
});

test('banque et publicité : prêt, remboursements quotidiens, plafond, campagne', () => {
  const g = new Game(7);
  keepAlive(g);
  goTo(g, 'banque');
  const c0 = g.cash;
  const l = g.takeLoan(1);
  assert.ok(l.ok);
  if (!l.ok) return;
  assert.equal(g.cash - c0, LOAN_OFFERS[1]!.amount);
  assert.ok(l.data.total > l.data.amount, 'intérêts');
  assert.equal(g.takeLoan(2).ok, true);
  assert.equal(g.takeLoan(2).ok, false, 'plafond d’endettement');
  const debt0 = g.debt;
  g.advance(DAY / 2); keepAlive(g); g.advance(DAY / 2); keepAlive(g);
  goTo(g, 'banque');
  assert.ok(g.debt < debt0, 'remboursement quotidien');
  const due = g.repayAmount(g.loans[0]!);
  assert.ok(due < g.loans[0]!.remaining);
  assert.ok(g.repayLoan(g.loans[0]!.id).ok);
  const shop = g.rent(bestFree(g), 'cafe');
  assert.ok(shop.ok);
  if (!shop.ok) return;
  goTo(g, 'pub');
  assert.equal(g.startCampaign('flyers', null, 3).ok, false, 'flyers : un commerce');
  assert.ok(g.startCampaign('flyers', shop.data.id, 3).ok);
  assert.ok(g.startCampaign('internet', null, 2).ok);
  assert.ok(Math.abs(g.marketingBoost(shop.data.id) - 0.47) < 1e-9);
  for (let d = 0; d < 6; d++) { g.advance(DAY / 2); keepAlive(g); }
  assert.equal(g.campaigns.length, 0, 'campagnes terminées');
});

test('sauvegarde : reprise identique, même suite', () => {
  const g = new Game(11, 'Sauvé');
  const s = g.rent(bestFree(g), 'cafe');
  assert.ok(s.ok);
  if (!s.ok) return;
  furnish(g, s.data.id, 'cafe');
  stockUp(g, s.data.id);
  staff(g, s.data.id);
  goTo(g, 'garage');
  g.buyVehicle('scooter');
  g.advance(DAY * 2 + 300);
  const json = JSON.parse(JSON.stringify(g.save()));
  const h = new Game(json.seed, json.companyName, json);
  g.advance(DAY); h.advance(DAY);
  assert.equal(h.cash, g.cash);
  assert.deepEqual(h.shops, g.shops);
  assert.deepEqual(h.player, g.player);
  assert.deepEqual(h.vehicles, g.vehicles);
});

test('équilibrage : chaque type de commerce bien géré est rentable', () => {
  for (const type of ['epicerie', 'cafe', 'vetements', 'fleuriste', 'boulangerie', 'fastfood', 'primeur'] as ShopType[]) {
    const g = new Game(7);
    const s = g.rent(bestFree(g), type);
    assert.ok(s.ok);
    if (!s.ok) return;
    furnish(g, s.data.id, type);
    stockUp(g, s.data.id);
    staff(g, s.data.id);
    for (let d = 0; d < 14; d++) { keepAlive(g); g.advance(DAY); }
    const last = g.shop(s.data.id)!.history.slice(-7);
    const margin = last.reduce((a, d) => a + d.revenue - d.costOfSales - d.wages - d.rent - d.purchases * 0.06, 0) / 7;
    console.log(`${type} : ${margin.toFixed(0)} CHF / jour (marge − salaires − loyer − livraisons approx.)`);
    assert.ok(margin > 0, `${type} rentable (${margin.toFixed(0)})`);
    assert.ok(Number.isFinite(dayProfit(g.ledger.at(-1)!)));
  }
});

test('objectifs, avis clients et progression des employés', async () => {
  const { OBJECTIVES, netWorth, rankOf } = await import('../src/sim/objectives');
  const g = new Game(7);
  assert.deepEqual(g.achieved, []);
  g.setPlace({ kind: 'rue' });
  const s = g.rent(bestFree(g), 'epicerie');
  assert.ok(s.ok);
  if (!s.ok) return;
  g.checkObjectives();
  assert.deepEqual(g.achieved, ['sortir', 'louer'], 'premiers objectifs dans l’ordre');
  furnish(g, s.data.id, 'epicerie');
  stockUp(g, s.data.id);
  staff(g, s.data.id);
  const skill0 = g.employees[0]!.skill;
  // Prix très élevés : des clients reposent des articles, avis « trop cher ».
  for (let d = 0; d < 3; d++) { keepAlive(g); g.advance(DAY); }
  for (const pr of productsOf('epicerie')) g.setPrice(s.data.id, pr.id, pr.basePrice * 1.8);
  g.feedback = [];
  keepAlive(g);
  g.advance(DAY / 2);
  assert.ok(g.today.refusedPrice > 0 || g.ledger.at(-1)!.refusedPrice > 0, 'articles refusés pour le prix');
  assert.ok(g.feedback.some((f) => f.kind === 'prix'), 'bulle « trop cher »');
  assert.ok(g.employees[0]!.skill > skill0, `compétence ${skill0} → ${g.employees[0]!.skill}`);
  for (const id of ['meubler', 'stock', 'servir10', 'embaucher']) assert.ok((g.achieved as string[]).includes(id), `objectif ${id}`);
  assert.ok(Number.isFinite(netWorth(g)) && netWorth(g) > 0);
  assert.equal(OBJECTIVES.length, 13);
  assert.equal(rankOf(0), 'Débutant');
  // Sauvegarde : objectifs conservés.
  const h = new Game(g.seed, 'x', JSON.parse(JSON.stringify(g.save())));
  assert.deepEqual(h.achieved, g.achieved);
});

test('sous-location, marché, concurrents, météo, loyer mensuel, employés et sauvegarde', () => {
  const g = new Game(11, 'Bailleur SA');
  g.cash = 200_000;
  g.setPlace({ kind: 'rue' });
  // Appartement à sous-louer.
  const home = g.district.homes.find((h) => g.homeFree(h.id))!;
  const sl = g.leaseForSublet('logement', home.id);
  assert.ok(sl.ok, sl.ok ? '' : sl.message);
  if (!sl.ok) return;
  assert.equal(g.homeFree(home.id), false);
  assert.ok(!g.rentHome(home.id).ok, 'impossible d’emménager dans un logement sous-loué');
  const m = g.marketRent('logement', home.id);
  assert.ok(g.setSubletAsk(sl.data.id, m * 10).ok);
  assert.equal(g.sublets[0]!.ask, Math.round(m * 2.5 * 100) / 100, 'loyer demandé plafonné à 250 %');
  g.setSubletAsk(sl.data.id, m * 0.9);
  assert.ok(g.tenantChance(g.sublets[0]!) > 0.5, 'loyer bas : locataire probable');
  // Local à sous-louer : plus libre, dépôt rendu à la résiliation.
  const p = g.district.premises.find((x) => g.isFree(x))!;
  const sp = g.leaseForSublet('local', p.id);
  assert.ok(sp.ok && !g.isFree(p));
  let income = 0, rentPaid = 0;
  for (let d = 0; d < 8; d++) { keepAlive(g); g.advance(DAY); income += g.ledger.at(-1)!.rentalIncome; rentPaid += g.ledger.at(-1)!.rent; }
  assert.ok(g.sublets.some((x) => x.tenant), 'un locataire finit par arriver');
  assert.ok(income > 0 && rentPaid > 0, `loyers encaissés ${income} / payés ${rentPaid}`);
  if (sp.ok) { const cash = g.cash; assert.ok(g.endSublet(sp.data.id).ok); assert.ok(g.cash >= cash, 'dépôt rendu'); assert.ok(g.isFree(p)); }
  // Marché, concurrents, météo.
  for (const pr of productsOf('epicerie')) { const k = g.marketIndex(pr.id); assert.ok(k >= 0.85 && k <= 1.2, `indice ${k}`); }
  assert.ok(['soleil', 'nuages', 'pluie'].includes(g.weather));
  assert.ok(g.weatherFactor('epicerie') > 0.5 && g.weatherFactor('epicerie') < 1.2);
  // Commerce : loyer provisionné chaque jour, prélevé au 30e jour.
  const p2 = g.district.premises.find((x) => g.isFree(x))!;
  const s = g.rent(p2.id, 'epicerie');
  assert.ok(s.ok);
  if (!s.ok) return;
  furnish(g, s.data.id, 'epicerie');
  stockUp(g, s.data.id);
  staff(g, s.data.id);
  const emp = g.employees[0]!;
  assert.ok(g.raiseWage(emp.id, emp.wage + 2).ok && (emp.mood ?? 0) > 0.75, 'augmentation : satisfaction en hausse');
  for (let d = 0; d < 29; d++) { keepAlive(g); g.advance(DAY); }
  assert.ok((g.shop(s.data.id)!.rentDue ?? 0) > 0, 'loyer provisionné');
  keepAlive(g); g.advance(DAY);
  assert.ok(g.notices.some((n) => n.text.includes('loyer du mois prélevé')), 'loyer mensuel prélevé');
  assert.ok(g.rivals['epicerie']! < 1, 'les concurrents baissent leurs prix');
  // Sauvegarde : tout est restauré ; une ancienne sauvegarde sans les nouveaux champs se charge.
  const save = g.save();
  const g2 = new Game(save.seed, save.companyName, structuredClone(save));
  assert.deepEqual(g2.sublets, g.sublets);
  assert.deepEqual(g2.market, g.market);
  assert.equal(g2.weather, g.weather);
  assert.equal(Math.round(g2.cash), Math.round(g.cash));
  const old = structuredClone(save) as Partial<typeof save>;
  delete old.sublets; delete old.market; delete old.rivals; delete old.weather; delete old.marketDay;
  const g3 = new Game(save.seed, save.companyName, old as typeof save);
  assert.deepEqual(g3.sublets, []);
  assert.equal(g3.weather, 'soleil');
});

test('formation des employés : coût par niveau, capacité de caisse, salaire du marché, plafond', () => {
  const g = new Game(7);
  const s = g.rent(bestFree(g), 'epicerie');
  assert.ok(s.ok);
  if (!s.ok) return;
  furnish(g, s.data.id, 'epicerie');
  staff(g, s.data.id);
  const e = g.employees[0]!;
  const skill0 = e.skill, serve0 = g.serviceSkill(e), market0 = g.marketWage(e.skill, 0);
  assert.equal(g.nextTrainingCost(e), 600);
  const cash = g.cash;
  const r = g.train(e.id);
  assert.ok(r.ok && r.data === 600, 'formation niveau 1 payée');
  assert.equal(Math.round(cash - g.cash), 600);
  assert.equal(e.training, 1);
  assert.ok(e.skill > skill0 || e.skill === 1, 'compétence en hausse');
  assert.ok(g.serviceSkill(e) > serve0 * 1.1, `capacité ${serve0.toFixed(2)} → ${g.serviceSkill(e).toFixed(2)}`);
  assert.ok(g.marketWage(e.skill, 1) >= market0 + 2, 'salaire du marché plus élevé');
  assert.equal(g.nextTrainingCost(e), 1100);
  assert.ok(g.train(e.id).ok && g.train(e.id).ok);
  assert.equal(e.training, 3);
  assert.equal(g.nextTrainingCost(e), null);
  assert.equal(g.train(e.id).ok, false, 'pas de quatrième niveau');
  g.cash = 100;
  const e2 = (staff(g, s.data.id), g.employees[1]!);
  assert.equal(g.train(e2.id).ok, false, 'trésorerie insuffisante');
  // Formé mais salaire inchangé : il finit par demander une augmentation.
  g.cash = 50_000;
  e.wage = g.marketWage(e.skill, 0);
  keepAlive(g); g.advance(DAY);
  assert.ok(e.askedRaise, 'un employé formé payé au tarif de base demande une augmentation');
});

test('gamme premium : employé formé requis, mise en place payée une fois, prix, coûts et clientèle selon la réputation', async () => {
  const { PREMIUM, PREMIUM_BY_TYPE, PRODUCT_BY_ID, premiumDemand } = await import('../src/sim/catalog');
  const g = new Game(7);
  const s = g.rent(bestFree(g), 'cafe');
  assert.ok(s.ok);
  if (!s.ok) return;
  const id = s.data.id;
  furnish(g, id, 'cafe');
  stockUp(g, id);
  staff(g, id);
  assert.equal(g.setPremium(id, true).ok, false, 'refus sans employé formé');
  assert.ok(g.train(g.employees[0]!.id).ok);
  const shop = g.shop(id)!, cafe = PRODUCT_BY_ID.get('cafe')!;
  const price0 = shop.products['cafe']!.price, ref0 = g.refPrice(cafe, shop);
  shop.reputation = 0.95;
  const attr0 = g.attractiveness(shop);
  const cash = g.cash, cost = PREMIUM_BY_TYPE.get('cafe')!.cost;
  const r = g.setPremium(id, true);
  assert.ok(r.ok && r.data === cost, 'mise en place payée');
  assert.equal(Math.round(cash - g.cash), cost);
  assert.ok(shop.premium && shop.premiumOwned);
  assert.ok(Math.abs(shop.products['cafe']!.price - price0 * PREMIUM.priceMult) < 0.02, 'prix de vente relevés');
  assert.ok(Math.abs(g.refPrice(cafe, shop) - ref0 * PREMIUM.priceMult) < 0.02, 'prix de référence premium');
  assert.ok(g.orderCost('cafe', 10, id) > g.orderCost('cafe', 10) * 1.4, 'achats premium plus chers');
  // Bonne réputation : autant de clients ; réputation faible : bien moins.
  const attrHi = g.attractiveness(shop);
  assert.ok(Math.abs(attrHi / attr0 - premiumDemand(0.95)) < 0.01 && attrHi >= attr0 * 0.95, `attrait ${attr0.toFixed(2)} → ${attrHi.toFixed(2)}`);
  shop.reputation = 0.25;
  assert.ok(g.attractiveness(shop) < attrHi * 0.45, 'réputation faible : peu de clientèle premium');
  shop.reputation = 0.95;
  // Une journée : coût des ventes au prix premium, marge unitaire plus élevée.
  keepAlive(g); g.advance(DAY);
  const d = g.shop(id)!.history.at(-1)!;
  assert.ok(d.customers > 0 && d.revenue > 0);
  assert.ok((d.revenue - d.costOfSales) / d.revenue > 0.7, 'marge brute confortable en premium');
  // Retour au standard puis re-bascule gratuite.
  assert.ok(g.setPremium(id, false).ok && !shop.premium);
  assert.ok(Math.abs(shop.products['cafe']!.price - price0) < 0.05, 'prix revenus au standard');
  const c2 = g.cash;
  const r2 = g.setPremium(id, true);
  assert.ok(r2.ok && r2.data === 0 && g.cash === c2, 'deuxième passage en premium gratuit');
  // Sauvegarde : la gamme est conservée.
  const h = new Game(g.seed, 'x', JSON.parse(JSON.stringify(g.save())));
  assert.equal(h.shop(id)!.premium, true);
});

test('contrat fournisseur : signé chez le grossiste, remise, livraison offerte, forfait quotidien, sauvegarde', () => {
  const g = new Game(7);
  const s = g.rent(bestFree(g), 'epicerie');
  assert.ok(s.ok);
  if (!s.ok) return;
  const id = s.data.id;
  furnish(g, id, 'epicerie');
  g.setPlace({ kind: 'rue' });
  assert.equal(g.signContract('essentiel').ok, false, 'à signer chez le grossiste');
  const base = g.orderCost('pain', 50), fee = g.deliveryFee(base);
  goTo(g, 'grossiste');
  const cash = g.cash;
  assert.ok(g.signContract('essentiel').ok);
  assert.equal(Math.round(cash - g.cash), 45, 'premier jour payé à la signature');
  assert.ok(Math.abs(g.orderCost('pain', 50) - base * 0.92) < 0.02, 'remise de 8 %');
  assert.ok(g.signContract('partenaire').ok);
  assert.ok(Math.abs(g.orderCost('pain', 50) - base * 0.85) < 0.02, 'remise de 15 %');
  assert.ok(g.deliveryFee(base) < fee - 30, 'forfait de livraison offert');
  // Forfait prélevé à minuit, dans les achats du jour.
  const before = g.cash;
  g.advance(DAY - (g.total % DAY));
  keepAlive(g);
  assert.ok(g.ledger.at(-1)!.purchases >= 150, 'forfait compté dans les achats');
  assert.ok(g.cash <= before - 150 + 1e-6 || g.cash < before, 'forfait payé');
  const save = g.save();
  assert.equal(new Game(save.seed, save.companyName, structuredClone(save)).contract, 'partenaire');
  const old = structuredClone(save) as Partial<typeof save>;
  delete old.contract;
  old.achieved = ['sortir', 'jour2000'];
  const g2 = new Game(save.seed, save.companyName, old as typeof save);
  assert.equal(g2.contract, null, 'ancienne sauvegarde : pas de contrat');
  assert.deepEqual(g2.achieved, ['sortir'], 'objectifs disparus ignorés');
  assert.ok(g.signContract(null).ok && g.contract === null, 'contrat résilié');
});

test('objectif « Monter en gamme » : formation puis gamme premium', async () => {
  const { OBJECTIVES } = await import('../src/sim/objectives');
  const o = OBJECTIVES.find((x) => x.id === 'gamme')!;
  const g = new Game(7);
  const s = g.rent(bestFree(g), 'fastfood');
  assert.ok(s.ok);
  if (!s.ok) return;
  furnish(g, s.data.id, 'fastfood');
  assert.equal(o.progress(g).p, 0);
  staff(g, s.data.id);
  g.train(g.employees[0]!.id);
  assert.equal(o.progress(g).p, 0.5);
  assert.ok(g.setPremium(s.data.id, true).ok);
  assert.equal(o.progress(g).p, 1);
  g.checkObjectives();
  assert.ok(g.achieved.includes('gamme'));
});
