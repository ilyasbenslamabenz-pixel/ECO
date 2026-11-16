/**
 * Tableaux Markdown de l'étude d'équilibrage à partir des JSON de `equilibre-economie.ts` (--json=…).
 *   npx tsx tests/perf/equilibre-economie-rapport.ts run1.json [run2.json …] [--detail] [--tous-les=3]
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const DETAIL = args.includes('--detail');
const EVERY = Number(args.find((a) => a.startsWith('--tous-les='))?.split('=')[1] ?? 3);
const k = (v: number | undefined | null): string => (v === undefined || v === null ? '—' : Math.round(v / 1000).toLocaleString('fr-FR'));
const n = (v: number | undefined | null): string => (v === undefined || v === null ? '—' : Math.round(v).toLocaleString('fr-FR'));

interface Row {
  m: number; pop: number; money: number; balance: number; taxes: Record<string, number>; taxTotal: number;
  upkeepBuildings: number; upkeepRoads: number; salaries: number; loans: number; services: Record<string, number>;
  servicesRecurring: number; oneOff: number; construction: number; happiness: number; unemployment: number;
  upkeepBy: Record<string, number>; salaryBy: Record<string, number>; modLines: Record<string, number>; palier: string | null;
}
const net = (r: Row, mod: string): number => (r.services[`${mod}:recette`] ?? 0) + (r.services[`${mod}:depense`] ?? 0);

const summary: string[] = ['| Parcours | Réglages | Faillite | 1er mois solde > 0 (3 mois de suite) | Trésorerie min (mois) | Pop. M6 / M12 / M24 | Solde M6 / M12 / M24 | Trésorerie M12 / M24 | Investi par le joueur |', '|---|---|---|---|---|---|---|---|---|'];
for (const f of files) {
  const j = JSON.parse(readFileSync(f, 'utf8')) as { parcours: string; reglages: string[]; rows: Row[]; bankruptAt: number | null; positiveDurable: number | null; minMoney: number; minMoneyAt: number; investissementsJoueur: number; evenements: string[] };
  const at = (m: number): Row | undefined => j.rows[m - 1];
  summary.push(`| ${j.parcours} | ${j.reglages.join(', ') || 'actuels'} | ${j.bankruptAt ? `mois ${j.bankruptAt}` : 'non'} | ${j.positiveDurable ?? 'jamais'} | ${k(j.minMoney)} k (M${j.minMoneyAt}) | ${n(at(6)?.pop)} / ${n(at(12)?.pop)} / ${n(at(24)?.pop)} | ${k(at(6)?.balance)} / ${k(at(12)?.balance)} / ${k(at(24)?.balance)} k | ${k(at(12)?.money)} / ${k(at(24)?.money)} k | ${k(j.investissementsJoueur)} k |`);
  if (!DETAIL) continue;
  console.log(`\n#### ${j.parcours} — ${j.reglages.join(', ') || 'réglages actuels'}\n`);
  console.log('Montants mensuels en milliers de CHF (k). Solde = recettes récurrentes − dépenses récurrentes (hors investissements et primes).\n');
  console.log('| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of j.rows) {
    if (r.m !== 1 && r.m !== 2 && r.m % EVERY !== 0 && r.m !== j.rows.length) continue;
    const primes = (r.services['prime_palier:recette:ponctuel'] ?? 0) + (r.services['prime_objectif:recette:ponctuel'] ?? 0) + (r.services['evenement:recette:ponctuel'] ?? 0);
    const invest = r.construction - Object.entries(r.services).filter(([key]) => key.endsWith('depense:ponctuel')).reduce((s, [, v]) => s + v, 0);
    console.log(`| ${r.m} | ${n(r.pop)} | ${k(r.money)} | ${k(r.balance)} | ${k(r.taxes.residential)} / ${k(r.taxes.commercial)} / ${k(r.taxes.industrial)} / ${k(r.taxes.office)} | ${k(r.upkeepBuildings)} | ${k(r.upkeepRoads)} | ${k(r.salaries)} | ${k(net(r, 'electricite'))} | ${k(net(r, 'eau'))} | ${k(net(r, 'dechets'))} | ${k(net(r, 'transports'))} | ${k(r.loans)} | ${k(primes)} | ${k(invest)} | ${r.happiness} | ${r.palier ?? '—'} |`);
  }
  const last = j.rows[j.rows.length - 1]!;
  console.log(`\nDernier mois — entretien par famille : ${Object.entries(last.upkeepBy).map(([a, b]) => `${a} ${n(b)}`).join(', ')} ; salaires : ${Object.entries(last.salaryBy).map(([a, b]) => `${a} ${n(b)}`).join(', ')}`);
  console.log(`Lignes des modules : ${Object.entries(last.modLines).map(([a, b]) => `${a} ${n(b)}`).join(', ')}`);
  console.log(`\nÉvénements du joueur : ${j.evenements.slice(0, 40).join(' ; ')}`);
}
console.log('\n' + summary.join('\n'));
