/**
 * Objectifs en quatre paliers : structure (ordre, identifiants des anciennes versions), objectifs actifs et paliers
 * verrouillés, récompenses des paliers franchis, objectif final, notifications, conditions (prix alignés, propreté,
 * rachat, part de marché), valeur nette (entrepôt, marchandise), sauvegardes anciennes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECONOMY, FURNITURE_BY_ID, LOGISTICS, PRODUCT_BY_ID, productsOf } from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { canPlace } from '../src/sim/layout';
import { Game, SAVE_VERSION } from '../src/sim/game';
import { buyRacks, placeImport, rentWarehouse, warehousePremises } from '../src/sim/logistics';
import {
  LEGEND_ID, OBJECTIVES, OBJECTIVE_BY_ID, TIERS, activeObjectives, bestMarketShare, currentTier, isUnlocked, netWorth, rankOf,
  tierComplete, tierObjectives, victoryScore,
} from '../src/sim/objectives';

const DAY = 1440;
const keepAlive = (g: Game): void => { g.player.energy = 100; g.player.hunger = 100; };
const ids = (tier: string): string[] => OBJECTIVES.filter((o) => o.tier === tier).map((o) => o.id);
const before = (id: string): string[] => OBJECTIVES.slice(0, OBJECTIVES.findIndex((o) => o.id === id)).map((o) => o.id);
const goTo = (g: Game, kind: Parameters<typeof serviceBuilding>[1]): void => { const b = serviceBuilding(g.district, kind)!; g.setPlace({ kind: 'service', service: kind, buildingId: b.id }); };

/** Épicerie aménagée, approvisionnée et tenue par un employé sur le meilleur local libre. */
function epicerie(g: Game): number {
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  const r = g.rent(p.id, 'epicerie');
  if (!r.ok) throw new Error(r.message);
  const id = r.data.id, s = g.shop(id)!;
  goTo(g, 'meubles');
  for (const f of ['caisse', 'rayon', 'rayon', 'frigo']) {
    assert.ok(g.buyFurniture(f, 1, id).ok);
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(s.items, p.gridW, p.gridD, FURNITURE_BY_ID.get(f)!, x, z, 0)) continue;
      done = g.place(id, f, x, z, 0).ok;
    }
  }
  for (const pr of productsOf('epicerie')) { g.order(id, pr.id, g.room(s, pr.id)); g.setAuto(id, pr.id, true); }
  goTo(g, 'emploi');
  assert.ok(g.hire(g.candidates[0]!.id, id).ok);
  return id;
}

test('quatre paliers dans l’ordre, une trentaine d’objectifs, identifiants des anciennes versions conservés', () => {
  assert.deepEqual(TIERS.map((t) => t.name), ['Démarrage', 'Gérant', 'Entrepreneur', 'Magnat']);
  assert.ok(OBJECTIVES.length >= 28 && OBJECTIVES.length <= 36, `${OBJECTIVES.length} objectifs`);
  assert.equal(new Set(OBJECTIVES.map((o) => o.id)).size, OBJECTIVES.length, 'identifiants uniques');
  // Objectifs groupés par palier, dans l'ordre des paliers ; la légende en dernier.
  const order = OBJECTIVES.map((o) => TIERS.findIndex((t) => t.id === o.tier));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(OBJECTIVES.at(-1)!.id, LEGEND_ID);
  for (const t of TIERS) assert.ok(tierObjectives(t.id).length >= 7, `palier ${t.name}`);
  for (const id of ['sortir', 'louer', 'meubler', 'stock', 'servir10', 'embaucher', 'jour500', 'vehicule', 'pub', 'deux', 'trois', 'gamme', 'valeur100k']) assert.ok(OBJECTIVE_BY_ID.has(id), `ancien objectif ${id}`);
  // Démarrage : les objectifs d'avant jusqu'à « jour500 », puis pub, deux, trois et le véhicule (un scooter suffit).
  assert.deepEqual(ids('demarrage'), ['sortir', 'louer', 'meubler', 'stock', 'servir10', 'embaucher', 'jour500', 'pub', 'deux', 'trois', 'vehicule']);
  assert.match(OBJECTIVE_BY_ID.get('vehicule')!.hint, /scooter suffit/);
  assert.equal(OBJECTIVE_BY_ID.get('valeur100k')!.title, 'Atteindre 80 000 CHF de valeur nette');
  assert.equal(OBJECTIVE_BY_ID.get('valeur100k')!.tier, 'entrepreneur');
  assert.equal(OBJECTIVE_BY_ID.get('gamme')!.tier, 'entrepreneur');
  assert.equal(OBJECTIVE_BY_ID.get('former')!.tier, 'gerant', 'former un employé : objectif à part');
});

test('trois objectifs actifs ; paliers suivants verrouillés (la mise de départ ne vaut pas 40 000 CHF de valeur nette)', () => {
  const g = new Game(7);
  assert.ok(netWorth(g) >= 40_000, 'la mise de départ vaut déjà 40 000 CHF');
  assert.deepEqual(activeObjectives(g).map((o) => o.id), ['sortir', 'louer', 'meubler']);
  assert.equal(currentTier(g)!.id, 'demarrage');
  assert.ok(!isUnlocked(g, OBJECTIVE_BY_ID.get('vn40k')!));
  g.setPlace({ kind: 'rue' });
  g.checkObjectives();
  assert.deepEqual(g.achieved, ['sortir'], 'seul l’objectif ouvert et rempli est validé');
  // Démarrage presque fini : les premiers objectifs du palier Gérant complètent les trois objectifs actifs.
  g.achieved = before('vehicule');
  assert.deepEqual(activeObjectives(g).map((o) => o.id), ['vehicule', 'prix', 'proprete']);
  assert.ok(isUnlocked(g, OBJECTIVE_BY_ID.get('proprete')!) && !isUnlocked(g, OBJECTIVE_BY_ID.get('former')!));
  // Palier Gérant ouvert : tous ses objectifs se valident, dans n'importe quel ordre ; le palier suivant reste fermé.
  g.achieved = ids('demarrage');
  assert.equal(currentTier(g)!.id, 'gerant');
  assert.equal(rankOf(g), 'Gérant');
  g.checkObjectives();
  assert.ok(g.achieved.includes('vn40k'), 'valeur nette de 40 000 CHF validée une fois le palier ouvert');
  assert.ok(!g.achieved.includes('valeur100k') && !g.achieved.includes('types4'));
});

test('paliers franchis : recrue d’exception (gardée 7 jours), réputation, prime ; notifications regroupées', () => {
  const g = new Game(7);
  g.setPlace({ kind: 'rue' });
  const id = epicerie(g);
  keepAlive(g); g.advance(10 * 60);
  g.achieved = before('vehicule');
  g.notices = [];
  goTo(g, 'garage');
  assert.ok(g.buyVehicle('scooter').ok);
  g.checkObjectives();
  assert.ok(tierComplete(g, 'demarrage'));
  const fresh = g.notices.map((x) => x.text);
  assert.ok(fresh.some((t) => t === 'Objectif atteint : Acheter un véhicule !'), fresh.join(' | '));
  assert.ok(fresh.some((t) => t.startsWith('Palier franchi : Démarrage !') && t.includes('recrue d’exception')), fresh.join(' | '));
  const star = g.candidates[0]!;
  assert.equal(star.skill, 0.95);
  assert.equal(star.until, g.day + 7);
  // Renouvellement des candidats du lundi : la recrue reste jusqu'à sa date.
  for (let d = 0; d < 6; d++) { keepAlive(g); g.advance(DAY); }
  assert.ok(g.candidates.some((c) => c.id === star.id), 'recrue encore à l’agence');
  for (let d = 0; d < 3; d++) { keepAlive(g); g.advance(DAY); }
  assert.ok(!g.candidates.some((c) => c.id === star.id), 'recrue partie après 7 jours');
  // Gérant : +10 points de réputation ; plusieurs objectifs dans la même vérification : une seule notification.
  const s = g.shop(id)!;
  s.reputation = 0.5;
  g.achieved = before('vn40k');
  g.cash += 50_000;
  g.notices = [];
  g.checkObjectives();
  assert.ok(tierComplete(g, 'gerant'));
  assert.ok(Math.abs(s.reputation - 0.6) < 1e-9, `réputation ${s.reputation}`);
  const msgs = g.notices.map((x) => x.text);
  assert.equal(msgs.filter((t) => /^Objectifs? atteints? :/.test(t)).length, 1, msgs.join(' | '));
  assert.ok(msgs.some((t) => t.startsWith('Palier franchi : Gérant !')));
  // Entrepreneur : prime de 25 000 CHF.
  g.achieved = OBJECTIVES.filter((o) => o.tier !== 'magnat' && o.id !== 'vn100k').map((o) => o.id);
  g.cash = 200_000;
  g.checkObjectives();
  assert.ok(tierComplete(g, 'entrepreneur'));
  assert.ok(Math.abs(g.cash - 225_000) < 1e-6, `prime versée (${g.cash})`);
  assert.equal(rankOf(g), 'Magnat');
});

test('légende du quartier : tous les autres objectifs d’abord, puis victoire (palier Magnat franchi) et score', () => {
  const g = new Game(7);
  const legend = OBJECTIVE_BY_ID.get(LEGEND_ID)!;
  g.achieved = OBJECTIVES.filter((o) => o.id !== LEGEND_ID && o.id !== 'vn1m').map((o) => o.id);
  assert.ok(isUnlocked(g, legend));
  assert.ok(legend.progress(g).p < 1);
  g.checkObjectives();
  assert.ok(!g.achieved.includes(LEGEND_ID), 'pas de légende sans le million');
  g.cash = 1_000_000;
  g.checkObjectives();
  assert.ok(g.achieved.includes('vn1m') && g.achieved.includes(LEGEND_ID), 'le million puis la légende, dans la même vérification');
  assert.equal(currentTier(g), null);
  assert.equal(rankOf(g), 'Légende du quartier');
  assert.ok(g.notices.some((n) => n.text.startsWith('Palier franchi : Magnat !')));
  assert.deepEqual(activeObjectives(g), []);
  assert.equal(victoryScore(g), Math.round(netWorth(g) / (g.day + 1)));
});

test('prix alignés : seulement après une baisse des concurrents, tous les produits à ± 3 % du prix du quartier', () => {
  const g = new Game(7);
  const id = epicerie(g);
  const o = OBJECTIVE_BY_ID.get('prix')!;
  // Prix de départ = prix habituel : rien à aligner tant que les concurrents n'ont pas bougé.
  assert.equal(o.progress(g).p, 0);
  g.rivals['epicerie'] = 0.94;
  const s = g.shop(id)!;
  assert.ok(o.progress(g).p < 1, 'prix habituels 6 % au-dessus du quartier');
  for (const pr of productsOf('epicerie')) g.setPrice(id, pr.id, g.refPrice(pr, s) * 1.02);
  assert.equal(o.progress(g).p, 1);
  g.setPrice(id, 'pain', g.refPrice(PRODUCT_BY_ID.get('pain')!, s) * 0.95);
  assert.ok(o.progress(g).p < 1, 'un produit à −5 % n’est pas aligné');
});

test('propreté : service de nuit, ou 90 % et plus trois jours de suite avec des clients', () => {
  const g = new Game(7);
  const id = epicerie(g);
  const s = g.shop(id)!, o = OBJECTIVE_BY_ID.get('proprete')!;
  g.achieved = ids('demarrage');
  // Un commerce gardé propre (employé d'entretien simulé) pendant 4 jours de vente.
  for (let h = 0; h < 4 * 24; h++) { keepAlive(g); s.clean = 100; g.advance(60); }
  assert.ok(s.cleanSince !== undefined && g.total - s.cleanSince >= 3 * DAY, 'série suivie sur le commerce');
  assert.ok(g.achieved.includes('proprete'), o.progress(g).text);
  // Une baisse sous 90 % remet la série à zéro ; le service de nuit suffit.
  const h = new Game(7);
  const id2 = epicerie(h);
  h.achieved = ids('demarrage');
  h.shop(id2)!.clean = 50;
  h.checkObjectives();
  assert.equal(h.shop(id2)!.cleanSince, undefined);
  assert.ok(!h.achieved.includes('proprete'));
  h.setCleanService(id2, true);
  h.checkObjectives();
  assert.ok(h.achieved.includes('proprete'));
});

test('rachat d’un commerce rival et part de marché', () => {
  const g = new Game(7);
  g.cash = 300_000;
  const rachat = OBJECTIVE_BY_ID.get('rachat')!;
  assert.ok(rachat.progress(g).p < 1 && /CHF/.test(rachat.progress(g).text), 'avancement : trésorerie / rachat le moins cher');
  const rs = [...g.rivalry.shops].sort((a, b) => g.rivalry.quote(a.premiseId)!.total - g.rivalry.quote(b.premiseId)!.total)[0]!;
  const r = g.rivalry.buy(rs.premiseId, true);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.data.acquired, 'commerce marqué « racheté »');
  assert.equal(rachat.progress(g).p, 1);
  g.achieved = [...ids('demarrage'), ...ids('gerant')];
  g.checkObjectives();
  assert.ok(g.achieved.includes('rachat'));
  // Part de marché : clients de la veille rapportés au marché ; un marché sans concurrent ne compte pas pour un seul commerce.
  r.data.history.push({ ...r.data.today, customers: 100_000 });
  const b = bestMarketShare(g);
  assert.equal(b.type, r.data.type);
  assert.ok(b.share > 0.9);
});

test('valeur nette : entrepôt (dépôt, étagères à 40 %, stock au coût), marchandise et arrivages payés', () => {
  const g = new Game(7);
  g.cash = 200_000;
  const p = warehousePremises(g)[0]!;
  const w0 = netWorth(g);
  const w = rentWarehouse(g, p.id);
  assert.ok(w.ok);
  if (!w.ok) return;
  assert.ok(Math.abs(netWorth(g) - w0) < 1e-6, 'dépôt de garantie compté');
  const w1 = netWorth(g);
  assert.ok(buyRacks(g, w.data.id, 4).ok);
  assert.ok(Math.abs(netWorth(g) - (w1 - 4 * LOGISTICS.rackPrice * (1 - ECONOMY.resale))) < 1e-6, 'étagères à 40 % de leur prix');
  const w2 = netWorth(g);
  w.data.stock['pain'] = 100;
  assert.ok(Math.abs(netWorth(g) - w2 - 100 * PRODUCT_BY_ID.get('pain')!.cost) < 1e-6, 'stock au coût d’achat');
  // Commande à l'importateur : payée, comptée au prix payé tant qu'elle est en route.
  const w3 = netWorth(g);
  const o = placeImport(g, w.data.id, { lait: 5 });
  assert.ok(o.ok, o.ok ? '' : o.message);
  assert.ok(Math.abs(netWorth(g) - w3) < 1e-6, 'arrivage payé compté');
  // Loyer provisionné de l'entrepôt : une dette.
  w.data.rentDue = 500;
  assert.ok(Math.abs(netWorth(g) - (w3 - 500)) < 1e-6);
});

test('sauvegardes : objectifs atteints conservés (anciens identifiants compris), version inchangée', () => {
  assert.equal(SAVE_VERSION, 2);
  const g = new Game(7);
  const save = g.save();
  // Ancienne partie : les 13 objectifs d'avant, dont « gamme » et « valeur100k » (palier Entrepreneur).
  const old = ['sortir', 'louer', 'meubler', 'stock', 'servir10', 'embaucher', 'jour500', 'vehicule', 'pub', 'deux', 'trois', 'gamme', 'valeur100k', 'jour2000'];
  const h = new Game(save.seed, 'Ancienne SA', { ...structuredClone(save), achieved: old });
  assert.deepEqual(h.achieved, old.slice(0, 13), 'acquis gardés, objectif disparu ignoré');
  assert.ok(tierComplete(h, 'demarrage'));
  assert.equal(currentTier(h)!.id, 'gerant');
  assert.equal(rankOf(h), 'Gérant');
  assert.deepEqual(activeObjectives(h).map((o) => o.id), ['prix', 'proprete', 'former']);
  const again = new Game(save.seed, 'x', JSON.parse(JSON.stringify(h.save())));
  assert.deepEqual(again.achieved, h.achieved);
});
