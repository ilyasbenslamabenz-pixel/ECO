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
 *  - véhicules : InstancedVehicleRenderer (trafic interpolé, LOD, phares la nuit) ;
 *  - feux tricolores : TrafficSignalRenderer (poteaux / potences et têtes instanciés, état de la simulation) ;
 *  - modules de phase 2 : RenderPluginHost (src/render/plugins) reçoit `ext[id]` des instantanés / deltas et
 *    est appelé à chaque image (`frame`) ; registre de modules vides = aucun effet.
 */
import * as THREE from 'three';
import type { AssetCatalog } from '../shared/catalog';
import { TILE_SIZE } from '../shared/constants';
import type { BuildingRecord, CameraPose, RoadEdgeRecord } from '../shared/contracts';
import { rotAngle } from '../shared/footprint';
import { SIGNAL_HEAD_STRIDE, type DeltaMessage, type SignalLayoutMsg, type SnapshotMessage } from '../shared/protocol';
import { cubic, cubicLength, polyline } from '../sim/roads/bezier';
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
import { TrafficSignalRenderer } from './traffic/signals';
import { InstancedVehicleRenderer } from './vehicles/renderer';
import { RENDER_PLUGINS, RenderPluginHost, type RenderPlugin } from './plugins';
import { WaterSystem } from './water/water-system';
import { deviceProfile, isSafeMode, type DeviceProfile, type QualitySetting } from './device-profile';

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
  /** Reconstruit ce qui vit seulement sur le GPU après une restauration du contexte WebGL. */
  rebuildGpu(): void;
  /** Profil de rendu retenu (mode allégé sur téléphone). */
  profile: DeviceProfile;
  sky: SkySystem;
  terrain: TerrainSystem;
  water: WaterSystem;
  roads: RoadNetworkRenderer;
  buildings: InstancedBuildingRenderer;
  vehicles: InstancedVehicleRenderer;
  signals: TrafficSignalRenderer;
  veg: VegetationSystem;
  /** Modules de rendu de phase 2 (registre src/render/plugins/index.ts). */
  plugins: RenderPluginHost;
  /** Libère les ressources des modules de rendu. */
  disposePlugins(): void;
  /** Heure simulée -> soleil, lune, fenêtres et lampadaires. */
  setTimeOfDay(hour: number): void;
  /** Cadre des ombres sur la zone regardée. */
  followView(p: CameraPose): void;
  applySnapshot(s: SnapshotMessage): void;
  applyDelta(d: DeltaMessage): void;
  /** Charge tous les modèles (démo, porte de validation) et attend la fin des chargements en cours. */
  whenReady(preloadAll?: boolean): Promise<void>;
  stats(): RenderStats;
  /** Végétation qui recouvre une chaussée (diagnostic e2e : doit rester vide). */
  vegOnRoads(): { x: number; z: number; r: number; assetId: string }[];
}

export async function initRender(
  canvas: HTMLCanvasElement, lib: AssetLibrary, catalog: AssetCatalog, assetsBase: URL, renderPlugins: readonly RenderPlugin[] = RENDER_PLUGINS,
  quality: QualitySetting = 'auto',
): Promise<RenderHandle> {
  const ctx = initScene(canvas);
  const profile = deviceProfile(quality);
  // Mode allégé : toute texture d'image plus grande est réduite par three avant l'envoi au GPU (resizeImage).
  // Fixé AVANT tout envoi ; la carte d'ombre a déjà lu la vraie limite à la création du rendu.
  if (Number.isFinite(profile.gpuTextureCap)) ctx.renderer.capabilities.maxTextureSize = Math.min(ctx.renderer.capabilities.maxTextureSize, profile.gpuTextureCap);
  const cycleJourNuit = (() => { try { const q = new URLSearchParams(globalThis.location?.search ?? ''); return q.get('nuit') === '1' || q.has('h'); } catch { return false; } })();
  const sky = await SkySystem.create({
    renderer: ctx.renderer, scene: ctx.scene, sun: ctx.sun, hemi: ctx.hemi, catalog, assetsBase,
    shadowMapSize: profile.lite ? profile.shadowSize : Math.min(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1) > 1100 ? 4096 : 2048,
  });
  // Textures du sol (3 tableaux de 5 couches) : 1024 px sur ordinateur, 512 en mode allégé, 256 en mode sûr.
  const terrain = new TerrainSystem(ctx.scene, { catalog, assetsBase, textureSize: profile.lite ? (isSafeMode() ? 256 : 512) : 1024 });
  const water = new WaterSystem(ctx.scene);
  const heightAt = (x: number, z: number): number => terrain.heightAt(x, z);
  const veg = new VegetationSystem(ctx.scene, lib, { heightAt, renderer: ctx.renderer, distances: profile.vegDistances });
  await veg.load();
  const roads = new RoadNetworkRenderer(ctx.scene, heightAt, { lib, treeImpostor: (id) => veg.impostorMaterial(id) });
  const buildings = new InstancedBuildingRenderer(ctx.scene, lib, { lodBias: profile.buildingLodBias });
  buildings.attachCamera(ctx.camera);
  buildings.attachRenderer(ctx.renderer);
  const vehicles = new InstancedVehicleRenderer(ctx.scene, lib);
  vehicles.attachCamera(ctx.camera);
  const signals = new TrafficSignalRenderer(ctx.scene);
  const buildingIds = new Set<number>();
  const assets = new Map(catalog.assets.map((a) => [a.id, a]));
  let lastHour = -1;
  let frameMs = 0;
  let night = 0;
  const plugins = new RenderPluginHost(renderPlugins);
  await plugins.init({
    scene: ctx.scene, camera: ctx.camera, renderer: ctx.renderer, sun: ctx.sun, catalog, lib, heightAt, nightFactor: () => night, vegetation: veg,
  });

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
      // Arbres plantés compris : une route tracée sur un alignement ou un parc les remplace.
      for (let k = 0; k + 3 < poly.length; k += 2) veg.removeAlongSegment(poly[k]!, poly[k + 1]!, poly[k + 2]!, poly[k + 3]!, hw, true);
    }
  };
  /** Végétation dont l'emprise recouvre la chaussée d'une route du rendu (diagnostic e2e : doit rester vide). */
  const vegOnRoads = (): { x: number; z: number; r: number; assetId: string }[] => {
    const segs: number[] = [];
    for (const id of roads.net.segmentIds()) {
      const c = roads.net.curve(id);
      const poly = polyline(c, Math.max(1, Math.ceil(cubicLength(c) / 12)));
      const hw = halfWidth(roads.net.kindOf(id));
      for (let k = 0; k + 3 < poly.length; k += 2) segs.push(poly[k]!, poly[k + 1]!, poly[k + 2]!, poly[k + 3]!, hw);
    }
    return veg.overlapping((x, z, r) => {
      for (let k = 0; k < segs.length; k += 5) {
        const ax = segs[k]!, az = segs[k + 1]!, dx = segs[k + 2]! - ax, dz = segs[k + 3]! - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
        const w = segs[k + 4]! + r;
        if ((x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2 < w * w) return true;
      }
      return false;
    });
  };

  /** Le décor routier (lampadaires, arbres) s'écarte des pieds de mâts de feux (disposition lue, jamais modifiée). */
  const setSignalObstacles = (layout: SignalLayoutMsg): void => {
    const n = layout.nodeIds.length;
    const xz = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { xz[i * 2] = layout.heads[i * SIGNAL_HEAD_STRIDE]!; xz[i * 2 + 1] = layout.heads[i * SIGNAL_HEAD_STRIDE + 2]!; }
    roads.setDecorObstacles(xz, layout.nodeIds);
  };

  const handle: RenderHandle = {
    ctx, profile, sky, terrain, water, roads, buildings, vehicles, signals, veg, plugins,
    disposePlugins() { plugins.dispose(); },
    rebuildGpu() { sky.rebuildEnvironment(); veg.rebakeImpostors(ctx.renderer); buildings.invalidate(); },
    setTimeOfDay(hour) {
      // Toujours de jour (demande du propriétaire, allège le rendu) : lumière fixe de début d'après-midi.
      // Le cycle jour/nuit reste disponible avec ?nuit=1 (ou une heure imposée ?h=, captures) ; l'horloge de la simulation n'est pas touchée.
      if (!cycleJourNuit) hour = 14;
      if (Math.abs(hour - lastHour) < 1 / 120) return;
      lastHour = hour;
      sky.setTimeOfDay(hour);
      veg.syncLights(ctx.sun, ctx.hemi, sky.ambientSky, sky.ambientGround);
      const n = nightFactorForHour(hour);
      night = n;
      buildings.setNight(n);
      roads.setNight(n);
      vehicles.setNight(n);
      signals.setNight(n);
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
      signals.clear(); // la disposition des feux arrive avec le delta suivant
      roads.setDecorObstacles([], []);
      roads.addRoads(s.roads.nodes, s.roads.edges);
      clearVegForRoads(s.roads.nodes, s.roads.edges);
      buildings.add(s.buildings);
      for (const b of s.buildings) buildingIds.add(b.id);
      clearVegForBuildings(s.buildings);
      plugins.applySnapshot(s.ext);
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
      if (d.signals) {
        signals.apply(d.signals);
        if (d.signals.layout) setSignalObstacles(d.signals.layout);
      }
      if (d.vehicles) vehicles.setFrame(d.vehicles);
      else if (vehicles.count > 0) vehicles.setVehicles(new Float32Array(0), new Uint16Array(0), 0);
      if (d.ext) plugins.applyDelta(d.ext);
      handle.setTimeOfDay(d.stats.date.hour + d.stats.date.minute / 60);
    },
    async whenReady(preloadAll = false) {
      // Mode allégé : pas de préchargement de TOUS les modèles (mémoire) ; chargement à la demande.
      if (preloadAll && profile.preloadAll) { buildings.preloadAll(); vehicles.preloadAll(); }
      await Promise.all([terrain.ready, roads.whenReady(), buildings.whenReady(), vehicles.whenReady()]);
    },
    vegOnRoads,
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
    plugins.frame(dt);
    frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
  });
  return handle;
}
