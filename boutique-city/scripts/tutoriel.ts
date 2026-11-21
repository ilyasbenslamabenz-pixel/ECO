/**
 * Parcours du tutoriel (objectifs 1 à 13) par la simulation, en suivant les indications : après chaque action, liste
 * des objectifs atteints. Milieu de partie : formation, caisse en plus, gamme premium, contrat fournisseur. Signale ceux qui ne se débloquent pas.   npx tsx scripts/tutoriel.ts
 */
import { FURNITURE_BY_ID, PREMIUM_BY_TYPE, productsOf } from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { canPlace, layoutStats } from '../src/sim/layout';
import { Game } from '../src/sim/game';
import { OBJECTIVES, netWorth } from '../src/sim/objectives';

const g = new Game(7, 'Tutoriel SA');
const log: string[] = [];
const step = (label: string): void => { g.checkObjectives(); log.push(`${label.padEnd(46)} → ${g.achieved.length} / 13 : ${g.achieved.join(', ')}`); };
const go = (k: Parameters<typeof serviceBuilding>[1]): void => { const b = serviceBuilding(g.district, k)!; g.setPlace({ kind: 'service', service: k, buildingId: b.id }); };
const live = (days: number): void => { for (let d = 0; d < days; d++) { g.player.energy = 100; g.player.hunger = 100; g.advance(1440); } };
/** Pose chaque meuble à la première place qui garde tout accessible. */
function placeAll(id: number, layout: string[]): void {
  const s = g.shop(id)!, p = g.premise(s.premiseId)!;
  for (const f of layout) {
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(s.items, p.gridW, p.gridD, FURNITURE_BY_ID.get(f)!, x, z, 0)) continue;
      const q = g.place(id, f, x, z, 0);
      if (q.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (q.ok) g.pickUp(id, q.data.uid);
    }
  }
}
function open(type: 'epicerie' | 'cafe' | 'fastfood', layout: string[]): number {
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  const r = g.rent(p.id, type); if (!r.ok) throw new Error(r.message);
  go('meubles');
  for (const f of layout) g.buyFurniture(f, 1, r.data.id);
  placeAll(r.data.id, layout);
  return r.data.id;
}
g.setPlace({ kind: 'rue' }); step('1. sortir dans la rue');
const a = open('epicerie', ['caisse', 'rayon', 'rayon', 'rayon', 'frigo', 'frigo', 'plante', 'plante']); step('2-3. louer, meubler l’épicerie');
for (const pr of productsOf('epicerie')) { g.order(a, pr.id, g.room(g.shop(a)!, pr.id)); g.setAuto(a, pr.id, true); }
g.advance(8 * 60); step('4. commande livrée (stock en rayon)');
g.setPlace({ kind: 'commerce', shopId: a }); g.tend(a); g.advance(4 * 60); step('5. tenir la caisse 4 h');
g.tend(null); go('emploi'); g.hire(g.candidates[0]!.id, a); step('6. embaucher');
live(2); step('7. deux jours de ventes');
go('garage'); g.buyVehicle('camionnette'); step('8. acheter une camionnette');
go('pub'); g.startCampaign('flyers', a, 3); step('9. campagne de publicité');
const b = open('cafe', ['caisse', 'machine', 'comptoir', 'vitrine', 'frigo', 'table', 'table', 'plante']);
for (const pr of productsOf('cafe')) { g.order(b, pr.id, g.room(g.shop(b)!, pr.id)); g.setAuto(b, pr.id, true); }
go('emploi'); g.hire(g.candidates[0]!.id, b); live(2); step('10-11. deuxième commerce, deux jours');
go('banque'); g.takeLoan(1);
const c = open('fastfood', ['caisse', 'comptoir', 'comptoir', 'vitrine', 'frigo', 'table', 'plante']);
for (const pr of productsOf('fastfood')) { g.order(c, pr.id, g.room(g.shop(c)!, pr.id)); g.setAuto(c, pr.id, true); }
go('emploi'); g.hire(g.candidates[0]!.id, c); for (const id of [a, b]) g.hire(g.candidates[0]!.id, id); live(3); step('12. troisième commerce (prêt), trois jours');
// Milieu de partie : les leviers indiqués par l'objectif « Monter en gamme » et par la valeur nette.
const raises = (): void => { for (const e of g.employees) if (e.askedRaise) g.raiseWage(e.id, g.marketWage(e.skill, e.training ?? 0)); };
const nw = (): string => `${Math.round(netWorth(g)).toLocaleString('fr-CH')} CHF`;
live(2); raises();
for (const e of g.employees) g.train(e.id);
step(`12b. former les employés (valeur ${nw()})`);
// Une caisse de plus là où deux employés se partageaient une seule caisse (clients perdus à l'attente).
go('meubles');
for (const id of [a, b]) if (g.staffOf(id).length > g.stats(g.shop(id)!).registers) { g.buyFurniture('caisse', 1, id); placeAll(id, ['caisse']); }
step(`12c. une caisse de plus (${nw()})`);
let days = 0;
while (!g.achieved.includes('valeur100k') && days < 120) {
  live(1); days++; raises();
  // Gamme premium dès que la réputation (≥ 80 %) et la trésorerie le permettent ; contrat fournisseur quand les achats le justifient.
  for (const s of g.shops) {
    const cost = PREMIUM_BY_TYPE.get(s.type)!.cost;
    if (!s.premium && s.reputation >= 0.8 && g.cash > cost + 3000 && g.setPremium(s.id, true).ok) step(`12d. ${s.name} premium (jour ${g.day + 1}, ${nw()})`);
  }
  // Agrandir l'assortiment de l'épicerie (ruptures fréquentes) une fois les trois gammes premium en place.
  if (g.shops.every((s) => s.premium) && !g.shop(a)!.items.some((it) => it.def === 'gondole') && g.cash > 8000) {
    go('meubles'); g.buyFurniture('gondole', 1, a); g.buyFurniture('frigo', 1, a); placeAll(a, ['gondole', 'frigo']);
    for (const pr of productsOf('epicerie')) g.order(a, pr.id, g.room(g.shop(a)!, pr.id));
    step(`12f. épicerie agrandie (jour ${g.day + 1}, ${nw()})`);
  }
  if (!g.contract && g.ledger.slice(-3).reduce((x, d) => x + d.purchases, 0) / 3 > 1100) { go('grossiste'); g.signContract('essentiel'); step(`12e. contrat fournisseur (jour ${g.day + 1}, ${nw()})`); }
}
step(`13. valeur nette (${days} jours de plus)`);
console.log(log.join('\n'));
const missing = OBJECTIVES.filter((o) => !g.achieved.includes(o.id)).map((o) => o.title);
console.log(missing.length ? `Non atteints : ${missing.join(' ; ')}` : 'Les 13 objectifs sont atteints.');
console.log(`Trésorerie finale ${Math.round(g.cash)} CHF, jour ${g.day + 1}`);
console.log(`Impôts payés : ${Math.round(g.ledger.reduce((x, d) => x + (d.tax ?? 0), 0))} CHF ; plafond de crédit : ${Math.round(g.creditLimit().limit)} CHF`);
