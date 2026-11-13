/**
 * Module hubs (port et aéroport, ROADMAP §7) : tests d'effet obligatoires et contrôles de validation.
 *  - port -> la capacité d'export publiée par `provide('port')` augmente (et une réservation l'entame) ;
 *  - aéroport -> la satisfaction et la valeur foncière baissent sous les pistes (grilles municipales), pas au loin ;
 *  - placement refusé hors littoral / sur l'eau / hors terrain plat ;
 *  - bâtiment trop haut dans l'axe des pistes refusé (commande, outil de pose réel, et aéroport refusé si un
 *    bâtiment existant viole la servitude) ;
 *  - navires et avions : arrivée, accostage / stationnement, départ ; sauvegarde et rechargement ; déterminisme.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubsSim, findSite, findRefusal, place, cmd, tryCmd } from './helpers';
import type { SimPlugin } from '../../src/sim/plugins';
import type { HubFreightApi } from '../../src/shared/hubs/types';
import { HUB_SPECS } from '../../src/shared/hubs/types';
import { RUNWAY_LENGTH, RUNWAY_Z, easementLimitLocal, hubLayout, hubToWorld, airportNoiseLocal } from '../../src/shared/hubs/layout';
import { movementDuration, movementPose } from '../../src/shared/hubs/paths';
import { migrateHubs, emptyHubsSave } from '../../src/sim/save-sections/hubs';
import { transportsView, type TransportsSummary } from '../../src/ui/panels/transports';
import { runDays } from '../sim/fixtures';

/* ------------------------------------------------------------------ gabarits et trajectoires */

test('gabarits : pièces dans l\'emprise, postes à quai côté mer, postes avions sur l\'aire', () => {
  for (const type of ['port_commerce', 'port_passagers', 'aeroport'] as const) {
    const l = hubLayout(type);
    assert.equal(l.hx * 2, HUB_SPECS[type].tilesX * 8);
    for (const p of l.pieces) {
      assert.ok(Math.abs(p.x) <= l.hx + 1 && Math.abs(p.z) <= l.hz + 1, `${type} : ${p.asset} hors emprise (${p.x}, ${p.z})`);
    }
    for (const b of l.berths) assert.ok(b.z > l.hz, `${type} : poste à quai côté mer`);
    for (const s of l.stands) assert.ok(Math.abs(s.z) < l.hz && Math.abs(s.x) < l.hx);
  }
  assert.equal(hubLayout('port_passagers').berths.length, 2, 'poste ferry');
  assert.ok(hubLayout('port_commerce').pieces.filter((p) => p.anim === 'grue_portique').length >= 2);
});

test('trajectoires : un avion atterrit, roule, stationne, repousse, décolle et monte ; un navire accoste puis repart', () => {
  const mv = { id: 1, hub: 1, asset: 'aero_avion_moyen_courrier', role: 'passagers' as const, slot: 1, t0: 100 };
  const seen = new Map<string, { minAlt: number; maxAlt: number }>();
  const dur = movementDuration('aeroport', mv);
  for (let t = 100; t < 100 + dur; t += 0.5) {
    const p = movementPose('aeroport', mv, t)!;
    const s = seen.get(p.phase) ?? { minAlt: Infinity, maxAlt: -Infinity };
    s.minAlt = Math.min(s.minAlt, p.alt); s.maxAlt = Math.max(s.maxAlt, p.alt);
    seen.set(p.phase, s);
  }
  assert.deepEqual([...seen.keys()], ['approche', 'atterrissage', 'roulage', 'stationne', 'repoussage', 'decollage', 'montee']);
  assert.ok(seen.get('approche')!.maxAlt > 60, 'descente depuis plus de 60 m');
  assert.equal(seen.get('decollage')!.maxAlt, 0, 'roulage de décollage au sol');
  assert.ok(seen.get('montee')!.maxAlt > 300, 'montée après la rotation');
  assert.equal(movementPose('aeroport', mv, 99), null);
  assert.equal(movementPose('aeroport', mv, 100 + dur + 1), null);
  const st = hubLayout('aeroport').stands[1]!;
  const parked = [...Array(Math.ceil(dur))].map((_, i) => movementPose('aeroport', mv, 100 + i)).find((p) => p?.phase === 'stationne')!;
  assert.ok(Math.hypot(parked.x - st.x, parked.z - st.z) < 0.01, 'stationné à son poste');
  const ship = { id: 2, hub: 1, asset: 'port_porte_conteneurs', role: 'cargo' as const, slot: 0, t0: 0 };
  const b = hubLayout('port_commerce').berths[0]!;
  const docked = movementPose('port_commerce', ship, 300)!;
  assert.equal(docked.phase, 'a_quai');
  assert.ok(Math.abs(docked.x - b.x) < 0.01 && Math.abs(docked.z - b.z) < 0.01);
  assert.equal(movementPose('port_commerce', ship, 30)!.phase, 'accostage');
  assert.equal(movementPose('port_commerce', ship, movementDuration('port_commerce', ship) - 10)!.phase, 'appareillage');
});

test('servitudes : limite nulle sur la bande, 2 % dans l\'axe, libre loin latéralement ; bruit fort sous l\'axe', () => {
  const end = RUNWAY_LENGTH / 2;
  assert.equal(easementLimitLocal(0, RUNWAY_Z), 0);
  assert.ok(Math.abs(easementLimitLocal(end + 500, RUNWAY_Z) - 10) < 1e-9);
  assert.equal(easementLimitLocal(0, RUNWAY_Z + 1000), Infinity);
  assert.ok(airportNoiseLocal(end + 1000, RUNWAY_Z) > 30, 'bruit sous l\'axe à 1 km');
  assert.ok(airportNoiseLocal(end + 1000, RUNWAY_Z + 1200) < 10, 'calme à 1,2 km de l\'axe');
});

/* ------------------------------------------------------------------ validation */

test('port : refusé hors littoral (intérieur des terres), sur l\'eau ; accepté sur la côte', () => {
  const { sim } = hubsSim({ seed: 3 });
  const inland = findRefusal(sim, 'port_commerce', /littoral ou un cours d'eau navigable/);
  assert.ok(inland, 'un emplacement intérieur est refusé pour défaut de littoral');
  const wet = findRefusal(sim, 'port_commerce', /terre ferme/);
  assert.ok(wet, 'un emplacement en mer est refusé');
  const site = findSite(sim, 'port_commerce', 24);
  assert.ok(site, 'un emplacement côtier est accepté');
  const r = place(sim, 'port_commerce', site.x, site.z, site.rot);
  assert.ok(r.ok, r.ok ? '' : r.message);
  // Pas deux pôles au même endroit.
  const again = place(sim, 'port_commerce', site.x, site.z, site.rot, true);
  assert.ok(!again.ok && /occupé/.test(again.message));
});

test('aéroport : refusé hors terrain plat (relief), accepté sur une plaine', () => {
  const { sim } = hubsSim({ seed: 7 });
  const steep = findRefusal(sim, 'aeroport', /grand terrain plat/);
  assert.ok(steep, 'emplacement accidenté refusé');
  assert.match(steep.message, /dénivelé .* > 6 m/);
  const site = findSite(sim, 'aeroport', 64, [0, 1]);
  assert.ok(site, 'plaine trouvée');
  assert.ok(place(sim, 'aeroport', site.x, site.z, site.rot).ok);
  const second = findSite(sim, 'aeroport', 64, [0, 1]);
  assert.equal(second, null, 'un seul aéroport par ville');
});

/* ------------------------------------------------------------------ tests d'effet */

/** Module de test qui lit le service `port` comme le fera l'export (phase 2B). */
function probe(): SimPlugin & { read: () => ReturnType<HubFreightApi['capacity']> | undefined; api: () => HubFreightApi | undefined } {
  let api: HubFreightApi | undefined;
  return { id: 'sonde', init: (ctx) => { api = ctx.use<HubFreightApi>('port'); }, read: () => api?.capacity(), api: () => api };
}

test('EFFET : construire un port augmente la capacité d\'export de la ville (API provide(\'port\'))', () => {
  // Sonde = module enregistré après hubs, qui lit le service comme le fera l'export de la phase 2B.
  const sonde = probe();
  const t = hubsSim({ seed: 3, extra: [sonde] });
  const api = sonde.api();
  assert.ok(api, 'service « port » publié');
  const before = api.capacity();
  assert.equal(before.exportT, 0);
  assert.equal(api.available(), false);
  assert.equal(api.book(1000, 'export').ok, false, 'aucun port : réservation refusée');
  const site = findSite(t.sim, 'port_commerce', 24)!;
  assert.ok(place(t.sim, 'port_commerce', site.x, site.z, site.rot).ok);
  const after = api.capacity();
  assert.equal(after.exportT, HUB_SPECS.port_commerce.exportT, 'capacité d\'export du port de commerce');
  assert.ok(after.exportT > before.exportT);
  assert.equal(after.costPerT, 12);
  assert.equal(after.delayDays, 6);
  const q = api.quote(5000, 'export');
  assert.equal(q.accepted, 5000);
  const b = api.book(5000, 'export', 'contrat-ble');
  assert.ok(b.ok);
  assert.equal(b.arrivalMinutes - t.sim.clock.totalMinutes, 6 * 1440);
  assert.equal(api.capacity().usedExportT, 5000);
  const sum = cmd<TransportsSummary>(t.sim, 'summary');
  assert.equal(sum.hubs[0]!.month.bookedExportT, 5000);
  assert.equal(sum.port.exportT - sum.port.usedExportT, HUB_SPECS.port_commerce.exportT - 5000);
});

test('EFFET : un aéroport fait baisser satisfaction et valeur foncière sous les pistes (grilles municipales), pas au loin', () => {
  const t = hubsSim({ seed: 7 });
  const site = findSite(t.sim, 'aeroport', 64, [0, 1])!;
  const rec = { type: 'aeroport' as const, ...site };
  // Points : dans l'axe à 300 m au-delà du seuil (sous l'approche) et à 1,5 km latéralement (hors bruit).
  const [ux, uz] = hubToWorld(rec, RUNWAY_LENGTH / 2 + 300, RUNWAY_Z);
  const [fx, fz] = hubToWorld(rec, 0, RUNWAY_Z + 1500);
  const read = (x: number, z: number): { sat: number; land: number; bruit: number } => {
    const d = cmd<{ satisfaction: number; landValue: number; bruit: number }>(t.sim, 'probe', { x, z });
    return { sat: d.satisfaction, land: d.landValue, bruit: d.bruit };
  };
  runDays(t.sim, 1, 10);
  const under0 = read(ux, uz), far0 = read(fx, fz);
  assert.ok(place(t.sim, 'aeroport', site.x, site.z, site.rot).ok);
  runDays(t.sim, 2, 10);
  const under1 = read(ux, uz), far1 = read(fx, fz);
  assert.ok(under1.bruit > under0.bruit + 20, `bruit sous l'axe ${under0.bruit} -> ${under1.bruit}`);
  assert.ok(under1.sat < under0.sat - 5, `satisfaction sous les pistes ${under0.sat} -> ${under1.sat}`);
  assert.ok(under1.land < under0.land - 5, `valeur foncière sous les pistes ${under0.land} -> ${under1.land}`);
  assert.ok(Math.abs(far1.sat - far0.sat) < 1, `satisfaction au loin inchangée ${far0.sat} -> ${far1.sat}`);
  // Contribution réversible : stable dans le temps (pas d'accumulation jour après jour).
  runDays(t.sim, 3, 10);
  assert.ok(Math.abs(read(ux, uz).sat - under1.sat) < 0.5, 'pas d\'accumulation');
  // Grilles du contrat partagé, effet tracé dans le registre municipal.
  const muni = t.muni!.municipal;
  assert.ok(t.hubs.system.usesSharedMunicipal);
  const causes = muni.effects.topCauses(10);
  assert.ok(causes.some((c) => c.cause.kind === 'construction_aeroport'), 'cause enregistrée');
  const eff = muni.effects.query({ target: 'satisfaction' });
  assert.ok(eff.some((e) => e.magnitude < 0), 'effet mesuré négatif sur la satisfaction');
  // Démolition : la contribution est retirée.
  const id = cmd<TransportsSummary>(t.sim, 'summary').hubs[0]!.hub.id;
  cmd(t.sim, 'remove', { id });
  assert.ok(Math.abs(read(ux, uz).sat - under0.sat) < 0.5, 'satisfaction rétablie après démolition');
});

test('EFFET (repli sans module municipal enregistré) : même baisse, sur l\'instance locale du contrat', () => {
  const t = hubsSim({ seed: 7, municipal: false });
  const site = findSite(t.sim, 'aeroport', 64, [0, 1])!;
  const [ux, uz] = hubToWorld({ type: 'aeroport', ...site }, RUNWAY_LENGTH / 2 + 300, RUNWAY_Z);
  assert.ok(place(t.sim, 'aeroport', site.x, site.z, site.rot).ok);
  runDays(t.sim, 1, 10);
  assert.equal(t.hubs.system.usesSharedMunicipal, false);
  assert.ok(t.hubs.system.muni.grids.read('satisfaction', ux, uz) < 45);
});

/* ------------------------------------------------------------------ servitudes : bâtiments trop hauts */

test('SERVITUDE : bâtiment trop haut dans l\'axe des pistes refusé ; le même hors de l\'axe accepté', () => {
  const t = hubsSim({ seed: 7 });
  const site = findSite(t.sim, 'aeroport', 64, [0, 1])!;
  const rec = { type: 'aeroport' as const, ...site };
  assert.ok(place(t.sim, 'aeroport', site.x, site.z, site.rot).ok);
  const [ax, az] = hubToWorld(rec, RUNWAY_LENGTH / 2 + 60, RUNWAY_Z);     // 60 m après le seuil : 1,2 m autorisés
  const [ox, oz] = hubToWorld(rec, 0, RUNWAY_Z + 900);                    // hors servitude
  const inAxis = tryCmd(t.sim, 'checkBuilding', { assetId: 'immeuble', x: ax, z: az, rot: 0 });
  assert.ok(!inAxis.ok);
  assert.match(inAxis.message, /Servitude aéronautique.*dépasse la hauteur autorisée/);
  const off = tryCmd(t.sim, 'checkBuilding', { assetId: 'immeuble', x: ox, z: oz, rot: 0 });
  assert.ok(off.ok, off.ok ? '' : off.message);
});

test('SERVITUDE : aéroport refusé si un bâtiment existant dépasse dans l\'axe', () => {
  const t = hubsSim({ seed: 7 });
  const site = findSite(t.sim, 'aeroport', 64, [0, 1])!;
  const rec = { type: 'aeroport' as const, ...site };
  // Bâtiment (10 m) juste après le seuil, dans l'axe : on cherche une case constructible.
  let placed = false;
  for (let d = 40; d < 160 && !placed; d += 8) {
    for (const sx of [1, -1]) {
      const [x, z] = hubToWorld(rec, sx * (RUNWAY_LENGTH / 2 + d), RUNWAY_Z);
      if (t.sim.placeBuilding({ assetId: 'maison', x, z, rot: 0 }).ok) { placed = true; break; }
    }
  }
  assert.ok(placed, 'maison posée dans l\'axe');
  const r = place(t.sim, 'aeroport', site.x, site.z, site.rot, true);
  assert.ok(!r.ok);
  assert.match(r.message, /Servitude aéronautique : 1 bâtiment\(s\) trop haut\(s\) dans l'axe des pistes/);
});

/* ------------------------------------------------------------------ mouvements, sauvegarde, déterminisme */

test('navires et avions : apparition, accostage / stationnement, départ ; échantillon dans les deltas', () => {
  const t = hubsSim({ seed: 3 });
  const site = findSite(t.sim, 'port_passagers', 24)!;
  assert.ok(place(t.sim, 'port_passagers', site.x, site.z, site.rot).ok);
  const d0 = t.sim.takeDelta();
  const ext0 = d0.ext?.hubs as { hubs?: unknown[] } | undefined;
  assert.equal(ext0?.hubs?.length, 1, 'structure envoyée au rendu');
  const phases = new Set<string>();
  const sys = t.hubs.system;
  for (let i = 0; i < 12000; i++) {
    t.sim.tick(1);
    for (const mv of sys.movements) phases.add(`${mv.role}:${movementPose('port_passagers', mv, sys.phys)?.phase}`);
  }
  for (const k of ['cargo', 'ferry']) {
    for (const ph of ['accostage', 'a_quai', 'appareillage']) {
      const ok = [...phases].some((p) => p.startsWith(k === 'cargo' ? '' : 'ferry') && p.endsWith(ph) && (k === 'ferry' || !p.startsWith('ferry')));
      assert.ok(ok, `${k} : phase ${ph} vue (${[...phases].join(', ')})`);
    }
  }
  const sum = cmd<TransportsSummary>(t.sim, 'summary');
  assert.ok(sum.hubs[0]!.month.movements >= 2, 'escales comptées');
});

test('sauvegarde : pôles, mouvements, activité et contributions rechargés à l\'identique ; déterminisme', () => {
  const mk = (): ReturnType<typeof hubsSim> => {
    const t = hubsSim({ seed: 7 });
    const a = findSite(t.sim, 'aeroport', 64, [0, 1])!;
    assert.ok(place(t.sim, 'aeroport', a.x, a.z, a.rot).ok);
    runDays(t.sim, 2, 5);
    return t;
  };
  const a = mk(), b = mk();
  assert.deepEqual(a.hubs.system.save(), b.hubs.system.save(), 'deux parties identiques');
  const save = a.sim.toSave();
  assert.ok(save.plugins?.hubs, 'section hubs écrite');
  assert.equal(save.plugins!.hubs!.v, 1);
  const c = hubsSim({ seed: 1 });
  const err = c.sim.fromSave(JSON.parse(JSON.stringify(save)));
  assert.equal(err, null, err?.message);
  assert.deepEqual(c.hubs.system.save(), a.hubs.system.save(), 'état du module identique après rechargement');
  // Les grilles municipales (sauvegardées par le contrat) portent la même contribution.
  const g1 = a.muni!.municipal.grids.get('satisfaction')!.data, g2 = c.muni!.municipal.grids.get('satisfaction')!.data;
  assert.deepEqual(Array.from(g2), Array.from(g1));
  // Puis la suite est identique.
  runDays(a.sim, 1, 5); runDays(c.sim, 1, 5);
  assert.deepEqual(c.hubs.system.save(), a.hubs.system.save());
});

test('section de sauvegarde : migration, vide, erreurs', () => {
  assert.deepEqual(migrateHubs(emptyHubsSave(), 1), emptyHubsSave());
  assert.deepEqual(migrateHubs({}, 1), emptyHubsSave());
  assert.throws(() => migrateHubs({ ...emptyHubsSave(), hubs: [{ id: 1, type: 'gare', x: 0, z: 0, rot: 0, y: 0 }] }, 1), /type inconnu/);
  assert.throws(() => migrateHubs({}, 2), /plus récente/);
  assert.throws(() => migrateHubs('x', 1), /objet attendu/);
});

test('panneau Transports : lignes construites à partir des valeurs réelles de la simulation', () => {
  const t = hubsSim({ seed: 3 });
  const site = findSite(t.sim, 'port_commerce', 24)!;
  assert.ok(place(t.sim, 'port_commerce', site.x, site.z, site.rot).ok);
  runDays(t.sim, 2, 10);
  const sum = cmd<TransportsSummary>(t.sim, 'summary');
  const view = transportsView(sum);
  assert.equal(view[0]!.title, 'Capacités de la ville');
  assert.match(view[0]!.rows[0]![1], /90\s?000 t/);
  const port = view.find((s) => s.title.startsWith('Port de commerce'))!;
  const row = (k: string): string => port.rows.find((r) => r[0].startsWith(k))![1];
  assert.match(row('Bruit moyen'), /\/ 100 sur \d+ cellules/);
  assert.ok(sum.hubs[0]!.nuisance.noisyCells > 0, 'cellules exposées mesurées');
  assert.ok(sum.hubs[0]!.nuisance.airPollution > 0, 'pollution de l\'air mesurée');
  assert.ok(sum.hubs[0]!.nuisance.waterPollution > 0, 'pollution de l\'eau mesurée');
  assert.ok(sum.hubs[0]!.month.jobs > 0, 'emplois');
  assert.ok(row('Camions par jour').length > 0);
});

/* ------------------------------------------------------------------ outil de pose réel (machine à états) */

import { ConstructionTools, isHubAsset, type SimPort } from '../../src/client/tools/machine';
import { WorldMirror } from '../../src/client/tools/mirror';
import { handleCommand } from '../../src/sim/handler';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import type { CommandArgs, CommandName, CommandResult, DeltaMessage, SnapshotMessage } from '../../src/shared/protocol';
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { townCatalog } from '../sim/fixtures';
import { hubEntries } from '../../tools/transport/catalog';
import type { Simulation } from '../../src/sim/world';

/** Port en processus vers une VRAIE simulation (mêmes messages que le worker). */
class Port implements SimPort {
  private snapL: ((s: SnapshotMessage) => void)[] = [];
  private deltaL: ((d: DeltaMessage) => void)[] = [];
  private req = 1;
  constructor(readonly sim: Simulation) {}
  onSnapshot(l: (s: SnapshotMessage) => void): void { this.snapL.push(l); }
  onDelta(l: (d: DeltaMessage) => void): void { this.deltaL.push(l); }
  async send<K extends CommandName>(name: K, args: CommandArgs<K>): Promise<CommandResult<K>> {
    await Promise.resolve();
    const out = handleCommand(this.sim, { kind: 'cmd', reqId: this.req++, name, args });
    if (out.snapshot) { const s = this.sim.snapshot(); for (const l of this.snapL) l(s); }
    const d = this.sim.takeDelta();
    for (const l of this.deltaL) l(d);
    const r = out.result;
    if (r.kind !== 'result') throw new Error('réponse inattendue');
    if (!r.ok) throw { error: r.error };
    return r.data as CommandResult<K>;
  }
}

const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function catalogWithHubs(): AssetCatalog {
  const cat = townCatalog();
  const rep = (id: string): CatalogAsset => ({ ...cat.assets[0]!, id, category: 'transport', footprint: { tilesX: 0, tilesZ: 0 }, frontage: [], tags: ['transport'] });
  cat.assets.push(...hubEntries([rep('port_grue_portique'), rep('port_gare_maritime'), rep('aero_tour_controle')]));
  return cat;
}

test('OUTIL DE POSE : Aéroport posé via le catalogue (aperçu rouge/vert par la simulation), immeuble refusé dans l\'axe', async () => {
  const t = hubsSim({ seed: 7 });
  const site = findSite(t.sim, 'aeroport', 64, [0, 1])!;
  const cat = catalogWithHubs();
  const port = new Port(t.sim);
  await port.send('init', { protocolVersion: PROTOCOL_VERSION, catalog: cat });
  await port.send('newGame', { seed: 7, mapChunks: 8, startMoney: 500_000_000, cityName: 'Outil', terrain: { hydrology: 'mer', rivers: 0, relief: 0.15 } });
  const mirror = new WorldMirror(cat);
  port.onSnapshot((s) => mirror.applySnapshot(s));
  port.onDelta((d) => mirror.applyDelta(d));
  const notes: string[] = [];
  const tools = new ConstructionTools(mirror, port, (m, k) => notes.push(`${k}:${m}`));
  const aero = cat.assets.find((a) => a.id === 'hub_aeroport')!;
  assert.ok(isHubAsset(aero));
  assert.ok(tools.setTool('building', { assetId: 'hub_aeroport' }), 'entrée Aéroport sélectionnable');
  // En mer : refus de la simulation (aperçu rouge, message).
  tools.hover({ x: 600, z: 900 }, null);
  await settle();
  assert.equal(tools.preview.kind === 'building' && tools.preview.validity, 'error');
  // Rotation par huitièmes de tour (piste orientable).
  tools.rotate(1);
  assert.equal(tools.rot, 0.5);
  tools.rotate(1); tools.rotate(1); tools.rotate(1);
  assert.equal(tools.rot, 2);
  // Sur la plaine trouvée : aperçu vert puis pose.
  tools.rot = site.rot;
  tools.hover({ x: site.x, z: site.z }, null);
  await settle();
  const p = tools.preview;
  assert.equal(p.kind === 'building' && p.validity, 'ok', p.kind === 'building' ? p.message : '');
  await tools.primary();
  assert.ok(notes.some((n) => n.startsWith('ok:Aéroport construit')), notes.join(' | '));
  assert.equal(t.hubs.system.hubs.length, 1);
  // Immeuble (10 m) juste après le seuil : refusé par la servitude, aperçu rouge et clic refusé.
  const h = t.hubs.system.hubs[0]!.rec;
  const [ax, az] = hubToWorld(h, RUNWAY_LENGTH / 2 + 60, RUNWAY_Z);
  tools.setTool('building', { assetId: 'immeuble' });
  tools.rot = 0; tools.autoAlign = false;
  tools.hover({ x: ax, z: az }, null);
  await settle();
  const q = tools.preview;
  assert.equal(q.kind === 'building' && q.validity, 'error');
  assert.match(q.kind === 'building' ? q.message : '', /Servitude aéronautique/);
  const before = t.sim.buildings.count;
  await tools.primary();
  assert.equal(t.sim.buildings.count, before, 'aucun bâtiment posé');
  assert.ok(notes.some((n) => /Construction refusée : Servitude aéronautique/.test(n)));
});
