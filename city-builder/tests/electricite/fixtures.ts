/** Fixtures des tests du module « Électricité » : catalogue de test + installations, ville, avance du temps. */
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';
import { Simulation } from '../../src/sim/world';
import type { SimPlugin } from '../../src/sim/plugins';
import { createElectricitePlugin, type ElectricitePlugin } from '../../src/sim/plugins/electricite';
import { buildStreet, buildTown, townCatalog } from '../sim/fixtures';

const lic = { spdx: 'CC0-1.0', source: 'tests/electricite/fixtures', author: 'tests' };

function facility(id: string, tx: number, tz: number, jobs: number, cost: number, upkeep: number, tags: string[]): CatalogAsset {
  return {
    id, nameFr: `Test ${id}`, category: 'industrial',
    lods: [{ file: `models/${id}_lod0.glb`, maxDistance: 200 }, { file: `models/${id}_lod1.glb`, maxDistance: 1e9 }],
    dimensions: { width: tx * TILE_SIZE - 2, depth: tz * TILE_SIZE - 2, height: 12 },
    footprint: { tilesX: tx, tilesZ: tz }, cost, upkeepPerMonth: upkeep, capacity: { residents: 0, jobs },
    frontage: [{ x: 0, z: (tz * TILE_SIZE) / 2, nx: 0, nz: 1, kind: 'pedestrian' }],
    variants: [{ id: 'a', nameFr: 'A' }], textureSets: [], license: lic, tags: ['electricite', ...tags],
  };
}

/** Catalogue du bourg de test + installations électriques (puissances réduites à l'échelle du bourg). */
export function powerCatalog(): AssetCatalog {
  const c = townCatalog();
  c.assets.push(
    facility('centrale_gaz', 3, 3, 30, 3_000_000, 4_000, ['elec:centrale:thermique']),
    facility('petite_centrale', 2, 2, 5, 500_000, 800, ['elec:centrale:thermique', 'elec:kw:150']),
    facility('eolienne', 1, 1, 1, 400_000, 300, ['elec:centrale:eolien', 'elec:kw:600']),
    facility('ferme_solaire', 3, 3, 2, 600_000, 300, ['elec:centrale:solaire', 'elec:kw:800']),
    facility('barrage', 4, 4, 20, 2_500_000, 2_000, ['elec:centrale:hydro']),
    facility('poste', 2, 2, 2, 300_000, 400, ['elec:poste']),
  );
  return c;
}

export interface PowerTown { sim: Simulation; elec: ElectricitePlugin }

/** Simulation avec le seul module électricité (contrat municipal intégré), bourg construit, peuplé `days` jours. */
export function powerTown(opts: { seed?: number; days?: number; plugins?: (e: ElectricitePlugin) => SimPlugin[] } = {}): PowerTown {
  const elec = createElectricitePlugin();
  const sim = new Simulation(opts.plugins ? opts.plugins(elec) : [elec]);
  sim.setCatalog(powerCatalog());
  sim.newGame({ seed: opts.seed ?? 1234, mapChunks: 4, startMoney: 80_000_000, cityName: 'Bourg-Volt', terrain: { hydrology: 'aucune', rivers: 0 } });
  buildTown(sim);
  // Distribution le long des routes : les deux rues du bourg sont reliées (comme dans une vraie partie).
  const link = sim.buildRoad({ type: 'street', points: [-220, 0, -220, 80] });
  if (!link.ok) throw new Error(`liaison du bourg : ${link.error.message}`);
  if (opts.days) advanceHours(sim, opts.days * 24);
  return { sim, elec };
}

/** Pose des installations le long d'une rue en z = roadZ (côté nord). */
export function placeFacilities(sim: Simulation, roadZ: number, x0: number, x1: number, ids: string[], connect = true): number[] {
  const out = buildStreet(sim, roadZ, x0, x1, ids);
  // Rue des installations reliée au bourg (rue z = 80) par une rue nord-sud à son extrémité ouest.
  if (connect && roadZ > 80) {
    // Jusqu'à la rue z = 80, ou jusqu'à la rue d'installations précédente si une liaison existe déjà.
    const r = sim.buildRoad({ type: 'street', points: [x0, 80, x0, roadZ] });
    if (!r.ok) {
      const r2 = sim.buildRoad({ type: 'street', points: [x0, roadZ - 70, x0, roadZ] });
      if (!r2.ok) throw new Error(`liaison des installations : ${r.error.message} / ${r2.error.message}`);
    }
  }
  return out;
}

/** Avance de `hours` heures de jeu par pas de 10 minutes. */
export function advanceHours(sim: Simulation, hours: number, step = 10): void {
  const n = Math.round((hours * 60) / step);
  for (let i = 0; i < n; i++) sim.tick(step);
}

/** Avance jusqu'à l'heure `h` (0..24) du jour courant ou suivant. */
export function advanceToHour(sim: Simulation, h: number): void {
  let guard = 0;
  while (Math.abs(sim.clock.hourOfDay - h) > 0.01 && guard++ < 300) sim.tick(10);
}
