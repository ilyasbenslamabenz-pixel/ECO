/**
 * Démo du module routier (hors jeu) : terrain généré, réseau construit par les règles de la
 * simulation (layout.ts), terrain nivelé sous les chaussées, rendu complet du réseau
 * (RoadNetworkRenderer) avec les vrais assets du catalogue (textures PBR Poly Haven, lampadaires GLB).
 * Le terrain et l'eau de cette page sont un support minimal propre à la démo (le vrai rendu du
 * terrain appartient à l'agent environnement).
 * Expose window.__roadsDemo pour les captures Playwright (tests/roads/capture.ts).
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CHUNK_TILES } from '../../../shared/constants';
import { generateTerrain, terrainBounds, terrainHeightAt } from '../../../shared/terrain-gen';
import { gradeTerrainForRoads, PathPlanner } from '../../../sim/roads';
import { AssetLibrary, fetchCatalog } from '../../assets';
import { MaterialLibrary } from '../../materials';
import { RoadNetworkRenderer } from '../renderer';
import { DEMO_MAP_CHUNKS, DEMO_SEED, buildDemoNetwork } from './layout';

interface View { pos: [number, number, number]; target: [number, number, number]; night?: boolean; fov?: number }
/** Vues : positions (x, hauteur au-dessus du sol, z). */
const VIEWS: Record<string, View> = {
  aerien: { pos: [420, 320, 380], target: [-10, 0, -110] },
  carrefour: { pos: [48, 30, -150], target: [0, 0, -200] },
  carrefour_dessus: { pos: [6, 110, -152], target: [0, 0, -200], fov: 40 },
  rue: { pos: [-95.6, 1.95, -66], target: [-99, 1.4, -140], fov: 60 },
  pietonne: { pos: [-192, 1.85, -37], target: [-120, 1.2, -42], fov: 60 },
  courbe: { pos: [330, 55, 30], target: [250, 0, 110] },
  pont: { pos: [75, 9, 525], target: [0, 3, 572] },
  autoroute: { pos: [-470, 55, 330], target: [-560, 4, 420] },
  nuit: { pos: [55, 38, -132], target: [-20, 0, -200], night: true },
};

interface DemoState {
  phase: string;
  ready: boolean;
  error: string | null;
  failures: string[];
  stats: Record<string, unknown>;
  frames: number;
  view: (name: string) => Promise<void>;
}
const state: DemoState = { phase: 'init', ready: false, error: null, failures: [], stats: {}, frames: 0, view: async () => undefined };
(window as unknown as { __roadsDemo: DemoState }).__roadsDemo = state;

async function main(): Promise<void> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb3c2cf, 900, 3200);
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.3, 8000);
  const hemi = new THREE.HemisphereLight(0xd4e0f0, 0x51493b, 0.5);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.4;
  scene.add(hemi, sun, sun.target);

  // Ciel physique + carte d'environnement (réflexions PBR).
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const su = sky.material.uniforms;
  su['turbidity']!.value = 5; su['rayleigh']!.value = 1.4; su['mieCoefficient']!.value = 0.004; su['mieDirectionalG']!.value = 0.85;
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const sunDir = new THREE.Vector3();
  const setSun = (elev: number, azim: number): void => {
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(azim));
    su['sunPosition']!.value.copy(sunDir);
    const envScene = new THREE.Scene();
    const s2 = new Sky(); s2.scale.setScalar(1000);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) s2.material.uniforms[k]!.value = su[k]!.value;
    s2.material.uniforms['sunPosition']!.value.copy(sunDir);
    envScene.add(s2);
    scene.environment = pmrem.fromScene(envScene).texture;
    scene.environmentIntensity = 0.45;
  };
  setSun(34, 205);

  const base = new URL('./assets/', location.href);
  state.phase = 'catalogue';
  const catalog = await fetchCatalog(base);
  const lib = new AssetLibrary(catalog, base);
  const materials = new MaterialLibrary(catalog, base, 8);

  state.phase = 'terrain + réseau';
  const terrain = generateTerrain(DEMO_SEED, DEMO_MAP_CHUNKS);
  const bounds = terrainBounds(terrain);
  // Le réseau est planifié sur le terrain NATUREL, puis le terrain est nivelé sous les chaussées.
  const natural = { heights: new Float32Array(terrain.heights) };
  const env = { heightAt: (x: number, z: number) => terrainHeightAt({ ...terrain, heights: natural.heights }, x, z), waterLevel: terrain.waterLevel };
  const t0 = performance.now();
  const { net, failures } = buildDemoNetwork(env, bounds);
  state.failures = failures;
  gradeTerrainForRoads(terrain, net);
  const tNet = performance.now() - t0;

  // Support de terrain de la démo : maillage par chunk texturé (herbe / terre / roche Poly Haven en projection monde).
  const grass = materials.get('terrain_herbe', { uv: 'worldXZ', tileSizeM: 3, color: '#a3b884' });
  const W = terrain.samplesX;
  for (let cz = 0; cz < (W - 1) / CHUNK_TILES; cz++) {
    for (let cx = 0; cx < (W - 1) / CHUNK_TILES; cx++) {
      const n = CHUNK_TILES + 1;
      const pos = new Float32Array(n * n * 3);
      const idx: number[] = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const gi = cx * CHUNK_TILES + i, gj = cz * CHUNK_TILES + j;
        const k = (j * n + i) * 3;
        pos[k] = terrain.originX + gi * terrain.spacing;
        pos[k + 1] = terrain.heights[gj * W + gi]!;
        pos[k + 2] = terrain.originZ + gj * terrain.spacing;
      }
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, grass);
      m.receiveShadow = true;
      scene.add(m);
    }
  }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1d3a46, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.2 }));
  water.position.y = terrain.waterLevel;
  water.receiveShadow = true;
  scene.add(water);

  state.phase = 'maillage routier';
  const roads = new RoadNetworkRenderer(scene, (x, z) => terrainHeightAt(terrain, x, z), { lib, materials });
  const t1 = performance.now();
  roads.showNetwork(net);
  const tMesh = performance.now() - t1;
  state.phase = 'chargement des assets';
  await roads.whenReady();
  await materials.whenReady();

  // Chemin A* de démonstration (vérifie que le réseau affiché est routable).
  const planner = new PathPlanner(net);
  const from = net.nodeNear(-200, -360, 30), to = net.nodeNear(0, 820, 30);
  const path = from >= 0 && to >= 0 ? planner.find(from, to) : null;

  let night = false;
  const applyNight = (on: boolean): void => {
    night = on;
    roads.setNight(on ? 1 : 0);
    if (on) {
      setSun(-6, 250);
      // Clair de lune froid + ciel nocturne : la ville reste lisible, l'éclairage public domine.
      sun.intensity = 0.35; sun.color.set(0x9db4ff); hemi.intensity = 0.32; hemi.color.set(0x3a4f80); hemi.groundColor.set(0x1a1a22);
      renderer.toneMappingExposure = 0.95;
      scene.environmentIntensity = 0.12;
      scene.fog!.color.set(0x0b1020);
    } else {
      setSun(34, 205);
      sun.intensity = 2.4; sun.color.set(0xfff0dc); hemi.intensity = 0.5; hemi.color.set(0xd4e0f0); hemi.groundColor.set(0x51493b);
      renderer.toneMappingExposure = 0.62;
      scene.fog!.color.set(0xb3c2cf);
    }
  };

  const setView = (name: string): void => {
    const v = VIEWS[name] ?? VIEWS['aerien']!;
    const gy = (x: number, z: number): number => Math.max(terrain.waterLevel, terrainHeightAt(terrain, x, z));
    camera.position.set(v.pos[0], gy(v.pos[0], v.pos[2]) + v.pos[1], v.pos[2]);
    camera.fov = v.fov ?? 50;
    camera.updateProjectionMatrix();
    const t = new THREE.Vector3(v.target[0], gy(v.target[0], v.target[2]) + v.target[1], v.target[2]);
    camera.lookAt(t);
    // Ombres cadrées sur la zone regardée.
    const d = Math.max(60, Math.min(500, camera.position.distanceTo(t) * 1.1));
    const sc = sun.shadow.camera;
    sc.left = -d; sc.right = d; sc.top = d; sc.bottom = -d; sc.near = 1; sc.far = 3000;
    sc.updateProjectionMatrix();
    sun.target.position.copy(t);
    sun.position.copy(t).addScaledVector(sunDir.lengthSq() > 0 ? sunDir : new THREE.Vector3(0, 1, 0), 1200);
    if (sunDir.y < 0) sun.position.copy(t).add(new THREE.Vector3(0, 1200, 0));
    sun.target.updateMatrixWorld();
    if (!!v.night !== night) applyNight(!!v.night);
    roads.update(camera.position.x, camera.position.y, camera.position.z);
  };

  // Rendu à la demande (SwiftShader est lent : pas de boucle continue).
  let frames = 0;
  const render = (): void => { renderer.render(scene, camera); frames++; state.frames = frames; };
  state.view = async (name: string): Promise<void> => {
    setView(name);
    render();
    await new Promise((r) => setTimeout(r, 50));
  };
  setView(new URLSearchParams(location.search).get('cam') ?? 'aerien');
  render();
  state.stats = {
    ...roads.stats(), materials: materials.stats(), networkMs: Math.round(tNet), meshMs: Math.round(tMesh),
    roadLengthM: Math.round(net.totalLength()), pathNodes: path?.nodes.length ?? 0, pathSeconds: path ? Math.round(path.cost) : null,
    textureErrors: materials.loadErrors.length,
  };
  state.phase = 'prêt';
  state.ready = true;
}

main().catch((e: unknown) => {
  state.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  state.phase = 'erreur';
});
