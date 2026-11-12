/**
 * Point d'entrée du module rendu : assemble les sous-systèmes et applique
 * instantanés / deltas venant du worker. Chaque sous-système appartient à un agent
 * (voir AGENT_TASKS.md) et respecte une interface de src/shared/contracts.ts.
 */
import type { DeltaMessage, SnapshotMessage } from '../shared/protocol';
import { AssetLibrary } from './assets';
import { BuildingRenderer } from './buildings';
import { initEnvironment, type EnvironmentHandle } from './environment';
import { RoadRenderer } from './roads';
import { initScene, type RenderContext } from './scene';
import { TerrainRenderer } from './terrain';
import { VehicleRenderer } from './vehicles';
import { WaterRenderer } from './water';

export interface RenderHandle {
  ctx: RenderContext;
  env: EnvironmentHandle;
  terrain: TerrainRenderer;
  water: WaterRenderer;
  roads: RoadRenderer;
  buildings: BuildingRenderer;
  vehicles: VehicleRenderer;
  applySnapshot(s: SnapshotMessage): void;
  applyDelta(d: DeltaMessage): void;
}

export function initRender(canvas: HTMLCanvasElement, lib: AssetLibrary): RenderHandle {
  const ctx = initScene(canvas);
  const env = initEnvironment(ctx);
  const terrain = new TerrainRenderer(ctx.scene);
  const water = new WaterRenderer(ctx.scene);
  let roads = new RoadRenderer(ctx.scene, (x, z) => terrain.heightAt(x, z));
  let buildings = new BuildingRenderer(ctx.scene, lib);
  const vehicles = new VehicleRenderer();

  const handle: RenderHandle = {
    ctx, env, terrain, water, roads, buildings, vehicles,
    applySnapshot(s) {
      terrain.build(s.terrain);
      water.build(s.terrain);
      roads.dispose();
      buildings.dispose();
      roads = new RoadRenderer(ctx.scene, (x, z) => terrain.heightAt(x, z));
      buildings = new BuildingRenderer(ctx.scene, lib);
      handle.roads = roads;
      handle.buildings = buildings;
      roads.addRoads(s.roads.nodes, s.roads.edges);
      buildings.add(s.buildings);
    },
    applyDelta(d) {
      if (d.roadEdgesRemoved.length) roads.removeRoadEdges(d.roadEdgesRemoved);
      if (d.roadNodesAdded.length || d.roadEdgesAdded.length) roads.addRoads(d.roadNodesAdded, d.roadEdgesAdded);
      if (d.buildingsRemoved.length) buildings.remove(d.buildingsRemoved);
      if (d.buildingsAdded.length) buildings.add(d.buildingsAdded);
      if (d.vehicles) vehicles.setVehicles(d.vehicles.positions, d.vehicles.assetIndices, d.vehicles.count);
    },
  };
  ctx.onFrame.push((dt) => {
    const c = ctx.camera.position;
    handle.buildings.update(c.x, c.y, c.z);
    vehicles.update(dt);
  });
  return handle;
}
