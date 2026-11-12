/** Réseaux et bâtiments de test pour le trafic (scénarios déterministes). */
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { CATALOG_SCHEMA_VERSION } from '../../src/shared/constants';
import type { TrafficEdgeInput, TrafficNetworkInput } from '../../src/sim/traffic/network';
import type { TrafficBuilding } from '../../src/sim/traffic/system';

export type RoadKind = 'rue' | 'avenue' | 'sens_unique';

export function edge(id: number, a: number, b: number, ax: number, az: number, bx: number, bz: number, kind: RoadKind = 'rue'): TrafficEdgeInput {
  const lanes = kind === 'avenue' ? 2 : kind === 'sens_unique' ? 2 : 1;
  return {
    id, a, b, points: [ax, 0, az, bx, 0, bz],
    lanesForward: lanes, lanesBackward: kind === 'sens_unique' ? 0 : lanes, laneWidth: 3.25,
    median: kind === 'avenue' ? 2 : 0, speedKmh: kind === 'avenue' ? 50 : 40, rank: kind === 'avenue' ? 1 : 0,
  };
}

/** Grille nx × nz de nœuds espacés de `step` m ; `kindOf(ligne/colonne)` choisit le type de voie. */
export function grid(nx: number, nz: number, step: number, kindOf: (horizontal: boolean, index: number) => RoadKind = () => 'rue'): TrafficNetworkInput {
  const nodes = [];
  const id = (i: number, j: number): number => 1 + j * nx + i;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) nodes.push({ id: id(i, j), x: i * step, y: 0, z: j * step });
  const edges: TrafficEdgeInput[] = [];
  let e = 1;
  for (let j = 0; j < nz; j++) for (let i = 0; i + 1 < nx; i++) edges.push(edge(e++, id(i, j), id(i + 1, j), i * step, j * step, (i + 1) * step, j * step, kindOf(true, j)));
  for (let i = 0; i < nx; i++) for (let j = 0; j + 1 < nz; j++) edges.push(edge(e++, id(i, j), id(i, j + 1), i * step, j * step, i * step, (j + 1) * step, kindOf(false, i)));
  return { nodes, edges };
}

/** Bâtiments le long des tronçons d'une grille : alternance logements / emplois / commerces. */
export function gridBuildings(nx: number, nz: number, step: number): TrafficBuilding[] {
  const out: TrafficBuilding[] = [];
  let id = 1;
  for (let j = 0; j < nz; j++) for (let i = 0; i + 1 < nx; i++) {
    for (const t of [0.3, 0.7]) {
      const x = (i + t) * step, z = j * step + 9;
      const k = (i + j + (t > 0.5 ? 1 : 0)) % 3;
      out.push(k === 0
        ? { id: id++, assetId: 'immeuble_test', category: 'apartment_low', residents: 60, jobs: 0, x, z }
        : k === 1 ? { id: id++, assetId: 'bureaux_test', category: 'commercial', residents: 0, jobs: 80, x, z }
          : { id: id++, assetId: 'industrie_test', category: 'industrial', residents: 0, jobs: 40, x, z: j * step - 9 });
    }
  }
  return out;
}

function vehicleAsset(id: string, usage: string, kind: 'car' | 'van' | 'bus' | 'truck' | 'service', len: number): CatalogAsset {
  return {
    id, nameFr: id, category: 'vehicle', lods: [{ file: `vehicles/${id}_lod0.glb`, maxDistance: 1e9 }], dimensions: { width: 1.9, depth: len, height: 1.5 },
    footprint: { tilesX: 0, tilesZ: 0 }, cost: 0, upkeepPerMonth: 0, capacity: { residents: 0, jobs: 0 }, frontage: [],
    variants: [{ id: 'a', nameFr: 'A', materialOverrides: { peinture: { color: '#ff0000' } } }, { id: 'b', nameFr: 'B', materialOverrides: { peinture: { color: '#0000ff' } } }],
    textureSets: [], license: { spdx: 'CC0-1.0', source: 'tests', author: 'tests' }, tags: ['vehicule', `usage:${usage}`], vehicle: { kind, maxSpeedKmh: 130, lengthM: len },
  };
}

export function vehicleCatalog(): AssetCatalog {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION, generatedAt: new Date(0).toISOString(), textureSets: [], hdris: [],
    assets: [
      vehicleAsset('voiture_a', 'prive', 'car', 4.5), vehicleAsset('voiture_b', 'prive', 'car', 4.0), vehicleAsset('fourgon', 'livraison', 'van', 5.4),
      vehicleAsset('camion', 'fret', 'truck', 8.6), vehicleAsset('bus', 'bus', 'bus', 12), vehicleAsset('taxi', 'taxi', 'car', 4.6),
    ],
  };
}
