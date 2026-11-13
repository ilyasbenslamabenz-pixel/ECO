import { Simulation } from '../src/sim/world';
import { buildTown, townCatalog } from '../tests/sim/fixtures';
const s=new Simulation(); s.setCatalog(townCatalog());
s.newGame({ seed: 7, mapChunks: 4, startMoney: 50_000_000, cityName: 'C', terrain: { hydrology: 'aucune', rivers: 0 } });
buildTown(s);
for (const x of [-120,0,120]) { const r=s.buildRoad({kind:'avenue',type:'avenue',points:[x,-120,x,200]}); console.log(x, JSON.stringify(r)); }
