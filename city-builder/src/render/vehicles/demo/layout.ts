/**
 * Ville de test du module véhicules / trafic (données pures, sans three) : quadrillage de rues et
 * d'avenues, bâtiments du catalogue alignés en façade (logements, bureaux, commerces, industrie,
 * équipements publics), points d'accès pour la génération des trajets.
 */
import type { CatalogAsset } from '../../../shared/catalog';
import type { TrafficEdgeInput, TrafficNetworkInput } from '../../../sim/traffic/network';
import type { TrafficBuilding } from '../../../sim/traffic/system';

export interface DemoBuilding { id: number; assetId: string; variant: number; x: number; z: number; rot: number; category: string; residents: number; jobs: number; ax: number; az: number }
export interface DemoLayout { network: TrafficNetworkInput; buildings: DemoBuilding[]; size: [number, number]; avenueRows: number[]; avenueCols: number[]; step: number; nx: number; nz: number }

export const STREET_HALF = 5; // demi-largeur rue (chaussée 6,5 m + trottoirs)
export const AVENUE_HALF = 10;

function rngFrom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildLayout(assets: CatalogAsset[], nx = 8, nz = 6, step = 120, seed = 7): DemoLayout {
  const rand = rngFrom(seed);
  const avenueRows = [Math.floor(nz / 2)];
  const avenueCols = [Math.floor(nx / 2)];
  const nodes = [];
  const id = (i: number, j: number): number => 1 + j * nx + i;
  const ox = -((nx - 1) * step) / 2, oz = -((nz - 1) * step) / 2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) nodes.push({ id: id(i, j), x: ox + i * step, y: 0, z: oz + j * step });
  const edges: TrafficEdgeInput[] = [];
  let e = 1;
  const mk = (a: number, b: number, ax: number, az: number, bx: number, bz: number, avenue: boolean): TrafficEdgeInput => ({
    id: e++, a, b, points: [ax, 0, az, bx, 0, bz], lanesForward: avenue ? 2 : 1, lanesBackward: avenue ? 2 : 1,
    laneWidth: 3.25, median: avenue ? 2 : 0, speedKmh: avenue ? 50 : 40, rank: avenue ? 1 : 0,
  });
  for (let j = 0; j < nz; j++) for (let i = 0; i + 1 < nx; i++) edges.push(mk(id(i, j), id(i + 1, j), ox + i * step, oz + j * step, ox + (i + 1) * step, oz + j * step, avenueRows.includes(j)));
  for (let i = 0; i < nx; i++) for (let j = 0; j + 1 < nz; j++) edges.push(mk(id(i, j), id(i, j + 1), ox + i * step, oz + j * step, ox + i * step, oz + (j + 1) * step, avenueCols.includes(i)));

  const byCat = (cats: string[]): CatalogAsset[] => assets.filter((a) => cats.includes(a.category) && a.footprint.tilesX > 0);
  const pools = {
    centre: byCat(['skyscraper', 'apartment_high', 'commercial']),
    mid: byCat(['apartment_mid', 'apartment_low', 'townhouse', 'commercial']),
    out: byCat(['house', 'townhouse']),
    ind: byCat(['industrial']),
    pub: byCat(['public']),
  };
  const buildings: DemoBuilding[] = [];
  let bid = 1;
  const halfAt = (j: number): number => (avenueRows.includes(j) ? AVENUE_HALF : STREET_HALF);
  const pubQueue = [...pools.pub];
  // façades le long des rues est-ouest (des deux côtés), entre les carrefours
  for (let j = 0; j < nz; j++) for (let i = 0; i + 1 < nx; i++) {
    for (const side of [-1, 1] as const) {
      if ((j === 0 && side < 0) || (j === nz - 1 && side > 0)) continue;
      const roadZ = oz + j * step;
      const cx = ox + (i + 0.5) * step, cz = roadZ + side * step / 2;
      const d = Math.hypot(cx, cz) / (Math.hypot(nx, nz) * step / 2);
      const industrial = i === 0 && j >= nz - 2;
      let pool = industrial ? pools.ind : d < 0.3 ? pools.centre : d < 0.6 ? pools.mid : pools.out;
      if (!pool.length) pool = pools.mid.length ? pools.mid : assets.filter((a) => a.footprint.tilesX > 0);
      const x0 = ox + i * step + (avenueCols.includes(i) ? AVENUE_HALF : STREET_HALF) + 6;
      const x1 = ox + (i + 1) * step - (avenueCols.includes(i + 1) ? AVENUE_HALF : STREET_HALF) - 6;
      let x = x0;
      let guard = 0;
      while (guard++ < 20) {
        let a: CatalogAsset;
        if (pubQueue.length && rand() < 0.12 && !industrial) a = pubQueue.shift()!;
        else a = pool[Math.floor(rand() * pool.length)]!;
        const w = a.footprint.tilesX * 8, dep = a.footprint.tilesZ * 8;
        if (x + w > x1) { if (x === x0) { x += 1; continue; } break; }
        const setback = halfAt(j) + 4 + dep / 2;
        const bz = roadZ + side * setback;
        if (dep + halfAt(j) + 4 > step / 2 - 4) { x += 2; continue; }
        const rot = side < 0 ? 0 : 2; // façade (+Z local) tournée vers la rue
        const fx = x + w / 2;
        buildings.push({
          id: bid++, assetId: a.id, variant: Math.floor(rand() * Math.max(1, a.variants.length)), x: fx, z: bz, rot,
          category: a.category, residents: a.capacity.residents, jobs: a.capacity.jobs,
          ax: fx, az: roadZ + side * (halfAt(j) + 1),
        });
        x += w + 2 + rand() * 4;
      }
    }
  }
  return { network: { nodes, edges }, buildings, size: [(nx - 1) * step, (nz - 1) * step], avenueRows, avenueCols, step, nx, nz };
}

export function trafficBuildings(l: DemoLayout): TrafficBuilding[] {
  return l.buildings.map((b) => ({ id: b.id, assetId: b.assetId, category: b.category, residents: b.residents, jobs: b.jobs, x: b.ax, z: b.az }));
}
