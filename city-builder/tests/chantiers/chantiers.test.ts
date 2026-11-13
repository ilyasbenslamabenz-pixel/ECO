/**
 * Tests du module « chantiers » — propriété de la branche p2a-chantiers (inclus dans `npm test`).
 *
 * Couverture : enregistrement du module, durées et horaires de travail, ouverture d'un chantier à la
 * pose, phases, achèvement, chantier de démolition, portail d'activité (bâtiment inactif pendant le
 * chantier quand le cœur l'expose), sauvegarde EN COURS de chantier, chargement d'une ancienne
 * sauvegarde SANS section chantiers, migration v1 -> v2, et neutralité du module désactivé.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { RENDER_PLUGINS } from '../../src/render/plugins';
import { UI_PANELS } from '../../src/ui/panels/index';
import { CHANTIERS_SAVE_VERSION, emptyChantiersSave, migrateChantiers } from '../../src/sim/save-sections/chantiers';
import { chantierSystem, chantiersPlugin } from '../../src/sim/plugins/chantiers';
import { ChantierSystem } from '../../src/sim/construction/system';
import {
  buildDurationMinutes, calendarMinutesFor, demolitionDurationMinutes, isWorkMinute, MIN_BUILD_MINUTES,
  WORK_MINUTES_PER_DAY, workedMinutesBetween,
} from '../../src/sim/construction/schedule';
import {
  CHANTIER_PHASES, CHANTIER_PHASE_ENDS, chantierProgress, phaseIndexAt, phaseLocalProgress,
  type ChantiersDelta, type ChantiersEtat, type ChantiersSnapshot,
} from '../../src/shared/protocol-ext/chantiers';
import { Simulation } from '../../src/sim/world';
import { newTownSim, townCatalog } from '../sim/fixtures';
import { TILE_SIZE } from '../../src/shared/constants';
import type { PluginContext } from '../../src/sim/plugins/types';

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

/** Partie prête : une rue est tracée et le premier tick a eu lieu (les chantiers suivent les poses ensuite). */
function sim(): Simulation {
  const s = newTownSim(80_000_000);
  const r = s.buildRoad({ type: 'street', points: [-240, 0, 240, 0] });
  assert.ok(r.ok, 'route de test');
  s.takeDelta();
  s.tick(1); // première synchronisation : l'existant est achevé
  return s;
}

/** Pose un bâtiment au bord de la rue et renvoie son identifiant. */
function place(s: Simulation, assetId: string, x: number): number {
  const a = s.getAsset(assetId)!;
  const r = s.placeBuilding({ assetId, x, z: -8 - (a.footprint.tilesZ * TILE_SIZE) / 2, rot: 0 });
  assert.ok(r.ok, `pose ${assetId} : ${r.ok ? '' : r.error.message}`);
  return r.ok ? r.data.buildingId : 0;
}

/** Charge utile du module dans le prochain delta. */
function delta(s: Simulation): ChantiersDelta | undefined {
  return s.takeDelta().ext?.['chantiers'] as ChantiersDelta | undefined;
}

function etat(s: Simulation): ChantiersEtat {
  const r = s.pluginCommand({ plugin: 'chantiers', name: 'etat' });
  assert.ok(r.ok, 'commande etat');
  return (r.ok ? r.data.data : null) as ChantiersEtat;
}

/** Avance la simulation de `minutes` minutes de jeu par pas de 30 minutes. */
function run(s: Simulation, minutes: number): void {
  for (let m = 0; m < minutes; m += 30) s.tick(30);
}

/* ------------------------------------------------------------------ */
/* Enregistrement                                                      */
/* ------------------------------------------------------------------ */

test('chantiers : module enregistré (simulation, rendu, interface)', () => {
  assert.ok(SIM_PLUGINS.some((p) => p.id === 'chantiers'));
  assert.ok(RENDER_PLUGINS.some((p) => p.id === 'chantiers'));
  assert.ok(UI_PANELS.some((p) => p.id === 'chantiers'));
  assert.equal(chantiersPlugin.saveVersion, CHANTIERS_SAVE_VERSION);
});

/* ------------------------------------------------------------------ */
/* Durées et horaires                                                  */
/* ------------------------------------------------------------------ */

test('chantiers : durée croissante avec le coût, la hauteur et l\'emprise, bornée', () => {
  const d = (cost: number, height: number, tiles = 4): number =>
    buildDurationMinutes({ cost, dimensions: { width: 10, depth: 10, height }, footprint: { tilesX: tiles, tilesZ: 1 } });
  const maison = d(42_000, 7.5, 4);
  const immeuble = d(620_000, 25, 6);
  const tour = d(14_500_000, 233, 16);
  assert.ok(maison < immeuble && immeuble < tour, `${maison} < ${immeuble} < ${tour}`);
  assert.equal(maison, Math.round(maison / 10) * 10, 'durée arrondie à 10 min');
  assert.ok(maison >= MIN_BUILD_MINUTES);
  // Ordres de grandeur annoncés : ~1,1 jour de travail pour un pavillon, ~3,5 pour un immeuble, ~16 pour une tour.
  assert.ok(maison / WORK_MINUTES_PER_DAY > 0.9 && maison / WORK_MINUTES_PER_DAY < 1.5, `pavillon ${maison}`);
  assert.ok(immeuble / WORK_MINUTES_PER_DAY > 2.5 && immeuble / WORK_MINUTES_PER_DAY < 4.5, `immeuble ${immeuble}`);
  assert.ok(tour / WORK_MINUTES_PER_DAY > 10 && tour / WORK_MINUTES_PER_DAY <= 20, `tour ${tour}`);
  // Démolition : plus courte que la construction, et plus courte encore si le bâtiment était inachevé.
  const asset = { cost: 620_000, dimensions: { width: 10, depth: 10, height: 25 }, footprint: { tilesX: 3, tilesZ: 2 } };
  assert.ok(demolitionDurationMinutes(asset, 1) < buildDurationMinutes(asset));
  assert.ok(demolitionDurationMinutes(asset, 0.2) < demolitionDurationMinutes(asset, 1));
});

test('chantiers : horloge de travail (06:00-20:00), nuits sautées', () => {
  assert.equal(isWorkMinute(5 * 60 + 59), false);
  assert.equal(isWorkMinute(6 * 60), true);
  assert.equal(isWorkMinute(19 * 60 + 59), true);
  assert.equal(isWorkMinute(20 * 60), false);
  assert.equal(workedMinutesBetween(0, 24 * 60), WORK_MINUTES_PER_DAY);
  assert.equal(workedMinutesBetween(0, 6 * 60), 0);
  assert.equal(workedMinutesBetween(6 * 60, 7 * 60), 60);
  assert.equal(workedMinutesBetween(19 * 60, 21 * 60), 60);
  assert.equal(workedMinutesBetween(3 * 24 * 60, 5 * 24 * 60), 2 * WORK_MINUTES_PER_DAY);
  // Durée calendaire : une journée de travail à 6 h du matin se termine à 20 h le même jour.
  assert.equal(calendarMinutesFor(6 * 60, WORK_MINUTES_PER_DAY), 14 * 60);
  // Démarré à 19 h, il reste 1 h ce soir puis la suite le lendemain matin.
  assert.equal(calendarMinutesFor(19 * 60, 120), 60 + 10 * 60 + 60);
  // Cohérence : ce que l'on travaille pendant la durée calendaire calculée est bien la durée demandée.
  for (const start of [0, 300, 6 * 60 + 17, 13 * 60, 23 * 60 + 30]) {
    for (const work of [10, 480, 2000]) {
      const cal = calendarMinutesFor(start, work);
      assert.ok(Math.abs(workedMinutesBetween(start, start + cal) - work) < 1e-6, `${start}/${work}`);
    }
  }
});

test('chantiers : phases ordonnées et avancement dans la phase', () => {
  assert.equal(CHANTIER_PHASES.length, CHANTIER_PHASE_ENDS.length);
  assert.equal(CHANTIER_PHASE_ENDS[CHANTIER_PHASE_ENDS.length - 1], 1);
  for (let i = 1; i < CHANTIER_PHASE_ENDS.length; i++) assert.ok(CHANTIER_PHASE_ENDS[i]! > CHANTIER_PHASE_ENDS[i - 1]!);
  assert.equal(phaseIndexAt(0), 0);
  assert.equal(phaseIndexAt(0.5), 2);
  assert.equal(phaseIndexAt(1), CHANTIER_PHASES.length - 1);
  assert.equal(phaseLocalProgress(0.12, 1), 0);
  assert.ok(Math.abs(phaseLocalProgress(0.19, 1) - 0.5) < 0.01);
  assert.equal(chantierProgress({ t0: 100, duree: 200 }, 200), 0.5);
  assert.equal(chantierProgress({ t0: 100, duree: 200 }, 50), 0);
  assert.equal(chantierProgress({ t0: 100, duree: 200 }, 9999), 1);
});

/* ------------------------------------------------------------------ */
/* Cycle de vie d'un chantier                                          */
/* ------------------------------------------------------------------ */

test('chantiers : la pose ouvre un chantier, les phases s\'enchaînent, l\'achèvement le referme', () => {
  const s = sim();
  const id = place(s, 'maison', -200);
  const d = delta(s) ?? (s.tick(1), delta(s));
  assert.ok(d, 'charge utile du module dans le delta');
  assert.equal(d!.ajoutes?.length, 1);
  const rec = d!.ajoutes![0]!;
  assert.equal(rec.kind, 'construction');
  assert.equal(rec.buildingId, id);
  assert.equal(rec.assetId, 'maison');
  assert.ok(rec.duree > 0);

  const e0 = etat(s);
  assert.equal(e0.actif, true);
  assert.equal(e0.chantiers.length, 1);
  assert.equal(e0.chantiers[0]!.phase, 'terrassement');
  assert.equal(e0.chantiers[0]!.avancement, 0);
  assert.ok(e0.chantiers[0]!.resteCalendaire >= e0.chantiers[0]!.resteTravail, 'les nuits allongent le calendrier');

  // Phases successives : on avance par quarts de la durée.
  const vues = new Set<string>();
  for (let i = 0; i < 40; i++) {
    run(s, 180);
    const e = etat(s);
    if (e.chantiers.length === 0) break;
    vues.add(e.chantiers[0]!.phase);
  }
  assert.equal(etat(s).chantiers.length, 0, 'chantier achevé');
  assert.ok(vues.has('fondations') && vues.has('structure') && vues.has('finitions'), `phases vues : ${[...vues].join(',')}`);
  assert.ok(s.notices.some((n) => n.message.includes('Chantier terminé')), 'notification d\'achèvement');
  assert.equal(s.buildings.indexOf(id) >= 0, true, 'le bâtiment reste en place');
});

test('chantiers : la démolition ouvre un chantier de déblaiement puis disparaît', () => {
  const s = sim();
  const id = place(s, 'maison', -200);
  run(s, 10 * 60); // la partie démarre à minuit : il faut atteindre les heures de travail
  assert.ok(etat(s).chantiers[0]!.avancement > 0.1, 'chantier réellement commencé');
  // Chantier de construction en cours : sa démolition l'annule et ouvre un déblaiement court.
  const r = s.demolish({ buildingId: id });
  assert.ok(r.ok);
  s.tick(1);
  const e = etat(s);
  assert.equal(e.chantiers.length, 1);
  assert.equal(e.chantiers[0]!.kind, 'demolition');
  assert.ok(e.chantiers[0]!.bati < 0.5, 'bâtiment à peine commencé');
  for (let i = 0; i < 40 && etat(s).chantiers.length > 0; i++) run(s, 180);
  assert.equal(etat(s).chantiers.length, 0, 'déblaiement terminé');
});

test('chantiers : démolition d\'un bâtiment achevé (durée complète) et nouvelle construction sur le terrain', () => {
  const s = sim();
  const id = place(s, 'maison', -100);
  for (let i = 0; i < 40 && etat(s).chantiers.length > 0; i++) run(s, 180);
  assert.ok(s.demolish({ buildingId: id }).ok);
  s.tick(1);
  const demo = etat(s).chantiers[0]!;
  assert.equal(demo.kind, 'demolition');
  assert.equal(demo.bati, 1);
  // Reconstruire au même endroit annule le chantier de démolition.
  const id2 = place(s, 'maison', -100);
  s.tick(1);
  const e = etat(s);
  assert.equal(e.chantiers.length, 1);
  assert.equal(e.chantiers[0]!.kind, 'construction');
  assert.equal(e.chantiers[0]!.buildingId, id2);
});

test('chantiers : commandes inspecter / configurer', () => {
  const s = sim();
  const id = place(s, 'immeuble', 40);
  s.tick(1);
  const r = s.pluginCommand({ plugin: 'chantiers', name: 'inspecter', payload: { buildingId: id } });
  assert.ok(r.ok);
  const info = (r.ok ? r.data.data : null) as { buildingId: number; phaseFr: string; nomFr: string };
  assert.equal(info.buildingId, id);
  assert.equal(info.phaseFr, 'Terrassement');
  const absent = s.pluginCommand({ plugin: 'chantiers', name: 'inspecter', payload: { buildingId: 9999 } });
  assert.equal(absent.ok, false);
  assert.equal(absent.ok === false && absent.error.code, 'NOT_FOUND');
  const bad = s.pluginCommand({ plugin: 'chantiers', name: 'inspecter', payload: {} });
  assert.equal(bad.ok, false);
  // Désactivation : les chantiers en cours s'achèvent, plus aucun ne s'ouvre.
  const off = s.pluginCommand({ plugin: 'chantiers', name: 'configurer', payload: { actif: false } });
  assert.ok(off.ok);
  assert.equal(etat(s).chantiers.length, 0);
  place(s, 'maison', 120);
  s.tick(1);
  assert.equal(etat(s).chantiers.length, 0, 'module désactivé : aucune ouverture');
  // Le choix est retenu par la sauvegarde (il s'écarte du réglage par défaut).
  const sec = s.toSave().plugins?.['chantiers'];
  assert.equal((sec?.data as { actif: boolean } | undefined)?.actif, false);
  const s3 = new Simulation();
  s3.setCatalog(townCatalog());
  assert.equal(s3.fromSave(JSON.parse(JSON.stringify(s.toSave()))), null);
  assert.equal(etat(s3).actif, false, 'chantiers toujours désactivés après rechargement');
  // Réactivation : les bâtiments existants restent achevés.
  assert.ok(s.pluginCommand({ plugin: 'chantiers', name: 'configurer', payload: { actif: true } }).ok);
  assert.equal(etat(s).chantiers.length, 0);
});

/* ------------------------------------------------------------------ */
/* Portail d'activité (API du cœur, facultative)                        */
/* ------------------------------------------------------------------ */

/** Contexte minimal pour tester la logique du portail sans le cœur (docs/requests/chantiers.md). */
function fakeCtx(calls: [number, boolean][]): PluginContext {
  const cat = townCatalog();
  const store = {
    id: new Int32Array([7]), assetIndex: new Uint16Array([0]), variant: new Int32Array([0]),
    x: new Float32Array([10]), y: new Float32Array([0]), z: new Float32Array([20]), rot: new Float64Array([0]),
    tilesX: new Uint16Array([2]), tilesZ: new Uint16Array([2]), residents: new Int32Array([0]),
    workers: new Int32Array([0]), roadAccess: new Uint8Array([1]),
  };
  return {
    pluginId: 'chantiers',
    clock: { totalMinutes: 6 * 60, hourOfDay: 6, minuteOfDay: 360, dayIndex: 0, monthIndex: 0, month: 1, year: 1, season: 'printemps', weekday: 0 },
    params: null, inGame: true, catalog: cat, getAsset: (id) => cat.assets.find((a) => a.id === id),
    terrain: { heightAt: () => 0, isWet: () => false, bounds: () => null },
    roads: {} as PluginContext['roads'],
    economy: {} as PluginContext['economy'],
    buildings: {
      count: 1, store, indexOf: (id: number) => (id === 7 ? 0 : -1), record: () => null,
      assetOf: (id: number) => (id === 7 ? cat.assets[0] : undefined),
      query: (_a: number, _b: number, _c: number, _d: number, out: number[]) => out,
      setActive: (id: number, active: boolean) => { calls.push([id, active]); return true; },
    } as unknown as PluginContext['buildings'],
    demography: null, speed: 1,
    rng: { next: () => 0.5, getState: () => [1, 2, 3, 4], setState: () => undefined } as unknown as PluginContext['rng'],
    notify: () => undefined, provide: () => undefined, use: () => undefined,
  };
}

test('chantiers : portail d\'activité appelé à l\'ouverture et à l\'achèvement quand le cœur l\'expose', () => {
  const calls: [number, boolean][] = [];
  const ctx = fakeCtx(calls);
  assert.equal(ChantierSystem.hasActivityGate(ctx), true);
  // Un bâtiment DÉJÀ présent à la première synchronisation est achevé : aucun appel au portail.
  const existant = new ChantierSystem();
  existant.reset(true);
  existant.sync(ctx);
  assert.deepEqual(calls, [], 'l\'existant n\'est pas remis en chantier');
  // Un bâtiment signalé comme posé par le joueur ouvre un chantier et désactive le bâtiment.
  const sys = new ChantierSystem();
  sys.reset(true);
  sys.onBuildingAdded(ctx, 7, 'commande');
  assert.deepEqual(calls, [[7, false]]);
  assert.equal(sys.enChantier(7), true);
  assert.ok(sys.avancement(7) === 0);
  // Fin du chantier : le bâtiment est réactivé.
  const duree = sys.etat(ctx).chantiers[0]!.duree;
  const saut = duree * 3;
  sys.tick({ ...ctx, clock: { ...ctx.clock, totalMinutes: 6 * 60 + saut } }, saut);
  assert.deepEqual(calls, [[7, false], [7, true]]);
  assert.equal(sys.enChantier(7), false);
  assert.equal(sys.avancement(7), 1);
});

test('chantiers : sans portail d\'activité, le module fonctionne sans rien écrire dans la simulation', () => {
  const s = sim();
  assert.equal(ChantierSystem.hasActivityGate(s.plugins.contextOf('chantiers')!), false, 'cœur actuel : pas de portail');
  const e = etat(s);
  assert.equal(e.porteActivite, false);
  const id = place(s, 'immeuble', 40);
  s.tick(1);
  assert.equal(etat(s).chantiers.length, 1);
  // Limite connue et documentée (docs/requests/chantiers.md) : le bâtiment est déjà actif.
  assert.equal(s.buildings.roadAccess[s.buildings.indexOf(id)], 1);
});

/* ------------------------------------------------------------------ */
/* Sauvegarde                                                          */
/* ------------------------------------------------------------------ */

test('chantiers : sauvegarde EN COURS de chantier rechargée à l\'identique', () => {
  const s = sim();
  const id = place(s, 'immeuble', -140);
  run(s, 600);
  const avant = etat(s).chantiers[0]!;
  assert.ok(avant.avancement > 0 && avant.avancement < 1, `avancement ${avant.avancement}`);
  const save = s.toSave();
  assert.ok(save.plugins?.['chantiers'], 'section chantiers écrite');
  assert.equal(save.plugins!['chantiers']!.v, CHANTIERS_SAVE_VERSION);

  const s2 = new Simulation();
  s2.setCatalog(townCatalog());
  assert.equal(s2.fromSave(JSON.parse(JSON.stringify(save))), null);
  const apres = etat(s2).chantiers[0]!;
  assert.equal(apres.buildingId, id);
  assert.equal(apres.id, avant.id);
  assert.equal(apres.duree, avant.duree);
  assert.ok(Math.abs(apres.avancement - avant.avancement) < 1e-9, `${apres.avancement} vs ${avant.avancement}`);
  assert.equal(apres.phase, avant.phase);
  // Et le chantier se termine normalement après le chargement.
  for (let i = 0; i < 60 && etat(s2).chantiers.length > 0; i++) run(s2, 180);
  assert.equal(etat(s2).chantiers.length, 0);
});

test('chantiers : ancienne sauvegarde SANS section chantiers (phase 1) chargée, tous les bâtiments achevés', () => {
  const s = sim();
  const id = place(s, 'maison', -60);
  for (let i = 0; i < 40 && etat(s).chantiers.length > 0; i++) run(s, 180);
  const save = JSON.parse(JSON.stringify(s.toSave())) as Record<string, unknown>;
  delete save['plugins']; // sauvegarde de la phase 1
  const s2 = new Simulation();
  s2.setCatalog(townCatalog());
  assert.equal(s2.fromSave(save), null);
  assert.equal(s2.buildings.indexOf(id) >= 0, true);
  const e = etat(s2);
  assert.equal(e.chantiers.length, 0, 'aucun chantier inventé au chargement');
  // Et la simulation continue sans ouvrir de chantier sur l'existant.
  run(s2, 600);
  assert.equal(etat(s2).chantiers.length, 0);
  // Une pose APRÈS le chargement ouvre bien un chantier.
  const r = s2.placeBuilding({ assetId: 'maison', x: 160, z: -16, rot: 0 });
  assert.ok(r.ok);
  s2.tick(1);
  assert.equal(etat(s2).chantiers.length, 1);
});

test('chantiers : migration de section v1 -> v2 et sections invalides rejetées', () => {
  const v1 = migrateChantiers({}, 1);
  assert.deepEqual(v1, emptyChantiersSave());
  assert.deepEqual(migrateChantiers(emptyChantiersSave(), CHANTIERS_SAVE_VERSION), emptyChantiersSave());
  assert.throws(() => migrateChantiers({}, CHANTIERS_SAVE_VERSION + 1), /plus récente/);
  assert.throws(() => migrateChantiers('texte', 1), /objet attendu/);
  assert.throws(() => migrateChantiers({ actif: true, horloge: 0, chantiers: [{ id: 1 }] }, 2), /invalide/);
  assert.throws(() => migrateChantiers({ actif: true, horloge: -5, chantiers: [] }, 2), /horloge/);
  const bon = {
    actif: true, horloge: 120, prochainId: 4,
    chantiers: [{ id: 3, kind: 'construction', buildingId: 2, assetId: 'maison', variant: 0, x: 1, y: 2, z: 3, rot: 0, t0: 10, duree: 900, bati: 0 }],
  };
  const m = migrateChantiers(JSON.parse(JSON.stringify(bon)), 2);
  assert.equal(m.chantiers.length, 1);
  assert.equal(m.prochainId, 4);
  // Chantier dont le bâtiment a disparu : ignoré au chargement, le reste de la partie est intact.
  const s = sim();
  const save = s.toSave() as unknown as Record<string, unknown> & { plugins?: Record<string, { v: number; data: unknown }> };
  save.plugins = { chantiers: { v: 2, data: { ...bon, chantiers: [{ ...bon.chantiers[0]!, buildingId: 777 }] } } };
  const s2 = new Simulation();
  s2.setCatalog(townCatalog());
  assert.equal(s2.fromSave(JSON.parse(JSON.stringify(save))), null);
  assert.equal(etat(s2).chantiers.length, 0);
  assert.ok(s2.notices.some((n) => n.message.includes('incohérent')), 'incohérence signalée');
});

/* ------------------------------------------------------------------ */
/* Instantané et neutralité                                            */
/* ------------------------------------------------------------------ */

test('chantiers : instantané complet, et ville construite d\'un coup livrée achevée', () => {
  const s = sim();
  place(s, 'maison', -200);
  s.tick(1);
  const snap = s.snapshot().ext?.['chantiers'] as ChantiersSnapshot;
  assert.equal(snap.actif, true);
  assert.equal(snap.chantiers.length, 1);
  assert.equal(snap.chantiers[0]!.assetId, 'maison');
  // buildCity : les bâtiments arrivent en lot, l'instantané qui suit les adopte achevés.
  const s2 = newTownSim(500_000_000);
  const r = s2.runExt('buildCity', { preset: 'demo', maxBuildings: 30, settleWaves: 0 });
  assert.ok(r.ok);
  assert.equal(s2.snapshot().ext?.['chantiers'], undefined, 'aucune ville de démonstration en chantier');
  s2.tick(1);
  assert.equal(etat(s2).chantiers.length, 0);
});

test('chantiers : aucune charge utile ni section tant qu\'aucun chantier n\'existe', () => {
  const s = sim();
  assert.equal(delta(s), undefined);
  run(s, 240);
  assert.equal(delta(s), undefined, 'rien à envoyer sans chantier');
  assert.equal(s.toSave().plugins?.['chantiers'], undefined, 'aucune section tant que rien ne s\'est passé');
});

test('chantiers : le système exporté est partagé par le module et remis à zéro à chaque partie', () => {
  const s = sim();
  place(s, 'maison', -200);
  s.tick(1);
  assert.equal(chantierSystem.sites.size, 1);
  s.newGame({ seed: 7, mapChunks: 4, startMoney: 1_000_000, cityName: 'Neuve', terrain: { hydrology: 'aucune', rivers: 0 } });
  assert.equal(chantierSystem.sites.size, 0);
  assert.equal(chantierSystem.horloge, 0);
});
