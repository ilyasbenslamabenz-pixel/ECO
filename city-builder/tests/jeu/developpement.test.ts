/** Arbres de développement : points gagnés aux paliers, déblocage, refus, effets, verrous levés, sauvegarde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';
import { DEV_NODES, DEV_DOMAINS, devFactors, devPointsEarned, devPointsSpent, type DevelopmentState } from '../../src/shared/development';
import { migrateDeveloppement } from '../../src/sim/plugins/developpement';
import { Service } from '../../src/sim/demography';
import { PALIERS_SERVICE, type PaliersService } from '../../src/shared/milestones';

type R = { ok: boolean; data?: DevelopmentState; message?: string };
const cmd = (s: Simulation, name: string, payload?: unknown): R => {
  const r = s.plugins.command('developpement', name, payload) as { ok: boolean; data?: { data?: DevelopmentState }; error?: { message: string } };
  return { ok: r.ok, data: r.data?.data, message: r.error?.message };
};
const state = (s: Simulation): DevelopmentState => cmd(s, 'state').data!;
const paliers = (s: Simulation): PaliersService => s.plugins.service<PaliersService>(PALIERS_SERVICE)!;

test('développement : définitions cohérentes (6 domaines, prérequis du même domaine, points par palier)', () => {
  assert.deepEqual([...DEV_DOMAINS], ['electricite', 'eau', 'transports', 'sante', 'education', 'police']);
  const ids = new Set(DEV_NODES.map((n) => n.id));
  assert.equal(ids.size, DEV_NODES.length, 'identifiants uniques');
  for (const n of DEV_NODES) {
    assert.ok(n.cost > 0);
    for (const q of n.requires) { assert.ok(ids.has(q), `${n.id} → ${q}`); assert.equal(DEV_NODES.find((x) => x.id === q)!.domain, n.domain); }
  }
  for (const d of DEV_DOMAINS) assert.ok(DEV_NODES.filter((n) => n.domain === d).length >= 3, d);
  assert.equal(devPointsEarned(0), 0);
  assert.equal(devPointsEarned(1), 1);
  assert.equal(devPointsEarned(3), 5);
  assert.ok(devPointsEarned(99) < devPointsSpent(DEV_NODES.map((n) => n.id)), 'il faut choisir : tout ne se débloque pas');
  const f = devFactors(['police_proximite', 'police_patrouilles', 'police_effectifs', 'police_prevention', 'edu_pedagogie']);
  assert.ok(Math.abs(f.crimeFactor - 0.9 * 0.85) < 1e-12);
  assert.equal(f.radius.police, 1.15);
  assert.equal(f.capacity.police, 1.2);
  assert.equal(f.educationFactor, 1.15);
  assert.deepEqual(migrateDeveloppement({ unlocked: ['elec_reseau', 'inconnu', 'elec_reseau', 3] }, 1), { unlocked: ['elec_reseau'] });
});

test('développement : points au premier palier, déblocage, refus (inconnu, prérequis, points), effets appliqués, sauvegarde', () => {
  const s = newTownSim(); buildTown(s);
  const empty = s.toSave() as { plugins?: Record<string, unknown> };
  assert.equal(empty.plugins?.['developpement'], undefined, 'aucune section sans activité');
  runDays(s, 12);
  assert.ok(paliers(s).reachedCount() >= 1, 'hameau atteint');
  let st = state(s);
  assert.equal(st.earned, devPointsEarned(paliers(s).reachedCount()));
  assert.equal(st.available, st.earned);
  assert.equal(cmd(s, 'unlock', { id: 'nimporte' }).ok, false);
  const pre = cmd(s, 'unlock', { id: 'police_prevention' });
  assert.equal(pre.ok, false); assert.match(pre.message!, /Il faut d'abord/);
  assert.equal(s.govMods.powerDemandFactor, 1);
  const r = cmd(s, 'unlock', { id: 'elec_reseau' });
  assert.ok(r.ok, r.message);
  assert.equal(cmd(s, 'unlock', { id: 'elec_reseau' }).ok, false, 'déjà débloqué');
  st = state(s);
  assert.equal(st.spent, 1);
  assert.ok(st.nodes.find((n) => n.id === 'elec_reseau')!.unlocked);
  assert.ok(st.nodes.find((n) => n.id === 'elec_renouvelable')!.available);
  s.tick(2);
  assert.equal(s.govMods.powerDemandFactor, 0.95, 'modificateur combiné avec la gouvernance');
  // Points insuffisants : on dépense tout ce qui reste puis on tente un nœud de plus.
  while (state(s).available >= 1) {
    const n = state(s).nodes.find((x) => x.affordable);
    if (!n) break;
    assert.ok(cmd(s, 'unlock', { id: n.id }).ok);
  }
  const left = state(s).nodes.find((x) => x.available && !x.affordable);
  if (left) { const k = cmd(s, 'unlock', { id: left.id }); assert.equal(k.ok, false); assert.match(k.message!, /insuffisants/); }
  // Sauvegarde : nœuds conservés, points recalculés depuis les paliers.
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.ok(Array.isArray(save.plugins.developpement.data.unlocked));
  const c = new Simulation(); c.setCatalog(townCatalog());
  assert.equal(c.fromSave(save), null);
  assert.deepEqual(state(c).nodes.filter((n) => n.unlocked).map((n) => n.id), state(s).nodes.filter((n) => n.unlocked).map((n) => n.id));
  assert.equal(state(c).available, state(s).available);
  // Ancienne sauvegarde (sans section) : rien de débloqué, les points des paliers déjà franchis sont disponibles.
  delete save.plugins.developpement;
  const o = new Simulation(); o.setCatalog(townCatalog());
  assert.equal(o.fromSave(save), null);
  assert.equal(state(o).spent, 0);
  assert.equal(state(o).available, state(s).earned);
});

test('développement : effets sur les équipements (rayon, capacité), la criminalité, l’éducation ; bâtiment débloqué avant son palier', () => {
  const s = newTownSim();
  // Déblocages progressifs : seulement sur une ville vide.
  assert.ok((s.plugins.command('paliers', 'mode', { verrous: true }) as { ok: boolean }).ok);
  buildTown(s);
  assert.match(paliers(s).assetLock('public_hopital') ?? '', /Bourg/);
  // Points d'expansion accordés (objectifs) : paliers franchis jusqu'à la Grande ville.
  paliers(s).grant(12_000, 'objectifs');
  assert.ok(paliers(s).reachedCount() >= 6);
  assert.equal(paliers(s).assetLock('public_hopital'), null, 'hôpital débloqué par le palier Bourg');
  assert.match(paliers(s).assetLock('tour_iconique_couronne') ?? 'x', /./);
  for (const id of ['sante_prevention', 'sante_capacite', 'sante_ambulances', 'police_proximite', 'police_patrouilles', 'edu_pedagogie']) assert.ok(cmd(s, 'unlock', { id }).ok, id);
  s.tick(2);
  const d = s.demography!;
  assert.equal(d.devCapacity[Service.Health], 1.2);
  assert.equal(d.devRadius[Service.Health], 1.15);
  assert.equal(d.devRadius[Service.Police], 1.15);
  assert.equal(d.devCapacity[Service.Education], 1);
  assert.equal(d.educationFactor, 1.15);
  assert.equal(d.services.devCrimeFactor, 0.9);
  // Bâtiment spécial : la gare (palier Petite ville) avec l'arbre Transports — partie neuve encore sous ce palier.
  const t = newTownSim();
  assert.ok((t.plugins.command('paliers', 'mode', { verrous: true }) as { ok: boolean }).ok);
  buildTown(t);
  paliers(t).grant(1_600, 'objectifs'); // Hameau, Village, Bourg : 5 points
  assert.equal(paliers(t).reachedCount(), 3);
  assert.match(paliers(t).assetLock('public_gare') ?? '', /Petite ville/);
  assert.ok(cmd(t, 'unlock', { id: 'trans_entretien' }).ok);
  assert.equal(cmd(t, 'unlock', { id: 'trans_gare' }).ok, false, 'prérequis');
  assert.ok(cmd(t, 'unlock', { id: 'trans_logistique' }).ok);
  assert.equal(cmd(t, 'unlock', { id: 'trans_gare' }).ok, false, '3 points requis, 2 disponibles');
  paliers(t).grant(1_500, 'objectifs'); // Petite ville : +3 points (et la gare débloquée par le palier)
  assert.ok(cmd(t, 'unlock', { id: 'trans_gare' }).ok);
  assert.equal(paliers(t).assetLock('public_gare'), null);
  // Barrage (palier Ville) débloqué par l'arbre Eau avant d'atteindre ce palier.
  const u = newTownSim();
  assert.ok((u.plugins.command('paliers', 'mode', { verrous: true }) as { ok: boolean }).ok);
  buildTown(u);
  paliers(u).grant(3_100, 'objectifs'); // 4 paliers : 8 points
  assert.match(paliers(u).assetLock('elec_barrage') ?? '', /Ville/);
  for (const id of ['eau_compteurs', 'eau_fuites', 'eau_barrage']) assert.ok(cmd(u, 'unlock', { id }).ok, id);
  assert.equal(paliers(u).assetLock('elec_barrage'), null, 'barrage débloqué par l’arbre');
  const locks = (u.plugins.command('paliers', 'state', undefined) as { data: { data: { locks: { assets: Record<string, string> } } } }).data.data.locks;
  assert.equal(locks.assets['elec_barrage'], undefined, 'cadenas retiré de l’interface');
  assert.ok(locks.assets['public_hotel_de_ville'], 'les autres verrous restent');
});
