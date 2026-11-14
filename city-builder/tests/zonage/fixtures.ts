/** Fixtures des tests du module « Zonage » : catalogue à plusieurs niveaux par zone, ville de test, accès au système. */
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';
import { Simulation } from '../../src/sim/world';
import type { PluginContext, SimPlugin } from '../../src/sim/plugins';
import { createZonagePlugin, type ZonagePlugin } from '../../src/sim/plugins/zonage';
import type { ZoningSystem } from '../../src/sim/zoning';

const lic = { spdx: 'CC0-1.0', source: 'tests/zonage/fixtures', author: 'tests' };

export function asset(id: string, category: CatalogAsset['category'], tx: number, tz: number, residents: number, jobs: number, tags: string[] = []): CatalogAsset {
  return {
    id, nameFr: `Test ${id}`, category,
    lods: [{ file: `models/${id}_lod0.glb`, maxDistance: 200 }, { file: `models/${id}_lod1.glb`, maxDistance: 1e9 }],
    dimensions: { width: tx * TILE_SIZE - 2, depth: tz * TILE_SIZE - 2, height: 10 },
    footprint: { tilesX: tx, tilesZ: tz }, cost: 50_000 * tx * tz, upkeepPerMonth: 50, capacity: { residents, jobs },
    frontage: [{ x: 0, z: (tz * TILE_SIZE) / 2, nx: 0, nz: 1, kind: 'pedestrian' }],
    variants: [{ id: 'a', nameFr: 'A' }, { id: 'b', nameFr: 'B' }], textureSets: [], license: lic, tags,
  };
}

/** Catalogue : trois niveaux pour le résidentiel faible et dense, deux pour les autres zones, plus des intrus. */
export function zoningCatalog(): AssetCatalog {
  return {
    schemaVersion: 1, generatedAt: '2026-01-01T00:00:00Z', textureSets: [], hdris: [],
    assets: [
      asset('maison_a', 'house', 2, 2, 4, 0),
      asset('maison_b', 'house', 2, 2, 5, 0),
      asset('maison_c', 'house', 2, 2, 7, 0),
      asset('bande', 'townhouse', 2, 2, 12, 0),
      asset('collectif', 'apartment_low', 2, 2, 24, 0),
      asset('immeuble_s', 'apartment_mid', 2, 2, 30, 0),
      asset('immeuble_m', 'apartment_mid', 2, 2, 45, 0),
      asset('tour', 'apartment_high', 2, 2, 90, 0),
      asset('boutique', 'commercial', 2, 2, 0, 12, ['commerce']),
      asset('halle', 'commercial', 2, 2, 0, 30, ['commerce']),
      asset('bureau_s', 'commercial', 2, 2, 0, 40, ['bureaux', 'tertiaire']),
      asset('bureau_l', 'skyscraper', 2, 2, 0, 120, ['bureaux']),
      asset('atelier', 'industrial', 2, 2, 0, 14, ['industrie']),
      asset('usine', 'industrial', 2, 2, 0, 50, ['industrie']),
      asset('centrale', 'industrial', 3, 3, 0, 20, ['electricite', 'elec:centrale:thermique']),
      asset('ecole', 'public', 3, 3, 0, 20, ['service:education', 'rayon:900']),
      { ...asset('voiture', 'vehicle', 0, 0, 0, 0), footprint: { tilesX: 0, tilesZ: 0 }, frontage: [], vehicle: { kind: 'car', maxSpeedKmh: 50, lengthM: 4 } },
    ],
  };
}

export interface ZoningTown { sim: Simulation; plugin: ZonagePlugin; ctx: PluginContext; sys: ZoningSystem; cmd(name: string, payload?: unknown): { ok: boolean; data?: unknown; error?: unknown } }

/** Simulation avec le seul module zonage (ou la liste donnée, qui doit contenir `plugin`), carte sans eau. */
export function zoningTown(opts: { seed?: number; plugins?: (z: ZonagePlugin) => SimPlugin[]; money?: number } = {}): ZoningTown {
  const plugin = createZonagePlugin();
  const sim = new Simulation(opts.plugins ? opts.plugins(plugin) : [plugin]);
  sim.setCatalog(zoningCatalog());
  sim.newGame({ seed: opts.seed ?? 11, mapChunks: 4, startMoney: opts.money ?? 20_000_000, cityName: 'Bourg-Zone', terrain: { hydrology: 'aucune', rivers: 0 } });
  const ctx = sim.plugins.contextOf('zonage')!;
  return {
    sim, plugin, ctx, get sys() { return plugin.systemOf(ctx); },
    cmd: (name, payload) => {
      const r = sim.plugins.command('zonage', name, payload);
      return r.ok ? { ok: true, data: r.data.data } : { ok: false, error: r.error };
    },
  };
}

/** Avance de `hours` heures de jeu par pas de 10 minutes. */
export function advanceHours(sim: Simulation, hours: number, step = 10): void {
  const n = Math.round((hours * 60) / step);
  for (let i = 0; i < n; i++) sim.tick(step);
}
