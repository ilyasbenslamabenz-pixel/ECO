/**
 * Scène de test du module véhicules / trafic : petite ville quadrillée (rues, avenues à feux),
 * bâtiments du catalogue (rendu instancié des bâtiments), simulation de trafic RÉELLE dans un Web Worker
 * (src/sim/traffic/demo-worker.ts), véhicules instanciés et interpolés (InstancedVehicleRenderer),
 * feux tricolores animés selon les phases simulées, carte de chaleur de densité.
 * Vues : aerien, carrefour, dessus, rue, rue_avenue, nuit, densite. API : window.__vd.
 */
import * as THREE from 'three';
import { loadHdrTexture } from '../../gzip-assets';
import type { AssetCatalog, CatalogAsset, TextureSet } from '../../../shared/catalog';
import { AssetLibrary } from '../../assets';
import { InstancedBuildingRenderer } from '../../buildings/renderer';
import { InstancedVehicleRenderer, type VehicleFrameExt } from '../renderer';
import { AVENUE_HALF, buildLayout, STREET_HALF, trafficBuildings, type DemoLayout } from './layout';

interface DemoState { ready: boolean; error: string | null; stats: Record<string, unknown>; view: (v: string) => Promise<void> }
const w = window as unknown as { __vd: DemoState };
w.__vd = { ready: false, error: null, stats: {}, view: async () => undefined };
const q = new URLSearchParams(location.search);

async function main(): Promise<void> {
  THREE.Cache.enabled = true;
  const base = new URL('/assets/', location.href);
  const get = async (f: string): Promise<unknown> => (await fetch(new URL(f, base))).json();
  const main = await get('catalog.json') as AssetCatalog;
  const frags = await Promise.all(['catalog.buildings.residential.json', 'catalog.buildings.other.json', 'catalog.vehicles.json'].map(async (f) => {
    try { return await get(f) as { assets: CatalogAsset[]; textureSets: TextureSet[] }; } catch { return { assets: [], textureSets: [] }; }
  }));
  const catalog: AssetCatalog = { ...main, assets: [...main.assets], textureSets: [...main.textureSets] };
  for (const fr of frags) {
    for (const a of fr.assets) if (!catalog.assets.some((x) => x.id === a.id)) catalog.assets.push(a);
    for (const t of fr.textureSets) if (!catalog.textureSets.some((x) => x.id === t.id)) catalog.textureSets.push(t);
  }
  const lib = new AssetLibrary(catalog, base);
  const layout = buildLayout(catalog.assets, Number(q.get('nx') ?? 8), Number(q.get('nz') ?? 6), 120, 7);

  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.3, 4000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hdrFile = (id: string): string => new URL(main.hdris.find((h) => h.id === id)!.file, base).href;
  const [dayHdr, duskHdr] = await Promise.all([loadHdrTexture(hdrFile('ciel_jour')), loadHdrTexture(hdrFile('ciel_crepuscule'))]);
  dayHdr.mapping = duskHdr.mapping = THREE.EquirectangularReflectionMapping;
  const envDay = pmrem.fromEquirectangular(dayHdr).texture, envDusk = pmrem.fromEquirectangular(duskHdr).texture;
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd2ea, 0x3a3428, 0.25);
  scene.add(hemi);

  // ------------------------------- sol et routes -------------------------------
  const tl = new THREE.TextureLoader();
  const ts = (id: string): TextureSet => catalog.textureSets.find((t) => t.id === id)!;
  const pbr = (id: string, tint = 0xffffff): THREE.MeshStandardMaterial => {
    const t = ts(id);
    const load = (f: string | undefined, srgb: boolean): THREE.Texture | null => {
      if (!f) return null;
      const x = tl.load(new URL(f, base).href);
      x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = 8;
      if (srgb) x.colorSpace = THREE.SRGBColorSpace;
      return x;
    };
    const m = new THREE.MeshStandardMaterial({ color: tint, map: load(t.albedo, true), normalMap: load(t.normal, false), roughnessMap: load(t.arm, false), aoMap: load(t.arm, false) });
    m.userData['tile'] = t.tileSizeM;
    return m;
  };
  const worldUv = (g: THREE.BufferGeometry, tile: number): void => {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / tile; uv[i * 2 + 1] = p.getZ(i) / tile; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  };
  const grassM = pbr('terrain_herbe', 0x9db27c);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(layout.size[0] + 900, layout.size[1] + 900).rotateX(-Math.PI / 2), grassM);
  worldUv(ground.geometry, grassM.userData['tile'] as number);
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);
  const asphalt = pbr('route_asphalte', 0xb8b8b8), walk = pbr('trottoir_dalles', 0xdedad2), curbM = pbr('bordure_granit');
  const lineM = new THREE.MeshStandardMaterial({ color: 0xeeeee6, roughness: 0.55 });
  const medianM = pbr('terrain_herbe', 0xaab890);
  const quadsGeo = (quads: number[][], y: number, tile: number): THREE.BufferGeometry => {
    const pos: number[] = [], idx: number[] = [];
    for (const [x0, z0, x1, z1] of quads) {
      const b = pos.length / 3;
      pos.push(x0!, y, z0!, x1!, y, z0!, x1!, y, z1!, x0!, y, z1!);
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    worldUv(g, tile);
    return g;
  };
  const roadQ: number[][] = [], walkQ: number[][] = [], lineQ: number[][] = [], medQ: number[][] = [], curbQ: number[][] = [];
  const net = layout.network;
  const nodeById = new Map(net.nodes.map((n) => [n.id, n]));
  const halfOf = (avenue: boolean): number => (avenue ? AVENUE_HALF : STREET_HALF);
  for (const e of net.edges) {
    const a = nodeById.get(e.a)!, b = nodeById.get(e.b)!;
    const avenue = e.lanesForward >= 2;
    const carriage = e.lanesForward * e.laneWidth + e.median / 2 + 0.3;
    const half = halfOf(avenue);
    const horiz = a.z === b.z;
    const t0 = 0, t1 = 0;
    void t0; void t1;
    const rect = (lo: number, hi: number, s0: number, s1: number): number[] => horiz ? [Math.min(a.x, b.x) + s0, a.z + lo, Math.max(a.x, b.x) - s1, a.z + hi] : [a.x + lo, Math.min(a.z, b.z) + s0, a.x + hi, Math.max(a.z, b.z) - s1];
    roadQ.push(rect(-carriage, carriage, 0, 0));
    // trottoirs (sauf dans l'emprise des carrefours)
    const cut = half + 1;
    walkQ.push(rect(carriage, half + 2.5, cut, cut), rect(-half - 2.5, -carriage, cut, cut));
    curbQ.push(rect(carriage, carriage + 0.25, cut, cut), rect(-carriage - 0.25, -carriage, cut, cut));
    // marquages : axe discontinu (rue) / terre-plein planté et lignes de voies (avenue)
    const L = horiz ? Math.abs(b.x - a.x) : Math.abs(b.z - a.z);
    if (avenue) {
      medQ.push(rect(-e.median / 2, e.median / 2, cut + 4, cut + 4));
      for (const off of [-(e.median / 2 + e.laneWidth), e.median / 2 + e.laneWidth]) {
        for (let s = cut + 3; s + 3 < L - cut; s += 9) lineQ.push(rect(off - 0.07, off + 0.07, s, L - s - 3));
      }
    } else {
      for (let s = cut + 2; s + 3 < L - cut; s += 7) lineQ.push(rect(-0.07, 0.07, s, L - s - 3));
    }
  }
  for (const n of net.nodes) {
    const inc = net.edges.filter((e) => e.a === n.id || e.b === n.id);
    const h = Math.max(...inc.map((e) => e.lanesForward * e.laneWidth + e.median / 2 + 0.3));
    roadQ.push([n.x - h, n.z - h, n.x + h, n.z + h]);
  }
  const roadMesh = new THREE.Mesh(quadsGeo(roadQ, 0.02, asphalt.userData['tile'] as number), asphalt);
  const walkMesh = new THREE.Mesh(quadsGeo(walkQ, 0.17, walk.userData['tile'] as number), walk);
  const curbMesh = new THREE.Mesh(quadsGeo(curbQ, 0.18, 1), curbM);
  const lineMesh = new THREE.Mesh(quadsGeo(lineQ, 0.035, 1), lineM);
  const medMesh = new THREE.Mesh(quadsGeo(medQ, 0.2, medianM.userData['tile'] as number), medianM);
  for (const m of [roadMesh, walkMesh, curbMesh, lineMesh, medMesh]) { m.receiveShadow = true; scene.add(m); }

  // ------------------------------- bâtiments -------------------------------
  const buildings = new InstancedBuildingRenderer(scene, lib);
  buildings.attachCamera(camera);
  buildings.add(layout.buildings.map((b) => ({ id: b.id, assetId: b.assetId, variant: b.variant, x: b.x, y: 0, z: b.z, rot: b.rot })));

  // ------------------------------- véhicules -------------------------------
  const vehicles = new InstancedVehicleRenderer(scene, lib);
  vehicles.attachCamera(camera);
  vehicles.preloadAll();

  // ------------------------------- feux tricolores (procéduraux) -------------------------------
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8).translate(0, 1.6, 0);
  const boxGeo = new THREE.BoxGeometry(0.34, 0.95, 0.26).translate(0, 3.0, 0);
  const lampGeo = new THREE.SphereGeometry(0.1, 10, 8);
  const darkM = new THREE.MeshStandardMaterial({ color: 0x1d2124, roughness: 0.5, metalness: 0.6 });
  const lampM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  let heads: Float32Array = new Float32Array(0);
  let poles: THREE.InstancedMesh | null = null, boxes: THREE.InstancedMesh | null = null, lamps: THREE.InstancedMesh | null = null;
  const LAMP = [new THREE.Color(4, 0.25, 0.15), new THREE.Color(4, 2.2, 0.1), new THREE.Color(0.2, 3.5, 0.8)];
  const OFF = [new THREE.Color(0.18, 0.02, 0.02), new THREE.Color(0.18, 0.12, 0.02), new THREE.Color(0.02, 0.14, 0.05)];
  const setupSignals = (h: Float32Array): void => {
    heads = h;
    const n = h.length / 4;
    poles = new THREE.InstancedMesh(poleGeo, darkM, n); boxes = new THREE.InstancedMesh(boxGeo, darkM, n); lamps = new THREE.InstancedMesh(lampGeo, lampM, n * 3);
    const m = new THREE.Matrix4(), qn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) {
      const x = h[i * 4]!, y = h[i * 4 + 1]!, z = h[i * 4 + 2]!, hd = h[i * 4 + 3]!;
      qn.setFromAxisAngle(up, hd + Math.PI); // face aux véhicules qui arrivent
      m.compose(new THREE.Vector3(x, y + 0.15, z), qn, one);
      poles.setMatrixAt(i, m); boxes.setMatrixAt(i, m);
      for (let k = 0; k < 3; k++) {
        const off = new THREE.Vector3(0, 3.3 - k * 0.3, 0.14).applyQuaternion(qn);
        m.compose(new THREE.Vector3(x, y + 0.15, z).add(off), qn, one);
        lamps.setMatrixAt(i * 3 + k, m);
        lamps.setColorAt(i * 3 + k, OFF[k]!);
      }
    }
    for (const im of [poles, boxes, lamps]) { im.castShadow = im !== lamps; scene.add(im); }
  };
  const applySignals = (states: Uint8Array): void => {
    if (!lamps) return;
    for (let i = 0; i < states.length && i * 4 < heads.length; i++) {
      const st = states[i]!; // 0 vert, 1 orange, 2 rouge
      const on = st === 0 ? 2 : st === 1 ? 1 : 0;
      for (let k = 0; k < 3; k++) lamps.setColorAt(i * 3 + k, k === on ? LAMP[k]! : OFF[k]!);
    }
    lamps.instanceColor!.needsUpdate = true;
  };

  // ------------------------------- carte de chaleur -------------------------------
  const heatGeo = new THREE.BufferGeometry();
  const heatPos: number[] = [];
  const edgeVert = new Map<number, number>();
  for (const e of net.edges) {
    const a = nodeById.get(e.a)!, b = nodeById.get(e.b)!;
    const hw = e.lanesForward * e.laneWidth + e.median / 2;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    const nx = -dz / l * hw, nz = dx / l * hw;
    edgeVert.set(e.id, heatPos.length / 3);
    heatPos.push(a.x + nx, 0.3, a.z + nz, b.x + nx, 0.3, b.z + nz, b.x - nx, 0.3, b.z - nz, a.x - nx, 0.3, a.z - nz);
  }
  heatGeo.setAttribute('position', new THREE.Float32BufferAttribute(heatPos, 3));
  const heatCol = new Float32Array(heatPos.length);
  heatGeo.setAttribute('color', new THREE.BufferAttribute(heatCol, 3));
  const hidx: number[] = [];
  for (let k = 0; k < heatPos.length / 12; k++) hidx.push(k * 4, k * 4 + 2, k * 4 + 1, k * 4, k * 4 + 3, k * 4 + 2);
  heatGeo.setIndex(hidx);
  const heat = new THREE.Mesh(heatGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  heat.visible = false;
  heat.renderOrder = 3;
  scene.add(heat);
  const applyDensity = (d: { edgeIds: Int32Array; density: Float32Array }): void => {
    const c = new THREE.Color();
    for (let i = 0; i < d.edgeIds.length; i++) {
      const v0 = edgeVert.get(d.edgeIds[i]!);
      if (v0 === undefined) continue;
      const t = Math.min(1, d.density[i]! / 60); // 60 véh/km/voie = saturé
      c.setHSL(0.33 * (1 - t), 0.9, 0.5);
      for (let k = 0; k < 4; k++) { heatCol[(v0 + k) * 3] = c.r; heatCol[(v0 + k) * 3 + 1] = c.g; heatCol[(v0 + k) * 3 + 2] = c.b; }
    }
    (heatGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  };

  // ------------------------------- worker de trafic -------------------------------
  const vehicleCatalog: AssetCatalog = { ...catalog };
  const worker = new Worker(new URL('traffic-worker.js', location.href));
  let lastStats: Record<string, unknown> = {};
  let frames = 0;
  let workerInfo: Record<string, unknown> = {};
  const workerReady = new Promise<void>((resolve, reject) => {
    worker.onerror = (e) => reject(new Error(`worker : ${e.message}`));
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: string; heads?: Float32Array; frame?: VehicleFrameExt; signals?: Uint8Array; stats?: Record<string, unknown>; density?: { edgeIds: Int32Array; density: Float32Array } };
      if (m.type === 'ready') { setupSignals(m.heads!); workerInfo = { ...m, heads: m.heads!.length / 4 }; resolve(); }
      if (m.type === 'frame') {
        vehicles.setFrame(m.frame!);
        if (m.signals) applySignals(m.signals);
        if (m.density) applyDensity(m.density);
        lastStats = m.stats!;
        frames++;
      }
    };
  });
  const hour0 = Number(q.get('heure') ?? 8.2);
  worker.postMessage({
    type: 'init', catalog: vehicleCatalog, network: layout.network, buildings: trafficBuildings(layout),
    seed: 7, demandScale: Number(q.get('demande') ?? 2), maxVehicles: Number(q.get('max') ?? 2500), hour: hour0, speed: 1, warmup: Number(q.get('prechauffe') ?? 900),
  });

  // ------------------------------- vues -------------------------------
  const hud = document.getElementById('hud')!;
  let night = 0;
  const setNight = (n: number): void => {
    night = n;
    scene.environment = n > 0.5 ? envDusk : envDay;
    scene.background = n > 0.5 ? new THREE.Color(0x0a1022) : envDay;
    scene.backgroundBlurriness = 0.3;
    scene.environmentIntensity = n > 0.5 ? 0.12 : 1;
    sun.intensity = n > 0.5 ? 0.05 : 2.4;
    hemi.intensity = n > 0.5 ? 0.04 : 0.25;
    renderer.toneMappingExposure = n > 0.5 ? 1.1 : 0.9;
    vehicles.setNight(n);
    buildings.setNight(n);
  };
  setNight(0);
  const nodesSig = (): { x: number; z: number } => ({ x: 0, z: 0 });
  const ox = -layout.size[0] / 2, oz = -layout.size[1] / 2;
  const avX = ox + layout.avenueCols[0]! * layout.step, avZ = oz + layout.avenueRows[0]! * layout.step;
  void nodesSig;
  const VIEWS: Record<string, () => void> = {
    aerien: () => { camera.fov = 50; camera.position.set(avX + 330, 260, avZ + 360); camera.lookAt(avX - 20, 0, avZ - 10); },
    carrefour: () => { camera.fov = 45; camera.position.set(avX + 2, 34, avZ + 66); camera.lookAt(avX - 2, 0, avZ - 4); },
    dessus: () => { camera.fov = 40; camera.position.set(avX + 0.1, 95, avZ + 0.1); camera.lookAt(avX, 0, avZ); },
    rue: () => { camera.fov = 60; camera.position.set(avX - 11.2, 1.7, avZ + 70); camera.lookAt(avX - 4, 1.2, avZ - 40); },
    rue_avenue: () => { camera.fov = 60; camera.position.set(avX - 75, 1.7, avZ - 13); camera.lookAt(avX + 40, 2, avZ - 2); },
    nuit: () => { camera.fov = 50; camera.position.set(avX + 3, 60, avZ + 150); camera.lookAt(avX - 5, 0, avZ - 30); },
    densite: () => { camera.fov = 50; camera.position.set(0.1, 900, 380); camera.lookAt(0, 0, 0); },
  };
  let current = q.get('vue') ?? 'aerien';
  const apply = (v: string): void => {
    current = v;
    heat.visible = v === 'densite';
    setNight(v === 'nuit' ? 1 : 0);
    worker.postMessage({ type: 'hour', hour: v === 'nuit' ? 21.5 : hour0 });
    (VIEWS[v] ?? VIEWS['aerien']!)();
    camera.updateProjectionMatrix();
    const t = new THREE.Vector3(); camera.getWorldDirection(t);
    const focus = camera.position.clone().addScaledVector(t, Math.min(400, camera.position.y * 2 + 60));
    sun.position.set(focus.x + 220, 380, focus.z + 160); sun.target.position.copy(focus);
    const sc = sun.shadow.camera, r = Math.min(500, 80 + camera.position.y * 1.6);
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 10; sc.far = 1200; sc.updateProjectionMatrix();
  };
  apply(current);

  const clock = new THREE.Clock();
  let fps = 0;
  const loop = (): void => {
    const dt = clock.getDelta();
    fps = fps * 0.9 + (dt > 0 ? 1 / dt : 0) * 0.1;
    const c = camera.position;
    buildings.update(c.x, c.y, c.z);
    vehicles.update(dt);
    renderer.render(scene, camera);
    const st = vehicles.stats();
    hud.textContent = `Démo trafic — vue « ${current} » · véhicules simulés ${String(lastStats['vehicles'] ?? 0)} · dessinés ${st.drawn.join('/')} (LOD0/1/2) · vitesse moy. ${Number(lastStats['meanSpeedKmh'] ?? 0).toFixed(1)} km/h · à l'arrêt ${String(lastStats['stopped'] ?? 0)} · feux ${String(lastStats['signals'] ?? 0)} · ${fps.toFixed(1)} i/s${night ? ' · nuit' : ''}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  await workerReady;
  buildings.preloadAll();
  await Promise.all([vehicles.whenReady(), buildings.whenReady()]);
  // attend quelques trames de simulation
  while (frames < 5) await new Promise((r) => setTimeout(r, 100));
  w.__vd.stats = {};
  Object.defineProperty(w.__vd, 'stats', { get: () => ({ sim: lastStats, render: vehicles.stats(), worker: workerInfo, buildings: layout.buildings.length, frames, errors: vehicles.loadErrors }) });
  w.__vd.view = async (v: string): Promise<void> => {
    apply(v);
    // laisse passer quelques trames (interpolation, feux) puis deux rendus complets
    const f0 = frames;
    while (frames < f0 + 4) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  w.__vd.ready = true;
}

main().catch((e: unknown) => { w.__vd.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e); });
