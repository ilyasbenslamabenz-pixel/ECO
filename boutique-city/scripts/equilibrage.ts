/**
 * Équilibrage : pour chaque type de commerce, 7 jours simulés depuis le début d'une partie (40 000 CHF), bien géré
 * (prix du quartier, réassort automatique, un employé, aménagement complet, nettoyage quotidien par le patron) puis mal géré (prix +60 %, pas de
 * réassort, deux employés payés au-dessus du marché, stock initial faible). Tableau jour par jour : chiffre
 * d'affaires, charges, bénéfice, trésorerie. Puis milieu de partie : standard contre premium sur 21 jours.   npx tsx scripts/equilibrage.ts [fichier.md]
 */
import { writeFileSync } from 'node:fs';
import { FURNITURE_BY_ID, SHOP_TYPES, productsOf, type ShopType } from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { canPlace, layoutStats } from '../src/sim/layout';
import { Game, dayProfit } from '../src/sim/game';
import * as L from '../src/sim/logistics';

const LAYOUTS: Record<ShopType, string[]> = {
  epicerie: ['caisse', 'rayon', 'rayon', 'rayon', 'frigo', 'frigo', 'plante', 'plante'],
  cafe: ['caisse', 'machine', 'comptoir', 'vitrine', 'frigo', 'table', 'table', 'table', 'plante'],
  vetements: ['caisse', 'portant', 'portant', 'portant', 'portant', 'rayon', 'plante', 'lampe'],
  fleuriste: ['caisse', 'frigo', 'frigo', 'rayon', 'plante', 'lampe', 'tapis'],
  boulangerie: ['caisse', 'rayon', 'rayon', 'vitrine', 'vitrine', 'frigo', 'table', 'plante'],
  fastfood: ['caisse', 'comptoir', 'comptoir', 'vitrine', 'frigo', 'table', 'table', 'plante'],
  primeur: ['caisse', 'rayon', 'rayon', 'rayon', 'rayon', 'frigo', 'plante'],
};
const fmt = (v: number): string => Math.round(v).toLocaleString('fr-CH');
/** Le patron entre dans le commerce, nettoie (30 minutes de jeu) et ressort. */
function cleanUp(g: Game, id: number): void {
  g.setPlace({ kind: 'commerce', shopId: id });
  g.cleanShop(id);
  g.setPlace({ kind: 'rue' });
}

function run(type: ShopType, good: boolean): { rows: string[]; firstProfitDay: number | null; endCash: number } {
  const g = new Game(7, 'Test');
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  const s = g.rent(p.id, type);
  if (!s.ok) throw new Error(s.message);
  const id = s.data.id;
  const go = (k: 'meubles' | 'emploi'): void => { const b = serviceBuilding(g.district, k)!; g.setPlace({ kind: 'service', service: k, buildingId: b.id }); };
  go('meubles');
  for (const f of LAYOUTS[type]) g.buyFurniture(f, 1, id);
  const sh = g.shop(id)!;
  for (const f of LAYOUTS[type]) {
    const def = FURNITURE_BY_ID.get(f)!;
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(sh.items, p.gridW, p.gridD, def, x, z, 0)) continue;
      const r = g.place(id, f, x, z, 0);
      if (r.ok && layoutStats(sh.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (r.ok) g.pickUp(id, r.data.uid);
    }
  }
  for (const pr of productsOf(type)) {
    g.order(id, pr.id, good ? Math.max(20, g.room(sh, pr.id)) : 15);
    if (good) g.setAuto(id, pr.id, true);
    else g.setPrice(id, pr.id, pr.basePrice * 1.6);
  }
  go('emploi');
  g.hire(g.candidates[0]!.id, id);
  if (!good) { g.hire(g.candidates[0]!.id, id); for (const e of g.employees) g.raiseWage(e.id, e.wage + 12); }
  g.setPlace({ kind: 'rue' });
  const rows: string[] = [];
  let first: number | null = null;
  for (let d = 0; d < 7; d++) {
    g.player.energy = 100; g.player.hunger = 100;
    // Bien géré : le patron passe nettoyer le magasin chaque jour vers 15 h (30 minutes de jeu).
    g.advance(480);
    if (good) cleanUp(g, id);
    g.advance(1440 - (g.total - 7 * 60) % 1440);
    const y = g.ledger.at(-1)!;
    const charges = y.purchases + y.wages + y.rent + y.equipment + y.marketing + y.finance + y.living + (y.tax ?? 0) + (y.overhead ?? 0);
    const profit = dayProfit(y);
    if (first === null && profit > 0 && d > 0) first = d + 1;
    rows.push(`| ${d + 1} | ${fmt(y.revenue)} | ${fmt(charges)} | ${profit >= 0 ? '+' : ''}${fmt(profit)} | ${fmt(g.cash)} |`);
    if (process.env['DBG'] && d === 3) console.error(type, good, JSON.stringify({ cli: y.customers, lostStaff: y.lostStaff, lostStock: y.lostStock, lostCap: y.lostCapacity, refused: y.refusedPrice, purchases: Math.round(y.purchases), wages: Math.round(y.wages), rent: Math.round(y.rent), living: Math.round(y.living), cos: Math.round(y.costOfSales) }));
  }
  return { rows, firstProfitDay: first, endCash: g.cash };
}

const out: string[] = ['# Équilibrage : 7 jours par type de commerce', '', 'CA = chiffre d’affaires ; charges = achats + salaires + loyer (provision) + équipement + vie courante ; trésorerie en fin de journée (départ 40 000 CHF, dépôt et meubles déduits).', ''];
for (const t of SHOP_TYPES) {
  for (const good of [true, false]) {
    const r = run(t.id, good);
    out.push(`## ${t.nameFr} — ${good ? 'bien géré' : 'mal géré'}`, '', '| Jour | CA | Charges | Bénéfice | Trésorerie |', '|---|---|---|---|---|', ...r.rows, '',
      `Premier jour bénéficiaire : ${r.firstProfitDay ?? 'aucun sur 7 jours'} · trésorerie finale : ${fmt(r.endCash)} CHF`, '');
  }
}
// Milieu de partie : même commerce bien géré sur 21 jours, en gamme standard ou formé puis passé en premium au jour 8.
function mid(type: ShopType, premium: boolean): { profit: number; rep: number } {
  const g = new Game(7, 'Test');
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  const id = (g.rent(p.id, type) as { ok: true; data: { id: number } }).data.id;
  const go = (k: 'meubles' | 'emploi'): void => { const b = serviceBuilding(g.district, k)!; g.setPlace({ kind: 'service', service: k, buildingId: b.id }); };
  go('meubles');
  for (const f of LAYOUTS[type]) g.buyFurniture(f, 1, id);
  const sh = g.shop(id)!;
  for (const f of LAYOUTS[type]) {
    const def = FURNITURE_BY_ID.get(f)!;
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(sh.items, p.gridW, p.gridD, def, x, z, 0)) continue;
      const r = g.place(id, f, x, z, 0);
      if (r.ok && layoutStats(sh.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (r.ok) g.pickUp(id, r.data.uid);
    }
  }
  for (const pr of productsOf(type)) { g.order(id, pr.id, Math.max(20, g.room(sh, pr.id))); g.setAuto(id, pr.id, true); }
  go('emploi'); g.hire(g.candidates[0]!.id, id); g.setPlace({ kind: 'rue' });
  let acc = 0;
  for (let d = 0; d < 21; d++) {
    if (d === 7 && premium) { g.train(g.employees[0]!.id); g.setPremium(id, true); }
    for (const e of g.employees) if (e.askedRaise) g.raiseWage(e.id, g.marketWage(e.skill, e.training ?? 0));
    g.player.energy = 100; g.player.hunger = 100; g.advance(480); cleanUp(g, id); g.player.energy = 100; g.player.hunger = 100; g.advance(1440 - (g.total - 7 * 60) % 1440);
    if (d >= 14) acc += dayProfit(g.ledger.at(-1)!);
  }
  return { profit: acc / 7, rep: sh.reputation };
}
out.push('## Milieu de partie : gamme premium (jours 15 à 21)', '', 'Même commerce bien géré ; « premium » = employé formé puis gamme premium activée au jour 8. Bénéfice moyen par jour, toutes dépenses.', '',
  '| Type | Standard | Premium | Réputation |', '|---|---|---|---|');
const premiums: number[] = [];
for (const t of SHOP_TYPES) {
  const a = mid(t.id, false), b = mid(t.id, true);
  premiums.push(b.profit);
  out.push(`| ${t.nameFr} | ${a.profit >= 0 ? '+' : ''}${fmt(a.profit)} | ${b.profit >= 0 ? '+' : ''}${fmt(b.profit)} | ${Math.round(b.rep * 100)} % |`);
}
// Cible : aucun type plus de deux fois plus rentable qu'un autre en premium.
out.push('', `Écart premium entre le meilleur et le moins bon type : ×${(Math.max(...premiums) / Math.max(1, Math.min(...premiums))).toFixed(2)} (cible ≤ ×2).`);
// Logistique : trois épiceries réassorties par le grossiste (livraison, réassort automatique) ou par un entrepôt
// (importateur, tournée de nuit par transporteur). Bénéfice moyen par jour des jours 8 à 21, toutes dépenses.
function logi(depot: boolean): { profit: number; buy: number } {
  const g = new Game(7, 'Test');
  g.cash = 200_000;
  const free = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall).slice(0, 3);
  const ids: number[] = [];
  for (const p of free) {
    const id = (g.rent(p.id, 'epicerie') as { ok: true; data: { id: number } }).data.id;
    ids.push(id);
    const go = (k: 'meubles' | 'emploi'): void => { const b = serviceBuilding(g.district, k)!; g.setPlace({ kind: 'service', service: k, buildingId: b.id }); };
    go('meubles');
    for (const f of LAYOUTS.epicerie) g.buyFurniture(f, 1, id);
    const sh = g.shop(id)!;
    for (const f of LAYOUTS.epicerie) {
      const def = FURNITURE_BY_ID.get(f)!;
      let done = false;
      for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
        if (canPlace(sh.items, p.gridW, p.gridD, def, x, z, 0)) continue;
        const r = g.place(id, f, x, z, 0);
        if (r.ok && layoutStats(sh.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (r.ok) g.pickUp(id, r.data.uid);
      }
    }
    for (const pr of productsOf('epicerie')) { g.order(id, pr.id, g.room(sh, pr.id)); g.setAuto(id, pr.id, true); }
    go('emploi'); g.hire(g.candidates[0]!.id, id); g.setPlace({ kind: 'rue' });
    if (depot) L.autoMins(g, id);
  }
  let wid = 0;
  if (depot) {
    const w = L.rentWarehouse(g, L.warehousePremises(g)[0]!.id) as { ok: true; data: { id: number } };
    wid = w.data.id;
    L.buyRacks(g, wid, 99);
    L.setTransport(g, wid, 'service');
    L.setMidday(g, wid, true);
  }
  let acc = 0, buy = 0;
  for (let d = 0; d < 21; d++) {
    // Entrepôt : le grossiste assure les 3 premiers jours, le temps du premier arrivage et de la première tournée.
    if (depot && d === 3) for (const id of ids) for (const pr of productsOf('epicerie')) g.setAuto(id, pr.id, false);
    if (depot) {
      // Commande à l'importateur : de quoi tenir 4 à 5 jours par produit (stock + arrivages).
      const w = L.warehouse(g, wid)!, lines: Record<string, number> = {};
      for (const pr of productsOf('epicerie')) {
        const have = (w.stock[pr.id] ?? 0) + g.logi.imports.reduce((a, o) => a + (o.lines[pr.id] ?? 0), 0);
        const k = Math.floor((800 - have) / L.palletOf(pr));
        if (k > 0) lines[pr.id] = k;
      }
      L.placeImport(g, wid, lines);
    }
    g.player.energy = 100; g.player.hunger = 100; g.advance(480);
    for (const id of ids) cleanUp(g, id);
    g.player.energy = 100; g.player.hunger = 100; g.advance(1440 - (g.total - 7 * 60) % 1440);
    if (d >= 7) { acc += dayProfit(g.ledger.at(-1)!); buy += g.ledger.at(-1)!.purchases; }
  }
  return { profit: acc / 14, buy: buy / 14 };
}
{
  const a = logi(false), b = logi(true);
  out.push('', '## Logistique : trois épiceries (jours 8 à 21)', '', 'Réassort par le grossiste (livraisons, réassort automatique) ou par un entrepôt (importateur, tournée de nuit par transporteur, loyer et étagères compris). Moyennes par jour.', '',
    '| Réassort | Achats et transport | Bénéfice |', '|---|---|---|',
    `| Grossiste | ${fmt(a.buy)} | ${a.profit >= 0 ? '+' : ''}${fmt(a.profit)} |`, `| Entrepôt | ${fmt(b.buy)} | ${b.profit >= 0 ? '+' : ''}${fmt(b.profit)} |`);
}
out.push('');
const text = out.join('\n');
if (process.argv[2]) writeFileSync(process.argv[2], text);
console.log(text);
