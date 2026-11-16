/**
 * Connexions extérieures (module « connexions », docs/CONNEXIONS.md) : détection des routes reliées au bord de la carte,
 * liaison à la ville, trafic entrant / sortant, import / export de marchandises (droits au budget), migrants acheminés
 * par les connexions, aucun effet sans connexion, sauvegarde (aller-retour identique, ancienne sauvegarde).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { validateSave } from '../../src/sim/save-format';
import type { ConnexionsState, ConnexionsSummary } from '../../src/shared/protocol-ext/connexions';
import { buildTown, newTownSim, runDays } from '../sim/fixtures';
import { connexionsView } from '../../src/ui/panels/transports';
import { UI_PANELS } from '../../src/ui/panels/index';

type R = { ok: boolean; data?: any; error?: { code: string; message: string } };
const cmd = (s: Simulation, name: string, payload?: unknown): R => {
  const r = s.plugins.command('connexions', name, payload) as any;
  return r.ok ? { ok: true, data: r.data?.data ?? r.data } : { ok: false, error: r.error ?? r };
};
const state = (s: Simulation): ConnexionsState => { const r = cmd(s, 'state'); assert.ok(r.ok, r.error?.message); return r.data; };
const stats = (s: Simulation): ConnexionsSummary => state(s).summary;

function bounds(s: Simulation): { minX: number; minZ: number; maxX: number; maxZ: number } {
  return (s.plugins as any).contextOf('connexions').terrain.bounds();
}

/** Route de la ville (x = 220, z = 0) jusqu'au bord est de la carte. */
function connectEast(s: Simulation, kind: 'street' | 'avenue' = 'avenue'): void {
  const b = bounds(s);
  const r = s.buildRoad({ type: 'street', kind, points: [220, 0, b.maxX - 40, 0] });
  assert.ok(r.ok, !r.ok ? r.error.message : '');
}

test('connexions : détection au bord de la carte, liaison à la ville ; aucune connexion = aucun effet', () => {
  const s = newTownSim();
  buildTown(s);
  runDays(s, 2, 10);
  assert.equal(stats(s).connexions, 0);
  assert.equal(s.traffic.externalShare, 0);
  assert.equal(s.demography!.externalImmigrationFactor, 1);
  assert.equal(s.toSave().plugins?.connexions, undefined, 'aucune section sans connexion');
  // Route isolée qui touche le bord : connexion détectée mais non reliée (aucun bâtiment desservi).
  const b = bounds(s);
  assert.ok(s.buildRoad({ type: 'street', points: [b.minX + 40, 300, b.minX + 200, 300] }).ok);
  s.tick(1);
  let st = state(s);
  assert.equal(st.connexions.length, 1);
  assert.equal(st.connexions[0]!.side, 'ouest');
  assert.equal(st.connexions[0]!.linked, false);
  runDays(s, 1, 10);
  assert.equal(s.traffic.externalShare, 0, 'connexion non reliée : aucun effet');
  // Route de la ville jusqu'au bord est : reliée.
  connectEast(s);
  s.tick(1);
  st = state(s);
  const east = st.connexions.find((c) => c.side === 'est')!;
  assert.ok(east && east.linked && east.kind === 'route');
  assert.equal(st.summary.linked, 1);
  assert.equal(s.traffic.gateCount, 0, 'accès créés au prochain pas du trafic');
});

test('connexions : trafic entrant / sortant, import / export avec droits au budget, migrants par la connexion', () => {
  const s = newTownSim();
  buildTown(s);
  // Rues z = 0 et z = 80 reliées : l'usine (rue nord) est desservie par la connexion.
  assert.ok(s.buildRoad({ type: 'street', points: [-220, 0, -220, 80] }).ok);
  assert.ok(s.buildRoad({ type: 'street', points: [220, 0, 220, 80] }).ok);
  connectEast(s);
  let vehDays = 0;
  for (let d = 0; d < 4; d++) { runDays(s, 1, 2); const x = stats(s); vehDays += x.vehiclesInDay + x.vehiclesOutDay; }
  const sum = stats(s);
  assert.equal(sum.linked, 1);
  assert.ok(sum.tripShare > 0 && s.traffic.externalShare === sum.tripShare, `part ${sum.tripShare}`);
  assert.ok(s.traffic.gateCount === 1, 'accès de la connexion dans le trafic');
  assert.ok(s.traffic.externalIn + s.traffic.externalOut > 0, `véhicules ${s.traffic.externalIn} / ${s.traffic.externalOut}`);
  assert.ok(vehDays > 0, 'comptes du jour');
  assert.ok(sum.localT > 0, `échanges locaux ${sum.localT}`);
  // Marchandises : l'usine produit, les habitants et la boutique consomment ; échanges avec l'extérieur, droits perçus.
  assert.ok(sum.productionT > 0 && sum.consumptionT > 0, JSON.stringify(sum));
  assert.ok(sum.exportT + sum.importT > 0, 'échanges extérieurs');
  assert.ok(sum.dutiesDay > 0 && sum.dutiesMonth > 0, `droits ${sum.dutiesDay}`);
  assert.ok(Math.abs(sum.localT + sum.exportT + sum.unsoldT - sum.productionT) < 0.5, 'bilan production');
  assert.ok(Math.abs(sum.localT + sum.importT + sum.shortageT - sum.consumptionT) < 0.5, 'bilan consommation');
  // Migrants : arrivés par la connexion, immigration un peu favorisée.
  assert.ok(sum.migrantsMonth > 0, `migrants ${sum.migrantsMonth}`);
  assert.ok(s.demography!.externalImmigrationFactor > 1);
  assert.ok(state(s).connexions[0]!.migrantsDay >= 0);
  // Coupure : la route vers le bord est démolie -> plus de connexion, effets retirés au jour suivant.
  const edges = s.toSave().roads.edges.filter((e) => { const a = s.toSave().roads.nodes.find((n) => n.id === e.a)!; const b = s.toSave().roads.nodes.find((n) => n.id === e.b)!; return Math.max(a.x, b.x) > bounds(s).maxX - 100; });
  for (const e of edges) assert.ok(s.removeRoad({ edgeId: e.id }).ok);
  runDays(s, 1, 10);
  assert.equal(stats(s).linked, 0);
  assert.equal(s.traffic.externalShare, 0);
  assert.equal(s.demography!.externalImmigrationFactor, 1);
});

test('connexions : panneau (vue pure) et registres', () => {
  assert.ok(SIM_PLUGINS.some((p) => p.id === 'connexions'));
  assert.ok(UI_PANELS.some((p) => p.id === 'connexions'));
  const s = newTownSim();
  assert.match(connexionsView(state(s))[0]!.title, /Aucune connexion/);
  buildTown(s);
  connectEast(s);
  runDays(s, 1, 10);
  const v = connexionsView(state(s));
  assert.equal(v.length, 2);
  assert.ok(v[0]!.rows.some(([k]) => /Export/.test(k)));
  assert.match(v[1]!.title, /Route est/);
});

test('connexions : budget — les droits de douane sont versés à la ville', () => {

  const mk = (connect: boolean): Simulation => { const s = newTownSim(); buildTown(s); if (connect) connectEast(s); return s; };
  const a = mk(false), b = mk(true);
  const sb = (b.plugins as any).plugins.find((p: any) => p.id === 'connexions').system;
  let duties = 0;
  const orig = sb.daily.bind(sb);
  sb.daily = (ctx: any) => { orig(ctx); duties += stats(b).dutiesDay; };
  runDays(a, 3, 10); runDays(b, 3, 10);
  assert.ok(duties > 0);
  assert.ok(stats(b).dutiesMonth >= Math.round(duties) - 1, `${stats(b).dutiesMonth} / ${duties}`);
});

test('connexions : sauvegarde — aller-retour identique ; ancienne sauvegarde chargée (connexions recalculées)', () => {
  const s = newTownSim();
  buildTown(s);
  connectEast(s);
  runDays(s, 3, 10);
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.ok(validateSave(save).ok);
  assert.equal(save.plugins.connexions.v, 1);
  const u = new Simulation();
  u.setCatalog((s as any).catalog);
  assert.equal(u.fromSave(save), null);
  assert.deepEqual(stats(u), stats(s));
  assert.equal(u.traffic.externalShare, s.traffic.externalShare);
  assert.equal(u.demography!.externalImmigrationFactor, s.demography!.externalImmigrationFactor);
  runDays(s, 2, 10);
  runDays(u, 2, 10);
  const fp = (x: Simulation): unknown => ({ money: Math.round(x.economy.money), pop: x.demography!.population, rng: x.rng.getState(), duties: stats(x).dutiesMonth });
  assert.deepEqual(fp(u), fp(s));
  // Ancienne version (sans module) : aucune section ; rechargée avec le module, la connexion est détectée.
  const old = new Simulation(SIM_PLUGINS.filter((p) => p.id !== 'connexions'));
  old.setCatalog((s as any).catalog);
  assert.equal(old.fromSave(save), null);
  const oldSave = JSON.parse(JSON.stringify(old.toSave()));
  assert.deepEqual(oldSave.plugins?.connexions, save.plugins.connexions, 'section inconnue conservée telle quelle');
  delete oldSave.plugins.connexions;
  const w = new Simulation();
  w.setCatalog((s as any).catalog);
  assert.equal(w.fromSave(oldSave), null);
  assert.equal(stats(w).linked, 1);
  // Section illisible : partie chargée, notification.
  const broken = { ...save, plugins: { ...save.plugins, connexions: { v: 1, data: 'n’importe quoi' } } };
  const z = new Simulation();
  z.setCatalog((s as any).catalog);
  z.plugins.log = () => undefined;
  assert.equal(z.fromSave(broken), null);
  assert.equal(stats(z).linked, 1);
});



