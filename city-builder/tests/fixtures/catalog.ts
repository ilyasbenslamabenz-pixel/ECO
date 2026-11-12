/** Catalogue de test minimal (données uniquement, aucun fichier GLB requis par la simulation). */
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';

const lic = { spdx: 'CC0-1.0', source: 'tests/fixtures', author: 'tests' };

export function testAsset(id: string, over: Partial<CatalogAsset> = {}): CatalogAsset {
  return {
    id, nameFr: `Test ${id}`, category: 'house',
    lods: [{ file: `models/${id}_lod0.glb`, maxDistance: 200 }, { file: `models/${id}_lod1.glb`, maxDistance: 1e9 }],
    dimensions: { width: 12, depth: 14, height: 9 },
    footprint: { tilesX: 2, tilesZ: 2 },
    cost: 10_000, upkeepPerMonth: 100, capacity: { residents: 4, jobs: 0 },
    frontage: [{ x: 0, z: 8, nx: 0, nz: 1, kind: 'pedestrian' }],
    variants: [{ id: 'a', nameFr: 'A' }, { id: 'b', nameFr: 'B', heightScale: 1.2 }],
    textureSets: [], license: lic, tags: [],
    ...over,
  };
}

export function testCatalog(): AssetCatalog {
  return {
    schemaVersion: 1, generatedAt: '2026-01-01T00:00:00Z',
    assets: [testAsset('maison_test'), testAsset('grand_test', { footprint: { tilesX: 4, tilesZ: 3 }, category: 'commercial', cost: 50_000 }),
      testAsset('voiture_test', { category: 'vehicle', footprint: { tilesX: 0, tilesZ: 0 }, cost: 0, frontage: [], vehicle: { kind: 'car', maxSpeedKmh: 130, lengthM: 4.3 } })],
    textureSets: [], hdris: [],
  };
}
