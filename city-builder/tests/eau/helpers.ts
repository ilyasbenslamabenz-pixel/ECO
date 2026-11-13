/** Aides des tests du module « eau » : catalogue de test (bourg + installations), simulation avec contrat municipal. */
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';
import { WATER_FACILITIES, WATER_FACILITY_KINDS } from '../../src/shared/water-network/types';
import { Simulation } from '../../src/sim/world';
import { SIM_PLUGINS, type SimPlugin } from '../../src/sim/plugins';
import { createMunicipalPlugin } from '../../src/sim/municipal';
import { createEauPlugin } from '../../src/sim/plugins/eau';
import type { MapGenOptions } from '../../src/shared/contracts';
import { townCatalog } from '../sim/fixtures';

const lic = { spdx: 'CC0-1.0', source: 'tests/eau/helpers', author: 'tests' };
const FOOT: Record<string, [number, number]> = { pompage: [2, 2], potabilisation: [3, 3], chateau: [2, 2], epuration: [3, 3], emissaire: [1, 2] };

export function facilityAsset(kind: keyof typeof FOOT): CatalogAsset {
  const spec = WATER_FACILITIES[kind as keyof typeof WATER_FACILITIES];
  const [tx, tz] = FOOT[kind]!;
  return {
    id: spec.assetId, nameFr: spec.nameFr, category: 'public',
    lods: [{ file: `models/${spec.assetId}_lod0.glb`, maxDistance: 200 }, { file: `models/${spec.assetId}_lod1.glb`, maxDistance: 1e9 }],
    dimensions: { width: tx * TILE_SIZE - 2, depth: tz * TILE_SIZE - 2, height: 8 },
    footprint: { tilesX: tx, tilesZ: tz }, cost: 100_000, upkeepPerMonth: 100, capacity: { residents: 0, jobs: 4 },
    frontage: [{ x: 0, z: (tz * TILE_SIZE) / 2, nx: 0, nz: 1, kind: 'pedestrian' }],
    variants: [{ id: 'a', nameFr: 'A' }], textureSets: [], license: lic, tags: ['service:eau'],
  };
}

export function eauCatalog(): AssetCatalog {
  const c = townCatalog();
  return { ...c, assets: [...c.assets, ...WATER_FACILITY_KINDS.map((k) => facilityAsset(k))] };
}

/**
 * Modules de base (registre sans municipal ni eau) + municipal + eau (instances neuves). Sans contrat partagé
 * (`shared: false`), l'électricité est retirée aussi : elle embarquerait sinon son propre contrat municipal et le
 * publierait (l'eau ne serait plus en contrat privé). `base` remplace les modules de base (ex. `[]` : eau seule).
 */
export function eauPlugins(opts: { shared?: boolean; base?: readonly SimPlugin[] } = {}): { plugins: SimPlugin[]; eau: ReturnType<typeof createEauPlugin>; municipal: ReturnType<typeof createMunicipalPlugin> | null } {
  const base = opts.base ?? SIM_PLUGINS.filter((p) => p.id !== 'eau' && p.id !== 'municipal' && (opts.shared !== false || p.id !== 'electricite'));
  const eau = createEauPlugin();
  const municipal = opts.shared === false ? null : createMunicipalPlugin();
  return { plugins: [...base, ...(municipal ? [municipal] : []), eau], eau, municipal };
}

export function newSim(plugins: readonly SimPlugin[], terrain: MapGenOptions = { hydrology: 'aucune', rivers: 0 }, seed = 1234): Simulation {
  const s = new Simulation(plugins);
  s.setCatalog(eauCatalog());
  s.newGame({ seed, mapChunks: 4, startMoney: 500_000_000, cityName: 'Bourg-Eau', terrain });
  return s;
}

/** Pose un bâtiment centré en (x, z), rotation 0 (façade +Z) ; lève en cas de refus. */
export function place(s: Simulation, assetId: string, x: number, z: number, rot = 0): number {
  const r = s.placeBuilding({ assetId, x, z, rot });
  if (!r.ok) throw new Error(`${assetId} @ (${x}, ${z}) : ${r.error.message}`);
  return r.data.buildingId;
}

/** Avance de `hours` heures de jeu en pas de `step` minutes. */
export function runHours(s: Simulation, hours: number, step = 10): void {
  const n = Math.round((hours * 60) / step);
  for (let i = 0; i < n; i++) s.tick(step);
}

/** Site au bord de l'eau (graine 1234, rivières 0,6, sans mer) : rue z = 240 de x = −344 à −184, eau au sud. */
export const RIVER_MAP: MapGenOptions = { hydrology: 'aucune', rivers: 0.6 };
export const RIVER_SEED = 1234;

/** Bourg riverain : rue, 7 logements au nord ; renvoie les ids des logements. */
export function buildRiverTown(s: Simulation): number[] {
  const r = s.buildRoad({ type: 'street', points: [-344, 240, -184, 240] });
  if (!r.ok) throw new Error(`route : ${r.error.message}`);
  const ids: number[] = [];
  let x = -340;
  for (const a of ['maison', 'maison', 'immeuble', 'maison', 'maison', 'immeuble', 'maison']) {
    const as = s.getAsset(a)!;
    const w = as.footprint.tilesX * TILE_SIZE, d = as.footprint.tilesZ * TILE_SIZE;
    ids.push(place(s, a, x + w / 2, 240 - 8 - d / 2));
    x += w + 8;
  }
  return ids;
}

/** Ville sèche (carte sans eau) : buildTown + rue de liaison entre les deux rues ; installations au sud de la rue z = 80. */
export function linkTown(s: Simulation): void {
  const r = s.buildRoad({ type: 'street', points: [-220, 0, -220, 80] });
  if (!r.ok) throw new Error(`liaison : ${r.error.message}`);
}
