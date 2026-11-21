/**
 * Finances de milieu et fin de partie : impôt hebdomadaire sur le bénéfice (exonération de départ, déficits non
 * imposés, provision annoncée), plafond de crédit (ventes récentes et valeur nette), placements (épargne, fonds
 * déterministe, frais de retrait, valeur nette), notoriété des campagnes qui s'accumule puis s'estompe, sauvegarde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_BY_ID, FINANCE, INVEST_BY_ID } from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { Game, dayProfit } from '../src/sim/game';
import { netWorth } from '../src/sim/objectives';
import type { ServiceKind } from '../src/sim/catalog';

const DAY = 1440;
const keepAlive = (g: Game): void => { g.player.energy = 100; g.player.hunger = 100; };
const goTo = (g: Game, kind: ServiceKind): void => { const b = serviceBuilding(g.district, kind)!; g.setPlace({ kind: 'service', service: kind, buildingId: b.id }); };
/** Avance d'un jour en ajoutant `sales` CHF de ventes fictives à la journée en cours. */
function day(g: Game, sales: number): void { g.today.revenue += sales; g.cash += sales; keepAlive(g); g.advance(DAY / 2); keepAlive(g); g.advance(DAY / 2); }
const close = (a: number, b: number, eps = 0.02): boolean => Math.abs(a - b) <= eps;

test('impôt : première semaine exonérée, 18 % du bénéfice ensuite, déficit non imposé, provision annoncée', () => {
  const g = new Game(3);
  // Le premier jour commence en cours de journée : on s'aligne sur minuit.
  keepAlive(g); g.advance(DAY - (g.total % DAY));
  assert.equal(g.today.day, 1);
  for (let d = 1; d < 7; d++) day(g, 1500);
  assert.equal(g.ledger.reduce((a, d) => a + (d.tax ?? 0), 0), 0, 'première semaine exonérée');
  assert.equal(g.taxEstimate().exempt, false);
  // Semaine 2 : provision visible, puis prélèvement au soir du 7e jour.
  for (let d = 0; d < 6; d++) day(g, 2000);
  const est = g.taxEstimate();
  assert.equal(est.daysLeft, 0, 'prélèvement ce soir');
  g.today.revenue += 2000; g.cash += 2000;
  const est2 = g.taxEstimate();
  assert.ok(est2.base > est.base && close(est2.due, Math.max(0, est2.base) * FINANCE.taxRate));
  const cash = g.cash;
  keepAlive(g); g.advance(DAY - (g.total % DAY));
  const y = g.ledger.at(-1)!;
  assert.equal(y.day, 13);
  const week = g.ledger.filter((d) => d.day >= 7 && d.day <= 13);
  const base = week.reduce((a, d) => a + dayProfit(d) + (d.tax ?? 0), 0);
  assert.ok(base > 0);
  assert.ok(close(y.tax ?? 0, base * FINANCE.taxRate, 0.05), `impôt ${y.tax} pour ${base}`);
  assert.ok(close(dayProfit(y), y.revenue - y.purchases - y.wages - y.rent - y.equipment - y.marketing - y.finance - y.living - (y.tax ?? 0)));
  assert.ok(cash - g.cash >= (y.tax ?? 0) - 0.01, 'impôt débité de la trésorerie');
  assert.deepEqual(g.taxes.at(-1), { week: 1, base: Math.round(base * 100) / 100, amount: y.tax });
  // Semaine 3 sans ventes : déficit, aucun impôt.
  for (let d = 0; d < 7; d++) day(g, 0);
  assert.equal(g.ledger.at(-1)!.tax ?? 0, 0, 'déficit non imposé');
  assert.equal(g.taxes.at(-1)!.amount, 0);
  assert.ok(g.taxes.at(-1)!.base < 0);
});

test('crédit : plafond selon la valeur nette et les ventes récentes, motif du refus', () => {
  const g = new Game(5);
  const c0 = g.creditLimit();
  assert.equal(c0.limit, FINANCE.creditBase + Math.round(netWorth(g) * FINANCE.creditWorthShare));
  assert.equal(c0.sales7, 0);
  for (let d = 0; d < 3; d++) day(g, 3000);
  const c1 = g.creditLimit();
  assert.ok(close(c1.sales7, 9000) && c1.fromSales === 18_000, 'deux semaines de ventes récentes');
  assert.ok(c1.limit > c0.limit);
  // Valeur nette très négative : il ne reste que le socle et les ventes.
  g.cash = -500_000;
  assert.equal(g.creditLimit().fromWorth, 0);
  goTo(g, 'banque');
  assert.ok(g.takeLoan(0).ok, 'petit prêt sous le plafond');
  const r = g.takeLoan(2);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.message.includes('plafond de crédit'));
  // Plafond borné.
  g.cash = 10_000_000;
  assert.equal(g.creditLimit().limit, FINANCE.creditMax);
  assert.ok(g.creditLimit().capped);
});

test('placements : épargne sûre, fonds déterministe, frais de retrait, valeur nette, sauvegarde', () => {
  const g = new Game(9), h = new Game(9);
  assert.equal(g.deposit('epargne', 50).ok, false, 'placement minimal');
  assert.equal(g.deposit('fonds', 1e9).ok, false, 'trésorerie insuffisante');
  const nw0 = netWorth(g);
  assert.ok(g.deposit('epargne', 10_000).ok && g.deposit('fonds', 10_000).ok);
  assert.ok(h.deposit('fonds', 10_000).ok);
  assert.ok(close(netWorth(g), nw0 - 10_000 * INVEST_BY_ID.get('fonds')!.exitFee), 'valeur de rachat comptée (frais du fonds déduits)');
  for (let d = 0; d < 10; d++) { day(g, 0); day(h, 0); }
  assert.ok(close(g.invest.epargne, 10_000 * (1 + INVEST_BY_ID.get('epargne')!.dailyMean) ** 10, 0.2), `épargne ${g.invest.epargne}`);
  assert.equal(g.invest.fonds, h.invest.fonds, 'fonds : même graine, même valeur');
  assert.notEqual(g.invest.fonds, 10_000, 'le fonds varie');
  assert.equal(g.fundReturns.length, 10);
  // Sauvegarde et reprise identiques.
  const k = new Game(9, 'x', structuredClone(g.save()));
  assert.deepEqual(k.invest, g.invest);
  assert.deepEqual(k.investPrincipal, g.investPrincipal);
  assert.deepEqual(k.fundReturns, g.fundReturns);
  day(k, 0); day(g, 0);
  assert.equal(k.invest.fonds, g.invest.fonds, 'même suite après reprise');
  // Retrait partiel du fonds : 1 % de frais.
  const cash = g.cash, half = g.invest.fonds / 2;
  const w = g.withdraw('fonds', half);
  assert.ok(w.ok && close(w.data, half * 0.99) && close(g.cash - cash, half * 0.99));
  const all = g.withdraw('epargne', 1e9);
  assert.ok(all.ok && g.invest.epargne === 0 && g.investPrincipal.epargne === 0);
  assert.equal(g.withdraw('epargne', 10).ok, false);
});

test('notoriété : monte au lancement et pendant la campagne, s’estompe ensuite, sauvegardée', () => {
  const g = new Game(7);
  const p = g.district.premises.filter((x) => g.isFree(x))[0]!;
  const s = g.rent(p.id, 'cafe');
  assert.ok(s.ok);
  if (!s.ok) return;
  const id = s.data.id, b = CAMPAIGN_BY_ID.get('flyers')!.boost;
  goTo(g, 'pub');
  assert.ok(g.startCampaign('flyers', id, 5).ok);
  assert.ok(close(g.marketingBoost(id), b, 1e-9), 'effet immédiat');
  assert.ok(g.awarenessView(id).trend > 0, 'tendance à la hausse pendant la campagne');
  const seen: number[] = [];
  for (let d = 0; d < 12; d++) { keepAlive(g); g.advance(DAY / 2); seen.push(g.marketingBoost(id)); }
  assert.ok(Math.max(...seen) > b, 'la notoriété s’accumule');
  assert.equal(g.campaigns.length, 0);
  const v = g.awarenessView(id);
  assert.ok(v.now > 0 && v.trend < 0, 'après la campagne : notoriété résiduelle qui baisse');
  const k = new Game(7, 'x', structuredClone(g.save()));
  assert.deepEqual(k.awareness, g.awareness);
  for (let d = 0; d < 30; d++) day(g, 0);
  assert.equal(g.marketingBoost(id), 0, 'notoriété disparue');
  // Résiliation : la notoriété du commerce disparaît.
  goTo(g, 'pub');
  assert.ok(g.startCampaign('affiches', id, 2).ok);
  assert.ok(g.release(id).ok);
  assert.equal(g.awareness[id], undefined);
});
