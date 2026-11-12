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
  /** Nombre de frames rendues (diagnostic / e2e). */
  readonly frames: number;
}

export function initScene(canvas: HTMLCanvasElement): RenderContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb8cf);
  scene.fog = new THREE.Fog(0xb7c7d6, 900, 3200);

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);
  camera.position.set(0, 300, 400);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x5a5242, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
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
  const loop = (): void => {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const f of onFrame) f(dt);
    // L'ombre suit la zone regardée par la caméra.
    renderer.render(scene, camera);
    frames++;
    requestAnimationFrame(loop);
  };

  return {
    renderer, scene, camera, sun, hemi, onFrame,
    start() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); } },
    stop() { running = false; },
    get frames() { return frames; },
  };
}
