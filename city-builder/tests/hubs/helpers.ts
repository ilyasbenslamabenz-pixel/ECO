/** Outils des tests du module hubs : simulation avec (ou sans) contrat municipal partagé, recherche d'emplacements. */
import { Simulation } from '../../src/sim/world';
import { SIM_PLUGINS, type SimPlugin } from '../../src/sim/plugins';
import { createHubsPlugin } from '../../src/sim/plugins/hubs';
import { createMunicipalPlugin } from '../../src/sim/municipal';
import type { HubType } from '../../src/shared/hubs/types';
import type { MapGenOptions } from '../../src/shared/contracts';
import { townCatalog } from '../sim/fixtures';
import { terrainBounds } from '../../src/shared/terrain-gen';

export interface HubsTestSim { sim: Simulation; hubs: ReturnType<typeof createHubsPlugin>; muni: ReturnType<typeof createMunicipalPlugin> | null }

/**
 * Simulation : modules du registre (sauf hubs), le `municipal` du registre remplacé à sa place par une instance
 * propre au test (ou retiré : `municipal: false`), puis une instance de hubs propre au test. Sans municipal,
 * l'électricité est retirée aussi : elle embarquerait sinon son propre contrat et le publierait (pas de repli).
 */
export function hubsSim(o: { seed?: number; mapChunks?: number; terrain?: MapGenOptions; municipal?: boolean; extra?: SimPlugin[] } = {}): HubsTestSim {
  const muni = o.municipal === false ? null : createMunicipalPlugin();
  const hubs = createHubsPlugin();
  const base = SIM_PLUGINS.filter((p) => p.id !== 'hubs' && (muni !== null || p.id !== 'electricite'));
  const registry = base.flatMap((p) => (p.id === 'municipal' ? (muni ? [muni] : []) : [p]));
  if (muni && !registry.includes(muni)) registry.push(muni);
  const plugins: SimPlugin[] = [...registry, hubs, ...(o.extra ?? [])];
  const sim = new Simulation(plugins);
  sim.setCatalog(townCatalog());
  sim.newGame({ seed: o.seed ?? 7, mapChunks: o.mapChunks ?? 8, startMoney: 500_000_000, cityName: 'Port-Test', terrain: o.terrain ?? { hydrology: 'mer', rivers: 0, relief: 0.15 } });
  return { sim, hubs, muni };
}

export function place(sim: Simulation, type: HubType, x: number, z: number, rot: number, dryRun = false): { ok: true; data: { id: number; cost: number; y: number } } | { ok: false; message: string; code: string } {
  const r = sim.pluginCommand({ plugin: 'hubs', name: 'place', payload: { type, x, z, rot, dryRun } });
  return r.ok ? { ok: true, data: (r.data as { data: { id: number; cost: number; y: number } }).data } : { ok: false, message: r.error.message, code: r.error.code };
}

/** Commande du module (lève avec le message de la simulation en cas de refus). */
export function cmd<T = unknown>(sim: Simulation, name: string, payload?: unknown): T {
  const r = sim.pluginCommand({ plugin: 'hubs', name, payload });
  if (!r.ok) throw new Error(r.error.message);
  return (r.data as { data: T }).data;
}

/** Commande du module : résultat brut (ok / message). */
export function tryCmd(sim: Simulation, name: string, payload?: unknown): { ok: true } | { ok: false; message: string } {
  const r = sim.pluginCommand({ plugin: 'hubs', name, payload });
  return r.ok ? { ok: true } : { ok: false, message: r.error.message };
}

/** Premier emplacement valide (balayage régulier de la carte, 4 orientations). */
export function findSite(sim: Simulation, type: HubType, step = 48, rots = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]): { x: number; z: number; rot: number } | null {
  if (!sim.terrain) return null;
  const b = terrainBounds(sim.terrain);
  for (let z = b.minZ + step; z < b.maxZ - step; z += step) {
    for (let x = b.minX + step; x < b.maxX - step; x += step) {
      for (const rot of rots) if (place(sim, type, x, z, rot, true).ok) return { x, z, rot };
    }
  }
  return null;
}

/** Premier emplacement REFUSÉ pour une raison donnée (message contenant `needle`). */
export function findRefusal(sim: Simulation, type: HubType, needle: RegExp, step = 64): { x: number; z: number; rot: number; message: string } | null {
  const b = terrainBounds(sim.terrain!);
  for (let z = b.minZ + step * 3; z < b.maxZ - step * 3; z += step) {
    for (let x = b.minX + step * 3; x < b.maxX - step * 3; x += step) {
      const r = place(sim, type, x, z, 0, true);
      if (!r.ok && needle.test(r.message)) return { x, z, rot: 0, message: r.message };
    }
  }
  return null;
}
