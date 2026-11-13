import { Simulation } from '../../src/sim/world';
import { townCatalog, runDays } from '../sim/fixtures';
const s = new Simulation();
s.setCatalog(townCatalog());
s.newGame({ seed: 7, mapChunks: 4, startMoney: 50_000_000, cityName: 'Z', terrain: { hydrology: 'aucune', rivers: 0 } });
console.log(s.buildRoad({ type: 'street', points: [-200, -150, 200, -150] }).ok, s.buildRoad({ type: 'street', points: [-200, 150, 200, 150] }).ok);
const cmd = (name: string, payload: unknown) => s.plugins.command('zonage', name, payload);
console.log(JSON.stringify(cmd('paint', { points: [-200, -150, 200, -150], zone: 'res_faible', depth: 3 })));
console.log(JSON.stringify(cmd('paint', { points: [-200, 150, 0, 150], zone: 'industrie', depth: 3 })));
console.log(JSON.stringify(cmd('paint', { points: [0, 150, 200, 150], zone: 'commerce', depth: 2 })));
const t0 = Date.now();
for (let d = 1; d <= 30; d++) {
  runDays(s, 1, 10);
  const st = (cmd('state', {}) as any).data.data;
  if (d % 3 === 0) console.log(d, 'bat', s.buildings.count, 'pop', s.demography!.population, JSON.stringify(st.demand), JSON.stringify(st.stats.buildings), 'money', Math.round(s.economy.money));
}
console.log('ms', Date.now() - t0, s.plugins.errors);
