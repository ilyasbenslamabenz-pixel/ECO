// Monde 3D Babylon.js : moteur, caméra stratégique, ciel et cycle jour/nuit, ombres, météo,
// sélection, étiquettes. Toutes les données affichées proviennent des instantanés du serveur.
import {
  ArcRotateCamera, CascadedShadowGenerator, Color3, Color4, DirectionalLight, DynamicTexture, Engine, GlowLayer, HemisphericLight,
  Matrix, MeshBuilder, ParticleSystem, PointerEventTypes, Scene, StandardMaterial, Vector3, type ArcRotateCameraPointersInput, type Mesh,
} from '@babylonjs/core';
import type { CountryDef } from '../../../shared/sim/types';
import { useStore, type Quality } from '../store';
import { ENV, buildGrid, type Grid } from './terrain';
import { createForests, createTerrain, createWaterAndNetwork } from './landscape';
import { createCities } from './cities';
import { createInfrastructure } from './infra';
import { createTraffic, weatherFor } from './life';
import { createAirSea } from './airsea'; // --- aéroport et port ---
import { upgradeWater } from './water';
import { createPostProcessing, timeOfDay } from './post';
import { startCityModels } from './cityModels'; // --- vie urbaine : modèles Blender ---
import { atmosphere, createSky } from './sky';

const Q: Record<Quality, { scale: number; step: number; block: number; trees: number; cars: number; shadows: number; precip: number; glow: boolean }> = {
  low: { scale: 1.25, step: 3, block: 0.28, trees: 6000, cars: 1500, shadows: 0, precip: 1500, glow: false },
  medium: { scale: 1, step: 2, block: 0.2, trees: 15000, cars: 3500, shadows: 1024, precip: 3000, glow: true },
  high: { scale: 1 / Math.min(2, window.devicePixelRatio || 1), step: 1, block: 0.2, trees: 30000, cars: 6000, shadows: 2048, precip: 5000, glow: true },
}

export const camApi = { focus: (_x: number, _z: number, _dist?: number) => {} };

export function createWorld(canvas: HTMLCanvasElement, country: CountryDef, quality: Quality, labelsRoot: HTMLElement) {
  const q = Q[quality];
  const engine = new Engine(canvas, quality !== 'low', { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, false);
  engine.setHardwareScalingLevel(q.scale);
  const scene = new Scene(engine);
  (window as unknown as { __ecoScene?: Scene }).__ecoScene = scene; // inspection (tests navigateur)
  scene.clearColor = new Color4(0.55, 0.75, 0.95, 1);
  scene.fogMode = Scene.FOGMODE_EXP2; // perspective aérienne : la brume s'épaissit avec la distance
  scene.fogDensity = 0.02;
  scene.fogColor = new Color3(0.7, 0.82, 0.95);
  const grid: Grid = buildGrid(country);
  // --- vie urbaine --- : bibliothèque de modèles chargée en arrière-plan (avant la création des systèmes qui s'y abonnent)
  startCityModels(scene);

  // Caméra stratégique : glisser = déplacer, clic droit = pivoter, molette = zoom
  const cap = country.cities.find((c) => c.capital) ?? country.cities[0];
  const camera = new ArcRotateCamera('cam', -Math.PI / 2.4, 0.9, 16, new Vector3(cap.x, grid.y(cap.x, cap.z), cap.z), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 0.25;
  camera.upperRadiusLimit = 95;
  camera.lowerBetaLimit = 0.15;
  camera.upperBetaLimit = 1.38;
  camera.minZ = 0.02;
  camera.maxZ = 2500;
  camera.wheelDeltaPercentage = 0.02;
  camera.panningSensibility = 900;
  camera.mapPanning = true;
  camera.inertia = 0.85;
  camera.panningInertia = 0.85;
  const pointers = camera.inputs.attached.pointers as ArcRotateCameraPointersInput;
  pointers.buttons = [0, 1, 2];
  (pointers as unknown as { _panningMouseButton: number })._panningMouseButton = 0;
  pointers.angularSensibilityX = 700;
  pointers.angularSensibilityY = 700;
  camera.keysUp = []; camera.keysDown = []; camera.keysLeft = []; camera.keysRight = [];

  // Lumières
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.7;
  hemi.groundColor = new Color3(0.35, 0.32, 0.28);
  const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.3), scene);
  sun.position = new Vector3(200, 300, 100);
  sun.intensity = 2.2;
  let shadow: CascadedShadowGenerator | null = null;
  if (q.shadows) {
    shadow = new CascadedShadowGenerator(q.shadows, sun);
    shadow.numCascades = 3;
    shadow.lambda = 0.85;
    shadow.shadowMaxZ = 18;
    shadow.stabilizeCascades = true;
    shadow.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
    shadow.bias = 0.002;
  }
  const glow = q.glow ? new GlowLayer('glow', scene, { mainTextureSamples: 1, blurKernelSize: 32 }) : null;
  if (glow) glow.intensity = 0;

  // Ciel : dôme dégradé maison (heure dorée, nuit, météo) + étoiles
  const sky = createSky(scene, quality === 'low');
  const starTex = new DynamicTexture('stars', 1024, scene, false);
  {
    const c = starTex.getContext() as CanvasRenderingContext2D;
    c.fillStyle = '#000';
    c.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 1400; i++) {
      c.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`;
      c.fillRect(Math.random() * 1024, Math.random() * 1024, Math.random() < 0.1 ? 2 : 1, Math.random() < 0.1 ? 2 : 1);
    }
    starTex.update();
  }
  const starMat = new StandardMaterial('starMat', scene);
  starMat.emissiveTexture = starTex;
  starMat.opacityTexture = starTex;
  starMat.disableLighting = true;
  starMat.backFaceCulling = false;
  starMat.fogEnabled = false;
  const stars = MeshBuilder.CreateSphere('stars', { diameter: 1800, segments: 16, sideOrientation: 1 }, scene);
  stars.material = starMat;
  stars.infiniteDistance = true;
  stars.isPickable = false;

  // Paysage, villes, équipements, vie
  const terrain = createTerrain(scene, grid, country, q.step);
  createWaterAndNetwork(scene, grid, country);
  // eau réfléchissante (miroir désactivé en qualité basse) et rendu cinématographique
  const water = upgradeWater(scene, quality === 'high' ? 1024 : quality === 'medium' ? 512 : 0);
  const post = createPostProcessing(scene, camera, quality);
  const forests = createForests(scene, grid, country, q.trees);
  const cities = createCities(scene, grid, country, q.block);
  let infra = createInfrastructure(scene, grid, country);
  const traffic = createTraffic(scene, grid, country, q.cars);
  const airsea = createAirSea(scene, grid, country);
  if (shadow) {
    // --- bâtiments --- : chaque gabarit instancié projette ses ombres (la boîte de sélection est invisible)
    for (const m of cities.shadowCasters) shadow.addShadowCaster(m);
    shadow.addShadowCaster(forests.tree);
    for (const r of infra.roots) shadow.addShadowCaster(r);
    terrain.receiveShadows = true; // --- bâtiments --- : les gabarits reçoivent déjà les ombres
  }

  // Précipitations autour de la caméra
  const dropTex = new DynamicTexture('drop', 16, scene, false);
  { const c = dropTex.getContext() as CanvasRenderingContext2D; const g = c.createRadialGradient(8, 8, 0, 8, 8, 8); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 16, 16); dropTex.hasAlpha = true; dropTex.update(); }
  const precip = new ParticleSystem('precip', q.precip, scene);
  precip.particleTexture = dropTex;
  precip.emitter = new Vector3();
  precip.minEmitBox = new Vector3(-6, 3, -6);
  precip.maxEmitBox = new Vector3(6, 5, 6);
  precip.minLifeTime = 1.2; precip.maxLifeTime = 1.6;
  precip.blendMode = ParticleSystem.BLENDMODE_STANDARD;

  // Sélection et survol
  const ring = MeshBuilder.CreateTorus('selection', { diameter: 2, thickness: 0.06, tessellation: 64 }, scene);
  const ringMat = new StandardMaterial('ringMat', scene);
  ringMat.emissiveColor = Color3.FromHexString('#ffd166');
  ringMat.disableLighting = true;
  ring.material = ringMat;
  ring.isPickable = false;
  ring.setEnabled(false);
  const pickers: Mesh[] = country.cities.map((c) => {
    const m = MeshBuilder.CreateCylinder('picker', { diameter: 2, height: 0.12, tessellation: 20 }, scene);
    m.position.set(c.x, grid.y(c.x, c.z) + 0.05, c.z);
    m.scaling.set(c.radius * 1.1, 1, c.radius * 1.1);
    m.visibility = 0;
    m.metadata = { kind: 'city', id: c.id };
    return m;
  });
  void pickers;
  let downX = 0, downY = 0;
  scene.onPointerObservable.add((pi) => {
    const ev = pi.event as PointerEvent;
    if (pi.type === PointerEventTypes.POINTERDOWN) { downX = ev.clientX; downY = ev.clientY; }
    if (pi.type === PointerEventTypes.POINTERUP && ev.button === 0 && Math.hypot(ev.clientX - downX, ev.clientY - downY) < 6) {
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => !!m.metadata || m === cities.box);
      const st = useStore.getState();
      if (pick?.hit && pick.pickedMesh) {
        const md = (pick.pickedMesh.metadata ?? pick.pickedMesh.parent?.metadata) as { kind: 'city' | 'infra'; id: number } | undefined;
        if (md) st.set({ selection: { kind: md.kind, id: md.id } });
        else if (pick.pickedMesh === cities.box && pick.thinInstanceIndex >= 0) {
          const ci = cities.cityOfInstance(pick.thinInstanceIndex);
          if (ci >= 0) st.set({ selection: { kind: 'city', id: ci } });
        }
      } else st.set({ selection: null });
    }
  });

  // Étiquettes DOM
  labelsRoot.innerHTML = '';
  const labels = country.cities.map((c) => {
    const d = document.createElement('div');
    d.className = `city-label ${c.kind}${c.capital ? ' capital' : ''}`;
    d.textContent = (c.capital ? '★ ' : '') + c.name;
    d.onclick = () => useStore.getState().set({ selection: { kind: 'city', id: c.id } });
    labelsRoot.appendChild(d);
    return d;
  });

  // Caméra : déplacements clavier et animation de focus
  const keys = new Set<string>();
  const kd = (e: KeyboardEvent) => { if (!(e.target as HTMLElement).closest('input,textarea,select')) keys.add(e.code); };
  const ku = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  let anim: { from: Vector3; to: Vector3; r0: number; r1: number; t: number } | null = null;
  camApi.focus = (x, z, dist = 4) => { anim = { from: camera.target.clone(), to: new Vector3(x, grid.y(x, z), z), r0: camera.radius, r1: dist, t: 0 }; };
  // --- routes et circulation --- : placement immédiat de la caméra (captures de vérification)
  (camApi as unknown as Record<string, unknown>).view = (x: number, z: number, dist: number, alpha: number, beta: number) => { anim = null; camera.target = new Vector3(x, grid.y(x, z), z); camera.radius = dist; camera.alpha = alpha; camera.beta = beta; };

  // Réactions aux instantanés du serveur
  let initialPop: number[] | null = null;
  let lastEmFactor = -1;
  let initialEmp = 0;
  let initialEm = 0;
  let lastMonth = -1;
  const applySnap = () => {
    const snap = useStore.getState().snap;
    if (!snap) return;
    if (!initialPop) {
      initialPop = snap.cities.map((c) => c.population);
      initialEmp = snap.demography.employed;
      initialEm = snap.accounts.emissions;
    }
    cities.update(snap.cities.map((c, i) => c.population / Math.max(1, initialPop![i])));
    traffic.setActivity(snap.demography.employed / Math.max(1, initialEmp));
    const ef = snap.accounts.emissions / Math.max(1, initialEm);
    if (Math.abs(ef - lastEmFactor) > 0.005) { infra.setEmissionFactor(ef); lastEmFactor = ef; }
    if (snap.month !== lastMonth) {
      lastMonth = snap.month;
      const m = snap.month % 12;
      ENV.winter = (1 + Math.cos((m / 12) * Math.PI * 2)) / 2;
      ENV.autumn = Math.exp(-((m - 9.5) ** 2) / 2.5);
      const w = (window as unknown as { __ecoWeather?: ReturnType<typeof weatherFor> }).__ecoWeather ?? weatherFor(country.seed, snap.month); // météo forcée : inspection (tests navigateur)
      const goldenSet = (useStore.getState().settings.timeMode ?? 'golden') === 'golden';
      ENV.snow = w === 'neige' ? (goldenSet ? 0.6 : 1) : 0; // heure dorée : neige plus légère, le zinc des toits reste lisible
      ENV.wet = w === 'pluie' || w === 'orage' ? 1 : 0;
      forests.recolor();
      const active = w === 'pluie' || w === 'orage' || w === 'neige';
      if (active) {
        const snow = w === 'neige';
        precip.color1 = snow ? new Color4(1, 1, 1, 0.9) : new Color4(0.75, 0.85, 1, 0.6);
        precip.color2 = precip.color1;
        precip.minSize = snow ? 0.025 : 0.008; precip.maxSize = snow ? 0.04 : 0.014;
        precip.gravity = new Vector3(0, snow ? -0.8 : -6, 0);
        precip.emitRate = q.precip * (w === 'orage' ? 1.2 : 0.8);
        precip.start();
      } else precip.stop();
      weather = w;
    }
  };
  let weather = weatherFor(country.seed, 0);
  const unsub = useStore.subscribe((s, prev) => {
    if (s.snap !== prev.snap) applySnap();
    // nouveaux équipements, chantiers, mises en service : seuls les équipements sont reconstruits
    if (s.country && prev.country && s.country.infra !== prev.country.infra) {
      infra.dispose();
      infra = createInfrastructure(scene, grid, s.country);
      if (shadow) for (const r of infra.roots) shadow.addShadowCaster(r);
      lastEmFactor = -1;
      applySnap();
    }
    if (s.selection !== prev.selection) updateRing(s.selection);
  });
  const updateRing = (sel: ReturnType<typeof useStore.getState>['selection']) => {
    let x = 0, z = 0, r = 0;
    if (sel?.kind === 'city') { const c = country.cities[sel.id]; x = c.x; z = c.z; r = c.radius * 1.1; }
    if (sel?.kind === 'infra') { const i = (useStore.getState().country ?? country).infra.find((k) => k.id === sel.id); if (i) { x = i.x; z = i.z; r = i.type === 'aeroport' ? 1.6 : 0.3; } }
    ring.setEnabled(r > 0);
    ring.position.set(x, grid.y(x, z) + 0.05, z);
    ring.scaling.set(r, Math.max(0.05, r * 0.3), r);
  };
  applySnap();

  // Boucle de rendu
  const startTime = performance.now();
  const tmp = new Vector3();
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    const { dayLength, timeMode } = useStore.getState().settings;
    const t = timeOfDay(timeMode ?? 'golden', (performance.now() - startTime) / 1000, dayLength);
    const ang = (t - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    ENV.time = t;
    // le joueur a choisi l'heure dorée : la météo reste lisible (pluie, neige, voile) sans éteindre la lumière
    const goldenMode = (timeMode ?? 'golden') === 'golden';
    const cloudRaw = weather === 'nuageux' ? 0.35 : weather === 'pluie' || weather === 'brouillard' ? 0.55 : weather === 'orage' ? 0.75 : weather === 'neige' ? 0.5 : 0;
    const cloudy = cloudRaw * (goldenMode ? 0.45 : 1);
    const atm = atmosphere(elev, cloudy);
    ENV.night = atm.lamps; // éclairage artificiel (fenêtres, lampadaires) : déjà allumé à l'heure dorée
    const night = atm.dark; // obscurité réelle (ciel, étoiles, lumière ambiante)
    const sunDir = new Vector3(Math.cos(ang), Math.max(-0.4, elev), 0.35).normalize();
    sky.update(atm, sunDir, cloudy, dt);
    sun.direction = sunDir.scale(-1);
    sun.position = camera.target.add(sunDir.scale(40));
    sun.intensity = atm.sunI;
    sun.diffuse.copyFrom(atm.sunCol);
    sun.specular.copyFrom(atm.sunCol);
    hemi.intensity = atm.hemiI;
    hemi.diffuse.copyFrom(atm.hemiSky);
    hemi.groundColor.copyFrom(atm.hemiGround);
    hemi.specular.set(0, 0, 0);
    starMat.alpha = night * (1 - cloudy);
    // brume : couleur de l'horizon (dorée au couchant), densité adaptée à l'échelle de la vue
    const fog = weather === 'brouillard' ? Color3.Lerp(atm.haze, new Color3(0.62, 0.62, 0.64).scale(1 - night * 0.8), goldenMode ? 0.35 : 0.7) : atm.haze;
    scene.fogColor = fog;
    scene.clearColor = new Color4(fog.r, fog.g, fog.b, 1);
    const reach = 20 + camera.radius * 2.6; // distance (km) où la brume voile environ la moitié de la scène
    scene.fogDensity = (0.83 / reach) * (1 + cloudy * 0.6) * (weather === 'brouillard' ? (goldenMode ? 2.2 : 3.5) : 1);
    if (glow) glow.intensity = Math.max(0, ENV.night - 0.45) * 1.4; // halos des feux : la nuit seulement (pas de voile à l'heure dorée)
    water.update(dt, camera.radius);
    post.update();
    // déplacement clavier
    const speed = camera.radius * 0.9 * dt;
    const fwd = camera.target.subtract(camera.position); fwd.y = 0; fwd.normalize();
    const right = new Vector3(fwd.z, 0, -fwd.x);
    tmp.setAll(0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) tmp.addInPlace(fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) tmp.subtractInPlace(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) tmp.subtractInPlace(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) tmp.addInPlace(right);
    if (tmp.lengthSquared() > 0) camera.target.addInPlace(tmp.normalize().scale(speed * 1.5));
    if (keys.has('KeyQ')) camera.alpha += dt * 1.2;
    if (keys.has('KeyE')) camera.alpha -= dt * 1.2;
    if (anim) {
      anim.t = Math.min(1, anim.t + dt * 1.6);
      const e = anim.t < 0.5 ? 2 * anim.t * anim.t : 1 - Math.pow(-2 * anim.t + 2, 2) / 2;
      camera.target = Vector3.Lerp(anim.from, anim.to, e);
      camera.radius = anim.r0 + (anim.r1 - anim.r0) * e;
      if (anim.t >= 1) anim = null;
    }
    camera.target.x = Math.max(-34, Math.min(34, camera.target.x));
    camera.target.z = Math.max(-26, Math.min(26, camera.target.z));
    camera.target.y = grid.y(camera.target.x, camera.target.z);
    const minY = grid.y(camera.position.x, camera.position.z) + 0.05;
    if (camera.position.y < minY) camera.beta = Math.max(camera.lowerBetaLimit!, camera.beta - 0.02);
    // météo et vie
    (precip.emitter as Vector3).set(camera.position.x, camera.position.y - 4, camera.position.z);
    traffic.update(dt);
    airsea.update(dt);
    infra.animate(dt);
    // étiquettes
    const show = useStore.getState().settings.labels;
    const rw = engine.getRenderWidth();
    const rh = engine.getRenderHeight();
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const vp = camera.viewport.toGlobal(rw, rh);
    const tm = scene.getTransformMatrix();
    country.cities.forEach((c, i) => {
      const el = labels[i];
      const world = new Vector3(c.x, grid.y(c.x, c.z) + (c.kind === 'metropole' ? 0.45 : 0.15), c.z);
      const p = Vector3.Project(world, Matrix.IdentityReadOnly, tm, vp);
      const dist = Vector3.Distance(camera.position, world);
      const maxD = c.kind === 'metropole' ? 160 : c.kind === 'ville' ? 55 : 28;
      const sx = (p.x / rw) * cw;
      const sy = (p.y / rh) * ch;
      const vis = show && p.z > 0 && p.z < 1 && dist < maxD && sx > -50 && sx < cw + 50 && sy > -20 && sy < ch + 20;
      el.style.display = vis ? 'block' : 'none';
      if (vis) el.style.transform = `translate(-50%, -100%) translate(${sx}px, ${sy}px)`;
    });
  });

  engine.runRenderLoop(() => scene.render());
  const onResize = () => engine.resize();
  window.addEventListener('resize', onResize);

  return () => {
    unsub();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', kd);
    window.removeEventListener('keyup', ku);
    labelsRoot.innerHTML = '';
    engine.stopRenderLoop();
    water.dispose();
    post.dispose();
    scene.dispose();
    engine.dispose();
  };
}
