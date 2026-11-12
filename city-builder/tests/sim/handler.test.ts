/** Répartiteur : commandes étendues validées, aller-retour sauvegarde via le protocole, worker non dupe. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { handleCommand } from '../../src/sim/handler';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import type { ResultMessage } from '../../src/shared/protocol';
import { buildTown, townCatalog } from './fixtures';

let req = 1;
function cmd(s: Simulation, name: string, args: unknown): ResultMessage {
  return handleCommand(s, { kind: 'cmd', reqId: req++, name, args }).result as ResultMessage;
}

function started(): Simulation {
  const s = new Simulation();
  assert.ok(cmd(s, 'init', { protocolVersion: PROTOCOL_VERSION, catalog: townCatalog() }).ok);
  assert.ok(cmd(s, 'newGame', { seed: 1234, mapChunks: 4, startMoney: 50_000_000, cityName: 'Proto', terrain: { hydrology: 'aucune', rivers: 0 } }).ok);
  return s;
}

test('commandes étendues : validation des arguments côté worker', () => {
  const s = new Simulation();
  const noGame = cmd(s, 'getReport', {});
  assert.ok(!noGame.ok && noGame.error.code === 'NO_GAME');
  const g = started();
  const bad: [string, unknown][] = [
    ['setTaxRate', { sector: 'lune', rate: 0.1 }], ['setTaxRate', { sector: 'office', rate: 'beaucoup' }],
    ['takeLoan', { amount: 'mille', months: 12 }], ['repayLoan', {}], ['inspectBuilding', { buildingId: null }],
    ['setFocus', { x: NaN, z: 0 }], ['settle', { waves: 0 }], ['settle', { waves: 1e9 }], ['getReport', { fullHistory: 'oui' }],
  ];
  for (const [n, a] of bad) {
    const r = cmd(g, n, a);
    assert.ok(!r.ok && r.error.code === 'INVALID_ARGS', `${n} ${JSON.stringify(a)}`);
  }
  const notMsg = handleCommand(g, { kind: 'cmd', reqId: 5, name: 'setTaxRate' }).result as ResultMessage;
  assert.ok(!notMsg.ok);
});

test('commandes étendues : impôts, emprunt, rapport, inspection, peuplement', () => {
  const s = started();
  buildTown(s);
  const t = cmd(s, 'setTaxRate', { sector: 'residential', rate: 0.3 });
  assert.ok(t.ok && (t.data as { rate: number }).rate === 0.25);
  const offer = cmd(s, 'loanOffer', { amount: 500_000, months: 60 });
  assert.ok(offer.ok && (offer.data as { monthlyPayment: number }).monthlyPayment > 500_000 / 60);
  const money0 = s.economy.money;
  const loan = cmd(s, 'takeLoan', { amount: 500_000, months: 60 });
  assert.ok(loan.ok && s.economy.money === money0 + 500_000);
  const tooBig = cmd(s, 'takeLoan', { amount: 1e12, months: 60 });
  assert.ok(!tooBig.ok && /Capacité/.test(tooBig.error.message));
  const settle = cmd(s, 'settle', { waves: 20 });
  assert.ok(settle.ok && (settle.data as { population: number }).population > 100);
  const rep = cmd(s, 'getReport', { fullHistory: true });
  assert.ok(rep.ok);
  const r = rep.data as { economy: { loans: unknown[]; forecast: { totalIncome: number } }; demography: { population: number }; dateFr: string };
  assert.equal(r.economy.loans.length, 1);
  assert.ok(r.economy.forecast.totalIncome > 0, 'recettes prévues dès que la ville est habitée');
  assert.ok(r.demography.population > 100);
  assert.match(r.dateFr, /janvier an 1/);
  const ins = cmd(s, 'inspectBuilding', { buildingId: s.buildings.id[0]! });
  assert.ok(ins.ok);
  const cid = s.demography!.citizens.col.id[0]!;
  const ci = cmd(s, 'inspectCitizen', { citizenId: cid });
  assert.ok(ci.ok && typeof (ci.data as { name: string }).name === 'string');
  assert.ok(!cmd(s, 'inspectCitizen', { citizenId: 999_999 }).ok);
  const repay = cmd(s, 'repayLoan', { loanId: (loan.data as { loan: { id: number } }).loan.id });
  assert.ok(repay.ok && s.economy.loans.length === 0);
});

test('protocole : save puis load renvoient la même ville ; load corrompu refusé sans casser la partie', () => {
  const s = started();
  buildTown(s);
  cmd(s, 'settle', { waves: 10 });
  const sv = cmd(s, 'save', { slot: 'test' });
  assert.ok(sv.ok);
  const data = JSON.parse(JSON.stringify((sv.data as { data: unknown }).data));
  const s2 = new Simulation();
  cmd(s2, 'init', { protocolVersion: PROTOCOL_VERSION, catalog: townCatalog() });
  const ld = handleCommand(s2, { kind: 'cmd', reqId: 99, name: 'load', args: { data } });
  assert.ok(ld.snapshot && (ld.result as ResultMessage).ok);
  assert.equal(s2.demography!.population, s.demography!.population);
  const pop = s2.demography!.population;
  const bad = cmd(s2, 'load', { data: { ...data, buildings: 'rien' } });
  assert.ok(!bad.ok && bad.error.code === 'BAD_SAVE');
  assert.equal(s2.demography!.population, pop, 'partie en cours conservée');
});
