/**
 * Banc de charge de la simulation (Node, sans navigateur) : ville synthétique de N habitants, puis mesures brutes.
 *   npx tsx tests/perf/population-bench.ts [habitants=54000] [--roads=2500] [--days=3] [--json]
 *
 * 1. Réseau : quadrillage de rues tracé par `buildRoad` (mêmes validations qu'un joueur) ; durée de chaque appel
 *    relevée par tranche de tronçons (coût de la création de route sur grand réseau).
 * 2. Bâtiments : tours de logements, bureaux, commerces, usines, écoles, hôpitaux, commissariats et casernes posés
 *    par `placeBuilding` le long des rues (accès route réel), en nombre suffisant pour loger N habitants.
 * 3. Population : ménages créés directement (même composition que l'immigration) jusqu'à N habitants, emplois
 *    attribués par la recherche d'emploi de la démographie (sans le plafond quotidien) : on mesure une ville
 *    « installée », pas sa croissance.
 * 4. Mesures : passe quotidienne (`DayStart`), tick ordinaire, rapport, clôture mensuelle, sauvegarde.
 * `--sans-etalement` / `--sans-fusion` : passe quotidienne d'un seul tenant / pas de fusion des ménages (comparaison).
 * `--croissance` : ville vide peuplée par injections toutes les 6 h pendant `--jours-croissance=20` jours (pic par jour).
 * Mesure aussi une journée complète tick par tick (pic, moyenne, p99, ticks > 16 ms / 50 ms).
 * Imprime un tableau lisible puis une ligne JSON (`--json` : la ligne JSON seule).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { Simulation } from '../../src/sim/world';
import type { AssetCatalog } from '../../src/shared/catalog';
import { MINUTES_PER_DAY } from '../../src/sim/clock';

const args = process.argv.slice(2);
const opt = (name: string, def: number): number => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? Number(a.split('=')[1]) : def; };
const TARGET = Number(args.find((a) => /^\d+$/.test(a)) ?? 54000);
const ROADS = opt('roads', 0);
const DAYS = opt('days', 3);
const JSON_ONLY = args.includes('--json');
const log = (...m: unknown[]): void => { if (!JSON_ONLY) console.log(...m); };

const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'assets/catalog.json'), 'utf8')) as AssetCatalog;
const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;
const stats = (a: number[]): { n: number; mean: number; p50: number; p95: number; max: number } => {
  const s = [...a].sort((x, y) => x - y);
  return { n: s.length, mean: round(s.reduce((x, y) => x + y, 0) / Math.max(1, s.length)), p50: round(s[Math.floor(s.length * 0.5)] ?? 0), p95: round(s[Math.floor(s.length * 0.95)] ?? 0), max: round(s[s.length - 1] ?? 0) };
};

const sim = new Simulation();
sim.setCatalog(catalog);
const t0 = performance.now();
sim.newGame({ seed: 11, mapChunks: 32, startMoney: 4e12, cityName: 'Banc', startHour: 1, terrain: { hydrology: 'aucune', relief: 0, forest: 0, rivers: 0, riverMode: 'aucune' } });
const genMs = performance.now() - t0;
const t = sim.terrain!;
const span = (t.samplesX - 1) * t.spacing;
const cx = t.originX + span / 2, cz = t.originZ + span / 2;

// ------------------------------- 1. Réseau -------------------------------
// Quartier habité : rues tous les STEP m, nombre d'îlots choisi pour loger TARGET habitants.
const pick = (id: string): string => { if (!catalog.assets.some((a) => a.id === id)) throw new Error(`asset ${id} absent`); return id; };
// Logement : immeuble de 46 habitants (ville « réaliste », beaucoup de bâtiments) ou tour de 300 (--logement=tour).
const TOWERS = args.includes('--logement=tour');
const HOUSING = pick(TOWERS ? 'tour_residentielle_balcons' : 'immeuble_haussmannien');
const OFFICE = pick('proc_tour_bureaux_retraits'); // 1500 emplois, 3x3
const SHOP = pick('proc_bureaux_angles_coupes'); // 360 emplois (bureaux)
const COMMERCE = pick('commerce_centre_commercial'); // 320 emplois, 5x4
const SCHOOL = pick('public_ecole');
const HOSPITAL = pick('public_hopital');
const POLICE = pick('public_commissariat');
const FIRE = catalog.assets.find((a) => a.tags.includes('service:incendie') || a.tags.includes('pompiers'))?.id ?? POLICE;
// Bâtiments par îlot (16 emplacements le long des rues) : tours ≈ 3 900 habitants et 2 180 emplois ; immeubles
// ≈ 640 habitants et ≈ 360 emplois (un îlot sur deux : bureaux, l'autre : centre commercial).
const plan: string[] = [];
for (let i = 0; i < 16; i++) plan.push(HOUSING);
if (TOWERS) { plan[3] = OFFICE; plan[8] = COMMERCE; plan[12] = SHOP; } else plan[8] = SHOP;
const capOf = (id: string): number => catalog.assets.find((a) => a.id === id)!.capacity.residents;
const STEP = 176;
const perBlock = plan.filter((x) => x === HOUSING).length * capOf(HOUSING);
const blocksNeeded = Math.max(4, Math.ceil(TARGET / perBlock * 1.15));
const n = Math.max(2, Math.ceil(Math.sqrt(blocksNeeded)));
const x0 = cx - (n * STEP) / 2, z0 = cz - (n * STEP) / 2;
const roadMs: number[] = [];
const roadAt: number[] = [];
let refused = 0;
const road = (ax: number, az: number, bx: number, bz: number): void => {
  const a = performance.now();
  const r = sim.buildRoad({ type: 'street', kind: 'street', points: [ax, az, bx, bz] });
  roadMs.push(performance.now() - a);
  roadAt.push(sim.net.segCount);
  if (!r.ok) refused++;
};
for (let k = 0; k <= n; k++) for (let c = 0; c < n; c++) road(x0 + c * STEP, z0 + k * STEP, x0 + (c + 1) * STEP, z0 + k * STEP);
for (let c = 0; c <= n; c++) for (let k = 0; k < n; k++) road(x0 + c * STEP, z0 + k * STEP, x0 + c * STEP, z0 + (k + 1) * STEP);
// Réseau supplémentaire (mesure de buildRoad sur grand réseau) : quadrillage plus large autour du quartier.
if (ROADS > 0) {
  const S2 = 120;
  const m = Math.floor((span - 200) / S2);
  const ox = t.originX + 100, oz = t.originZ + 100;
  outer: for (let k = 0; k <= m; k++) {
    for (let c = 0; c < m; c++) {
      if (sim.net.segCount >= ROADS) break outer;
      const ax = ox + c * S2, az = oz + k * S2;
      if (ax > x0 - S2 && ax < x0 + n * STEP + S2 && az > z0 - S2 && az < z0 + n * STEP + S2) continue;
      road(ax, az, ax + S2, az);
      road(ax, az, ax, az + S2);
    }
  }
}
const segs = sim.net.segCount;
const bucket = (lo: number, hi: number): number[] => roadMs.filter((_, i) => roadAt[i]! >= lo && roadAt[i]! < hi);
const roadBuckets: Record<string, ReturnType<typeof stats>> = {};
for (const [lo, hi] of [[0, 500], [500, 1000], [1000, 2000], [2000, 3000], [3000, 1e9]] as const) { const b = bucket(lo, hi); if (b.length) roadBuckets[`${lo}-${hi === 1e9 ? '∞' : hi}`] = stats(b); }
// Mesure ponctuelle à réseau final : 20 tracés isolés (construits puis supprimés).
// Le tick qui suit (reconstruction du graphe de circulation) est mesuré à part : coût total ressenti = somme.
const lateMs: number[] = [];
const lateTickMs: number[] = [];
let lateOk = 0;
for (let i = 0; i < 20; i++) {
  const ax = x0 + STEP * 0.5, az = z0 - 60 - i * 3;
  const a = performance.now();
  const r = sim.buildRoad({ type: 'street', kind: 'street', points: [ax - 30, az, ax + 30, az] });
  lateMs.push(performance.now() - a);
  const tt = performance.now(); sim.tick(); lateTickMs.push(performance.now() - tt); sim.takeDelta();
  if (r.ok) { lateOk++; for (const id of r.data.edgeIds) sim.removeRoad({ edgeId: id }); }
}
log(`Réseau : ${segs} tronçons (${refused} refus), buildRoad par tranche :`, roadBuckets, 'final :', stats(lateMs));

// ------------------------------- 2. Bâtiments -------------------------------
let placed = 0, placeFail = 0;
const placeMs: number[] = [];
const place = (assetId: string, x: number, z: number, rot: number): boolean => {
  const a = performance.now();
  const r = sim.placeBuilding({ assetId, x, z, rot });
  placeMs.push(performance.now() - a);
  if (r.ok) placed++; else placeFail++;
  return r.ok;
};
let housingCap = 0;
for (let k = 0; k < n && housingCap < TARGET * 1.08; k++) {
  for (let c = 0; c < n && housingCap < TARGET * 1.08; c++) {
    const bx = x0 + c * STEP, bz = z0 + k * STEP;
    let p = 0;
    // Le long des 4 côtés intérieurs de l'îlot, à 22 m de l'axe des rues (accès route).
    const off = 22, inner = STEP - 2 * off;
    const slots: [number, number, number][] = [];
    for (let s = 0; s < 5; s++) {
      const u = off + 14 + (s * (inner - 28)) / 4;
      slots.push([bx + u, bz + off, 0], [bx + u, bz + STEP - off, 2]);
    }
    for (let s = 1; s < 4; s++) {
      const v = off + 14 + (s * (inner - 28)) / 4;
      slots.push([bx + off, bz + v, 1], [bx + STEP - off, bz + v, 3]);
    }
    // Équipements : une école par îlot, un hôpital / commissariat / caserne un îlot sur deux, au centre de l'îlot
    // (sans accès route : posés en bordure si possible).
    const service = [SCHOOL, (k + c) % 2 ? HOSPITAL : POLICE, FIRE];
    for (const [sx, sz, rot] of slots) {
      const id = !TOWERS && p === 8 && (k + c) % 2 ? COMMERCE : p < plan.length ? plan[p]! : HOUSING;
      if (place(id, sx, sz, rot) && id === HOUSING) housingCap += capOf(HOUSING);
      p++;
    }
    let si = 0;
    for (const [sx, sz] of [[bx + STEP / 2, bz + STEP / 2 - 18], [bx + STEP / 2, bz + STEP / 2 + 22], [bx + STEP / 2 - 30, bz + STEP / 2]] as const) place(service[si++]!, sx, sz, 0);
  }
}
let roadAccess = 0;
for (let i = 0; i < sim.buildings.count; i++) roadAccess += sim.buildings.roadAccess[i]!;
log(`Bâtiments : ${placed} posés (${placeFail} refus), ${roadAccess} desservis, logements ${housingCap}, placeBuilding`, stats(placeMs));

// ------------------------------- 3. Population -------------------------------
const demo = sim.demography!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const d = demo as any;
const rng = sim.rng;
const now0 = sim.clock.totalMinutes;
// `--individuel` : simulation agrégée désactivée (comparaison) ; sinon règle automatique (seuil, poids croissant).
if (args.includes('--individuel')) d.aggregateThreshold = Infinity;
// `--sans-etalement` : passe quotidienne d'un seul tenant (comparaison) ; `--sans-fusion` : pas de fusion des ménages.
if (args.includes('--sans-etalement')) d.dailySpreadMinRows = Infinity;
if (args.includes('--sans-fusion') && typeof d.mergeCap === 'function') d.mergeCap = (): number => 1;
// Création directe de ménages (même composition que l'immigration, même règle de poids) dans les logements libres, à
// partir du bâtiment `cursor`, puis embauche de leurs actifs par la recherche d'emploi de la démographie.
let cursor = 0;
const inject = (count: number, hireNow = true): void => {
  const b = sim.buildings;
  const goal = demo.population + count;
  const first = demo.citizens.count;
  const now = sim.clock.totalMinutes;
  outer: for (; cursor < b.count; cursor++) {
    let free = demo.freeHousingAt(cursor);
    const home = b.id[cursor]!;
    while (free > 0) {
      if (demo.population >= goal) break outer;
      const kind = rng.weighted([0.3, 0.25, 0.32, 0.06, 0.07]);
      const adults = kind === 0 || kind === 3 ? 1 : 2;
      let kids = kind === 2 ? rng.int(1, 3) : kind === 3 ? rng.int(1, 2) : 0;
      // Poids du ménage : même règle que l'immigration (1 sous le seuil de la simulation agrégée).
      let hw: number = d.newHouseholdWeight?.() ?? 1;
      while ((adults + kids) * hw > free && hw > 1) hw = Math.max(1, hw >> 1);
      while (adults + kids > free && kids > 0) kids--;
      if (adults + kids > free) break;
      const baseAge = kind === 4 ? rng.int(65, 82) : kids > 0 ? rng.int(28, 46) : rng.int(20, 58);
      const hid = d.newHousehold(home, rng.int(0, 500), now, hw);
      for (let a = 0; a < adults; a++) {
        d.addCitizen(hid, home, adults === 2 ? a : rng.int(0, 1), Math.max(18, baseAge + (a === 0 ? 0 : rng.int(-4, 4))), rng.weighted([0.08, 0.12, 0.3, 0.25, 0.25]), 0, now);
        d.addMember(hid);
      }
      for (let kk = 0; kk < kids; kk++) {
        const age = rng.int(0, Math.min(17, Math.max(0, baseAge - 18)));
        d.addCitizen(hid, home, rng.int(0, 1), age, age >= 16 ? 2 : age >= 11 ? 1 : 0, 1, now);
        d.addMember(hid);
      }
      free -= (adults + kids) * hw;
    }
  }
  if (!hireNow) return;
  d.ensureCoverage?.();
  const c = demo.citizens.col;
  for (let i = first; i < demo.citizens.count; i++) {
    const age = demo.ageOf(i, now);
    if (age < 18 || age >= 64 || c.job[i]! >= 0) continue;
    const j = d.findJob(i);
    if (j >= 0) d.hire(d.jobPartialFree > 0 ? d.splitHousehold(i, d.jobPartialFree) : i, j);
  }
  d.memberIndex = null;
};
const GROWTH = args.includes('--croissance');
const tp = performance.now();
if (!GROWTH) inject(TARGET, false);
const seedPopMs = performance.now() - tp;
// Emplois : recherche de la démographie pour chaque actif (sans plafond quotidien).
const tj = performance.now();
if (!GROWTH) {
  d.ensureCoverage?.();
  const c = demo.citizens.col;
  for (let i = 0; i < demo.citizens.count; i++) {
    const age = demo.ageOf(i, now0);
    if (age < 18 || age >= 64 || c.job[i]! >= 0) continue;
    const j = d.findJob(i);
    if (j >= 0) d.hire(d.jobPartialFree > 0 ? d.splitHousehold(i, d.jobPartialFree) : i, j);
  }
  d.memberIndex = null;
}
const seedJobsMs = performance.now() - tj;
demo.updateLod();
let employed = 0;
for (let i = 0; i < demo.citizens.count; i++) if (demo.citizens.col.job[i]! >= 0) employed += d.weightOf?.(i) ?? 1;
log(`Population : ${demo.population} habitants, ${d.householdCount ?? demo.households.count} ménages, ${employed} emplois occupés (création ${Math.round(seedPopMs)} ms, embauche ${Math.round(seedJobsMs)} ms)`);

// ------------------------------- 4. Mesures -------------------------------
// Avance jusqu'à 23 h 58 puis mesure le tick qui franchit minuit (DayStart + plugins), DAYS fois.
const dayMs: number[] = [];
const dailyMs: number[] = [];
const tickMs: number[] = [];
const reportMs: number[] = [];
const origDaily = demo.daily.bind(demo);
demo.daily = (now: number, rate: number): void => { const a = performance.now(); origDaily(now, rate); dailyMs.push(performance.now() - a); };
// Passe quotidienne étalée (si présente) : durée de chaque étape, par étape (0 décès, 1 transitions, 2 services,
// 3 économie vivante, 4 bonheur, 5 naissances, 6 décohabitation, 7 fusion), et ticks qui suivent minuit jusqu'à la fin.
const stageMs: Record<string, number[]> = {};
if (typeof d.stepDaily === 'function') {
  const origStep = d.stepDaily.bind(demo);
  d.stepDaily = (): boolean => { const st = String(d.pass?.stage ?? '?'); const a = performance.now(); const r = origStep(); (stageMs[st] ??= []).push(performance.now() - a); return r; };
}
const spreadTickMs: number[] = [];
const spreadTotalMs: number[] = [];
for (let day = 0; day < DAYS; day++) {
  const toMidnight = MINUTES_PER_DAY - (sim.clock.totalMinutes % MINUTES_PER_DAY);
  // Ticks ordinaires mesurés (≈ 1 h de jeu avant minuit), le reste en grands pas.
  if (toMidnight > 62) sim.tick(toMidnight - 62);
  sim.takeDelta();
  while (MINUTES_PER_DAY - (sim.clock.totalMinutes % MINUTES_PER_DAY) > 2) {
    const a = performance.now(); sim.tick(); tickMs.push(performance.now() - a); sim.takeDelta();
  }
  const a = performance.now();
  sim.tick(2); // franchit minuit
  dayMs.push(performance.now() - a);
  sim.takeDelta();
  // Passe étalée : ticks d'une minute jusqu'à la fin de la passe (somme = coût total de la journée).
  let tot = dayMs[dayMs.length - 1]!;
  while (d.dailyPending) { const q = performance.now(); sim.tick(); const dt = performance.now() - q; spreadTickMs.push(dt); tot += dt; sim.takeDelta(); }
  spreadTotalMs.push(tot);
  const r = performance.now(); sim.report(); reportMs.push(performance.now() - r);
}
// Journée complète tick par tick (1 tick = 1 min de jeu) : pic et moyenne par tick, passe quotidienne comprise.
const fullDayMs: number[] = [];
// Ticks de plus de 50 ms de la journée complète : heure de jeu (hh:mm) et durée, pour les attribuer.
const slowTicks: string[] = [];
const fullDay = (): void => {
  for (let k = 0; k < MINUTES_PER_DAY; k++) {
    const a = performance.now(); sim.tick(); const dt = performance.now() - a; fullDayMs.push(dt); sim.takeDelta();
    if (dt > 50) { const m = sim.clock.totalMinutes % MINUTES_PER_DAY; slowTicks.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} ${round(dt, 1)}`); }
  }
};
// Croissance (`--croissance`) : ville vide, ménages injectés toutes les 6 h (TARGET / GROWTH_DAYS par jour, embauche
// immédiate), toutes les journées mesurées tick par tick ; pic par jour et lignes en fin de journée.
const GROWTH_DAYS = opt('jours-croissance', 20);
const growthDays: { day: number; population: number; rows: number; householdRows: number; aggregatedRows: number; maxTickMs: number; meanTickMs: number }[] = [];
if (GROWTH) {
  for (let day = 0; day < GROWTH_DAYS; day++) {
    const from = fullDayMs.length;
    for (let k = 0; k < MINUTES_PER_DAY; k++) {
      if (k % 360 === 0) inject(Math.ceil(TARGET / GROWTH_DAYS / 4));
      const a = performance.now(); sim.tick(); fullDayMs.push(performance.now() - a); sim.takeDelta();
    }
    const dayTicks = fullDayMs.slice(from);
    const info = demo.aggregateInfo();
    growthDays.push({ day, population: info.population, rows: info.rows, householdRows: info.householdRows, aggregatedRows: info.aggregatedRows, maxTickMs: round(Math.max(...dayTicks)), meanTickMs: round(dayTicks.reduce((x, y) => x + y, 0) / dayTicks.length, 3) });
    log(`jour ${day} : ${JSON.stringify(growthDays[growthDays.length - 1])}`);
  }
} else fullDay();
const fullDayStats = { ...stats(fullDayMs), p99: round([...fullDayMs].sort((x, y) => x - y)[Math.floor(fullDayMs.length * 0.99)] ?? 0), over16: fullDayMs.filter((x) => x > 16).length, over50: fullDayMs.filter((x) => x > 50).length };
log(`Journée complète tick par tick : ${JSON.stringify(fullDayStats)}`);
log(`Passe étalée : ticks après minuit ${JSON.stringify(stats(spreadTickMs))}, total par jour (minuit compris) ${JSON.stringify(stats(spreadTotalMs))}`);
// Clôture mensuelle (démographie seule) et sauvegarde.
const tm = performance.now(); demo.monthly(sim.clock.totalMinutes); const monthlyMs = performance.now() - tm;
const ts = performance.now(); const save = JSON.stringify(sim.toSave()); const saveMs = performance.now() - ts;
const mem = process.memoryUsage();
const cpu = os.cpus()[0]?.model ?? '?';
const out = {
  machine: `${cpu} × ${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} Go, Node ${process.version}`,
  target: TARGET, population: demo.population, households: d.householdCount ?? demo.households.count, employed, buildings: sim.buildings.count, roadSegments: segs,
  genMs: Math.round(genMs), seedPopulationMs: Math.round(seedPopMs), seedJobsMs: Math.round(seedJobsMs),
  buildRoadMs: roadBuckets, buildRoadFinalMs: stats(lateMs), buildRoadFinalOk: lateOk, tickAfterRoadMs: stats(lateTickMs), placeBuildingMs: stats(placeMs),
  dayTickMs: stats(dayMs), dailyMs: stats(dailyMs), tickMs: stats(tickMs), reportMs: stats(reportMs), monthlyMs: Math.round(monthlyMs),
  saveMs: Math.round(saveMs), saveMB: round(save.length / 2 ** 20, 1), heapMB: Math.round(mem.heapUsed / 2 ** 20),
  spreadTickMs: stats(spreadTickMs), spreadTicksPerDay: Math.round(spreadTickMs.length / DAYS), spreadTotalMs: stats(spreadTotalMs),
  stageSumPerDayMs: round(Object.values(stageMs).flat().reduce((x, y) => x + y, 0) / Math.max(1, DAYS + (GROWTH ? GROWTH_DAYS : 1))),
  stageMs: Object.fromEntries(Object.entries(stageMs).map(([k, v]) => [k, stats(v)])), mergedHouseholds: d.mergedHouseholds ?? 0,
  fullDayTickMs: fullDayStats, slowTicks, growthDays,
  aggregate: (demo as unknown as { aggregateInfo?: () => unknown }).aggregateInfo?.() ?? null,
};
log(`Jour (tick de minuit) : ${JSON.stringify(out.dayTickMs)} ; daily() ${JSON.stringify(out.dailyMs)}`);
log(`Tick ordinaire : ${JSON.stringify(out.tickMs)} ; rapport ${JSON.stringify(out.reportMs)} ; mensuel ${out.monthlyMs} ms ; sauvegarde ${out.saveMs} ms / ${out.saveMB} Mo ; tas ${out.heapMB} Mo`);
console.log(JSON.stringify(out));
