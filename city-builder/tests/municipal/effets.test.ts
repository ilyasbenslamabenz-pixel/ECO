/**
 * Tests d'effet (docs/ROADMAP_PHASE2.md §4) sur des cas jouets : une décision est modifiée, l'effet est mesuré
 * ET retrouvé dans le registre d'effets (cause -> cible, ampleur, lieu).
 *  1. Pénurie sur le réseau (fermeture d'une centrale) -> délestage des consommateurs les moins prioritaires.
 *  2. Pollution émise par une usine -> diffusion -> baisse de la valeur foncière autour, pas au loin.
 *  3. Même chaîne dans une vraie Simulation : la valeur foncière baisse près de l'usine du bourg de test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Municipal } from '../../src/sim/municipal';
import { Simulation } from '../../src/sim/world';
import { SIM_PLUGINS, type SimPlugin } from '../../src/sim/plugins';
import { createMunicipalPlugin, MUNICIPAL_SERVICE } from '../../src/sim/municipal';
import { buildTown, runDays, townCatalog } from '../sim/fixtures';

/** Avance une façade seule (sans Simulation) comme le ferait le module : événements de base puis tick. */
function run(m: Municipal, from: number, minutes: number, step = 10): number {
  let t = from;
  while (t < from + minutes) {
    t += step;
    if (Math.floor(t / 43200) !== Math.floor((t - step) / 43200)) m.scheduler.month(Math.floor(t / 43200), t);
    if (Math.floor(t / 1440) !== Math.floor((t - step) / 1440)) m.scheduler.day(Math.floor(t / 1440), t);
    m.scheduler.advance(t, step);
  }
  return t;
}

test('effet 1 : pénurie électrique (centrale fermée) -> délestage des moins prioritaires, tracé dans le registre', () => {
  const m = Municipal.forBounds({ minX: -500, minZ: -500, maxX: 500, maxZ: 500 });
  const net = m.networks.ensure('electricite');
  const thermique = net.addNode({ role: 'producer', capacity: 120, x: -400, z: 0, cost: 20 });
  const solaire = net.addNode({ role: 'producer', capacity: 60, x: 400, z: 0, cost: 0 });
  const poste = net.addNode({ role: 'junction', x: 0, z: 0 });
  net.addEdge(thermique, poste, 500, 0.02);
  net.addEdge(solaire, poste, 500, 0.02);
  const hopital = net.addNode({ role: 'consumer', demand: 50, priority: 10, x: 50, z: 50 });
  const ecole = net.addNode({ role: 'consumer', demand: 40, priority: 5, x: -50, z: 50 });
  const quartierA = net.addNode({ role: 'consumer', demand: 45, priority: 0, x: 100, z: -100 });
  const quartierB = net.addNode({ role: 'consumer', demand: 30, priority: 0, x: -100, z: -100 });
  for (const c of [hopital, ecole, quartierA, quartierB]) net.addEdge(poste, c, 200, 0.01);

  // Module « électricité » jouet : répartition horaire, chaque baisse de service est enregistrée comme effet.
  let decision = 0;
  const served = new Map<number, number>();
  m.scheduler.add({
    id: 'electricite:repartition', every: 'hour',
    run: (info) => {
      const r = m.networks.allocate('electricite');
      for (const c of r.consumers) {
        const prev = served.get(c.node) ?? c.delivered;
        if (decision && c.delivered < prev - 1e-9) {
          const n = net.node(c.node)!;
          m.effects.record(decision, 'electricite:livre', c.delivered - prev, 'kW', info.totalMinutes, { x: n.x, z: n.z, radius: 0 }, `priorité ${c.priority}`);
        }
        served.set(c.node, c.delivered);
      }
    },
  });

  let t = run(m, 0, 120);
  const before = m.networks.lastReport('electricite')!;
  assert.equal(before.shortfall < 1e-9, true, 'offre suffisante avant la décision');
  assert.ok(before.consumers.every((c) => !c.shed));

  // Décision du joueur : fermeture de la centrale thermique.
  decision = m.effects.cause({ kind: 'fermeture_centrale', label: 'Fermeture de la centrale thermique', source: 'joueur', at: t, x: -400, z: 0, ref: thermique });
  net.setNodeEnabled(thermique, false);
  t = run(m, t, 60);
  const after = m.networks.lastReport('electricite')!;
  const by = (id: number) => after.consumers.find((c) => c.node === id)!;
  // 60 kW produits, ~57 livrés (pertes 2 % + 1 %) : l'hôpital est servi, l'école partiellement, les logements coupés.
  assert.equal(by(hopital).ratio, 1);
  assert.ok(by(ecole).ratio > 0 && by(ecole).ratio < 1, `école ${by(ecole).ratio}`);
  assert.equal(by(quartierA).delivered, 0);
  assert.equal(by(quartierB).delivered, 0);
  assert.deepEqual(after.shedByPriority, { 0: 2, 5: 1 });
  assert.ok(after.shortfall > 100);

  // Registre : la décision a produit des baisses de service, localisées, plus fortes sur les basses priorités.
  const effects = m.effects.query({ cause: decision });
  assert.equal(effects.length, 3);
  assert.ok(!effects.some((e) => e.x === 50 && e.z === 50), 'aucun effet sur l\'hôpital');
  const sum = m.effects.summary(decision)!;
  assert.ok(Math.abs(sum.byTarget['electricite:livre']! + (before.delivered - after.delivered)) < 1e-6, 'ampleur = énergie perdue');
  assert.equal(m.effects.query({ x: 100, z: -100, radius: 1 })[0]!.note, 'priorité 0');
  assert.equal(m.effects.topCauses(1)[0]!.cause.label, 'Fermeture de la centrale thermique');
});

test('effet 2 : pollution émise -> diffusion -> baisse de la valeur foncière autour de l\'usine', () => {
  const m = Municipal.forBounds({ minX: -512, minZ: -512, maxX: 512, maxZ: 512 }, 32);
  const air = m.grids.ensure('pollution_air');
  const foncier = m.grids.ensure('valeur_fonciere');
  m.grids.addCoupling({ id: 'air->foncier', from: 'pollution_air', to: 'valeur_fonciere', factor: -0.05, every: 'day' });
  const usine = { x: 0, z: 0 };
  let active = false;
  m.scheduler.add({ id: 'usine:emission', every: 'hour', run: () => { if (active) air.stamp(usine.x, usine.z, 40, 10); } });

  // Témoin : 10 jours sans usine -> rien ne bouge.
  let t = run(m, 0, 10 * 1440, 30);
  assert.equal(air.stats().max, 0);
  assert.equal(foncier.at(0, 0), 100);

  // Décision : construction de l'usine.
  const cause = m.effects.cause({ kind: 'construction', label: 'Usine', source: 'joueur', at: t, x: 0, z: 0 });
  const airBefore = air.copyValues(), foncierBefore = foncier.copyValues();
  active = true;
  t = run(m, t, 10 * 1440, 30);
  const eAir = m.effects.measureGrid(cause, air, airBefore, t)!;
  const eFoncier = m.effects.measureGrid(cause, foncier, foncierBefore, t)!;

  // Diffusion : la pollution s'est étendue au-delà du rayon d'émission (40 m) mais décroît avec la distance.
  assert.ok(air.at(0, 0) > air.at(100, 0) && air.at(100, 0) > air.at(200, 0), 'décroissance avec la distance');
  assert.ok(air.at(100, 0) > 0, 'propagée au-delà du rayon d\'émission');
  // Valeur foncière : baisse près de l'usine, plus faible à distance, nulle très loin.
  const near = 100 - foncier.at(0, 0), mid = 100 - foncier.at(150, 0), far = 100 - foncier.at(-480, -480);
  assert.ok(near > 2, `baisse près de l'usine : ${near.toFixed(2)}`);
  assert.ok(mid > 0 && mid < near, `baisse intermédiaire : ${mid.toFixed(3)}`);
  assert.ok(far < 1e-3, `aucune baisse loin : ${far}`);
  // Registre : effet signé, localisé sur l'usine.
  assert.ok(eAir.magnitude > 0 && eFoncier.magnitude < 0);
  assert.ok(Math.hypot(eFoncier.x!, eFoncier.z!) < 32, 'barycentre de l\'effet sur l\'usine');
  assert.deepEqual(Object.keys(m.effects.summary(cause)!.byTarget).sort(), ['pollution_air', 'valeur_fonciere']);
});

test('effet 3 (Simulation complète) : l\'usine du bourg pollue et fait baisser la valeur foncière voisine', () => {
  const run3 = (emit: boolean) => {
    const mp = createMunicipalPlugin();
    const pollueur: SimPlugin = {
      id: 'pollueur',
      init(ctx) {
        const m = ctx.use<typeof mp.municipal>(MUNICIPAL_SERVICE)!;
        m.scheduler.add({
          id: 'pollueur:emission', every: 'hour',
          run: () => {
            if (!emit) return;
            const st = ctx.buildings.store;
            for (let i = 0; i < ctx.buildings.count; i++) {
              const tags = ctx.buildings.assetOf(st.id[i]!)?.tags ?? [];
              const lvl = Number(tags.find((x) => x.startsWith('pollution:'))?.split(':')[1] ?? 0);
              if (lvl > 0) m.grids.ensure('pollution_air').stamp(st.x[i]!, st.z[i]!, 48, 4 * lvl);
            }
          },
        });
      },
      onNewGame(ctx) {
        const m = ctx.use<typeof mp.municipal>(MUNICIPAL_SERVICE)!;
        m.grids.ensure('pollution_air'); m.grids.ensure('valeur_fonciere');
        m.grids.addCoupling({ id: 'air->foncier', from: 'pollution_air', to: 'valeur_fonciere', factor: -0.05, every: 'day' });
      },
    };
    const s = new Simulation([...SIM_PLUGINS, mp, pollueur]);
    s.setCatalog(townCatalog());
    s.newGame({ seed: 77, mapChunks: 4, startMoney: 50_000_000, cityName: 'Bourg', terrain: { hydrology: 'aucune', rivers: 0 } });
    buildTown(s);
    runDays(s, 8, 30);
    const k = Array.from({ length: s.buildings.count }, (_, i) => i).find((i) => s.catalog!.assets[s.buildings.assetIndex[i]!]!.id === 'usine')!;
    return { s, m: mp.municipal, ux: s.buildings.x[k]!, uz: s.buildings.z[k]! };
  };
  const off = run3(false), on = run3(true);
  const f = (r: typeof on, dx: number, dz: number) => r.m.grids.require('valeur_fonciere').at(r.ux + dx, r.uz + dz);
  assert.equal(f(off, 0, 0), 100, 'témoin sans émission : valeur de fond');
  assert.ok(f(on, 0, 0) < 99, `près de l'usine : ${f(on, 0, 0).toFixed(2)}`);
  assert.ok(f(on, 0, 0) < f(on, 160, 0), 'plus forte baisse au plus près');
  // Coin de la carte le plus éloigné de l'usine : valeur foncière quasi inchangée.
  const g = on.m.grids.require('valeur_fonciere');
  const corners = [[0, 0], [g.cols - 1, 0], [0, g.rows - 1], [g.cols - 1, g.rows - 1]] as const;
  const [ci, cj] = corners.reduce((a, c) => (Math.hypot(g.centerX(c[0]) - on.ux, g.centerZ(c[1]) - on.uz) > Math.hypot(g.centerX(a[0]) - on.ux, g.centerZ(a[1]) - on.uz) ? c : a));
  assert.ok(Math.hypot(g.centerX(ci) - on.ux, g.centerZ(cj) - on.uz) > 400);
  assert.ok(g.get(ci, cj) > 99.99, `loin : ${g.get(ci, cj)}`);
  // La simulation de base n'est pas affectée par le contrat (trésorerie, population identiques).
  assert.equal(on.s.economy.money, off.s.economy.money);
  assert.equal(on.s.demography!.population, off.s.demography!.population);
});
