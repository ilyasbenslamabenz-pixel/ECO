/**
 * Progression (vague 4, docs/PROGRESSION.md) : points d'expansion et paliers, déblocages progressifs (parties neuves
 * seulement), bonus d'emprunt, objectifs et réalisations, événements (préavis, effets, réglage, flux aléatoire séparé),
 * sauvegardes (aller-retour, anciennes parties), plafond horaire des trajets détaillés du trafic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import type { AssetCatalog } from '../../src/shared/catalog';
import { LOAN_BASE_CAPACITY } from '../../src/sim/economy';
import { MILESTONES, PALIERS_SERVICE, type PaliersService, type PaliersState } from '../../src/shared/milestones';
import type { ObjectifsState } from '../../src/shared/protocol-ext/objectifs';
import type { EvenementsState } from '../../src/shared/protocol-ext/evenements';
import { happinessXp } from '../../src/sim/plugins/paliers';
import { EVENTS_START_DAYS } from '../../src/sim/plugins/evenements';
import { validateSave } from '../../src/sim/save-format';
import { buildTown, runDays, townCatalog } from '../sim/fixtures';

type R = { ok: boolean; data?: any; error?: { code: string; message: string } };
const cmd = (s: Simulation, plugin: string, name: string, payload?: unknown): R => {
  const r = s.plugins.command(plugin, name, payload) as any;
  return r.ok ? { ok: true, data: r.data?.data ?? r.data } : { ok: false, error: r.error };
};
const paliers = (s: Simulation): PaliersState => cmd(s, 'paliers', 'state').data;
const objectifs = (s: Simulation): ObjectifsState => cmd(s, 'objectifs', 'state').data;
const evenements = (s: Simulation): EvenementsState => cmd(s, 'evenements', 'state').data;
const svc = (s: Simulation): PaliersService => s.plugins.service<PaliersService>(PALIERS_SERVICE)!;

/** Catalogue de test + modèles verrouillables portant les identifiants du vrai catalogue. */
function progCatalog(): AssetCatalog {
  const c = townCatalog();
  const hop = c.assets.find((a) => a.id === 'hopital')!;
  c.assets.push({ ...hop, id: 'public_hopital', nameFr: 'Hôpital de test' });
  return c;
}
function newSim(seed = 1234, money = 50_000_000): Simulation {
  const s = new Simulation();
  s.setCatalog(progCatalog());
  s.newGame({ seed, mapChunks: 4, startMoney: money, cityName: 'Bourg-Progrès', terrain: { hydrology: 'aucune', rivers: 0 } });
  return s;
}
function reload(s: Simulation, mutate?: (save: Record<string, any>) => void): Simulation {
  const save = JSON.parse(JSON.stringify(s.toSave())) as Record<string, any>;
  mutate?.(save);
  const c = new Simulation();
  c.setCatalog(progCatalog());
  assert.equal(c.fromSave(save), null);
  return c;
}

/* ------------------------------ Paliers ------------------------------ */

test('paliers : points de croissance (record de population) et de bonheur, palier franchi avec prime et déblocages', () => {
  assert.equal(happinessXp(1000, 45), 0, 'pas de points de bonheur sous 45');
  assert.ok(happinessXp(1000, 60) > 0 && happinessXp(1000, 90) === happinessXp(1000, 75), 'plafond à 75');
  const s = newSim(); buildTown(s);
  runDays(s, 12);
  const st = paliers(s);
  assert.ok(st.xp >= st.population, `points ${st.xp} ≥ population ${st.population} (jamais plus lent qu'avant)`);
  assert.ok((st.xpBy.croissance ?? 0) > 0, 'points de croissance');
  assert.ok(st.reached.includes('hameau'));
  const n = s.notices.find((x) => /Palier atteint : Hameau/.test(x.message));
  assert.ok(n && /prime de/.test(n.message) && /Débloque :/.test(n.message), n?.message);
  assert.equal(st.locked, false, 'partie de test : mode libre par défaut');
  // Points accordés par un objectif : le palier suivant tombe dès qu'ils suffisent (prime unique).
  const before = s.economy.money;
  const need = MILESTONES[1]!.xp - svc(s).xp() + 1;
  assert.equal(svc(s).grant(need, 'objectifs'), need);
  assert.ok(paliers(s).reached.includes('village'));
  assert.equal(Math.round(s.economy.money - before), MILESTONES[1]!.reward);
  svc(s).grant(1, 'objectifs');
  assert.equal(Math.round(s.economy.money - before), MILESTONES[1]!.reward, 'pas de double prime');
});

test('paliers : capacité d’emprunt supplémentaire pour toutes les parties', () => {
  const s = newSim(); buildTown(s);
  assert.equal(s.economy.loanCapacity(), LOAN_BASE_CAPACITY);
  svc(s).grant(600, 'objectifs'); // hameau + village
  s.tick(1);
  assert.equal(s.economy.loanBonus, 300_000);
  assert.ok(s.economy.loanCapacity() >= LOAN_BASE_CAPACITY + 300_000);
});

test('déblocages progressifs : verrous d’une partie neuve, levés par les paliers ; refusés sur une ville déjà bâtie', () => {
  const s = newSim();
  assert.ok(cmd(s, 'paliers', 'mode', { verrous: true }).ok);
  buildTown(s);
  assert.equal(paliers(s).locked, true);
  assert.ok(paliers(s).locks?.assets['public_hopital'], 'hôpital verrouillé');
  const r = s.placeBuilding({ assetId: 'public_hopital', x: 0, z: -150, rot: 0 });
  assert.ok(!r.ok && /palier « Bourg »/.test(r.error.message), !r.ok ? r.error.message : 'posé');
  const z = cmd(s, 'zonage', 'paint', { points: [-200, 40, 200, 40], zone: 'bureaux', depth: 2 });
  assert.ok(!z.ok && /Village/.test(z.error!.message), 'zone de bureaux verrouillée');
  const p = cmd(s, 'politiques', 'toggle', { id: 'aide_logement', on: true });
  assert.ok(!p.ok && /Bourg/.test(p.error!.message), 'politique verrouillée');
  assert.ok(cmd(s, 'politiques', 'toggle', { id: 'restrictions_eau', on: true }).ok, 'politique libre dès le début');
  assert.equal(svc(s).busLineLock(2), null, '2 lignes au départ');
  assert.match(svc(s).busLineLock(3) ?? '', /Hameau/);
  assert.match(svc(s).levelLock(2) ?? '', /Village/);
  // La ville n'est plus vide : on ne peut plus réactiver les verrous après les avoir levés.
  assert.ok(cmd(s, 'paliers', 'mode', { verrous: false }).ok);
  assert.equal(cmd(s, 'paliers', 'mode', { verrous: true }).ok, false);
  assert.ok(s.placeBuilding({ assetId: 'public_hopital', x: 0, z: -150, rot: 0 }).ok, 'mode libre : tout est accessible');
  // Nouvelle partie verrouillée puis paliers franchis : déblocage.
  const t = newSim(77);
  assert.ok(cmd(t, 'paliers', 'mode', { verrous: true }).ok);
  buildTown(t);
  svc(t).grant(1500, 'objectifs');
  assert.ok(paliers(t).reached.includes('bourg'));
  assert.equal(paliers(t).locks?.assets['public_hopital'], undefined);
  assert.ok(t.placeBuilding({ assetId: 'public_hopital', x: 0, z: -150, rot: 0 }).ok, 'hôpital débloqué au palier Bourg');
  assert.ok(cmd(t, 'zonage', 'paint', { points: [-200, 40, 200, 40], zone: 'bureaux', depth: 2 }).ok);
  assert.equal(svc(t).busLineLock(6), null);
  // Les verrous survivent à la sauvegarde.
  const c = reload(t);
  assert.equal(paliers(c).locked, true);
  assert.deepEqual(paliers(c).reached, paliers(t).reached);
});

test('anciennes sauvegardes : rien n’est verrouillé, paliers v1 repris sans perte (points = record de population)', () => {
  const s = newSim(); buildTown(s); runDays(s, 12);
  const pop = s.demography!.population;
  // Section v1 (paliers par population) : pas de points, pas de verrous.
  const v1 = reload(s, (save) => { save.plugins.paliers = { v: 1, data: { reached: ['hameau'], at: { hameau: 100 } } }; });
  const st = paliers(v1);
  assert.equal(st.locked, false);
  assert.deepEqual(st.reached, ['hameau']);
  assert.ok(st.xp >= pop && (st.xpBy.reprise ?? 0) > 0, `points repris ${st.xp} ≥ ${pop}`);
  assert.equal(svc(v1).assetLock('public_hopital'), null);
  // Sans section du tout (avant les paliers) et sans les nouveaux modules : se charge, tout débloqué, événements au calme.
  const old = reload(s, (save) => { delete save.plugins.paliers; delete save.plugins.objectifs; delete save.plugins.evenements; });
  assert.equal(paliers(old).locked, false);
  assert.ok(paliers(old).reached.includes('hameau'));
  assert.ok(evenements(old).quietUntil >= old.clock.totalMinutes + (EVENTS_START_DAYS - 1) * 1440, 'aucun événement juste après le chargement');
  assert.ok(validateSave(JSON.parse(JSON.stringify(old.toSave()))).ok);
});

/* ------------------------------ Objectifs ------------------------------ */

test('objectifs : proposés selon la ville, accomplis -> argent et points d’expansion ; réalisations', () => {
  const s = newSim(); buildTown(s);
  runDays(s, 8);
  let o = objectifs(s);
  assert.ok(o.active.length >= 1 && o.active.length <= 3, `objectifs en cours : ${o.active.map((a) => a.title).join(' | ')}`);
  assert.ok(s.notices.some((n) => /^Nouvel objectif : /.test(n.message)));
  assert.ok(o.achievements.find((a) => a.id === 'premiers_habitants')?.done, 'réalisation « Premiers habitants »');
  // Rend le premier objectif atteignable tout de suite (cible déjà dépassée) : accompli après sa durée de tenue.
  const live = (s.plugins.plugins.find((p) => p.id === 'objectifs') as any).state();
  const a = live.active[0];
  a.target = a.higher ? -1e9 : 1e9;
  if (a.streakUnit === 'mois') { a.streakUnit = 'jours'; }
  a.need = 1;
  const money0 = s.economy.money, xp0 = paliers(s).xp;
  runDays(s, 1);
  o = objectifs(s);
  assert.ok(o.completedCount >= 1, `${o.completedCount} accompli(s)`);
  assert.ok(o.recent.some((r) => r.key === a.key));
  assert.ok(s.economy.money - money0 >= a.money * 0.99 - 50_000, 'récompense versée');
  assert.ok(paliers(s).xp >= xp0 + a.xp, 'points d’expansion ajoutés');
  assert.ok(s.notices.some((n) => n.message.startsWith(`Objectif accompli : ${a.title}`)));
  // Remplacement : une fois par semaine.
  const k = objectifs(s).active[0]?.key;
  if (k) {
    assert.ok(cmd(s, 'objectifs', 'remplacer', { key: k }).ok);
    const k2 = objectifs(s).active[0]?.key;
    if (k2) assert.equal(cmd(s, 'objectifs', 'remplacer', { key: k2 }).ok, false, 'une fois par semaine');
  }
});

/* ------------------------------ Événements ------------------------------ */

test('événements : préavis, effets bornés, fin et issue ; réglage désactivé ; pas avant 45 jours', () => {
  const s = newSim(); buildTown(s);
  runDays(s, 2);
  assert.equal(evenements(s).current, null);
  assert.ok(evenements(s).quietUntil >= (EVENTS_START_DAYS - 1) * 1440 + s.gameStartMinute(), 'calme au début');
  const r = cmd(s, 'evenements', 'declencher', { kind: 'canicule' });
  assert.ok(r.ok);
  let ev = evenements(s).current!;
  assert.equal(ev.phase, 'annonce');
  assert.ok(ev.startsAt > s.clock.totalMinutes + 1440, 'préavis d’au moins un jour');
  assert.ok(s.notices.some((n) => /^Événement annoncé — Canicule/.test(n.message)));
  s.tick(1);
  assert.equal(s.govMods.powerDemandFactor, 1, 'aucun effet pendant l’annonce');
  runDays(s, 3);
  ev = evenements(s).current!;
  if (ev) {
    assert.equal(ev.phase, 'actif');
    s.tick(1);
    assert.equal(s.govMods.waterDemandFactor, 1.25);
    assert.equal(s.govMods.fireRiskFactor, 2);
  }
  runDays(s, 5);
  assert.equal(evenements(s).current, null, 'événement terminé');
  assert.equal(evenements(s).history.length, 1);
  assert.ok(s.notices.some((n) => /^Événement terminé — Canicule/.test(n.message)));
  s.tick(1);
  assert.equal(s.govMods.waterDemandFactor, 1, 'effet levé');
  assert.ok(objectifs(s).achievements.find((a) => a.id === 'crise_surmontee')?.done, 'réalisation « Crise surmontée »');
  // Désactivés : l'événement annoncé est annulé, aucun nouveau.
  assert.ok(cmd(s, 'evenements', 'declencher', { kind: 'epidemie' }).ok);
  assert.ok(cmd(s, 'evenements', 'reglage', { frequence: 'off' }).ok);
  assert.equal(evenements(s).current, null);
  assert.equal(evenements(s).setting, 'off');
  assert.equal(cmd(s, 'evenements', 'reglage', { frequence: 'parfois' }).ok, false);
});

test('événements : flux aléatoire séparé (une annonce ne touche pas au PRNG de la partie) et reprise identique', () => {
  const a = newSim(); buildTown(a);
  const b = newSim(); buildTown(b);
  runDays(a, 1); runDays(b, 1);
  assert.ok(cmd(a, 'evenements', 'declencher', { kind: 'greve_eboueurs' }).ok);
  runDays(a, 1); runDays(b, 1);
  assert.deepEqual(a.rng.getState(), b.rng.getState(), 'PRNG de la partie inchangé pendant le préavis');
  assert.equal(a.demography!.population, b.demography!.population);
  // Aller-retour : même suite (événement, objectifs, paliers).
  const c = reload(a);
  runDays(a, 6, 10); runDays(c, 6, 10);
  assert.deepEqual(c.toSave().plugins?.evenements, a.toSave().plugins?.evenements);
  assert.deepEqual(c.toSave().plugins?.objectifs, a.toSave().plugins?.objectifs);
  assert.deepEqual(c.toSave().plugins?.paliers, a.toSave().plugins?.paliers);
  assert.equal(c.economy.money, a.economy.money);
});

/* ------------------------------ Trafic ------------------------------ */

test('trafic : les trajets détaillés ne dépassent plus le nombre de voitures visé à l’heure de pointe', () => {
  const s = newSim(); buildTown(s);
  runDays(s, 3, 10);
  // Toute la ville est détaillée (point focal au centre) : pointe du matin à la minute.
  let over = 0, max = 0;
  while (Math.floor(s.clock.hourOfDay) !== 6) s.tick(10);
  for (let i = 0; i < 180; i++) {
    s.tick(1);
    const ceiling = s.traffic.demandCeiling(s.clock.hourOfDay);
    max = Math.max(max, s.traffic.actCount);
    if (s.traffic.actCount > ceiling + 8) over++;
  }
  assert.equal(over, 0, `véhicules au-delà du plafond (max ${max})`);
  assert.ok(max > 0, 'des véhicules circulent');
});
