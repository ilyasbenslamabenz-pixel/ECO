/**
 * Point d'entrée du module rendu (intégration) : assemble les sous-systèmes des agents et applique
 * instantanés / deltas venant du worker. Aucun état de jeu ici : tout vient de la simulation.
 *
 *  - ciel / lumière / ombres : SkySystem (HDRI Poly Haven, soleil astronomique, nuit) ;
 *  - terrain : TerrainSystem (chunks LOD en streaming, maillage en worker, PBR multi-couches) ;
 *  - eau : WaterSystem (mer/lac, rivières, réflexions) ;
 *  - végétation : VegetationSystem (semis déterministe, instancié, imposteurs lointains) ;
 *  - routes : RoadNetworkRenderer (tronçons courbes, carrefours, ponts, décor instancié, nuit) ;
 *  - bâtiments : InstancedBuildingRenderer (GLB LOD0/1/2 instanciés, culling, fenêtres la nuit) ;
 *  - véhicules : InstancedVehicleRenderer (trafic interpolé, LOD, phares la nuit).
 */
import * as THREE from 'three';
import type { AssetCatalog } from '../shared/catalog';
import { TILE_SIZE } from '../shared/constants';
import type { BuildingRecord, CameraPose, RoadEdgeRecord } from '../shared/contracts';
import { rotAngle } from '../shared/footprint';
import type { DeltaMessage, SnapshotMessage } from '../shared/protocol';
import { cubic, polyline } from '../sim/roads/bezier';
import { halfWidth, isRoadKind } from '../sim/roads/types';
import { isWorldTerrain } from '../sim/terrain';
import type { TerrainPatch } from '../sim/terrain/types';
import { AssetLibrary } from './assets';
import { InstancedBuildingRenderer } from './buildings/renderer';
import { nightFactorForHour } from './buildings/materials';
import { VegetationSystem } from './nature/vegetation';
import { RoadNetworkRenderer } from './roads/renderer';
import { initScene, type RenderContext } from './scene';
import { SkySystem } from './sky/sky-system';
import { TerrainSystem } from './terrain/renderer';
import { InstancedVehicleRenderer } from './vehicles/renderer';
import { WaterSystem } from './water/water-system';

export interface RenderStats {
  /** Appels de rendu et triangles de la dernière image (ombres comprises). */
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  buildings: number;
  vehiclesDrawn: number;
  vegetation: number;
  terrainTriangles: number;
  frameMs: number;
}

export interface RenderHandle {
  ctx: RenderContext;
  sky: SkySystem;
  terrain: TerrainSystem;
  water: WaterSystem;
  roads: RoadNetworkRenderer;
  buildings: InstancedBuildingRenderer;
  vehicles: InstancedVehicleRenderer;
  veg: VegetationSystem;
  /** Heure simulée -> soleil, lune, fenêtres et lampadaires. */
  setTimeOfDay(hour: number): void;
  /** Cadre des ombres sur la zone regardée. */
  followView(p: CameraPose): void;
  applySnapshot(s: SnapshotMessage): void;
  applyDelta(d: DeltaMessage): void;
  /** Charge tous les modèles (démo, porte de validation) et attend la fin des chargements en cours. */
  whenReady(preloadAll?: boolean): Promise<void>;
  stats(): RenderStats;
}

export async function initRender(canvas: HTMLCanvasElement, lib: AssetLibrary, catalog: AssetCatalog, assetsBase: URL): Promise<RenderHandle> {
  const ctx = initScene(canvas);
  const sky = await SkySystem.create({
    renderer: ctx.renderer, scene: ctx.scene, sun: ctx.sun, hemi: ctx.hemi, catalog, assetsBase,
    shadowMapSize: Math.min(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1) > 1100 ? 4096 : 2048,
  });
  const terrain = new TerrainSystem(ctx.scene, { catalog, assetsBase });
  const water = new WaterSystem(ctx.scene);
  const heightAt = (x: number, z: number): number => terrain.heightAt(x, z);
  const veg = new VegetationSystem(ctx.scene, lib, { heightAt, renderer: ctx.renderer });
  await veg.load();
  const roads = new RoadNetworkRenderer(ctx.scene, heightAt, { lib });
  const buildings = new InstancedBuildingRenderer(ctx.scene, lib);
  buildings.attachCamera(ctx.camera);
  const vehicles = new InstancedVehicleRenderer(ctx.scene, lib);
  vehicles.attachCamera(ctx.camera);
  const buildingIds = new Set<number>();
  const assets = new Map(catalog.assets.map((a) => [a.id, a]));
  let lastHour = -1;
  let frameMs = 0;

  const clearVegForBuildings = (list: readonly BuildingRecord[]): void => {
    for (const b of list) {
      const a = assets.get(b.assetId);
      if (!a) continue;
      veg.removeInFootprint(b.x, b.z, (a.footprint.tilesX * TILE_SIZE) / 2, (a.footprint.tilesZ * TILE_SIZE) / 2, rotAngle(b.rot), 1.5);
    }
  };
  const clearVegForRoads = (nodes: SnapshotMessage['roads']['nodes'], edges: readonly RoadEdgeRecord[]): void => {
    const pos = new Map<number, { x: number; z: number }>();
    for (const n of nodes) pos.set(n.id, n);
    for (const e of edges) {
      const a = pos.get(e.a) ?? (roads.net.hasNode(e.a) ? roads.net.nodePos(e.a) : null);
      const b = pos.get(e.b) ?? (roads.net.hasNode(e.b) ? roads.net.nodePos(e.b) : null);
      if (!a || !b) continue;
      const c1 = e.c1 ?? [a.x + (b.x - a.x) / 3, a.z + (b.z - a.z) / 3];
      const c2 = e.c2 ?? [a.x + ((b.x - a.x) * 2) / 3, a.z + ((b.z - a.z) * 2) / 3];
      const poly = polyline(cubic(a.x, a.z, c1[0], c1[1], c2[0], c2[1], b.x, b.z), Math.max(1, Math.ceil(e.length / 12)));
      const hw = halfWidth(e.kind && isRoadKind(e.kind) ? e.kind : e.type) + 1.5;
      for (let k = 0; k + 3 < poly.length; k += 2) veg.removeAlongSegment(poly[k]!, poly[k + 1]!, poly[k + 2]!, poly[k + 3]!, hw);
    }
  };

  const handle: RenderHandle = {
    ctx, sky, terrain, water, roads, buildings, vehicles, veg,
    setTimeOfDay(hour) {
      if (Math.abs(hour - lastHour) < 1 / 120) return;
      lastHour = hour;
      sky.setTimeOfDay(hour);
      veg.syncLights(ctx.sun, ctx.hemi, sky.ambientSky, sky.ambientGround);
      const n = nightFactorForHour(hour);
      buildings.setNight(n);
      roads.setNight(n);
      vehicles.setNight(n);
    },
    followView(p) {
      sky.followView(p.targetX, p.targetY, p.targetZ, Math.min(900, Math.max(60, p.distance)));
    },
    applySnapshot(s) {
      terrain.build(s.terrain);
      water.build(s.terrain);
      if (isWorldTerrain(s.terrain)) veg.scatter(s.terrain);
      roads.removeRoadEdges(roads.net.segmentIds());
      buildings.remove([...buildingIds]);
      buildingIds.clear();
      vehicles.setVehicles(new Float32Array(0), new Uint16Array(0), 0);
      roads.addRoads(s.roads.nodes, s.roads.edges);
      clearVegForRoads(s.roads.nodes, s.roads.edges);
      buildings.add(s.buildings);
      for (const b of s.buildings) buildingIds.add(b.id);
      clearVegForBuildings(s.buildings);
      handle.setTimeOfDay(s.stats.date.hour + s.stats.date.minute / 60);
    },
    applyDelta(d) {
      if (d.terrainPatch) {
        const p = d.terrainPatch as TerrainPatch;
        terrain.applyPatch(p);
        water.applyPatch(p);
      }
      if (d.roadEdgesRemoved.length) roads.removeRoadEdges(d.roadEdgesRemoved);
      if (d.roadNodesAdded.length || d.roadEdgesAdded.length) {
        roads.addRoads(d.roadNodesAdded, d.roadEdgesAdded);
        clearVegForRoads(d.roadNodesAdded, d.roadEdgesAdded);
      }
      if (d.buildingsRemoved.length) { buildings.remove(d.buildingsRemoved); for (const id of d.buildingsRemoved) buildingIds.delete(id); }
      if (d.buildingsAdded.length) {
        buildings.add(d.buildingsAdded);
        for (const b of d.buildingsAdded) buildingIds.add(b.id);
        clearVegForBuildings(d.buildingsAdded);
      }
      if (d.vehicles) vehicles.setFrame(d.vehicles);
      else if (vehicles.count > 0) vehicles.setVehicles(new Float32Array(0), new Uint16Array(0), 0);
      handle.setTimeOfDay(d.stats.date.hour + d.stats.date.minute / 60);
    },
    async whenReady(preloadAll = false) {
      if (preloadAll) { buildings.preloadAll(); vehicles.preloadAll(); }
      await Promise.all([terrain.ready, roads.whenReady(), buildings.whenReady(), vehicles.whenReady()]);
    },
    stats() {
      const info = ctx.renderer.info;
      const vs = vehicles.stats();
      return {
        calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
        buildings: buildings.count, vehiclesDrawn: vs.drawn.reduce((a, b) => a + b, 0), vegetation: veg.count,
        terrainTriangles: terrain.stats().triangles, frameMs,
      };
    },
  };

  const camPos = new THREE.Vector3();
  ctx.onFrame.push((dt) => {
    const t0 = performance.now();
    const cam = ctx.camera;
    cam.getWorldPosition(camPos);
    terrain.update(cam);
    water.update(dt);
    sky.update(dt, cam);
    veg.update(cam);
    roads.update(camPos.x, camPos.y, camPos.z);
    buildings.update(camPos.x, camPos.y, camPos.z);
    vehicles.update(dt);
    frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
  });
  return handle;
}
