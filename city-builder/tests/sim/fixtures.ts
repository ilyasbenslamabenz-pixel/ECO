/** Catalogue et ville de test pour les tests de simulation (données seules, aucun GLB requis). */
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { Simulation } from '../../src/sim/world';
import { TILE_SIZE } from '../../src/shared/constants';

const lic = { spdx: 'CC0-1.0', source: 'tests/sim/fixtures', author: 'tests' };

function asset(id: string, category: CatalogAsset['category'], tx: number, tz: number, residents: number, jobs: number, cost: number, upkeep: number, tags: string[] = []): CatalogAsset {
  return {
    id, nameFr: `Test ${id}`, category,
    lods: [{ file: `models/${id}_lod0.glb`, maxDistance: 200 }, { file: `models/${id}_lod1.glb`, maxDistance: 1e9 }],
    dimensions: { width: tx * TILE_SIZE - 2, depth: tz * TILE_SIZE - 2, height: 10 },
    footprint: { tilesX: tx, tilesZ: tz }, cost, upkeepPerMonth: upkeep, capacity: { residents, jobs },
    frontage: [{ x: 0, z: (tz * TILE_SIZE) / 2, nx: 0, nz: 1, kind: 'pedestrian' }],
    variants: [{ id: 'a', nameFr: 'A' }], textureSets: [], license: lic, tags,
  };
}

export function townCatalog(): AssetCatalog {
  return {
    schemaVersion: 1, generatedAt: '2026-01-01T00:00:00Z', textureSets: [], hdris: [],
    assets: [
      asset('maison', 'house', 2, 2, 5, 0, 40_000, 60),
      asset('immeuble', 'apartment_mid', 3, 2, 60, 10, 600_000, 800, ['immeuble', 'commerces']),
      asset('boutique', 'commercial', 2, 2, 0, 20, 150_000, 200, ['commerce', 'restaurant']),
      asset('bureaux', 'commercial', 2, 2, 0, 60, 900_000, 900, ['bureaux', 'tertiaire']),
      asset('usine', 'industrial', 3, 3, 0, 60, 500_000, 700, ['industrie', 'pollution:2']),
      asset('ecole', 'public', 3, 3, 0, 20, 800_000, 1200, ['service:education', 'rayon:900', 'capacite_service:300']),
      asset('hopital', 'public', 3, 3, 0, 40, 2_000_000, 3000, ['service:sante', 'rayon:2500']),
      asset('commissariat', 'public', 2, 2, 0, 15, 500_000, 900, ['service:police', 'rayon:1500']),
      asset('caserne', 'public', 2, 2, 0, 15, 500_000, 900, ['service:incendie', 'rayon:1500']),
      asset('parc', 'public', 2, 2, 0, 2, 100_000, 200, ['service:loisirs', 'attractivite:2', 'rayon:600']),
      { ...asset('voiture', 'vehicle', 0, 0, 0, 0, 0, 0), footprint: { tilesX: 0, tilesZ: 0 }, frontage: [], vehicle: { kind: 'car', maxSpeedKmh: 50, lengthM: 4 } },
    ],
  };
}

export function newTownSim(money = 50_000_000, seed = 1234): Simulation {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  // Carte sans eau intérieure : les scénarios posent la ville à des positions fixes autour du centre.
  s.newGame({ seed, mapChunks: 4, startMoney: money, cityName: 'Bourg-Test', terrain: { hydrology: 'aucune', rivers: 0 } });
  return s;
}

/**
 * Pose une rue le long de z = roadZ (x de x0 à x1) et des bâtiments côté nord, alignés sur la
 * grille, la façade à 3 m de la chaussée. Renvoie les ids des bâtiments posés.
 */
export function buildStreet(s: Simulation, roadZ: number, x0: number, x1: number, assets: string[]): number[] {
  const r = s.buildRoad({ type: 'street', points: [x0, roadZ, x1, roadZ] });
  if (!r.ok) throw new Error(`route : ${r.error.message}`);
  const ids: number[] = [];
  let x = x0 + 8;
  for (const id of assets) {
    const a = s.getAsset(id)!;
    const w = a.footprint.tilesX * TILE_SIZE, d = a.footprint.tilesZ * TILE_SIZE;
    const p = s.placeBuilding({ assetId: id, x: x + w / 2, z: roadZ - 8 - d / 2, rot: 0 });
    if (!p.ok) throw new Error(`${id} @ ${x} : ${p.error.message}`);
    ids.push(p.data.buildingId);
    x += w + 8;
  }
  return ids;
}

/** Petite ville complète : logements, commerces, bureaux, industrie, services. */
export function buildTown(s: Simulation): void {
  buildStreet(s, 0, -220, 220, ['maison', 'maison', 'maison', 'maison', 'maison', 'maison', 'immeuble', 'immeuble', 'boutique', 'ecole', 'parc', 'maison', 'maison', 'maison']);
  buildStreet(s, 80, -220, 220, ['immeuble', 'immeuble', 'bureaux', 'usine', 'hopital', 'commissariat', 'caserne', 'boutique', 'maison', 'maison']);
}

export function runDays(s: Simulation, days: number): void {
  const ticks = Math.round((days * 24 * 60) / 2);
  for (let i = 0; i < ticks; i++) s.tick();
}

/** Quartier dense : `rows` rues parallèles (pas de 40 m) bordées d'immeubles (13 par rue). */
export function buildDistrict(s: Simulation, rows: number, asset = 'immeuble', z0 = -200): number[] {
  const ids: number[] = [];
  for (let r = 0; r < rows; r++) ids.push(...buildStreet(s, z0 + r * 40, -220, 220, new Array<string>(13).fill(asset)));
  return ids;
}
