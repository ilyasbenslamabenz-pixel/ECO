/**
 * Météo simulée (phase 2C « Atmosphère ») : déterminisme, indépendance du découpage des ticks, saisons,
 * climat (neige seulement par temps froid), forçage, sauvegarde (aller-retour, section invalide), absence d'effet
 * sur la simulation de base, enregistrement dans les registres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { Rng } from '../../src/sim/rng';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { RENDER_PLUGINS } from '../../src/render/plugins';
import { WeatherModel, WEATHER_STEP_MIN, dayOfYearAt } from '../../src/sim/weather/model';
import { createWeatherPlugin } from '../../src/sim/weather/plugin';
import { migrateWeather, WEATHER_SAVE_VERSION, weatherSaveSection } from '../../src/sim/save-sections/weather';
import { climateMean, dayOfYearOf, diurnalShape, seasonOfDay, seasonVisuals } from '../../src/shared/weather/season';
import { WEATHER_KINDS, type WeatherPayload } from '../../src/shared/weather/types';
import { buildTown, townCatalog } from '../sim/fixtures';

const DAY = 1440;

function run(seed: number, totalMinutes: number, stepMinutes: number): { model: WeatherModel; trace: string[] } {
  const rng = new Rng(seed);
  const m = new WeatherModel();
  m.reset(rng, 9 * 60);
  const trace: string[] = [];
  for (let t = 9 * 60 + stepMinutes; t <= totalMinutes; t += stepMinutes) {
    m.advance(rng, t);
    if (t % (6 * 60) === 0) trace.push(JSON.stringify(m.payload(t)));
  }
  m.advance(rng, totalMinutes);
  return { model: m, trace };
}

test('météo : déterministe pour une graine, différente pour une autre graine', () => {
  const a = run(42, 60 * DAY, 2), b = run(42, 60 * DAY, 2), c = run(43, 60 * DAY, 2);
  assert.deepEqual(a.trace, b.trace);
  assert.deepEqual(a.model.state, b.model.state);
  assert.notDeepEqual(a.trace, c.trace);
});

test('météo : indépendante du découpage des ticks (pas fixes de 10 min alignés sur l\'horloge)', () => {
  const a = run(7, 30 * DAY, 2), b = run(7, 30 * DAY, 30), c = run(7, 30 * DAY, 120);
  assert.deepEqual(a.model.state, b.model.state);
  assert.deepEqual(a.model.state, c.model.state);
  assert.equal(WEATHER_STEP_MIN, 10);
});

test('météo : un an — tous les temps apparaissent, valeurs bornées, climat saisonnier', () => {
  const rng = new Rng(2024);
  const m = new WeatherModel();
  m.reset(rng, 0);
  const seen = new Map<string, number>();
  const tempsByMonth: number[][] = Array.from({ length: 12 }, () => []);
  let snowInSummer = 0;
  let snowWhenWarm = 0;
  for (let t = 60; t <= 360 * DAY; t += 60) {
    m.advance(rng, t);
    const p = m.payload(t);
    seen.set(p.kind, (seen.get(p.kind) ?? 0) + 1);
    for (const k of ['cloud', 'rain', 'snow', 'fog', 'storm', 'wetness', 'snowCover'] as const) {
      assert.ok(p[k] >= 0 && p[k] <= 1, `${k} hors bornes : ${p[k]}`);
    }
    assert.ok(p.tempC > -25 && p.tempC < 42, `température aberrante ${p.tempC}`);
    tempsByMonth[Math.floor(dayOfYearAt(t) / 30)]!.push(p.tempC);
    if (p.season === 'ete' && p.snow > 0.05) snowInSummer++;
    if (p.snow > 0.1 && p.tempC > 3) snowWhenWarm++;
  }
  for (const k of WEATHER_KINDS) assert.ok((seen.get(k) ?? 0) > 0, `temps jamais observé : ${k} (${JSON.stringify([...seen])})`);
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
  const jan = mean(tempsByMonth[0]!), jul = mean(tempsByMonth[6]!);
  assert.ok(jan < 6 && jul > 16 && jul - jan > 12, `janvier ${jan.toFixed(1)} °C, juillet ${jul.toFixed(1)} °C`);
  assert.equal(snowInSummer, 0, 'pas de neige en été');
  assert.equal(snowWhenWarm, 0, 'neige seulement par temps froid');
});

test('saisons : calendrier, paramètres visuels continus, normales climatiques, cycle diurne', () => {
  assert.equal(dayOfYearOf(1, 1), 0);
  assert.equal(dayOfYearOf(12, 30), 359);
  assert.equal(seasonOfDay(dayOfYearOf(1, 15)), 'hiver');
  assert.equal(seasonOfDay(dayOfYearOf(4, 15)), 'printemps');
  assert.equal(seasonOfDay(dayOfYearOf(7, 15)), 'ete');
  assert.equal(seasonOfDay(dayOfYearOf(10, 15)), 'automne');
  const jan = seasonVisuals(dayOfYearOf(1, 15)), apr = seasonVisuals(dayOfYearOf(4, 20));
  const jul = seasonVisuals(dayOfYearOf(7, 15)), oct = seasonVisuals(dayOfYearOf(10, 20));
  assert.ok(jan.bare > 0.95 && jan.dormant > 0.95 && jan.autumn === 0, `janvier ${JSON.stringify(jan)}`);
  assert.ok(apr.spring > 0.9 && apr.bare < 0.1, `avril ${JSON.stringify(apr)}`);
  assert.ok(jul.bare === 0 && jul.autumn === 0 && jul.spring === 0, `juillet ${JSON.stringify(jul)}`);
  assert.ok(oct.autumn > 0.9 && oct.bare < 0.1, `octobre ${JSON.stringify(oct)}`);
  // Continuité : pas de saut de plus de 0,1 d'un jour à l'autre (dont 31 déc. -> 1er janv.).
  for (let d = 0; d < 360; d++) {
    const a = seasonVisuals(d), b = seasonVisuals((d + 1) % 360);
    for (const k of Object.keys(a) as (keyof typeof a)[]) assert.ok(Math.abs(a[k] - b[k]) < 0.1, `saut ${k} au jour ${d}`);
  }
  assert.ok(climateMean(195).mean - climateMean(15).mean > 18);
  assert.ok(diurnalShape(15) > 0.49 && diurnalShape(6) < -0.49 && Math.abs(diurnalShape(3)) < 0.5);
});

test('forçage : temps imposé et établi, jour de l\'année figé, neige crédible', () => {
  const rng = new Rng(5);
  const m = new WeatherModel();
  m.reset(rng, 12 * 60);
  m.force(rng, 12 * 60, { kind: 'neige', settle: true, dayOfYear: 200 });
  let p = m.payload(12 * 60);
  assert.equal(p.kind, 'neige');
  assert.ok(p.tempC < 0 && p.snow > 0.3 && p.snowCover > 0.8, JSON.stringify(p));
  assert.equal(p.dayOfYear, 200);
  assert.equal(p.forced, true);
  m.force(rng, 12 * 60, { kind: 'pluie', settle: true, dayOfYear: null });
  p = m.payload(12 * 60);
  assert.equal(p.kind, 'pluie');
  assert.ok(p.rain > 0.3 && p.wetness > 0.8 && p.snowCover === 0 && p.tempC > 2, JSON.stringify(p));
  m.force(rng, 12 * 60, { kind: 'brouillard', settle: true });
  assert.equal(m.payload(12 * 60).kind, 'brouillard');
  m.force(rng, 12 * 60, { kind: 'orage', settle: true });
  assert.equal(m.payload(12 * 60).kind, 'orage');
});

function town(list?: ConstructorParameters<typeof Simulation>[0]): Simulation {
  const s = list ? new Simulation(list) : new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 50_000_000, cityName: 'Bourg-Météo', terrain: { hydrology: 'aucune', rivers: 0 } });
  return s;
}

function fingerprint(s: Simulation): unknown {
  return {
    minutes: s.clock.totalMinutes, money: s.economy.money, rng: s.rng.getState(), pop: s.demography!.population,
    sched: s.scheduler.toJSON(), vehicles: s.traffic.actCount,
    residents: Array.from(s.buildings.residents.subarray(0, s.buildings.count)),
  };
}

test('simulation : le module météo est enregistré et ne change rien à la simulation de base', () => {
  assert.ok(SIM_PLUGINS.some((p) => p.id === 'weather'));
  assert.ok(RENDER_PLUGINS.some((p) => p.id === 'weather'));
  const a = town([]);
  const b = town([createWeatherPlugin()]);
  buildTown(a);
  buildTown(b);
  for (let i = 1; i <= 1200; i++) {
    a.tick(3);
    b.tick(3);
    if (i % 100 === 0) assert.deepEqual(fingerprint(b), fingerprint(a), `tick ${i}`);
  }
  const d = b.takeDelta();
  const w = d.ext?.['weather'] as WeatherPayload | undefined;
  assert.ok(w && WEATHER_KINDS.includes(w.kind) && typeof w.tempC === 'number' && w.icon.length > 0, JSON.stringify(w));
  assert.equal(a.takeDelta().ext, undefined);
  const snap = b.snapshot();
  assert.ok((snap.ext?.['weather'] as WeatherPayload).label.length > 0);
});

test('sauvegarde : aller-retour exact (état + PRNG), suite identique après chargement', () => {
  const p1 = createWeatherPlugin();
  const s = town([p1]);
  for (let i = 0; i < 2000; i++) s.tick(5);
  const json = JSON.parse(JSON.stringify(s.toSave()));
  assert.equal(json.plugins.weather.v, WEATHER_SAVE_VERSION);
  const p2 = createWeatherPlugin();
  const t = town([p2]);
  assert.equal(t.fromSave(json), null);
  assert.deepEqual(t.toSave().plugins, s.toSave().plugins);
  for (let i = 0; i < 1500; i++) { s.tick(5); t.tick(5); }
  assert.deepEqual(t.toSave().plugins, s.toSave().plugins);
  const ws = s.takeDelta().ext?.['weather'], wt = t.takeDelta().ext?.['weather'];
  assert.deepEqual(wt, ws);
});

test('sauvegarde : section invalide rejetée, section vide acceptée, version future refusée', () => {
  assert.deepEqual(migrateWeather({}, 1), weatherSaveSection.empty());
  assert.throws(() => migrateWeather({ kind: 'tempete' }, 1), /temps inconnu/);
  const ok = { ...weatherSaveSection.empty() } as Record<string, unknown>;
  ok['cloud'] = 'beaucoup';
  assert.throws(() => migrateWeather(ok, 1), /cloud invalide/);
  assert.throws(() => migrateWeather({}, WEATHER_SAVE_VERSION + 1), /plus récente/);
  // Chargement d'une partie avec section corrompue : la partie se charge, la météo repart à neuf.
  const s = town([createWeatherPlugin()]);
  s.tick(30);
  const json = JSON.parse(JSON.stringify(s.toSave()));
  json.plugins.weather.data = { kind: 'tempete' };
  const t = town([createWeatherPlugin()]);
  assert.equal(t.fromSave(json), null);
  assert.ok(t.notices.some((n) => /weather/.test(n.message)));
});

test('commandes : state et force validées', () => {
  const p = createWeatherPlugin();
  const s = town([p]);
  const ctx = s.plugins.contextOf('weather')!;
  const st = p.command!(ctx, 'state', undefined);
  assert.ok(st.ok);
  const f = p.command!(ctx, 'force', { kind: 'neige', settle: true, dayOfYear: 20 });
  assert.ok(f.ok && (f.data as WeatherPayload).kind === 'neige');
  assert.equal(p.command!(ctx, 'force', { kind: 'grele' }).ok, false);
  assert.equal(p.command!(ctx, 'force', { hours: -1 }).ok, false);
  assert.equal(p.command!(ctx, 'inconnue', {}).ok, false);
  assert.ok(s.takeDelta().ext?.['weather'], 'le forçage produit un delta');
});

test('mois de départ : startMonth = 4 démarre la partie au printemps (calendrier, saison, météo) sans changer le défaut', async () => {
  const { validateCommandMessage } = await import('../../src/shared/protocol');
  const mk = (startMonth?: number) => {
    const s = new Simulation();
    s.setCatalog(townCatalog());
    s.newGame({ seed: 3, mapChunks: 4, startMoney: 1e6, cityName: 'M', startHour: 9, ...(startMonth ? { startMonth } : {}), terrain: { hydrology: 'aucune', rivers: 0 } });
    return s;
  };
  const a = mk(), b = mk(4);
  assert.equal(a.clock.month, 1);
  assert.equal(a.clock.totalMinutes, 9 * 60);
  assert.equal(b.clock.month, 4);
  assert.equal(b.clock.year, 1);
  assert.equal(b.clock.season, 'printemps');
  assert.equal(b.clock.hourOfDay, 9);
  const w = b.plugins.command('weather', 'state', undefined);
  assert.ok(w.ok);
  assert.equal((w.data.data as { season: string }).season, 'printemps');
  assert.notEqual(validateCommandMessage({ kind: 'cmd', reqId: 1, name: 'newGame', args: { seed: 1, mapChunks: 4, startMoney: 1, cityName: 'x', startMonth: 13 } }), null);
});
