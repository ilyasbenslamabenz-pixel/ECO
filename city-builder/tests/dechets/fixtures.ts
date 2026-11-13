/**
 * Bourg de test du module déchets : catalogue du bourg (tests/sim/fixtures) + installations de traitement
 * (données seules, mêmes étiquettes que le catalogue réel) ; simulation avec `municipal` et `dechets` injectés.
 */
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';
import { Simulation } from '../../src/sim/world';
import { createMunicipalPlugin } from '../../src/sim/municipal';
import { createDechetsPlugin } from '../../src/sim/plugins/dechets';
import type { SimPlugin } from '../../src/sim/plugins';
import { buildStreet, townCatalog } from '../sim/fixtures';

const lic = { spdx: 'CC0-1.0', source: 'tests/dechets/fixtures', author: 'tests' };

function facility(id: string, tx: number, tz: number, tags: string[]): CatalogAsset {
  return {
    id, nameFr: `Test ${id}`, category: 'public',
    lods: [{ file: `models/${id}_lod0.glb`, maxDistance: 1e9 }],
    dimensions: { width: tx * TILE_SIZE - 2, depth: tz * TILE_SIZE - 2, height: 8 },
    footprint: { tilesX: tx, tilesZ: tz }, cost: 100_000, upkeepPerMonth: 100, capacity: { residents: 0, jobs: 0 },
    frontage: [{ x: 0, z: (tz * TILE_SIZE) / 2, nx: 0, nz: 1, kind: 'pedestrian' }],
    variants: [{ id: 'a', nameFr: 'A' }], textureSets: [], license: lic, tags: ['public', 'dechets', ...tags],
  };
}

export function wasteCatalog(opts: { landfillKg?: number; trucks?: number } = {}): AssetCatalog {
  const c = townCatalog();
  c.assets.push(
    facility('t_depot', 3, 2, ['dechets:depot', `camions:${opts.trucks ?? 4}`]),
    facility('t_tri', 3, 3, ['dechets:tri', 'capacite_jour:30000']),
    facility('t_incinerateur', 3, 3, ['dechets:incinerateur', 'capacite_jour:60000']),
    facility('t_decharge', 4, 4, ['dechets:decharge', `capacite_totale:${opts.landfillKg ?? 3_000_000}`]),
  );
  return c;
}

export interface WasteTown { sim: Simulation; dechets: ReturnType<typeof createDechetsPlugin>; municipal: ReturnType<typeof createMunicipalPlugin> }

export function wasteSim(opts: { landfillKg?: number; trucks?: number; extra?: SimPlugin[] } = {}): WasteTown {
  const municipal = createMunicipalPlugin();
  const dechets = createDechetsPlugin();
  const sim = new Simulation([municipal, dechets, ...(opts.extra ?? [])]);
  sim.setCatalog(wasteCatalog(opts));
  sim.newGame({ seed: 1234, mapChunks: 4, startMoney: 80_000_000, cityName: 'Bourg-Déchets', terrain: { hydrology: 'aucune', rivers: 0 } });
  return { sim, dechets, municipal };
}

/**
 * Zone de traitement : rue z = 160 bordée (côté nord) du dépôt, du centre de tri, de l'incinérateur et de la
 * décharge, reliée au bourg par une rue x = 220 (du bout des rues z = 0 et z = 80). Renvoie les ids posés.
 */
export function buildWasteZone(s: Simulation, assets = ['t_depot', 't_tri', 't_incinerateur', 't_decharge']): number[] {
  const ids = buildStreet(s, 160, -220, 220, assets);
  const r = s.buildRoad({ type: 'street', points: [220, 0, 220, 160] });
  if (!r.ok) throw new Error(`liaison : ${r.error.message}`);
  return ids;
}
