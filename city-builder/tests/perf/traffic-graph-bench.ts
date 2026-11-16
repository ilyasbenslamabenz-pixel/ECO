/**
 * Banc du graphe de circulation (Node, sans navigateur) : coût de la reconstruction après une édition du réseau et du
 * premier pas après le chargement d'une sauvegarde.
 *   npx tsx tests/perf/traffic-graph-bench.ts [--roads=2500] [--edits=40] [--seed=7] [--json]
 *
 * 1. Réseau : quadrillage tracé par `buildRoad` (pas de 90 m, une ligne sur 6 en avenue : feux et voies multiples)
 *    jusqu'à N tronçons, immeubles et bureaux posés le long des rues, 30 min de pointe simulées (véhicules en route).
 * 2. Éditions tirées au sort (graine fixe) : rue en impasse depuis le milieu d'un tronçon (découpe), traversée d'un
 *    îlot (deux découpes), suppression, mise à niveau (rue <-> avenue). Après chacune : durée de la commande et du pas
 *    suivant (qui reconstruit le graphe), et détail de la reconstruction si disponible (`TrafficSystem.lastRebuild`).
 * 3. Chargement : sauvegarde -> nouvelle simulation -> `fromSave` -> premier pas (graphe construit à froid) -> pas
 *    suivants.
 * Imprime un résumé lisible puis une ligne JSON (`--json` : la ligne JSON seule). Mêmes tracés et mêmes éditions à
 * chaque exécution (comparaison avant / après).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { Simulation } from '../../src/sim/world';
import type { AssetCatalog } from '../../src/shared/catalog';

const args = process.argv.slice(2);
const opt = (name: string, def: number): number => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? Number(a.split('=')[1]) : def; };
const ROADS = opt('roads', 2500);
const EDITS = opt('edits', 40);
const SEED = opt('seed', 7);
const JSON_ONLY = args.includes('--json');
const log = (...m: unknown[]): void => { if (!JSON_ONLY) console.log(...m); };
const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'assets/catalog.json'), 'utf8')) as AssetCatalog;
const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;
const stats = (a: number[]): { n: number; mean: number; p50: number; p95: number; max: number } => {
  const s = [...a].sort((x, y) => x - y);
  return { n: s.length, mean: round(s.reduce((x, y) => x + y, 0) / Math.max(1, s.length)), p50: round(s[Math.floor(s.length * 0.5)] ?? 0), p95: round(s[Math.floor(s.length * 0.95)] ?? 0), max: round(s[s.length - 1] ?? 0) };
};
let rs = SEED >>> 0 || 1;
const rand = (): number => { rs = (rs + 0x6d2b79f5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const rebuildInfo = (s: Simulation): Record<string, number> | null => { const r = (s.traffic as Any).lastRebuild; return r ? { ...r } : null; };

const params = { seed: 11, mapChunks: 32, startMoney: 4e12, cityName: 'Banc', startHour: 7, terrain: { hydrology: 'aucune', relief: 0, forest: 0, rivers: 0, riverMode: 'aucune' } } as const;
const sim = new Simulation();
sim.setCatalog(catalog);
sim.newGame(params as Any);
const t = sim.terrain!;
const span = (t.samplesX - 1) * t.spacing;
const STEP = 90;
const m = Math.floor((span - 200) / STEP);
const ox = t.originX + 100, oz = t.originZ + 100;
const kindAt = (line: number): 'avenue' | 'street' => (line % 6 === 0 ? 'avenue' : 'street');
let tb = performance.now();
let lines = 0;
outer: for (let k = 0; k <= m; k++) {
  for (let c = 0; c < m; c++) {
    if (sim.net.segCount >= ROADS) break outer;
    const ax = ox + c * STEP, az = oz + k * STEP;
    sim.buildRoad({ type: 'street', kind: kindAt(k), points: [ax, az, ax + STEP, az] });
    sim.buildRoad({ type: 'street', kind: kindAt(c), points: [ax, az, ax, az + STEP] });
  }
  lines = k + 1;
}
const buildNetMs = performance.now() - tb;
// Bâtiments : un immeuble ou un bureau au sud de chaque tronçon horizontal d'une ligne sur deux.
const HOUSING = 'immeuble_haussmannien', OFFICE = 'proc_bureaux_angles_coupes';
let placed = 0;
tb = performance.now();
for (let k = 0; k < lines - 1; k += 2) for (let c = 0; c < m; c += 1) {
  const r = sim.placeBuilding({ assetId: (c + k) % 4 === 0 ? OFFICE : HOUSING, x: ox + c * STEP + STEP / 2, z: oz + k * STEP + 22, rot: 0 });
  if (r.ok) placed++;
}
const placeMs = performance.now() - tb;
// Véhicules en route : la ville du banc n'a pas d'habitants (demande nulle), trajets injectés entre bâtiments tirés
// au sort (graine fixe), puis 30 pas.
sim.tick(30); sim.tick(); sim.takeDelta(); // synchronisation des bâtiments avec la circulation
const VEH = opt('vehicles', 1500);
for (let i = 0, n = sim.traffic.accessCount; i < VEH * 3 && n > 1 && sim.traffic.stats.vehicles < VEH; i++) {
  (sim.traffic as Any).spawnTrip(Math.floor(rand() * n), Math.floor(rand() * n), 'prive');
  sim.traffic.stats.vehicles = (sim.traffic as Any).actCount;
}
for (let i = 0; i < 30; i++) { sim.tick(); sim.takeDelta(); }
const vehicles = sim.traffic.stats.vehicles;
log(`Réseau : ${sim.net.segCount} tronçons, ${sim.net.nodeCount} nœuds (${Math.round(buildNetMs)} ms) ; ${placed} bâtiments (${Math.round(placeMs)} ms) ; ${vehicles} véhicules`);

// ------------------------------- Éditions -------------------------------
type EditKind = 'impasse' | 'traversee' | 'suppression' | 'mise_a_niveau';
const editMs: Record<EditKind, number[]> = { impasse: [], traversee: [], suppression: [], mise_a_niveau: [] };
const tickMs: Record<EditKind, number[]> = { impasse: [], traversee: [], suppression: [], mise_a_niveau: [] };
const allTick: number[] = [];
const details: Record<string, number>[] = [];
let failed = 0;
for (let i = 0; i < EDITS; i++) {
  const ids = sim.net.segmentIds();
  const id = ids[Math.floor(rand() * ids.length)]!;
  const r0 = rand();
  const kind: EditKind = r0 < 0.3 ? 'impasse' : r0 < 0.55 ? 'traversee' : r0 < 0.8 ? 'suppression' : 'mise_a_niveau';
  const c = sim.net.curve(id);
  const mx = (c[0]! + c[6]!) / 2, mz = (c[1]! + c[7]!) / 2;
  const horiz = Math.abs(c[6]! - c[0]!) > Math.abs(c[7]! - c[1]!);
  const side = rand() < 0.5 ? -1 : 1;
  const a = performance.now();
  let ok = false;
  if (kind === 'impasse') ok = sim.buildRoad({ type: 'street', kind: 'street', points: horiz ? [mx, mz, mx, mz + side * 35] : [mx, mz, mx + side * 35, mz] }).ok;
  else if (kind === 'traversee') ok = sim.buildRoad({ type: 'street', kind: 'street', points: horiz ? [mx, mz, mx, mz + side * STEP] : [mx, mz, mx + side * STEP, mz] }).ok;
  else if (kind === 'suppression') ok = sim.removeRoad({ edgeId: id }).ok;
  else ok = sim.upgradeRoad({ edgeId: id, kind: sim.net.kindOf(id) === 'avenue' ? 'street' : 'avenue' }).ok;
  const e = performance.now() - a;
  if (!ok) { failed++; continue; }
  const tt = performance.now(); sim.tick(); const tk = performance.now() - tt; sim.takeDelta();
  editMs[kind].push(e); tickMs[kind].push(tk); allTick.push(tk);
  const d = rebuildInfo(sim);
  if (d) details.push(d);
}
const sum = (k: string): number => details.reduce((s, d) => s + (d[k] ?? 0), 0);
const detail = details.length ? {
  inputMs: stats(details.map((d) => d.inputMs ?? 0)), graphMs: stats(details.map((d) => d.graphMs!)),
  rebuildMs: stats(details.map((d) => d.rebuildMs ?? 0)), accessMs: stats(details.map((d) => d.accessMs ?? 0)),
  nodesComputedMean: round(sum('nodesComputed') / details.length, 1), nodesReusedMean: round(sum('nodesReused') / details.length, 1),
  routesKept: sum('routesKept'), routesRecomputed: sum('routesRecomputed'), accessKept: sum('accessKept'), accessRecomputed: sum('accessRecomputed'),
} : null;
log(`Éditions : ${allTick.length} réussies (${failed} refusées) ; pas suivant ${JSON.stringify(stats(allTick))}`);
for (const k of Object.keys(editMs) as EditKind[]) log(`  ${k} : commande ${JSON.stringify(stats(editMs[k]))} ; pas suivant ${JSON.stringify(stats(tickMs[k]))}`);
if (detail) log('  reconstruction :', JSON.stringify(detail));

// ------------------------------- Chargement -------------------------------
const ordinary: number[] = [];
for (let i = 0; i < 20; i++) { const a = performance.now(); sim.tick(); ordinary.push(performance.now() - a); sim.takeDelta(); }
const save = JSON.parse(JSON.stringify(sim.toSave()));
const sim2 = new Simulation();
sim2.setCatalog(catalog);
let a = performance.now();
const err = sim2.fromSave(save);
const loadMs = performance.now() - a;
if (err) throw new Error(err.message);
a = performance.now(); sim2.tick(); const firstTickMs = performance.now() - a; sim2.takeDelta();
const firstDetail = rebuildInfo(sim2);
const after: number[] = [];
for (let i = 0; i < 10; i++) { const b = performance.now(); sim2.tick(); after.push(performance.now() - b); sim2.takeDelta(); }
log(`Chargement : fromSave ${round(loadMs, 1)} ms ; premier pas ${round(firstTickMs, 1)} ms ; pas suivants ${JSON.stringify(stats(after))} ; pas ordinaire avant sauvegarde ${JSON.stringify(stats(ordinary))}`);
if (firstDetail) log('  premier pas :', JSON.stringify(firstDetail));

const cpu = os.cpus()[0]?.model ?? '?';
console.log(JSON.stringify({
  machine: `${cpu} × ${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} Go, Node ${process.version}`,
  roads: sim.net.segCount, nodes: sim.net.nodeCount, buildings: placed, vehicles, edits: allTick.length, refused: failed,
  tickAfterEditMs: stats(allTick), byKind: Object.fromEntries((Object.keys(editMs) as EditKind[]).map((k) => [k, { command: stats(editMs[k]), tick: stats(tickMs[k]) }])), rebuild: detail,
  loadMs: round(loadMs, 1), firstTickMs: round(firstTickMs, 1), firstTickDetail: firstDetail, ticksAfterLoadMs: stats(after), ordinaryTickMs: stats(ordinary),
}));
