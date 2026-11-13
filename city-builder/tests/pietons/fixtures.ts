/** Ville de test des piétons : quadrillage avec une avenue (passages peints, carrefours à 4 branches) et des bâtiments variés. */
import { Simulation } from '../../src/sim/world';
import { TILE_SIZE } from '../../src/shared/constants';
import type { SimPlugin } from '../../src/sim/plugins';
import { createPietonsPlugin } from '../../src/sim/plugins/pietons';
import type { PedestrianSystem } from '../../src/sim/pedestrians/system';
import type { PluginContext } from '../../src/sim/plugins/types';
import { townCatalog } from '../sim/fixtures';

export interface PedTown { sim: Simulation; system: PedestrianSystem; ctx: PluginContext; plugin: SimPlugin; buildings: number[] }

/** Rues est-ouest (z) et nord-sud (x) du quadrillage ; l'axe z = 0 est une avenue. */
export const GRID_Z: readonly number[] = [-120, 0, 120];
export const GRID_X: readonly number[] = [-240, -80, 80, 240];
const DEFAULT_GRID_X = GRID_X, DEFAULT_GRID_Z = GRID_Z;

const ROW = ['maison', 'immeuble', 'boutique', 'maison', 'immeuble', 'bureaux', 'maison', 'ecole', 'parc', 'immeuble', 'boutique', 'maison'];

export function buildGrid(s: Simulation, GRID_X: readonly number[] = DEFAULT_GRID_X, GRID_Z: readonly number[] = DEFAULT_GRID_Z): number[] {
  for (const z of GRID_Z) {
    const r = s.buildRoad({ type: z === 0 ? 'avenue' : 'street', kind: z === 0 ? 'avenue' : 'street', points: [GRID_X[0]!, z, GRID_X[GRID_X.length - 1]!, z] });
    if (!r.ok) throw new Error(`route z=${z} : ${r.error.message}`);
  }
  for (const x of GRID_X) {
    const r = s.buildRoad({ type: 'street', points: [x, GRID_Z[0]!, x, GRID_Z[GRID_Z.length - 1]!] });
    if (!r.ok) throw new Error(`route x=${x} : ${r.error.message}`);
  }
  const ids: number[] = [];
  let k = 0;
  // Bâtiments de part et d'autre de chaque rue est-ouest, entre les rues nord-sud.
  for (const z of GRID_Z) {
    const off = z === 0 ? 16 : 10;
    for (const side of [-1, 1]) {
      for (let b = 0; b + 1 < GRID_X.length; b++) {
        let x = GRID_X[b]! + 22;
        while (x < GRID_X[b + 1]! - 40) {
          const id = ROW[k++ % ROW.length]!;
          const a = s.getAsset(id)!;
          const w = a.footprint.tilesX * TILE_SIZE, d = a.footprint.tilesZ * TILE_SIZE;
          const p = s.placeBuilding({ assetId: id, x: x + w / 2, z: z + side * (off + d / 2), rot: side < 0 ? 0 : 2 });
          if (p.ok) ids.push(p.data.buildingId);
          x += w + 6;
        }
      }
    }
  }
  return ids;
}

export function pedTown(opts: { seed?: number; build?: boolean; attach?: boolean; extra?: readonly SimPlugin[] } = {}): PedTown {
  const plugin = createPietonsPlugin();
  const sim = new Simulation([...(opts.extra ?? []), plugin]);
  sim.setCatalog(townCatalog());
  sim.newGame({ seed: opts.seed ?? 4321, mapChunks: 4, startMoney: 500_000_000, cityName: 'Bourg-Piétons', terrain: { hydrology: 'aucune', rivers: 0 } });
  const buildings = opts.build === false ? [] : buildGrid(sim);
  if (opts.attach !== false) sim.snapshot(); // un client s'attache : la foule est simulée (comme le fait le worker)
  return { sim, system: plugin.system, ctx: sim.plugins.contextOf('pietons')!, plugin, buildings };
}

/** Avance de `hours` heures de jeu au pas réel (0,2 min de jeu, 0,1 s de marche par tick). */
export function runHours(s: Simulation, hours: number): void {
  const ticks = Math.round(hours * 300);
  for (let i = 0; i < ticks; i++) s.tick();
}
