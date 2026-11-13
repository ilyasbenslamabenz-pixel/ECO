import { TrafficSystem } from '../src/sim/traffic/system';
import { grid, vehicleCatalog } from '../tests/vehicles/fixtures';
const t = new TrafficSystem({ seed: 8, maxVehicles: 400, demand: false });
t.setCatalog(vehicleCatalog());
t.setNetwork(grid(5,3,150,()=>'rue')); t.step(0,9);
const g:any=(t as any).graph;
const arcOf=(id:number,dir=0)=>g.edgeIndex(id)*2+dir;
for (const id of [2,3]) { const a=arcOf(id); for(let s=5;s<g.edgeLen[a>>1]!-10;s+=7){const v=t.spawnVehicle(a,0,s,a,g.edgeLen[a>>1]!-5,0,0,0); if(v>=0){t.vDes[v]=0.05;t.v[v]=0;}}}
for(let k=0;k<400;k++) t.step(0.1,9);
const r:any=(t as any).router;
console.log('delay arc2', r.delay[arcOf(2)], 'arc3', r.delay[arcOf(3)], 'arc1', r.delay[arcOf(1)]);
const v=t.spawnVehicle(arcOf(1),0,10,arcOf(4),100,0); t.rrNext[v]=0;
const off=(t as any).routeOff[v], n=t.routeLen[v], arena=(t as any).arena;
console.log('route', Array.from(arena.subarray(off,off+n)), 'n',n, 'ri', t.routeIdx[v]);
for(let k=0;k<100;k++){t.step(0.1,9); }
console.log('apres', t.routeLen[v], t.routeIdx[v], t.stats.rerouted, 'link', t.link[v], 'alive', t.alive[v], 'lanelen', g.linkLen[t.link[v]!], 's', t.s[v]);
