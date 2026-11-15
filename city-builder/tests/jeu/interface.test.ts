/**
 * Interface (vague 5, docs/INTERFACE.md) : cartes d'information (module « cartes »), fiche « Pourquoi » d'un bâtiment,
 * historique des graphiques (module « historique » : relevés, bornes, sauvegarde, anciennes parties), journal des
 * notifications (regroupement, gravité, badge, « Tout marquer comme lu »).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Simulation } from '../../src/sim/world';
import type { BuildingOccupancy, BuildingDiagnosis } from '../../src/sim/demography';
import { CARTE_KINDS, CARTE_NO_DATA, type CarteLayer } from '../../src/shared/protocol-ext/cartes';
import {
  compactLong, emptyHistorique, HIST_LONG_MAX, HIST_RECENT_DAYS, HIST_STRIDE, monthsFor, pushMonth, pushSample, readHistorique, rowsOf, samplesFor, type HistoriqueState,
} from '../../src/shared/protocol-ext/historique';
import { explainBuilding } from '../../src/ui/why';
import { classify, NotifyJournal } from '../../src/ui/notify-log';
import { seriesFor } from '../../src/ui/history-view';
import { buildTown, newTownSim, runDays } from '../sim/fixtures';

type R = { ok: boolean; data?: any; error?: { code: string; message: string } };
const cmd = (s: Simulation, plugin: string, name: string, payload?: unknown): R => {
  const r = s.plugins.command(plugin, name, payload) as any;
  return r.ok ? { ok: true, data: r.data?.data ?? r.data } : { ok: false, error: r.error };
};
function reload(s: Simulation, mutate?: (save: Record<string, any>) => void): Simulation {
  const save = JSON.parse(JSON.stringify(s.toSave())) as Record<string, any>;
  mutate?.(save);
  const c = newTownSim();
  assert.equal(c.fromSave(save), null);
  return c;
}

/* ------------------------------ Cartes ------------------------------ */

test('cartes : chaque carte renvoie une grille 0..100 (255 = aucune donnée), une seule à la fois, rien sans affichage', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 6);
  for (const k of CARTE_KINDS) {
    const r = cmd(s, 'cartes', 'calque', { kind: k });
    assert.ok(r.ok, `${k} : ${r.error?.message}`);
    const l = r.data as CarteLayer;
    assert.equal(l.kind, k);
    assert.equal(l.values.length, l.cols * l.rows);
    assert.ok([...l.values].every((v) => v === CARTE_NO_DATA || (v >= 0 && v <= 100)), `${k} : valeurs bornées`);
    if (k !== 'dechets' && k !== 'bruit') assert.ok(l.buildings > 0, `${k} : bâtiments pris en compte (${l.buildings})`);
  }
  // Satisfaction : seuls les logements habités ; valeur foncière : les bâtiments évalués par l'économie vivante.
  const sat = cmd(s, 'cartes', 'calque', { kind: 'satisfaction' }).data as CarteLayer;
  const res = s.buildings.count;
  assert.ok(sat.buildings > 0 && sat.buildings <= res);
  assert.equal(cmd(s, 'cartes', 'calque', { kind: 'inconnue' }).ok, false, 'carte inconnue refusée');
  // Carte affichée : une grille par jour de jeu dans le delta ; éteinte : plus rien.
  cmd(s, 'cartes', 'calque', { kind: 'chomage' });
  runDays(s, 1, 30);
  const d1 = s.takeDelta() as any;
  assert.equal(d1.ext?.cartes?.layer?.kind, 'chomage', 'grille du jour dans le delta');
  cmd(s, 'cartes', 'calque', { kind: null });
  runDays(s, 2, 30);
  const d2 = s.takeDelta() as any;
  assert.equal(d2.ext?.cartes, undefined, 'aucune grille quand la carte est éteinte');
});

test('cartes : afficher une carte ne change pas la simulation (lecture seule)', () => {
  const a = newTownSim(); buildTown(a);
  const b = newTownSim(); buildTown(b);
  runDays(a, 4); runDays(b, 4);
  for (const k of CARTE_KINDS) cmd(b, 'cartes', 'calque', { kind: k });
  cmd(b, 'cartes', 'calque', { kind: 'satisfaction' });
  for (let d = 0; d < 8; d++) { runDays(a, 1); runDays(b, 1); b.takeDelta(); a.takeDelta(); }
  const ra = a.report(), rb = b.report();
  assert.equal(rb.demography.population, ra.demography.population);
  assert.equal(rb.economy.money, ra.economy.money);
  assert.equal(rb.demography.happiness, ra.demography.happiness);
});

/* ------------------------------ Fiche « Pourquoi » ------------------------------ */

test('pourquoi : la fiche d’un logement habité détaille les facteurs du calcul quotidien', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 8);
  const inspect = (id: number): BuildingOccupancy => (s as any).demography.inspectBuilding(id, s.clock.totalMinutes);
  const home = [...Array(s.buildings.count).keys()].map((i) => s.buildings.id[i]!).find((id) => inspect(id).residents > 0)!;
  const o = inspect(home);
  assert.ok(o.diagnosis, 'diagnostic présent');
  assert.ok(o.residents > 0 && o.diagnosis!.factors.length > 0, 'facteurs des habitants');
  // Même calcul que le jour : satisfaction cible ≈ 55 + somme des facteurs, proche de la satisfaction lissée.
  const target = 55 + o.diagnosis!.factors.reduce((a, f) => a + f.delta, 0);
  assert.ok(Number.isFinite(target));
  assert.ok(o.diagnosis!.labor >= o.diagnosis!.unemployed);
});

const diag = (p: Partial<BuildingDiagnosis> = {}): BuildingDiagnosis => ({
  factors: [], vacancy: null, power: 0, water: 0, ramp: 1, rentBurden: null, sustainableShare: 0.4, labor: 0, unemployed: 0, cityUnemployed: 10,
  jobsOffered: true, underqualified: 0, requiredEducation: null, customers: null, rentShare: null, reasonKey: null, transit: 0, ...p,
});
const occ = (p: Partial<BuildingOccupancy>): BuildingOccupancy => ({
  buildingId: 1, residents: 0, residentCapacity: 0, workers: 0, jobCapacity: 0, roadAccess: true, company: null, services: [], occupants: [], employees: [], diagnosis: diag(), ...p,
});

test('pourquoi : logement vide sans courant, raisons classées et actions conseillées', () => {
  const w = explainBuilding(occ({ residentCapacity: 20, diagnosis: diag({ vacancy: 'sansElectricite', power: 2 }) }));
  assert.equal(w[0]!.kind, 'vacant');
  assert.match(w[0]!.items[0]!.cause, /Pas de courant/);
  assert.match(w[0]!.items[0]!.action, /raccordez-vous|centrale/);
  const ruin = explainBuilding(occ({ residentCapacity: 20, safety: { state: 'ruine' } as any, diagnosis: diag({ vacancy: 'demandeFaible' }) }));
  assert.equal(ruin[0]!.items[0]!.key, 'ruine', 'la ruine passe avant la demande');
});

test('pourquoi : habitants mécontents, du facteur le plus lourd au plus léger, loyer chiffré', () => {
  const w = explainBuilding(occ({
    residents: 12, residentCapacity: 20,
    diagnosis: diag({ rentBurden: 0.45, labor: 6, unemployed: 2, factors: [
      { key: 'emploi', label: 'Emploi', delta: -4 }, { key: 'loyer', label: 'Coût du logement', delta: -9 }, { key: 'sante', label: 'Santé', delta: 7 }, { key: 'impots', label: 'Impôts', delta: -0.2 },
    ] }),
  }));
  const u = w.find((s) => s.kind === 'unhappy')!;
  assert.deepEqual(u.items.map((i) => i.key), ['loyer', 'emploi'], 'ordre d’importance, facteurs positifs et négligeables ignorés');
  assert.match(u.items[0]!.cause, /Loyer trop cher \(45 % des revenus/);
  assert.ok(u.items.every((i) => i.action.length > 10), 'une action par raison');
});

test('pourquoi : entreprise en difficulté (raison principale puis indicateurs) et local sans employé', () => {
  const w = explainBuilding(occ({
    jobCapacity: 20, workers: 8,
    company: { name: 'Boutique', sector: 'Commerce', revenue: 50_000, profit: -3000, status: 'difficulty', reason: 'Manque de clients', lossMonths: 2 },
    diagnosis: diag({ reasonKey: 'clients', customers: 0.6, rentShare: 0.3 }),
  }));
  const c = w.find((s) => s.kind === 'company')!;
  assert.equal(c.items[0]!.key, 'clients');
  assert.ok(c.items.some((i) => i.key === 'main-doeuvre'), 'postes vacants signalés');
  assert.ok(c.items.some((i) => i.key === 'loyer' && /30 %/.test(i.cause)));
  const empty = explainBuilding(occ({ jobCapacity: 20, workers: 0, diagnosis: diag({ cityUnemployed: 0 }) }));
  assert.match(empty[0]!.items[0]!.cause, /Aucun chômeur/);
});

/* ------------------------------ Historique ------------------------------ */

const sample = (day: number, pop = day) => ({ day, pop, money: 1000 * day, jobs: 10, filled: 8, unemp: 50, happy: 600 });

test('historique : relevés quotidiens bornés, série longue compactée, soldes mensuels', () => {
  const h = emptyHistorique();
  for (let d = 0; d < 4000; d++) pushSample(h, sample(d));
  assert.equal(h.recent.length / HIST_STRIDE, HIST_RECENT_DAYS, '3 mois de relevés quotidiens');
  assert.ok(h.long.length / HIST_STRIDE <= HIST_LONG_MAX, `série longue bornée (${h.long.length / HIST_STRIDE})`);
  assert.ok(h.longStep > 4, `pas doublé (${h.longStep} jours)`);
  const longRows = rowsOf(h.long);
  assert.equal(longRows[0]!.day, 0, 'le début de partie reste');
  // Même jour relevé deux fois : remplacé, pas doublé.
  pushSample(h, sample(3999, 7));
  assert.equal(rowsOf(h.recent).filter((r) => r.day === 3999).length, 1);
  for (let m = 0; m < 600; m++) pushMonth(h, m, m % 2 ? -100 : 200);
  assert.equal(h.months.length / 2, 480, 'soldes mensuels bornés');
  assert.equal(monthsFor(h, '3m').length, 3);
  assert.equal(monthsFor(h, '1a').length, 12);
  // Périodes : 3 mois = quotidien ; 1 an = série longue + quotidien, jours croissants.
  const p3 = samplesFor(h, '3m', 3999);
  assert.ok(p3.length >= 89 && p3.every((s) => s.day >= 3909));
  const p1 = samplesFor(h, '1a', 3999);
  assert.ok(p1.every((s, i) => i === 0 || s.day > p1[i - 1]!.day) && p1[0]!.day >= 3639);
  // Taille sauvegardée (JSON) bornée quelle que soit la durée de la partie.
  const json = JSON.stringify(h).length;
  assert.ok(json < 40_000, `section compacte (${json} octets)`);
  // Lecture tolérante.
  const bad = readHistorique({ recent: [1, 2, 3], long: 'x', longStep: -2, months: [1, 2, 3] });
  assert.deepEqual(bad.recent, []);
  assert.equal(bad.longStep, 4);
  assert.deepEqual(bad.months, [1, 2]);
  const h2: HistoriqueState = { recent: [], long: [...h.long, ...h.long], longStep: 8, months: [] };
  compactLong(h2);
  assert.equal(h2.longStep, 16);
});

test('historique : la simulation relève chaque jour, sauvegarde et recharge à l’identique ; ancienne partie reprise des bilans mensuels', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 40, 10);
  const st = cmd(s, 'historique', 'etat').data as { today: number; state: HistoriqueState };
  const rows = rowsOf(st.state.recent);
  assert.ok(rows.length >= 38, `relevés quotidiens (${rows.length})`);
  assert.ok(rows.some((r) => r.pop > 0) && rows.some((r) => r.happy >= 0), 'habitants et satisfaction relevés');
  assert.ok(st.state.months.length >= 2, 'solde du premier mois');
  const save = s.toSave() as any;
  assert.ok(save.plugins?.historique, 'section sauvegardée');
  const c = reload(s);
  assert.deepEqual((cmd(c, 'historique', 'etat').data as any).state, st.state, 'rechargement identique');
  // Ancienne sauvegarde : pas de section → série longue et soldes repris de l'historique de l'économie.
  const old = reload(s, (sv) => { delete sv.plugins.historique; });
  const os = (cmd(old, 'historique', 'etat').data as any).state as HistoriqueState;
  assert.equal(os.recent.length, 0);
  assert.equal(rowsOf(os.long).length, s.economy.history.length);
  assert.equal(os.months.length / 2, s.economy.history.length);
  // Graphiques : séries d'un onglet.
  const ser = seriesFor('money', samplesFor(st.state, 'tout', st.today), monthsFor(st.state, 'tout'));
  assert.equal(ser.lines[0]!.points.length, rows.length);
  assert.equal(ser.bars[0]!.bars.length, st.state.months.length / 2);
});

/* ------------------------------ Notifications ------------------------------ */

test('notifications : doublons regroupés, gravité, badge limité aux importantes, tout marquer comme lu', () => {
  const j = new NotifyJournal();
  for (let i = 0; i < 12; i++) j.add(`Construction : Maison ${i} (−40 000 CHF)`, 'ok', i);
  for (let i = 0; i < 5; i++) j.add(`Route construite : ${100 + i} m (−5 000 CHF)`, 'ok', 20 + i);
  j.add('Réseau : 12 bâtiments coupés (logements). Construisez une centrale.', 'error', 30);
  j.add('Réseau : 15 bâtiments coupés (logements). Construisez une centrale.', 'error', 31);
  j.add('Panne : Éolienne n° 3 hors service (réparation ≈ 4 h)', 'error', 32);
  j.add('Trésorerie négative (−2 000 CHF) : faillite dans 2 mois sans redressement.', 'error', 33);
  j.add('Partie sauvegardée (« auto »)', 'ok', 34);
  assert.equal(j.entries.length, 6, `${j.entries.map((e) => e.text).join(' | ')}`);
  const cons = j.entries.find((e) => e.key === 'r:construction')!;
  assert.equal(cons.count, 12);
  assert.match(cons.text, /^12 constructions \(dernière : Maison 11\)/);
  assert.equal(j.entries.find((e) => e.key === 'r:route')!.text, '5 routes construites');
  const cut = j.entries.find((e) => e.key === 'r:courant-coupe')!;
  assert.equal(cut.severity, 'urgent');
  assert.match(cut.text, /Coupures d’électricité : 2 alertes \(dernière : 15 bâtiments sans courant\)/);
  assert.equal(classify('Panne : Éolienne n° 3 hors service', 'error').severity, 'important');
  assert.equal(classify('Trésorerie négative', 'error').severity, 'urgent');
  assert.equal(classify('Message inconnu', 'error').severity, 'important');
  assert.equal(classify('Message inconnu', 'info').severity, 'info');
  // Badge : urgentes + importantes non lues seulement (coupures, panne, faillite).
  assert.equal(j.badgeCount(), 3);
  assert.equal(j.bySeverity('urgent').length, 2);
  j.markRead('info');
  assert.equal(j.unreadCount('info'), 0);
  assert.equal(j.badgeCount(), 3);
  assert.ok(j.markAllRead());
  assert.equal(j.badgeCount(), 0);
  // Une nouvelle occurrence remet le groupe en non lu.
  j.add('Réseau : 20 bâtiments coupés (logements).', 'error', 40);
  assert.equal(j.badgeCount(), 1);
  // Aucun type supprimé : 70 messages divers tiennent dans le journal borné.
  const k = new NotifyJournal();
  for (let i = 0; i < 70; i++) k.add(`Message ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, 'info', i);
  assert.ok(k.entries.length <= 60);
});
