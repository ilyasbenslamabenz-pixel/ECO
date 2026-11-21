/**
 * Équilibrage : pour chaque type de commerce, 7 jours simulés depuis le début d'une partie (40 000 CHF), bien géré
 * (prix du quartier, réassort automatique, un employé, aménagement complet) puis mal géré (prix +60 %, pas de
 * réassort, deux employés payés au-dessus du marché, stock initial faible). Tableau jour par jour : chiffre
 * d'affaires, charges, bénéfice, trésorerie.   npx tsx scripts/equilibrage.ts [fichier.md]
 */
import { writeFileSync } from 'node:fs';
import { FURNITURE_BY_ID, SHOP_TYPES, productsOf, type ShopType } from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { canPlace, layoutStats } from '../src/sim/layout';
import { Game, dayProfit } from '../src/sim/game';

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
    g.advance(1440);
    const y = g.ledger.at(-1)!;
    const charges = y.purchases + y.wages + y.rent + y.equipment + y.marketing + y.finance + y.living;
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
const text = out.join('\n');
if (process.argv[2]) writeFileSync(process.argv[2], text);
console.log(text);
