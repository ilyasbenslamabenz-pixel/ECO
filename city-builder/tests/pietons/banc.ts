/**
 * Banc de mesure du module piétons (simulation seule, sans rendu) :
 *   npx tsx tests/pietons/banc.ts [2000,5000]
 * Ville en quadrillage (9 × 9 rues, îlots de 100 m, ≈ 290 bâtiments), foule imposée de N piétons maintenue en
 * permanence (trajets renouvelés), mesure sur 1 200 ticks après stabilisation :
 *  - coût du module par tick (moyenne, p95, max) — `performance.now()` autour de `PedestrianSystem.tick` ;
 *  - coût du tick complet de la simulation (moyenne, p95), avec et sans le module, même ville ;
 *  - trame envoyée au rendu (octets par delta).
 * Résultats : tests/e2e/out/perf/pietons-<N>.json (format de docs/ROADMAP_PHASE2.md §5) et tests/pietons/BANC.md.
 * N'affirme rien : écrit ce qui est mesuré sur la machine qui l'exécute.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Simulation } from '../../src/sim/world';
import { createPietonsPlugin } from '../../src/sim/plugins/pietons';
import type { PietonsDelta } from '../../src/shared/protocol-ext/pietons';
import { townCatalog } from '../sim/fixtures';
import { buildGrid } from './fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const AXIS = [-400, -300, -200, -100, 0, 100, 200, 300, 400];
const MEASURE_TICKS = 1200;

function city(withPlugin: boolean): { sim: Simulation; plugin: ReturnType<typeof createPietonsPlugin>; buildings: number } {
  const plugin = createPietonsPlugin();
  const sim = new Simulation(withPlugin ? [plugin] : []);
  sim.setCatalog(townCatalog());
  sim.newGame({ seed: 2026, mapChunks: 6, startMoney: 2_000_000_000, cityName: 'Banc', terrain: { hydrology: 'aucune', rivers: 0, relief: 0, maxAltitude: 20 } });
  const ids = buildGrid(sim, AXIS, AXIS);
  sim.snapshot();
  return { sim, plugin, buildings: ids.length };
}

function pct(sorted: number[], p: number): number { return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!; }
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function measure(sim: Simulation, ticks: number): { mean: number; p95: number; max: number } {
  const samples: number[] = [];
  for (let k = 0; k < ticks; k++) {
    const t0 = performance.now();
    sim.tick();
    samples.push(performance.now() - t0);
    if (k % 10 === 9) sim.takeDelta(); // le worker vide les files à chaque delta
  }
  samples.sort((a, b) => a - b);
  return { mean: r3(samples.reduce((a, b) => a + b, 0) / samples.length), p95: r3(pct(samples, 0.95)), max: r3(samples[samples.length - 1]!) };
}

interface Result {
  scenario: string; pietons: number; pietonsMesures: { min: number; max: number }; batiments: number; vehicules: number;
  marcheurs: number; graphe: unknown;
  moduleTickMs: { moyenne: number; p95: number; max: number };
  simTickMs: { avecModule: { moyenne: number; p95: number; max: number }; sansModule: { moyenne: number; p95: number; max: number } };
  trameOctets: number; itinerairesParSeconde: number; traversees: number;
  materiel: Record<string, unknown>;
}

function run(target: number): Result {
  const a = city(true);
  const ctx = a.sim.plugins.contextOf('pietons')!;
  a.plugin.system.command(ctx, 'config', { foule: target, maxPietons: target });
  // Montée en charge : jusqu'à atteindre la foule visée, puis 300 ticks de stabilisation.
  let guard = 0;
  while (a.plugin.system.crowd.count < target && guard++ < 20000) a.sim.tick();
  for (let k = 0; k < 300; k++) a.sim.tick();
  a.sim.takeDelta();
  const q0 = a.plugin.system.stats().cumul;
  let minC = Infinity, maxC = 0;
  const simSamples: number[] = [];
  let frameBytes = 0;
  for (let k = 0; k < MEASURE_TICKS; k++) {
    const t0 = performance.now();
    a.sim.tick();
    simSamples.push(performance.now() - t0);
    const c = a.plugin.system.crowd.count;
    minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    if (k % 10 === 9) {
      const d = a.sim.takeDelta().ext?.pietons as PietonsDelta | undefined;
      if (d?.frame) frameBytes = d.frame.ids.byteLength + d.frame.pos.byteLength + d.frame.meta.byteLength;
    }
  }
  // Coût propre du module : fenêtre glissante interne (600 derniers ticks), mesurée autour de PedestrianSystem.tick.
  const st = a.plugin.system.stats();
  simSamples.sort((x, y) => x - y);
  const withModule = { moyenne: r3(simSamples.reduce((x, y) => x + y, 0) / simSamples.length), p95: r3(pct(simSamples, 0.95)), max: r3(simSamples[simSamples.length - 1]!) };
  const b = city(false);
  for (let k = 0; k < 300; k++) b.sim.tick();
  const base = measure(b.sim, MEASURE_TICKS);
  const cpus = os.cpus();
  return {
    scenario: `foule imposée de ${target} piétons, ville 9 × 9 rues`,
    pietons: target, pietonsMesures: { min: minC, max: maxC }, batiments: a.buildings, vehicules: a.sim.traffic.actCount,
    marcheurs: st.marcheurs, graphe: st.graphe,
    moduleTickMs: { moyenne: st.tickMs.moyenne, p95: st.tickMs.p95, max: st.tickMs.max },
    simTickMs: { avecModule: withModule, sansModule: { moyenne: base.mean, p95: base.p95, max: base.max } },
    trameOctets: frameBytes,
    itinerairesParSeconde: r3((st.cumul.itineraires - q0.itineraires) / (MEASURE_TICKS / 10)),
    traversees: st.cumul.traversees - q0.traversees,
    materiel: {
      cpu: cpus[0]?.model ?? 'inconnu', coeurs: cpus.length, ramGo: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}`,
      node: process.version, rendu: 'aucun (simulation seule, Node)',
    },
  };
}

const targets = (process.argv[2] ?? '2000,5000').split(',').map((s) => Number(s)).filter((n) => n > 0);
const results = targets.map(run);
const outDir = join(here, '..', 'e2e', 'out', 'perf');
mkdirSync(outDir, { recursive: true });
for (const r of results) writeFileSync(join(outDir, `pietons-${r.pietons}.json`), JSON.stringify(r, null, 2));
const m = results[0]!.materiel;
const lines = [
  '# Banc du module piétons (simulation seule)',
  '',
  `Généré par \`npx tsx tests/pietons/banc.ts\` le ${new Date().toISOString().slice(0, 10)}. Mesures RÉELLES sur la machine d'exécution :`,
  `${String(m.cpu)}, ${String(m.coeurs)} cœurs, ${String(m.ramGo)} Go, ${String(m.os)}, Node ${String(m.node)} ; aucun rendu (le coût du rendu se mesure sur GPU réel).`,
  '',
  'Un tick = 0,1 s de marche (10 ticks/s à x1). Budget de l\'architecture : tick de simulation ≤ 4 ms.',
  '',
  '| Piétons (min–max mesurés) | Module : moyenne | Module : p95 | Module : max | Tick complet avec module (moy. / p95) | Tick complet sans module (moy. / p95) | Trame / delta | Itinéraires / s |',
  '|---|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.pietons} (${r.pietonsMesures.min}–${r.pietonsMesures.max}) | ${r.moduleTickMs.moyenne} ms | ${r.moduleTickMs.p95} ms | ${r.moduleTickMs.max} ms | ${r.simTickMs.avecModule.moyenne} / ${r.simTickMs.avecModule.p95} ms | ${r.simTickMs.sansModule.moyenne} / ${r.simTickMs.sansModule.p95} ms | ${(r.trameOctets / 1024).toFixed(1)} Ko | ${r.itinerairesParSeconde} |`),
  '',
  `Ville de mesure : ${results[0]!.batiments} bâtiments, graphe ${JSON.stringify(results[0]!.graphe)}.`,
  'Le coût « module » est mesuré par le module lui-même (`performance.now()` autour de son tick, fenêtre des 600 derniers ticks) ;',
  'le tick complet inclut démographie et trafic. Détail : `tests/e2e/out/perf/pietons-<N>.json`.',
  '',
];
writeFileSync(join(here, 'BANC.md'), lines.join('\n'));
console.log(lines.join('\n'));
