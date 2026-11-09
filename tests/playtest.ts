// Parties simulées par des joueurs-robots (voir playtestLib.ts). Usage :
//   npm run playtest                 → 6 stratégies × 3 graines × 30 ans
//   npm run playtest -- 50 2030      → 50 ans, une seule graine
//   npm run playtest -- 30 2030,7,99 --md   → tableau Markdown (docs/EQUILIBRAGE.md)
import { STRATEGIES, markdownTable, runStrategy, summarize, type RunResult } from './playtestLib';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const years = Number(args[0] ?? 30);
const seeds = (args[1] ?? '2030,7,99').split(',').map(Number);
const md = process.argv.includes('--md');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const t0 = Date.now();
const results: RunResult[] = [];
for (const s of STRATEGIES) {
  if (only && !only.includes(s)) continue;
  for (const seed of seeds) results.push(runStrategy(s, years, seed));
}
const rows = summarize(results);
if (md) console.log(markdownTable(rows));
else console.table(Object.fromEntries(rows.map((r) => [r['stratégie'], Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'stratégie'))])));
if (process.argv.includes('--detail')) for (const r of results) console.log(r.strategy, r.seed, JSON.stringify({ el: r.elections, def: r.defeats, ms: r.milestoneGap, ft: r.firstTrophyId, at10: r.at[10], fin: r.final }));
console.log(`${results.length} parties de ${years} ans en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
