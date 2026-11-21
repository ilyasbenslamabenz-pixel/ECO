/**
 * Expérience du nouveau joueur (retours de playtest) : faim et énergie (alertes indépendantes, premier jour sans
 * évanouissement, repas à la maison), « Décharger » quand une commande en cours réserve la place, premier coup de la
 * concurrence et son impact chiffré, hygiène des notifications (ruptures regroupées, un seul message par action,
 * pastille réservée aux alertes), conseils chiffrés du récapitulatif, commerce visé par défaut.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FURNITURE_BY_ID, HOMES, HOME_MEAL, NEEDS, PRODUCT_BY_ID, RIVALS, bestStoreFurniture, productsOf, type ServiceKind, type ShopType } from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { canPlace, layoutStats } from '../src/sim/layout';
import { ECONOMY } from '../src/sim/catalog';
import { Game, isAlert, type Notice } from '../src/sim/game';
import { rivalTips, stockTips } from '../src/ui/recap-tips';
import { defaultShopId } from '../src/ui/dialogs';

const DAY = 1440;

function bestFree(g: Game, k = 0): number {
  return g.district.premises.filter((p) => g.isFree(p)).sort((a, b) => b.footfall - a.footfall)[k]!.id;
}
function goTo(g: Game, kind: ServiceKind): void {
  const b = serviceBuilding(g.district, kind)!;
  g.setPlace({ kind: 'service', service: kind, buildingId: b.id });
}
/** Achète puis pose chaque meuble à la première place qui garde tout accessible. */
function furnish(g: Game, shopId: number, layout: string[]): void {
  goTo(g, 'meubles');
  for (const id of layout) assert.ok(g.buyFurniture(id, 1, shopId).ok);
  const s = g.shop(shopId)!, p = g.premise(s.premiseId)!;
  for (const id of layout) {
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(s.items, p.gridW, p.gridD, FURNITURE_BY_ID.get(id)!, x, z, 0)) continue;
      const r = g.place(shopId, id, x, z, 0);
      if (r.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (r.ok) g.pickUp(shopId, r.data.uid);
    }
    assert.ok(done, `meuble ${id} posé`);
  }
}
function hire(g: Game, shopId: number): void { goTo(g, 'emploi'); assert.ok(g.hire(g.candidates[0]!.id, shopId).ok); g.setPlace({ kind: 'rue' }); }
const keepAlive = (g: Game): void => { g.player.energy = 100; g.player.hunger = 100; };
/** Journées entières, personnage reposé, augmentations accordées (pas de démission). */
function live(g: Game, days: number): void {
  for (let d = 0; d < days; d++) {
    keepAlive(g);
    for (const e of g.employees) if (e.askedRaise) g.raiseWage(e.id, g.marketWage(e.skill, e.training ?? 0));
    g.advance(DAY);
  }
}
/** Commerce meublé, approvisionné (réassort automatique au choix) et tenu par un caissier. */
function openShop(g: Game, type: ShopType, layout: string[], auto = true, k = 0): number {
  const r = g.rent(bestFree(g, k), type);
  assert.ok(r.ok);
  const id = r.ok ? r.data.id : -1, s = g.shop(id)!;
  furnish(g, id, layout);
  for (const pr of productsOf(type)) { g.order(id, pr.id, Math.max(20, g.room(s, pr.id))); if (auto) g.setAuto(id, pr.id, true); }
  hire(g, id);
  return id;
}
/** Journal complet des notifications (l'historique de la partie est plafonné à 100). */
function logNotices(g: Game): Notice[] {
  const log: Notice[] = [], notify = g.notify.bind(g);
  g.notify = (level, text, action) => { notify(level, text, action); log.push(g.notices.at(-1)!); };
  return log;
}
const after = (g: Game, seq: number): Notice[] => g.notices.filter((n) => n.seq > seq);

/* ------------------------------ 1. Faim et énergie ------------------------------ */

test('faim et énergie : départ rassasié, alertes d’énergie indépendantes de la faim (25, puis 10 en erreur), énergie d’abord', () => {
  const g = new Game(7);
  assert.equal(g.player.hunger, 100, 'faim de départ à 100');
  g.setPlace({ kind: 'rue' });
  const s0 = g.lastNoticeSeq;
  g.advance(5 * 60);
  assert.ok(!after(g, s0).some((n) => /faim/i.test(n.text)), 'pas d’alerte de faim le premier matin');
  // Affamé et fatigué à la fois : l'alerte d'énergie tombe quand même (ce n'est plus la branche « sinon » de la faim).
  g.player.hunger = 5; g.player.energy = NEEDS.tired + 0.05;
  const s1 = g.lastNoticeSeq;
  g.advance(3);
  assert.ok(after(g, s1).some((n) => n.level === 'warn' && n.text.includes('fatigué')), 'fatigue signalée à 25 malgré la faim');
  g.player.energy = NEEDS.exhausted + 0.05;
  const s2 = g.lastNoticeSeq;
  g.advance(3);
  assert.ok(after(g, s2).some((n) => n.level === 'error' && n.text.startsWith('Épuisé')), 'alerte forte (erreur) à 10');
  // Les deux seuils franchis la même minute : l'énergie d'abord.
  g.player.energy = NEEDS.tired + 0.01; g.player.hunger = NEEDS.low + 0.01;
  const s3 = g.lastNoticeSeq;
  g.advance(1);
  const c = after(g, s3), ie = c.findIndex((n) => n.text.includes('fatigué')), ih = c.findIndex((n) => n.text.includes('faim'));
  assert.ok(ie >= 0 && ih > ie, 'énergie signalée avant la faim');
});

test('premier jour : pas d’évanouissement à zéro d’énergie ; dès le lendemain, taxi et longue nuit', () => {
  const g = new Game(7);
  g.setPlace({ kind: 'rue' });
  g.advance(10 * 60);
  const log = logNotices(g);
  g.player.energy = 0.05;
  const cash = g.cash;
  g.advance(60);
  assert.equal(g.player.energy, 0);
  assert.ok(!g.player.sleeping && !g.player.teleportHome, 'le personnage tient debout le premier jour');
  assert.equal(g.cash, cash, 'ni taxi ni nuit forcée');
  assert.ok(log.some((n) => n.level === 'error' && n.text.startsWith('À bout de forces')), 'prévenu de ce qui arrivera dès demain');
  g.advance(DAY - (g.total % DAY) + 1);
  assert.equal(g.day, 1);
  assert.ok(g.player.sleeping && g.player.teleportHome, 'évanouissement le deuxième jour');
  assert.ok(log.some((n) => n.level === 'error' && n.text.startsWith('Épuisé, vous vous effondrez')));
  assert.ok(g.ledger.at(-1)!.living + g.today.living >= ECONOMY.faintCost, 'taxi payé');
});

test('repas à la maison : la cuisine du logement nourrit pour peu cher, mais prend du temps', () => {
  const g = new Game(7);
  assert.ok(HOMES.every((h) => h.kitchen), 'tous les logements ont une cuisine');
  assert.ok(g.hasKitchen());
  g.player.hunger = 30;
  g.setPlace({ kind: 'rue' });
  assert.equal(g.cook().ok, false, 'chez soi seulement');
  g.setPlace({ kind: 'logement', homeId: g.player.home! });
  const c0 = g.cash, t0 = g.total;
  const r = g.cook();
  assert.ok(r.ok && r.data === HOME_MEAL.price);
  assert.equal(g.total - t0, HOME_MEAL.minutes, 'le temps de cuisiner');
  assert.ok(Math.abs(c0 - g.cash - HOME_MEAL.price) < 1e-9, 'courses payées');
  assert.ok(g.player.hunger > 30 + HOME_MEAL.hunger - 10, `faim ${g.player.hunger}`);
  assert.ok(HOME_MEAL.price < 9, 'moins cher qu’un sandwich au snack');
  g.player.hunger = 99;
  assert.equal(g.cook().ok, false, 'pas faim');
});

/* ------------------------------ 2. Décharger ------------------------------ */

test('Décharger : place réservée par une commande — refus expliqué, puis rangement en réduisant la commande (remboursée au prorata)', () => {
  const g = new Game(7, 'Test');
  const r = g.rent(bestFree(g), 'epicerie');
  assert.ok(r.ok);
  const id = r.ok ? r.data.id : -1, s = g.shop(id)!;
  furnish(g, id, ['caisse', 'rayon', 'rayon', 'frigo']);
  const cap = g.storageFor(s, PRODUCT_BY_ID.get('pain')!);
  const o = g.order(id, 'pain', 1000);
  assert.ok(o.ok && o.data.qty === cap, 'commande qui réserve toute la place');
  const { qty: qty0, cost: cost0 } = o.ok ? o.data : { qty: 0, cost: 0 };
  goTo(g, 'grossiste');
  assert.ok(g.buyStock('pain', 24, 'pied').ok);
  g.setPlace({ kind: 'commerce', shopId: id });
  assert.equal(s.products['pain']!.stock, 0, 'rayon vide');
  const plan = g.unloadPlan(id);
  assert.deepEqual([plan.carried, plan.now, plan.reducing], [24, 0, 24]);
  assert.match(plan.reason ?? '', /place réservée par la livraison prévue aujourd’hui à 14 h \(\d+ commandés\)/);
  assert.ok(Math.abs(plan.refund - (cost0 * 24) / qty0) < 0.02, 'remboursement annoncé');
  const no = g.unload(id, false);
  assert.ok(!no.ok && /place réservée/.test(no.message) && !/mauvais produits/.test(no.message), 'message explicite');
  assert.equal(g.player.carry['pain'], 24, 'rien rangé sans accord');
  const cash0 = g.cash;
  const yes = g.unload(id);
  assert.ok(yes.ok && yes.data === 24, 'rangé quand même');
  assert.equal(s.products['pain']!.stock, 24);
  assert.equal(g.pendingQty(id, 'pain'), qty0 - 24, 'commande réduite d’autant');
  assert.ok(Math.abs(g.cash - cash0 - (cost0 * 24) / qty0) < 0.02, 'remboursée au prorata');
  assert.match(g.notices.at(-1)!.text, /commande réduite d’autant .*24 pain en moins sur la livraison aujourd’hui à 14 h/);
  assert.deepEqual(g.player.carry, {});
  // Toute la commande rangée à la main : elle est annulée (et entièrement remboursée).
  goTo(g, 'grossiste');
  assert.ok(g.buyStock('pain', 24, 'pied').ok);
  g.setPlace({ kind: 'commerce', shopId: id });
  s.products['pain']!.stock = cap - 24;
  const left = g.orders.find((x) => x.shopId === id && x.productId === 'pain')!, back = left.cost, cash1 = g.cash;
  assert.ok(g.unload(id).ok);
  assert.equal(g.pendingQty(id, 'pain'), 0);
  assert.ok(!g.orders.some((x) => x.shopId === id && x.productId === 'pain'), 'commande annulée');
  assert.ok(Math.abs(g.cash - cash1 - back) < 0.02, 'entièrement remboursée');
});

test('Décharger : rayon plein, aucun meuble ou produits d’ailleurs — rien de rangeable, raison donnée', () => {
  const g = new Game(7, 'Test');
  const r = g.rent(bestFree(g), 'epicerie');
  assert.ok(r.ok);
  const id = r.ok ? r.data.id : -1, s = g.shop(id)!;
  furnish(g, id, ['caisse', 'rayon']);
  g.setPlace({ kind: 'commerce', shopId: id });
  s.products['pain']!.stock = g.storageFor(s, PRODUCT_BY_ID.get('pain')!);
  g.player.carry = { pain: 5 };
  let plan = g.unloadPlan(id);
  assert.equal(plan.now + plan.reducing, 0, 'rien de rangeable : le bouton n’est pas mis en avant');
  assert.match(plan.reason ?? '', /Pain : rayon plein/);
  g.player.carry = { lait: 5 };
  plan = g.unloadPlan(id);
  assert.match(plan.reason ?? '', /Lait : aucun meuble pour ce produit \(ajoutez : vitrine réfrigérée\)/);
  g.player.carry = { tshirt: 5 };
  plan = g.unloadPlan(id);
  assert.equal(plan.carried, 0);
  assert.match(plan.reason ?? '', /ne se vendent pas ici/);
  const u = g.unload(id);
  assert.ok(!u.ok && /ne se vendent pas ici/.test(u.message));
});

/* ------------------------------ 3. Conseils du récapitulatif ------------------------------ */

test('conseils du soir : rayons trop petits chiffrés avec le meuble qui accueille le produit ; jamais « réassort automatique » s’il est actif', () => {
  const layout = ['caisse', 'rayon', 'vitrine', 'frigo', 'plante'];
  const g = new Game(7, 'Test');
  const id = openShop(g, 'boulangerie', layout, true);
  live(g, 3);
  const s = g.shop(id)!, d = s.history.at(-1)!;
  assert.ok(d.missed && d.sold, 'demande suivie par produit');
  const tips = stockTips(g, s, d);
  const presentoir = bestStoreFurniture('boulangerie', 'rayon')!;
  assert.equal(presentoir.id, 'presentoir-pain');
  assert.ok(tips.some((t) => t.startsWith('Rayons trop petits') && t.includes(`« ${presentoir.nameFr} »`) && /places de baguette pour une demande de ~\d+ par jour/.test(t)), tips.join('\n'));
  assert.ok(!tips.some((t) => t.includes('activez le réassort automatique')), 'réassort déjà actif : pas de conseil faux');
  // Sans réassort automatique, le conseil le propose.
  const h = new Game(7, 'Test');
  const k = openShop(h, 'boulangerie', layout, false);
  live(h, 2);
  const tips2 = stockTips(h, h.shop(k)!, h.shop(k)!.history.at(-1)!);
  assert.ok(tips2.some((t) => t.includes('réassort automatique')), tips2.join('\n'));
});

/* ------------------------------ 4. Concurrence ------------------------------ */

test('premier coup de la concurrence : jours 11 à 13, même type, près du commerce le plus rentable, alerte et impact chiffrés, déterministe', () => {
  const run = (): { g: Game; id: number; log: Notice[] } => {
    const g = new Game(7, 'Test'), log = logNotices(g);
    const id = openShop(g, 'boulangerie', ['caisse', 'rayon', 'rayon', 'vitrine', 'vitrine', 'frigo', 'table', 'plante']);
    live(g, 14);
    return { g, id, log };
  };
  const { g, id, log } = run(), rv = g.rivalry, st = rv.strike;
  assert.ok(st, 'le premier coup a eu lieu');
  assert.ok(st.day >= RIVALS.strikeDays[0] && st.day <= RIVALS.strikeDays[1], `jour ${st.day + 1}`);
  assert.equal(st.shopId, id);
  const rs = rv.shopAt(st.premiseId)!, s = g.shop(id)!;
  assert.equal(rs.type, 'boulangerie');
  assert.equal(rs.target, id);
  assert.equal(rs.opened, st.day);
  const p = g.premise(s.premiseId)!, q = g.premise(rs.premiseId)!;
  assert.ok(Math.hypot(p.doorX - q.doorX, p.doorZ - q.doorZ) < RIVALS.nearRadius, 'près du commerce visé');
  const alert = log.find((n) => n.text.startsWith('Coup dur'));
  assert.ok(alert && alert.level === 'warn' && alert.text.includes(rs.name) && /clients? de moins par jour|% de clients en moins/.test(alert.text), alert?.text);
  const im = rv.impact(s, rs);
  assert.ok(im.share > 0.01 && im.share < RIVALS.promoMax + 0.2 && im.customers >= 1, JSON.stringify(im));
  // Récapitulatif : « −N clients : Boulangerie … ».
  const y = g.ledger.find((x) => x.day === st.day)!;
  assert.ok(rivalTips(g, y).some((t) => t.startsWith('−') && t.includes(` clients : ${rs.name}`)), rivalTips(g, y).join('\n'));
  // Même graine, même coup ; conservé à la sauvegarde.
  assert.deepEqual(run().g.rivalry.strike, st);
  const h = new Game(7, 'Test', JSON.parse(JSON.stringify(g.save())));
  assert.deepEqual(h.rivalry.strike, st);
  live(g, 2); live(h, 2);
  assert.deepEqual(h.rivalry.save(), g.rivalry.save());
});

test('premier coup : rien sans commerce prêt ; abandonné après le jour 31', () => {
  const g = new Game(7);
  live(g, RIVALS.strikeDays[1] + 2);
  assert.equal(g.rivalry.strike, undefined, 'en attente tant que le joueur n’a pas de commerce');
  assert.ok(!g.notices.some((n) => n.text.startsWith('Coup dur')));
  live(g, RIVALS.strikeLastDay - g.day + 1);
  assert.equal(g.rivalry.strike, null, 'abandonné');
});

/* ------------------------------ 5. Notifications ------------------------------ */

test('ruptures regroupées : un message par commerce et par demi-journée, qui liste les produits', () => {
  const g = new Game(7, 'Test'), log = logNotices(g);
  const r = g.rent(bestFree(g), 'epicerie');
  assert.ok(r.ok);
  const id = r.ok ? r.data.id : -1, s = g.shop(id)!;
  furnish(g, id, ['caisse', 'rayon', 'rayon', 'frigo']);
  for (const pr of productsOf('epicerie')) g.order(id, pr.id, 6);
  hire(g, id);
  live(g, 2);
  const rupt = log.filter((n) => n.text.startsWith(`${s.name} : rupture de`) || n.text.startsWith(`${s.name} : stock bas de`));
  assert.ok(rupt.length > 0, 'ruptures signalées');
  assert.ok(rupt.some((n) => /rupture de [^;.]+(, | et )/.test(n.text)), 'plusieurs produits dans un même message');
  // Au plus une alerte de rupture par commerce et par demi-journée (avant 14 h, puis après).
  const slots = rupt.filter((n) => n.text.includes('rupture de')).map((n) => `${Math.floor(n.at / DAY)}-${(n.at % DAY) / 60 < 14 ? 0 : 1}`);
  assert.equal(new Set(slots).size, slots.length, slots.join(' '));
  assert.ok(!log.some((n) => /rupture de \S+\.$/.test(n.text) && log.filter((m) => m.text === n.text && Math.floor(m.at / 720) === Math.floor(n.at / 720)).length > 1), 'pas de doublon');
});

test('un seul message par action (achat de meubles, réglages en lot) ; numéros croissants ; simulation marquée ; pastille = alertes', () => {
  const g = new Game(7, 'Test');
  const r = g.rent(bestFree(g), 'epicerie');
  assert.ok(r.ok);
  const id = r.ok ? r.data.id : -1;
  goTo(g, 'meubles');
  let s0 = g.lastNoticeSeq;
  assert.ok(g.buyFurniture('rayon', 2, id).ok);
  let n = after(g, s0);
  assert.equal(n.length, 1, 'un seul message pour un achat de meubles');
  assert.ok(!n[0]!.sim && /2 × Rayonnage livrés dans la réserve .*CHF.*Aménager/.test(n[0]!.text), n[0]!.text);
  s0 = g.lastNoticeSeq;
  assert.ok(g.applyBatch('tous', { priceFactor: 1.1, auto: true }).ok);
  n = after(g, s0);
  assert.equal(n.length, 1, 'un seul message pour des réglages en lot');
  // Notifications de l'écoulement du temps : marquées « simulation » (l'interface sait qu'elles ne viennent pas d'une action).
  s0 = g.lastNoticeSeq;
  g.player.hunger = NEEDS.low + 0.01;
  g.advance(5);
  n = after(g, s0);
  assert.ok(n.length > 0 && n.every((x) => x.sim), 'messages de la simulation marqués');
  const seqs = g.notices.map((x) => x.seq);
  assert.ok(seqs.every((v, k) => k === 0 || v > seqs[k - 1]!), 'numéros croissants');
  // Pastille du téléphone : seules les alertes (avertissements, erreurs) comptent, pas les informations.
  assert.deepEqual((['info', 'ok', 'warn', 'error'] as const).map((level) => isAlert({ seq: 0, at: 0, level, text: '' })), [false, false, true, true]);
  // Historique plafonné à 100 : les numéros continuent (aucune notification perdue pour l'interface).
  for (let k = 0; k < 150; k++) g.notify('info', `test ${k}`);
  assert.equal(g.notices.length, 100);
  assert.equal(g.notices.at(-1)!.seq, g.lastNoticeSeq);
});

/* ------------------------------ 6. Commerce visé par défaut ------------------------------ */

test('valeurs par défaut : magasin de meubles et agence visent le commerce incomplet, sinon le dernier loué', () => {
  const g = new Game(7, 'Test');
  g.cash = 200_000;
  const a = g.rent(bestFree(g, 0), 'epicerie'), b = g.rent(bestFree(g, 1), 'cafe');
  assert.ok(a.ok && b.ok);
  const A = a.ok ? a.data.id : -1, B = b.ok ? b.data.id : -1;
  assert.equal(defaultShopId(g, 'meubles'), B, 'le dernier loué parmi les incomplets');
  furnish(g, B, ['caisse', 'machine', 'comptoir', 'vitrine', 'frigo']);
  assert.equal(defaultShopId(g, 'meubles'), A, 'le commerce encore à meubler');
  assert.equal(defaultShopId(g, 'emploi'), B, 'sans caissier : le dernier loué');
  hire(g, B);
  assert.equal(defaultShopId(g, 'emploi'), A, 'le commerce sans caissier');
  hire(g, A);
  assert.equal(defaultShopId(g, 'emploi'), B, 'tous complets : le dernier loué');
});
