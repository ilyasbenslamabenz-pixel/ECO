import { TrafficSystem } from '../src/sim/traffic/system';
import { grid, gridBuildings, vehicleCatalog } from '../tests/vehicles/fixtures';
const t = new TrafficSystem({ seed: 11, maxVehicles: 600, demandScale: 2.5 });
t.setCatalog(vehicleCatalog());
t.setNetwork(grid(6, 6, 120, (_h, i) => (i === 2 ? 'avenue' : 'rue')));
t.setBuildings(gridBuildings(6, 6, 120));
const P = new Float32Array(4 * 4096);
let minD = Infinity, worst: any = null;
for (let k = 0; k < 3000; k++) {
  t.step(0.1, 8);
  if (k % 10 !== 0) continue;
  const n = t.actCount;
  for (let i = 0; i < n; i++) t.vehiclePose(t.act[i]!, P, i * 4);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = Math.hypot(P[i*4]!-P[j*4]!, P[i*4+2]!-P[j*4+2]!);
    if (d < minD) { minD = d; const a=t.act[i]!,b=t.act[j]!;
      const g=(t as any).graph;
      worst = { k, d, a:{link:t.link[a],kind:g.linkKind[t.link[a]!],s:t.s[a],lat:t.latOff[a],len:t.len[a],lane:g.linkRank[t.link[a]!],arc:g.linkArc[t.link[a]!]},
                   b:{link:t.link[b],kind:g.linkKind[t.link[b]!],s:t.s[b],lat:t.latOff[b],len:t.len[b],lane:g.linkRank[t.link[b]!],arc:g.linkArc[t.link[b]!]} }; }
  }
}
console.log(minD.toFixed(2), JSON.stringify(worst,null,1), t.stats);
