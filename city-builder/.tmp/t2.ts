import { TrafficSystem } from '../src/sim/traffic/system';
import { edge, vehicleCatalog } from '../tests/vehicles/fixtures';
const t = new TrafficSystem({ seed: 2, maxVehicles: 10, demand: false });
t.setCatalog(vehicleCatalog());
t.setNetwork({ nodes:[{id:1,x:0,y:0,z:0},{id:2,x:900,y:0,z:0}], edges:[edge(1,1,2,0,0,900,0,'avenue')] });
t.step(0,9);
const g:any=(t as any).graph;
console.log('edges',g.edgeCount,'lanes fwd',g.edgeLanes[0],'arcLaneCount',g.arcLaneCount[0], 'laneLen', g.linkLen[0]);
const arc=g.edgeIndex(1)*2;
const lent=t.spawnVehicle(arc,1,120,arc,850,0,0,6);
const vif=t.spawnVehicle(arc,1,60,arc,860,0,0,14);
console.log({lent,vif, linkLent:t.link[lent], linkVif:t.link[vif], rank:g.linkRank[t.link[vif]!]});
t.vDes[lent]=6;
for(let k=0;k<200;k++){t.step(0.1,9);t.vDes[lent]=6;}
console.log('apres', {s_lent:t.s[lent],s_vif:t.s[vif],rankVif:g.linkRank[t.link[vif]!],lc:t.stats.laneChanges, needLane:(t as any).needLane[vif], lcCool:(t as any).lcCool[vif], v:t.v[vif]});
const t2 = new TrafficSystem({ seed: 2, maxVehicles: 10, demand: false });
t2.setCatalog(vehicleCatalog());
t2.setNetwork({ nodes:[{id:1,x:0,y:0,z:0},{id:2,x:900,y:0,z:0}], edges:[edge(1,1,2,0,0,900,0,'avenue')] });
t2.step(0,9);
const g2:any=(t2 as any).graph;
const a2=g2.edgeIndex(1)*2;
const L=t2.spawnVehicle(a2,1,120,a2,850,0,0,6), V=t2.spawnVehicle(a2,1,60,a2,860,0,0,14);
t2.vDes[L]=6;
let prev='';
for(let k=0;k<400;k++){t2.step(0.1,9);t2.vDes[L]=6;
  const st=`${g2.linkRank[t2.link[L]!]}/${g2.linkRank[t2.link[V]!]}`;
  if(st!==prev){console.log(k, st, 'sL',t2.s[L]!.toFixed(0),'sV',t2.s[V]!.toFixed(0),'vV',t2.v[V]!.toFixed(1), 'lc',t2.stats.laneChanges); prev=st;}
}
