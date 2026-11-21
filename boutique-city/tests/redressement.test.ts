/**
 * Redressement et faillite : commandes à découvert (limite, intérêt), alerte forte après 2 jours de trésorerie
 * négative, plan de redressement après 3 jours de pertes, mise à l'arrêt d'un commerce qui ne peut plus vendre (et
 * redémarrage), prêt d'urgence, licenciement payé à découvert depuis le plan, faillite après 14 jours en zone rouge,
 * sauvegarde. Puis les règles d'équilibrage associées : impôt progressif et report des pertes, frais de siège, rachats
 * majorés, caissiers sans caisse, équipe de pointe, prix au-dessus du quartier (« Aligner »), sensibilité au prix,
 * demande premium selon la réputation, bénéfice estimé par type.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMERGENCY_LOAN, FINANCE, FURNITURE_BY_ID, PREMIUM, PRICE, RESCUE, RIVALS, SHOP_TYPES, hqFee, loanTotal, premiumDemand, priceAppeal, productsOf, weeklyTax,
  type ServiceKind, type ShopType,
} from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { canPlace, layoutStats } from '../src/sim/layout';
import { Game, dayProfit, operatingResult, type GameSave } from '../src/sim/game';

const DAY = 1440;
const LAYOUT = ['caisse', 'rayon', 'rayon', 'rayon', 'frigo', 'frigo', 'plante', 'plante'];
const keepAlive = (g: Game): void => { g.player.energy = 100; g.player.hunger = 100; };
const goTo = (g: Game, kind: ServiceKind): void => { const b = serviceBuilding(g.district, kind)!; g.setPlace({ kind: 'service', service: kind, buildingId: b.id }); };
/** Avance jusqu'à minuit (fin de la journée en cours), personnage reposé. */
const toMidnight = (g: Game): void => { keepAlive(g); g.advance(DAY - (g.total % DAY)); };
/** Une journée complète (de minuit à minuit, ou depuis l'heure courante jusqu'au même moment le lendemain). */
const day = (g: Game): void => { keepAlive(g); g.advance(DAY / 2); keepAlive(g); g.advance(DAY / 2); };
/** Notifications émises pendant `fn` (la liste de la partie est plafonnée à 100 entrées : on compare les objets). */
function during(g: Game, fn: () => void): Game['notices'] {
  const before = new Set(g.notices);
  fn();
  return g.notices.filter((n) => !before.has(n));
}

/** Épicerie aménagée (avec `extra` meubles en plus), approvisionnée et tenue par `staff` caissiers. */
function openShop(g: Game, opts: { type?: ShopType; staff?: number; extra?: string[]; stock?: boolean } = {}): number {
  const type = opts.type ?? 'epicerie';
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  const r = g.rent(p.id, type);
  assert.ok(r.ok, r.ok ? '' : r.message);
  const id = r.data.id, s = g.shop(id)!;
  const layout = [...LAYOUT, ...(opts.extra ?? [])];
  goTo(g, 'meubles');
  for (const f of layout) assert.ok(g.buyFurniture(f, 1, id).ok);
  for (const f of layout) {
    const def = FURNITURE_BY_ID.get(f)!;
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(s.items, p.gridW, p.gridD, def, x, z, 0)) continue;
      const q = g.place(id, f, x, z, 0);
      if (q.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (q.ok) g.pickUp(id, q.data.uid);
    }
  }
  if (opts.stock !== false) for (const pr of productsOf(type)) { g.order(id, pr.id, Math.max(20, g.room(s, pr.id))); g.setAuto(id, pr.id, true); }
  goTo(g, 'emploi');
  for (let k = 0; k < (opts.staff ?? 1); k++) assert.ok(g.hire(g.candidates[0]!.id, id).ok);
  g.setPlace({ kind: 'rue' });
  return id;
}

/* ------------------------------ Découvert ------------------------------ */

test('découvert : commandes possibles jusqu’à 25 % du crédit disponible, intérêt quotidien sur le solde négatif', () => {
  const g = new Game(7);
  const id = openShop(g, { stock: false });
  const od = g.overdraftLimit();
  assert.equal(od, Math.round(g.creditLimit().available * FINANCE.overdraftShare));
  assert.ok(od > 0);
  // Trésorerie presque vide : la commande passe à découvert.
  g.cash = 50;
  const o = g.order(id, 'pain', 30);
  assert.ok(o.ok, o.ok ? '' : o.message);
  assert.ok(g.cash < 0 && g.cash >= -od, `trésorerie ${g.cash}`);
  // Au-delà du découvert autorisé : refus explicite, rien n'est débité.
  g.cash = -od + 1;
  const cash = g.cash;
  const r = g.order(id, 'lait', 40);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.message.includes('découvert autorisé'), !r.ok ? r.message : '');
  assert.equal(g.cash, cash);
  // Minuit : intérêt du découvert compté en charge financière (pas en remboursement de capital).
  g.cash = -10_000;
  toMidnight(g);
  const y = g.ledger.at(-1)!;
  assert.ok(y.finance >= 10_000 * FINANCE.overdraftRate - 0.01, `intérêt ${y.finance}`);
  assert.equal(y.principal ?? 0, 0);
});

/* ------------------------------ Alertes et plan ------------------------------ */

test('trésorerie négative : message le premier soir, alerte forte au deuxième avec le plan de redressement', () => {
  const g = new Game(5);
  toMidnight(g);
  g.cash = -3000;
  const first = during(g, () => toMidnight(g));
  assert.equal(g.rescue.negDays, 1);
  assert.ok(first.some((n) => n.level === 'error' && n.text.startsWith('Trésorerie négative')));
  const second = during(g, () => toMidnight(g));
  assert.equal(g.rescue.negDays, RESCUE.negDaysAlert);
  const alert = second.find((n) => n.text.startsWith('ALERTE'));
  assert.ok(alert && alert.level === 'error' && alert.action?.kind === 'redressement', 'alerte forte avec accès au plan');
  assert.ok(g.inDifficulty());
  // Trésorerie remontée : le compteur repart de zéro.
  g.cash = 5000;
  toMidnight(g);
  assert.equal(g.rescue.negDays, 0);
});

test('pertes d’affilée : plan de redressement proposé au 3e jour puis chaque semaine, résumé des charges', () => {
  const g = new Game(7);
  g.cash = 60_000;
  const id = openShop(g);
  day(g); day(g);
  assert.ok(g.ledger.some((d) => d.revenue > 0), 'activité lancée');
  assert.equal(g.rescue.lossDays, 0, 'commerce rentable');
  // Plus rien à vendre (réassort coupé, rayons vidés) : les journées deviennent des pertes.
  const s = g.shop(id)!;
  for (const pr of productsOf('epicerie')) { g.setAuto(id, pr.id, false); s.products[pr.id]!.stock = 0; }
  const plans = (fn: () => void): number => during(g, fn).filter((n) => n.action?.kind === 'redressement' && n.text.includes('pertes d’affilée')).length;
  const seen: number[] = [];
  for (let d = 0; d < 3; d++) seen.push(plans(() => day(g)));
  assert.ok(g.rescue.lossDays >= RESCUE.lossDaysPlan, `jours de pertes ${g.rescue.lossDays}`);
  assert.ok(operatingResult(g.ledger.at(-1)!) < 0);
  assert.equal(seen.reduce((a, b) => a + b, 0), 1, 'plan proposé une fois');
  const sum = g.lossSummary();
  assert.ok(sum.days >= 3 && sum.result < 0 && sum.rent > 0, JSON.stringify(sum));
  assert.ok(g.inDifficulty() && g.emergencyOffer().available);
  // Une semaine de pertes de plus : le plan revient.
  let again = 0;
  for (let d = 0; d < RESCUE.planEvery; d++) again += plans(() => day(g));
  assert.equal(again, 1, 'plan reproposé une fois par semaine de pertes');
});

/* ------------------------------ Mise à l'arrêt ------------------------------ */

test('mise à l’arrêt : 2 jours sans vente et rayons vides, employés en chômage technique, redémarrage au réassort', () => {
  const g = new Game(7);
  g.cash = 60_000;
  const id = openShop(g, { stock: false });
  const s = g.shop(id)!;
  assert.ok(g.setCleanService(id, true).ok);
  assert.equal(g.blocker(s), 'rayons');
  toMidnight(g);
  assert.equal(s.stopped, undefined, 'un seul jour sans vente');
  toMidnight(g);
  assert.equal(s.stopped, 'rayons');
  assert.ok(g.notices.some((n) => n.text.includes('mis à l’arrêt') && n.text.includes('chômage technique')));
  // Une journée entière à l'arrêt : ni salaire, ni nettoyage de nuit facturé.
  day(g);
  const y = s.history.at(-1)!;
  assert.equal(y.wages, 0, 'aucun salaire payé');
  assert.equal(g.onDuty(id, 'caisse', 10).length, 0);
  assert.deepEqual(g.cashierGaps(id), [], 'le planning prévu reste affiché');
  // Marchandise rangée : il repart à l'heure suivante, l'employé est de nouveau payé.
  s.products['pain']!.stock = 20;
  keepAlive(g); g.advance(60);
  assert.equal(s.stopped, undefined);
  assert.ok(g.notices.some((n) => n.text.includes('repart')));
  // Sans caissier (rôle changé) puis embauche : arrêt « pas de caissier », redémarrage aussitôt l'embauche faite.
  const e = g.staffOf(id)[0]!;
  assert.ok(g.setRole(e.id, 'rayon').ok);
  assert.equal(g.blocker(s), 'caissier');
  toMidnight(g); toMidnight(g); toMidnight(g);
  assert.equal(s.stopped, 'caissier');
  assert.ok(g.setRole(e.id, 'caisse').ok);
  assert.equal(s.stopped, undefined, 'repart dès que la caisse peut être tenue');
});

test('mise à l’arrêt évitée quand une livraison est en route', () => {
  const g = new Game(7);
  g.cash = 60_000;
  const id = openShop(g, { stock: false });
  const s = g.shop(id)!;
  toMidnight(g); keepAlive(g); g.advance(22 * 60);
  // Commande passée juste avant minuit : livrée à 7 h, pas de mise à l'arrêt.
  assert.ok(g.order(id, 'pain', 30).ok);
  toMidnight(g);
  assert.equal(s.stopped, undefined);
});

/* ------------------------------ Prêt d'urgence, licenciement à découvert ------------------------------ */

test('prêt d’urgence : réservé aux entreprises en difficulté, hors plafond, un seul à la fois', () => {
  const g = new Game(7);
  assert.equal(g.emergencyOffer().available, false);
  assert.equal(g.takeEmergencyLoan().ok, false, 'entreprise en bonne santé');
  // Endettée jusqu'au plafond et à découvert : la banque refuse un prêt ordinaire, mais pas le prêt d'urgence.
  goTo(g, 'banque');
  while (g.takeLoan(0).ok) { /* jusqu'au plafond */ }
  g.cash = -500;
  const before = g.cash, debt = g.debt;
  const l = g.takeEmergencyLoan();
  assert.ok(l.ok, l.ok ? '' : l.message);
  assert.equal(g.cash - before, EMERGENCY_LOAN.amount);
  assert.equal(g.debt - debt, loanTotal(EMERGENCY_LOAN));
  assert.ok(l.ok && l.data.emergency && l.data.daysLeft === EMERGENCY_LOAN.days);
  g.cash = -100;
  assert.equal(g.takeEmergencyLoan().ok, false, 'un seul prêt d’urgence à la fois');
  // Remboursé chaque jour comme un prêt ordinaire.
  const rem = g.loans.find((x) => x.emergency)!.remaining;
  toMidnight(g);
  assert.ok(g.loans.find((x) => x.emergency)!.remaining < rem);
});

test('plan de redressement : l’indemnité de licenciement peut être payée à découvert', () => {
  const g = new Game(7);
  const id = openShop(g);
  const e = g.staffOf(id)[0]!;
  g.cash = 10;
  assert.equal(g.fire(e.id).ok, false, 'hors plan : trésorerie exigée');
  const r = g.fire(e.id, true);
  assert.ok(r.ok, r.ok ? '' : r.message);
  assert.ok(r.ok && Math.abs(g.cash - (10 - r.data)) < 1e-6 && g.cash < 0);
  assert.equal(g.employees.length, 0);
  // Découvert épuisé : refus.
  g.cash = 50_000;
  const id2 = openShop(g);
  const e2 = g.staffOf(id2)[0]!;
  g.cash = -g.overdraftLimit();
  assert.equal(g.fire(e2.id, true).ok, false);
});

/* ------------------------------ Faillite ------------------------------ */

test('faillite : valeur nette sous −20 000 CHF et trésorerie négative pendant 14 jours, compte à rebours, sauvegarde', () => {
  const g = new Game(3);
  toMidnight(g);
  g.cash = -40_000;
  toMidnight(g);
  assert.equal(g.rescue.redDays, 1);
  assert.equal(g.bankruptcyIn(), RESCUE.bankruptDays - 1);
  assert.ok(g.notices.some((n) => n.text.startsWith('Risque de faillite') && n.action?.kind === 'redressement'));
  // Sauvegarde en cours de compte à rebours : reprise identique ; une ancienne sauvegarde sans le champ part de zéro.
  const save = structuredClone(g.save()) as GameSave;
  const h = new Game(3, 'x', structuredClone(save));
  assert.deepEqual(h.rescue, g.rescue);
  const old = structuredClone(save);
  delete old.rescue;
  assert.deepEqual(new Game(3, 'x', old).rescue, { negDays: 0, lossDays: 0, redDays: 0, bankrupt: false });
  for (let d = 1; d < RESCUE.bankruptDays - 1; d++) toMidnight(g);
  assert.equal(g.rescue.bankrupt, false);
  assert.equal(g.bankruptcyIn(), 1);
  toMidnight(g);
  assert.equal(g.rescue.bankrupt, true);
  assert.equal(g.rescue.bankruptDay, g.day);
  assert.ok(g.notices.some((n) => n.text.startsWith('Faillite')));
  assert.equal(g.emergencyOffer().available, false);
  assert.equal(g.planDue(), false);
});

test('faillite : pas de compte à rebours pour une expansion à crédit (valeur nette négative mais trésorerie positive)', () => {
  const g = new Game(3);
  toMidnight(g);
  // Dette lourde, trésorerie positive : la banque suit, pas de zone rouge.
  g.loans.push({ id: 999, amount: 80_000, total: 90_000, remaining: 90_000, daily: 500, daysLeft: 180 });
  g.cash = 20_000;
  for (let d = 0; d < 3; d++) toMidnight(g);
  assert.ok(g.cash > 0);
  assert.equal(g.rescue.redDays, 0);
  // Trésorerie négative en plus : le compte à rebours commence ; remontée au-dessus de zéro : il s'arrête.
  g.cash = -1000;
  toMidnight(g);
  assert.equal(g.rescue.redDays, 1);
  g.cash = 50_000;
  toMidnight(g);
  assert.equal(g.rescue.redDays, 0);
  assert.equal(g.bankruptcyIn(), null);
});

/* ------------------------------ Impôt progressif, report des pertes ------------------------------ */

test('impôt : barème progressif par tranches, report des pertes sur 4 semaines', () => {
  assert.equal(weeklyTax(0), 0);
  assert.equal(weeklyTax(5000), 750);
  assert.equal(weeklyTax(7000), 1050);
  assert.equal(weeklyTax(10_000), 1050 + 750);
  assert.equal(weeklyTax(30_000), 1050 + 3250 + 3500);
  const g = new Game(3);
  toMidnight(g);
  for (let d = 1; d < 7; d++) day(g);
  assert.equal(g.today.day, 7, 'début de la semaine 1');
  // Semaine 1 (jours 8 à 14) : gros investissement, déficit reportable.
  g.today.equipment += 6000; g.cash -= 6000;
  for (let d = 0; d < 7; d++) day(g);
  const deficit = g.taxes.at(-1)!;
  assert.ok(deficit.week === 1 && deficit.base < -5000 && deficit.amount === 0);
  assert.equal(deficit.loss, -deficit.base);
  // Semaine 2 : bénéfice ; le déficit est déduit avant le barème.
  for (let d = 0; d < 7; d++) { g.today.revenue += 2000; g.cash += 2000; day(g); }
  const rec = g.taxes.at(-1)!;
  assert.equal(rec.week, 2);
  assert.ok(Math.abs((rec.carried ?? 0) - Math.min(rec.base, -deficit.base)) < 0.02, `déduit ${rec.carried}`);
  assert.ok(Math.abs(rec.amount - weeklyTax(rec.base - (rec.carried ?? 0))) < 0.05, `impôt ${rec.amount}`);
  assert.equal(g.taxes.find((t) => t.week === 1)!.loss ?? 0, 0, 'déficit consommé');
  // Un déficit de plus de 4 semaines n'est plus déductible.
  assert.equal(g.lossCarry(1 + FINANCE.taxCarryWeeks + 1), 0);
});

/* ------------------------------ Frais de siège, rachats majorés ------------------------------ */

test('frais de siège : gratuits jusqu’à 5 commerces, puis de plus en plus chers, comptés dans le résultat', () => {
  assert.equal(hqFee(FINANCE.hqFreeShops), 0);
  assert.equal(hqFee(6), FINANCE.hqPerShop);
  assert.equal(hqFee(7), 2 * FINANCE.hqPerShop + FINANCE.hqStep);
  for (let n = 6; n < 30; n++) assert.ok(hqFee(n + 1) - hqFee(n) > hqFee(n) - hqFee(n - 1) - 1e-9, 'coût marginal croissant');
  const g = new Game(11);
  g.cash = 300_000;
  const free = g.district.premises.filter((p) => g.isFree(p)).slice(0, 6);
  for (const p of free) assert.ok(g.rent(p.id, 'fleuriste').ok);
  assert.ok(g.notices.some((n) => n.text.startsWith('Au-delà de 5 commerces')));
  toMidnight(g);
  const y = g.ledger.at(-1)!;
  assert.equal(y.overhead, hqFee(6));
  assert.ok(Math.abs(dayProfit(y) - (y.revenue + y.rentalIncome - y.purchases - y.wages - y.rent - y.equipment - y.marketing - y.finance - y.living - (y.tax ?? 0) - hqFee(6))) < 1e-6);
});

test('rachat de rivaux : plancher relevé, chaque rachat renchérit les suivants, compteur sauvegardé', () => {
  const g = new Game(7), rv = g.rivalry;
  keepAlive(g); g.advance(3 * DAY);
  const shops = rv.shops.filter((s) => s.co);
  const [a, b] = shops as [typeof shops[0], typeof shops[0]];
  const qb0 = rv.quote(b.premiseId)!;
  assert.ok(qb0.price >= RIVALS.buyMin);
  g.cash = 1_000_000;
  assert.ok(rv.buy(a.premiseId, false).ok);
  assert.equal(rv.buys, 1);
  const qb1 = rv.quote(b.premiseId)!;
  assert.ok(Math.abs(qb1.price / qb0.price - (1 + RIVALS.buySurcharge)) < 0.02, `${qb0.price} → ${qb1.price}`);
  const h = new Game(7, 'x', structuredClone(g.save()));
  assert.equal(h.rivalry.buys, 1);
});

/* ------------------------------ Caisses, équipes, réputation ------------------------------ */

test('caissiers sans caisse : avertissement à l’embauche ; équipe de pointe de 16 h à 20 h', () => {
  const g = new Game(7);
  g.cash = 60_000;
  const id = openShop(g);
  goTo(g, 'emploi');
  const w = during(g, () => assert.ok(g.hire(g.candidates[0]!.id, id).ok)).find((n) => n.text.includes('caissiers en même temps pour 1 caisse'));
  assert.ok(w && w.level === 'warn', 'deuxième caissier sans deuxième caisse signalé');
  assert.deepEqual(g.cashierSurplus(id).hours, [[8, 20]]);
  // Le second en équipe de pointe : 4 h payées, surplus limité à 16 h – 20 h.
  const e = g.employees.at(-1)!;
  assert.ok(g.setShift(e.id, 'pointe').ok);
  assert.equal(g.hoursPerDay(e), 4);
  assert.ok(g.worksAt(e, 16) && g.worksAt(e, 19) && !g.worksAt(e, 15) && !g.worksAt(e, 20));
  assert.deepEqual(g.cashierSurplus(id).hours, [[16, 20]]);
  // Une deuxième caisse : plus d'avertissement.
  goTo(g, 'meubles');
  assert.ok(g.buyFurniture('caisse', 1, id).ok);
  const s = g.shop(id)!, p = g.premise(s.premiseId)!;
  let placed = false;
  for (let z = 0; z < p.gridD && !placed; z++) for (let x = 0; x < p.gridW && !placed; x++) {
    if (canPlace(s.items, p.gridW, p.gridD, FURNITURE_BY_ID.get('caisse')!, x, z, 0)) continue;
    const r = g.place(id, 'caisse', x, z, 0);
    if (r.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) placed = true; else if (r.ok) g.pickUp(id, r.data.uid);
  }
  assert.ok(placed);
  assert.deepEqual(g.cashierSurplus(id).hours, []);
});

test('réputation : un client lassé d’attendre pèse plus lourd qu’un client reparti faute de stock', () => {
  const run = (wait: boolean): number => {
    const g = new Game(7);
    const id = openShop(g);
    const s = g.shop(id)!;
    toMidnight(g);
    s.reputation = 0.6;
    // Journée fictive : 1 000 clients servis, 1 000 perdus (attente ou rupture), puis une heure de jeu.
    s.today.customers = 1000;
    if (wait) s.today.lostCapacity = 1000; else s.today.lostStock = 1000;
    keepAlive(g); g.advance(60);
    return s.reputation;
  };
  assert.ok(run(true) < run(false) - 0.001, 'attente plus pénalisante');
});

/* ------------------------------ Prix du quartier, élasticité ------------------------------ */

test('prix au-dessus du quartier : notification avec « Aligner » quand les concurrents baissent, alignement en un geste', () => {
  const g = new Game(7);
  g.cash = 120_000;
  const a = openShop(g), b = openShop(g);
  toMidnight(g);
  const note = g.notices.find((n) => n.text.startsWith('Les concurrents (épicerie) baissent leurs prix'));
  assert.ok(note, 'baisse des concurrents annoncée');
  assert.deepEqual(note!.action, { kind: 'aligner', target: 'epicerie' });
  assert.ok(note!.text.includes('au-dessus du quartier'));
  assert.ok(g.priceGap('epicerie') >= 0.03 && g.priceGap(g.shop(a)!) >= 0.03);
  const r = g.applyBatch('epicerie', { priceFactor: 1 });
  assert.ok(r.ok && r.data.shops === 2);
  assert.ok(Math.abs(g.priceGap('epicerie')) < 0.005 && Math.abs(g.priceGap(g.shop(b)!)) < 0.005);
});

test('sensibilité au prix : plus douce au-dessus du prix du quartier qu’en dessous', () => {
  assert.equal(priceAppeal(1), 1);
  assert.ok(Math.abs(priceAppeal(1.2) - Math.exp(-PRICE.above * 0.2)) < 1e-12);
  assert.ok(Math.abs(priceAppeal(0.8) - Math.exp(PRICE.below * 0.2)) < 1e-12);
  assert.ok(PRICE.above < PRICE.below);
  // 20 % plus cher : environ 27 % d'attrait en moins (contre 36 % avec l'ancienne sensibilité).
  assert.ok(priceAppeal(1.2) > 0.72 && priceAppeal(1.2) < 0.74);
});

/* ------------------------------ Premium, estimation par type ------------------------------ */

test('demande premium : faible sous 65 % de réputation, normale au-delà', () => {
  for (let r = 0; r < 1; r += 0.05) assert.ok(premiumDemand(r + 0.05) >= premiumDemand(r) - 1e-12, 'croissante');
  assert.ok(Math.abs(premiumDemand(PREMIUM.knee) - (PREMIUM.demandBase + PREMIUM.demandSlope * PREMIUM.knee)) < 1e-12);
  // Marge × 1,5 : le premium ne rapporte qu'au-delà de 2/3 de la demande, atteints vers 65 % de réputation.
  assert.ok(premiumDemand(0.6) * PREMIUM.priceMult < 0.85);
  assert.ok(premiumDemand(0.7) * PREMIUM.priceMult > 1);
  assert.ok(premiumDemand(0.5) < 0.2 && premiumDemand(0.2) === PREMIUM.demandMin);
  assert.ok(premiumDemand(1) <= PREMIUM.demandMax);
});

test('bénéfice estimé par type (Immobilier) : détail cohérent, meilleur type, pas toujours le plus de clients', () => {
  const picks = new Set<string>();
  for (const seed of [1, 7]) {
    const g = new Game(seed);
    const free = g.district.premises.filter((p) => g.isFree(p));
    for (const p of free) {
      const best = g.bestType(p);
      picks.add(best.type);
      for (const t of SHOP_TYPES) {
        const e = g.estimateProfit(p, t.id);
        assert.ok(e.cashiers >= 1 && e.cashiers <= 3 && e.customers >= 0);
        assert.ok(Math.abs(e.profit - (e.margin - e.wages - e.rent - e.other)) <= 2, `${t.id} : ${JSON.stringify(e)}`);
        assert.ok(e.profit <= best.profit);
      }
    }
    // L'ancien conseil (le plus de clients par heure) désignait presque toujours l'épicerie ou la boulangerie.
    const top = free.sort((a, b) => b.footfall - a.footfall)[0]!;
    const busiest = [...SHOP_TYPES].sort((a, b) => g.estimatePeak(top, b.id) - g.estimatePeak(top, a.id))[0]!.id;
    assert.ok(['epicerie', 'boulangerie'].includes(busiest));
  }
  assert.ok(picks.size >= 2, `types conseillés variés : ${[...picks].join(', ')}`);
  assert.ok([...picks].some((t) => t !== 'epicerie' && t !== 'boulangerie'), 'le conseil ne se limite plus aux commerces à fort passage');
});
