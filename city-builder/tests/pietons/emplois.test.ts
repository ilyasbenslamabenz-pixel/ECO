/**
 * Emplois du temps : marcheurs tirés de la démographie réelle, épisodes quotidiens par rôle (heures, origines,
 * destinations), rythme de la journée (aucun départ la nuit, pointe du matin vers emplois et écoles), week-end,
 * plafond de piétons, bâtiments démolis, réseau modifié, foule imposée, commandes, compteur de statistiques.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTIF_COURSES, MOTIF_ECOLE, MOTIF_RETOUR, MOTIF_TRAVAIL, Personas, ROLE_ACTIF, ROLE_AUTRE, ROLE_ECOLIER, ROLE_RETRAITE, walkSpeed, lookForRole, mulberry,
  type VenueFinder,
} from '../../src/sim/pedestrians/schedule';
import { NIGHT_FROM_MIN, NIGHT_UNTIL_MIN, WALKER_SHARE } from '../../src/sim/pedestrians/system';
import { PIETON_AGE, PIETON_GENRE_BIT, type PietonInfo, type PietonsConfig, type PietonsDelta, type PietonsStats } from '../../src/shared/protocol-ext/pietons';
import { handleCommand } from '../../src/sim/handler';
import { collectTransferables, type DeltaMessage, type ResultMessage } from '../../src/shared/protocol';
import { pedTown, runHours } from './fixtures';

const venues: VenueFinder = { venue: (around, _r, kind) => (kind === 'repas' ? 500 : kind === 'parc' ? 600 : 700) + (around % 2) };

test('épisodes : par rôle, aux bonnes heures, entre les bons lieux ; déterministes ; week-end sans travail ni école', () => {
  const P = new Personas();
  const N = 4000;
  for (let i = 0; i < N; i++) P.add(10 + i, i % 4 < 2 ? 2000 + i : -1, i % 4, 2, 0, (i + 1) * 2654435761 >>> 0);
  const seen = { am: 0, pm: 0, school: 0, schoolBack: 0, none: 0 };
  for (let p = 0; p < N; p++) {
    P.makeEpisode(p, 3, 1, venues, false);
    const t = P.epT[p]!, role = P.role[p]!;
    if (t < 0) { seen.none++; assert.equal(P.done[p], 1); continue; }
    assert.equal(P.done[p], 0);
    assert.notEqual(P.epFrom[p], P.epDest[p]);
    assert.ok(t >= NIGHT_UNTIL_MIN && t < NIGHT_FROM_MIN, `départ à ${t} min (rôle ${role})`);
    if (role === ROLE_ACTIF && P.epMotif[p] === MOTIF_TRAVAIL) {
      seen.am++;
      assert.ok(t >= 390 && t <= 540, `départ au travail à ${t}`);
      assert.deepEqual([P.epFrom[p], P.epDest[p]], [P.home[p], P.anchor[p]]);
    } else if (role === ROLE_ACTIF && P.epMotif[p] === MOTIF_RETOUR && P.epFrom[p] === P.anchor[p]) {
      seen.pm++;
      assert.ok(t >= 990 && t <= 1110, `sortie du travail à ${t}`);
      assert.equal(P.epDest[p], P.home[p]);
    } else if (role === ROLE_ECOLIER && P.epMotif[p] === MOTIF_ECOLE) {
      seen.school++;
      assert.ok(t >= 465 && t <= 500);
      assert.deepEqual([P.epFrom[p], P.epDest[p]], [P.home[p], P.anchor[p]]);
    } else if (role === ROLE_ECOLIER && P.epMotif[p] === MOTIF_RETOUR && P.epFrom[p] === P.anchor[p]) {
      seen.schoolBack++;
      assert.ok(t >= 980 && t <= 1010);
    } else if (role === ROLE_RETRAITE || role === ROLE_AUTRE) {
      // Sortie depuis le domicile ou retour vers le domicile.
      assert.ok(P.epFrom[p] === P.home[p] || P.epDest[p] === P.home[p]);
      if (role === ROLE_RETRAITE && P.epMotif[p] === MOTIF_COURSES) assert.ok(t >= 540 && t <= 660, `courses d'un retraité à ${t}`);
    }
  }
  // 1 000 actifs : ≈ 42 % marchent le trajet du matin, ≈ 42 % celui du soir ; idem écoliers (47 % / 47 %).
  assert.ok(seen.am > 350 && seen.am < 490, `${seen.am} trajets du matin`);
  assert.ok(seen.pm > 350 && seen.pm < 490, `${seen.pm} trajets du soir`);
  assert.ok(seen.school > 400 && seen.school < 540 && seen.schoolBack > 400 && seen.schoolBack < 540);
  assert.ok(seen.none > 100 && seen.none < 800, `${seen.none} marcheurs sans sortie ce jour`);
  // Déterminisme : même jour -> même épisode ; autre jour -> épisodes différents pour une bonne part.
  const snap = Array.from(P.epT.subarray(0, N));
  for (let p = 0; p < N; p++) P.makeEpisode(p, 3, 1, venues, false);
  assert.deepEqual(Array.from(P.epT.subarray(0, N)), snap);
  for (let p = 0; p < N; p++) P.makeEpisode(p, 4, 2, venues, false);
  let changed = 0;
  for (let p = 0; p < N; p++) if (P.epT[p] !== snap[p]) changed++;
  assert.ok(changed > N * 0.8);
  // Week-end (samedi = 5) : ni travail ni école.
  for (let p = 0; p < N; p++) {
    P.makeEpisode(p, 5, 5, venues, false);
    assert.ok(P.epMotif[p] !== MOTIF_TRAVAIL && P.epMotif[p] !== MOTIF_ECOLE || P.epT[p]! < 0);
  }
  // `keepDone` (épisode régénéré après chargement) : l'état « fait » est conservé.
  P.done[0] = 1;
  P.makeEpisode(0, 6, 6, venues, true);
  assert.equal(P.done[0], 1);
});

test('apparence et vitesse : âge selon le rôle, seniors plus lents, enfants et adultes distincts', () => {
  const r = mulberry(42);
  const count = (role: number): number[] => { const c = [0, 0, 0, 0]; for (let i = 0; i < 2000; i++) c[lookForRole(role, r) & 3]!++; return c; };
  const eco = count(ROLE_ECOLIER), ret = count(ROLE_RETRAITE), act = count(ROLE_ACTIF);
  assert.equal(eco[PIETON_AGE.adulte]! + eco[PIETON_AGE.senior]!, 0, 'écoliers : enfants et adolescents');
  assert.equal(ret[PIETON_AGE.senior], 2000);
  assert.ok(act[PIETON_AGE.adulte]! > 1800);
  let femmes = 0;
  for (let i = 0; i < 2000; i++) if (lookForRole(ROLE_AUTRE, r) & PIETON_GENRE_BIT) femmes++;
  assert.ok(femmes > 900 && femmes < 1100);
  assert.ok(walkSpeed(PIETON_AGE.senior, 128) < walkSpeed(PIETON_AGE.adulte, 128) - 0.3);
  assert.ok(walkSpeed(PIETON_AGE.adulte, 0) < walkSpeed(PIETON_AGE.adulte, 255));
  for (const age of [0, 1, 2, 3]) for (const s of [0, 255]) { const v = walkSpeed(age, s); assert.ok(v > 0.8 && v < 1.6, `${v} m/s`); }
});

test('ville : marcheurs proportionnels à la population, rôles tirés de la démographie, rythme jour / nuit', () => {
  const t = pedTown();
  const { sim, system } = t;
  runHours(sim, 48); // la ville se peuple (vagues d'immigration)
  const pop = sim.demography!.population;
  assert.ok(pop > 500, `population ${pop}`);
  runHours(sim, 24);
  const st = system.stats();
  const expected = Math.round(sim.demography!.population * WALKER_SHARE);
  assert.ok(Math.abs(st.marcheurs - expected) <= expected * 0.12 + 2, `${st.marcheurs} marcheurs pour ${expected} attendus`);
  assert.equal(st.roles.actifs + st.roles.ecoliers + st.roles.retraites + st.roles.autres, st.marcheurs);
  const rep = sim.demography!.report(sim.clock.totalMinutes, sim.economy.taxRates.residential);
  if (rep.pupils > 20) assert.ok(st.roles.ecoliers > 0, 'des écoliers marchent quand la ville a des élèves');
  // Tous les marcheurs habitent un bâtiment existant qui a des habitants.
  const P = system.personas;
  for (let p = 0; p < P.count; p++) {
    const i = sim.buildings.indexOf(P.home[p]!);
    assert.ok(i >= 0);
    if (P.anchor[p]! >= 0) assert.ok(sim.buildings.indexOf(P.anchor[p]!) >= 0);
  }
  // Départs heure par heure sur 3 jours ouvrés : aucun la nuit, pointe du matin dominée par travail + école.
  while (sim.clock.weekday >= 4 || sim.clock.minuteOfDay !== 0) sim.tick();
  const departs = new Array<number>(24).fill(0);
  const amMotifs = [0, 0, 0, 0, 0, 0];
  let last = system.stats().cumul.trajets;
  const known = new Set<number>();
  for (let k = 0; k < 3 * 1440; k++) {
    sim.tick();
    const c = system.crowd;
    const now = system.stats().cumul.trajets;
    const h = Math.floor(((sim.clock.minuteOfDay + 1439) % 1440) / 60);
    departs[h]! += now - last;
    last = now;
    for (let i = 0; i < c.count; i++) {
      if (known.has(c.id[i]!)) continue;
      known.add(c.id[i]!);
      if (h >= 6 && h < 9) amMotifs[c.motif[i]!]!++;
    }
  }
  const night = departs.slice(22).concat(departs.slice(0, 6)).reduce((a, b) => a + b, 0);
  const day = departs.slice(6, 22).reduce((a, b) => a + b, 0);
  assert.equal(night, 0, `départs de nuit : ${departs.join(',')}`);
  assert.ok(day > 100, `départs de jour : ${day}`);
  if (st.roles.actifs + st.roles.ecoliers >= 10) {
    assert.ok(amMotifs[MOTIF_TRAVAIL]! + amMotifs[MOTIF_ECOLE]! > 0, `motifs du matin ${amMotifs.join('/')}`);
    // Avant 9 h, personne ne part faire des loisirs.
    assert.equal(amMotifs[3], 0);
  }
  // Les piétons dans la rue ne dépassent jamais le nombre de marcheurs (un trajet par marcheur à la fois).
  assert.ok(system.crowd.count <= system.personas.count);
});

test('plafond de piétons, désactivation, foule imposée : commande `config` (validation, bornes)', () => {
  const t = pedTown();
  const { sim, system, ctx } = t;
  const cmd = (name: string, payload?: unknown) => system.command(ctx, name, payload);
  assert.deepEqual(cmd('config'), { ok: true, data: { actif: true, maxPietons: 3000, foule: 0 } });
  assert.equal(cmd('config', { maxPietons: -1 }).ok, false);
  assert.equal(cmd('config', { foule: 'beaucoup' }).ok, false);
  assert.equal(cmd('config', { actif: 1 }).ok, false);
  assert.equal(cmd('config', { inconnu: 1 }).ok, false);
  assert.equal(cmd('config', 'x').ok, false);
  assert.equal(cmd('inexistante').ok, false);
  assert.deepEqual((cmd('config', { maxPietons: 1e9 }) as { data: PietonsConfig }).data.maxPietons, 12000);
  // Foule imposée : 150 passants en quelques secondes, plafonnée par maxPietons.
  cmd('config', { foule: 150, maxPietons: 3000 });
  for (let k = 0; k < 300; k++) sim.tick();
  assert.ok(system.crowd.count >= 150 && system.crowd.count <= 160, `${system.crowd.count} piétons`);
  cmd('config', { maxPietons: 40 });
  assert.equal(system.crowd.count, 40, 'plafond abaissé : les piétons en trop sont retirés');
  for (let k = 0; k < 200; k++) { sim.tick(); assert.ok(system.crowd.count <= 40); }
  // Désactivation : rue vidée, plus aucun coût ; une trame vide est envoyée au rendu.
  cmd('config', { actif: false });
  assert.equal(system.crowd.count, 0);
  const d = system.takeDelta()!;
  assert.equal(d.frame!.count, 0);
  assert.deepEqual(d.config, { actif: false, maxPietons: 40, foule: 150 });
  for (let k = 0; k < 50; k++) sim.tick();
  assert.equal(system.crowd.count, 0);
  assert.equal(system.takeDelta(), undefined, 'module inactif et rue vide : plus rien à envoyer');
  cmd('config', { actif: true, maxPietons: 500 });
  for (let k = 0; k < 300; k++) sim.tick();
  assert.ok(system.crowd.count >= 150);
});

test('protocole : pluginCommand, delta.ext.pietons transférable, compteur de piétons dans les statistiques', () => {
  const t = pedTown();
  const { sim, system } = t;
  const send = (name: string, payload?: unknown): ResultMessage => handleCommand(sim, { kind: 'cmd', reqId: 1, name: 'pluginCommand', args: { plugin: 'pietons', name, payload } }).result as ResultMessage;
  const r = send('config', { foule: 80 });
  assert.equal(r.ok, true);
  for (let k = 0; k < 200; k++) sim.tick();
  const delta: DeltaMessage = sim.takeDelta();
  const ext = delta.ext!.pietons as PietonsDelta;
  assert.ok(ext.frame && ext.frame.count >= 80);
  assert.equal(ext.frame.ids.length, ext.frame.count);
  assert.equal(ext.frame.pos.length, ext.frame.count * 4);
  assert.equal(ext.frame.meta.length, ext.frame.count * 3);
  // Les trois tampons de la trame sont transférés (zéro copie).
  const tr = collectTransferables(delta);
  for (const b of [ext.frame.ids.buffer, ext.frame.pos.buffer, ext.frame.meta.buffer]) assert.ok(tr.includes(b as ArrayBuffer));
  assert.ok(ext.stats, 'statistiques jointes au premier delta');
  assert.equal(ext.stats!.pietons, ext.frame.count);
  assert.equal(ext.stats!.enMarche + ext.stats!.enAttente + ext.stats!.enTraversee, ext.stats!.pietons);
  // Positions finies, sur la carte, à hauteur du sol.
  for (let i = 0; i < ext.frame.count; i++) {
    const x = ext.frame.pos[i * 4]!, y = ext.frame.pos[i * 4 + 1]!, z = ext.frame.pos[i * 4 + 2]!;
    assert.ok(Number.isFinite(x + y + z) && Math.abs(x) < 300 && Math.abs(z) < 200);
    assert.ok(Math.abs(y - sim.groundHeight(x, z)) < 1.2, `piéton ${i} à y=${y}, sol ${sim.groundHeight(x, z)}`);
  }
  // Sans nouveau tick : pas de trame renvoyée (rien n'a bougé).
  assert.equal((sim.takeDelta().ext?.pietons as PietonsDelta | undefined)?.frame, undefined);
  // Commandes stats / inspecter / proche.
  const st = send('stats');
  assert.equal(st.ok, true);
  const stats = (st as { data: { data: PietonsStats } }).data.data;
  assert.equal(stats.pietons, system.crowd.count);
  assert.ok(stats.tickMs.echantillons > 0 && stats.tickMs.moyenne > 0 && stats.tickMs.max >= stats.tickMs.p95);
  assert.ok(stats.graphe.trottoirsM > 3000 && stats.graphe.passagesMarques > 0);
  const id = ext.frame.ids[0]!;
  const info = (send('inspecter', { id }) as { data: { data: PietonInfo } }).data.data;
  assert.equal(info.id, id);
  assert.equal(info.role, 'passant');
  assert.ok(info.resteM >= 0 && ['enfant', 'ado', 'adulte', 'senior'].includes(info.age));
  const near = (send('proche', { x: info.x, z: info.z, rayon: 1 }) as { data: { data: PietonInfo } }).data.data;
  assert.equal(near.id, id);
  const miss = send('inspecter', { id: 99_999_999 });
  assert.equal(miss.ok, false);
  if (!miss.ok) assert.equal(miss.error.code, 'NOT_FOUND');
  assert.equal(send('proche', { x: 5000, z: 5000 }).ok, false);
});

test('réseau modifié et bâtiments démolis : les piétons sont déviés ou retirés, jamais d\'exception', () => {
  const t = pedTown();
  const { sim, system, ctx } = t;
  sim.plugins.log = (m) => { throw new Error(m); };
  system.command(ctx, 'config', { foule: 250 });
  for (let k = 0; k < 600; k++) sim.tick();
  const before = system.crowd.count;
  assert.ok(before >= 250);
  // Suppression d'un tronçon de l'avenue : le graphe est reconstruit, les chemins touchés recalculés.
  const seg = sim.net.segmentNear(0, 0, 5)!;
  assert.ok(seg);
  const v0 = system.graph!.roadsVersion;
  assert.equal(sim.removeRoad({ edgeId: seg.segId }).ok, true);
  for (let k = 0; k < 100; k++) sim.tick();
  assert.notEqual(system.graph!.roadsVersion, v0);
  const c = system.crowd;
  for (let i = 0; i < c.count; i++) assert.equal(c.reroute[i], 0, 'tous les chemins invalidés ont été recalculés');
  // Plus aucun piéton sur l'ancien tronçon (ils ont été recalés sur un trottoir existant ou retirés).
  const g = system.graph!;
  for (let i = 0; i < c.count; i++) assert.ok(c.edge[i]! < g.edgeCount);
  // Démolition de la moitié des bâtiments pendant que la foule marche.
  for (let k = 0; k < t.buildings.length; k += 2) sim.demolish({ buildingId: t.buildings[k]! });
  for (let k = 0; k < 1500; k++) sim.tick();
  assert.equal(sim.plugins.errors.length, 0);
  // Nouvelle route : les trottoirs neufs sont utilisables (graphe à jour).
  assert.ok(sim.buildRoad({ type: 'street', points: [-240, -180, 240, -180] }).ok);
  for (let k = 0; k < 20; k++) sim.tick();
  assert.equal(system.graph!.roadsVersion, sim.net.version);
  assert.equal(sim.plugins.errors.length, 0);
});
