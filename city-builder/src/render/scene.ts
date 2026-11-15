/**
 * Contexte de rendu Three.js : renderer, scène, caméra, lumière principale et boucle.
 * Propriétaire : agent intégration (voir AGENT_TASKS.md).
 */
import * as THREE from 'three';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Callbacks appelés à chaque frame avant le rendu (dt en secondes). */
  onFrame: ((dt: number) => void)[];
  start(): void;
  stop(): void;
  /** Une image immédiate (mêmes callbacks que la boucle), boucle arrêtée ou non : tests et captures. */
  renderNow(dt?: number): void;
  /** Nombre de frames rendues (diagnostic / e2e). */
  readonly frames: number;
  /** Réglages de cadence (téléphone : moins de chaleur, pas de ralentissement thermique). */
  perf: RenderPerf;
}

export interface RenderPerf {
  /** Images par seconde maximales (0 = sans limite : cadence de l'écran). */
  maxFps: number;
  /** Vrai quand rien ne bouge (jeu en pause, caméra immobile, aucun geste) : 4 images par seconde suffisent. */
  idle: () => boolean;
  /** Ombres recalculées seulement quand le soleil ou la zone regardée bouge, sinon une image sur `shadowEvery`. */
  shadowEvery: number;
  /** Résolution adaptative (rapport de pixels) : null = fixe. */
  adaptive: { min: number; max: number } | null;
  /** Rapport de pixels courant choisi par la résolution adaptative (diagnostic). */
  ratio: number;
}

export function initScene(canvas: HTMLCanvasElement): RenderContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap est retiré de three 0.187 (remplacé à l'exécution par PCFShadowMap, avec avertissement) :
  // même rendu, sans l'avertissement.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // Objets opaques groupés par PROGRAMME (shader) avant le matériau : three triait par matériau seul, et les
  // ≈ 500 matériaux des bâtiments alternaient leurs programmes (≈ 400 changements par image, chacun suivi du renvoi
  // des uniformes caméra / lumières). L'ordre n'influe que sur l'état GL, jamais sur l'image (objets opaques,
  // test de profondeur) ; un identifiant périmé après recompilation ne change que l'ordre.
  const props = renderer.properties;
  const progKey = (m: THREE.Material): number => {
    const c = m as THREE.Material & { __aubePk?: number };
    let k = c.__aubePk;
    if (!k) { k = (props.get(m) as { currentProgram?: { id: number } }).currentProgram?.id ?? 0; c.__aubePk = k; }
    return k;
  };
  renderer.setOpaqueSort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder
    || progKey(a.material) - progKey(b.material) || a.material.id - b.material.id || a.z - b.z || a.id - b.id);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb8cf);
  scene.fog = new THREE.Fog(0xa9bccd, 1400, 4200);

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);
  camera.position.set(0, 300, 400);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xcfdcf0, 0x4a4436, 0.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(400, 600, 250);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -400; sc.right = 400; sc.top = 400; sc.bottom = -400; sc.near = 10; sc.far = 2000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  const resize = (): void => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const onFrame: ((dt: number) => void)[] = [];
  let last = performance.now();
  let frames = 0;
  let running = false;
  const perf: RenderPerf = { maxFps: 0, idle: () => false, shadowEvery: 1, adaptive: null, ratio: 0 };
  // Ombres : clé (position du soleil et de sa cible) ; recalcul si elle change, sinon une image sur N.
  let shadowKey = '', shadowCount = 0;
  const updateShadows = (): void => {
    if (perf.shadowEvery <= 1 || !renderer.shadowMap.enabled) { renderer.shadowMap.autoUpdate = true; return; }
    renderer.shadowMap.autoUpdate = false;
    const p = sun.position, t = sun.target.position;
    const key = `${Math.round(p.x / 4)},${Math.round(p.y / 4)},${Math.round(p.z / 4)}|${Math.round(t.x / 8)},${Math.round(t.z / 8)}`;
    if (key !== shadowKey || ++shadowCount >= perf.shadowEvery) { shadowKey = key; shadowCount = 0; renderer.shadowMap.needsUpdate = true; }
  };
  // Résolution adaptative : monte d'un cran si la cadence visée tient 3 s, descend si elle décroche 1,5 s.
  let winStart = performance.now(), winFrames = 0, holdUntil = 0;
  // Rapport auquel la cadence a décroché : on n'y remonte pas avant 2 min (pas d'oscillation montée / descente).
  let failRatio = Infinity, failUntil = 0;
  const adapt = (now: number): void => {
    const a = perf.adaptive;
    if (!a) return;
    if (perf.ratio <= 0) perf.ratio = renderer.getPixelRatio();
    winFrames++;
    const span = now - winStart;
    const target = perf.maxFps > 0 ? perf.maxFps : 60;
    const fps = (1000 * winFrames) / Math.max(1, span);
    let next = perf.ratio;
    if (span > 1500 && fps < target * 0.8) { next = Math.max(a.min, perf.ratio - 0.25); holdUntil = now + 20000; failRatio = perf.ratio; failUntil = now + 120000; }
    else if (span > 3000 && fps > target * 0.93 && now > holdUntil) {
      next = Math.min(a.max, perf.ratio + 0.25);
      if (next >= failRatio - 1e-3 && now < failUntil) next = perf.ratio;
    }
    else if (span <= 3000) return;
    winStart = now; winFrames = 0;
    if (Math.abs(next - perf.ratio) > 1e-3) {
      perf.ratio = next;
      renderer.setPixelRatio(next);
      const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
    }
  };
  let lastDraw = 0;
  const loop = (): void => {
    if (!running) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    // Cadence : plafond choisi, ou 4 images/s quand rien ne bouge (petite marge pour l'irrégularité de l'écran).
    const cap = perf.idle() ? 4 : perf.maxFps;
    if (cap > 0 && now - lastDraw < 1000 / cap - 2) return;
    lastDraw = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const f of onFrame) f(dt);
    updateShadows();
    // L'ombre suit la zone regardée par la caméra.
    renderer.render(scene, camera);
    frames++;
    if (cap !== 4) adapt(now); else { winStart = now; winFrames = 0; }
  };

  return {
    renderer, scene, camera, sun, hemi, onFrame, perf,
    start() {
      if (running) return;
      running = true; last = performance.now();
      // Fenêtre de mesure de la résolution adaptative remise à zéro : sinon, au retour d'arrière-plan, la durée
      // passée boucle arrêtée compte comme des images manquées et la résolution baisse à tort.
      winStart = last; winFrames = 0;
      requestAnimationFrame(loop);
    },
    stop() { running = false; },
    renderNow(dt = 1 / 30) {
      for (const f of onFrame) f(dt);
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      frames++;
    },
    get frames() { return frames; },
  };
}
