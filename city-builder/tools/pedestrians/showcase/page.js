// Page de rendu des planches-contact des piétons (bundlée par esbuild, pilotée par run.mjs via Playwright).
// Applique la palette comme le jeu : couleur = palette[rangée][partie] × COLOR_0 (occlusion cuite).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();
let renderer = null;

function charger(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
}

function texturePalette(couleurs) {
  const data = new Uint8Array(8 * 4);
  couleurs.forEach((hex, i) => {
    const c = new THREE.Color(hex); // sRGB -> stocké tel quel, la texture est marquée sRGB
    const n = parseInt(hex.slice(1), 16);
    data.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], i * 4);
    void c;
  });
  const t = new THREE.DataTexture(data, 8, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function scene() {
  const sc = new THREE.Scene();
  sc.background = new THREE.Color('#aebfd0');
  sc.add(new THREE.HemisphereLight('#cfe0ff', '#7d735f', 1.15));
  const sun = new THREE.DirectionalLight('#fff1d8', 2.6);
  sun.position.set(3.2, 5, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 2.4, bottom: -0.6, near: 0.5, far: 14 });
  sun.shadow.bias = -0.0015;
  sun.shadow.normalBias = 0.01;
  sc.add(sun);
  const contre = new THREE.DirectionalLight('#dfe8ff', 0.9);
  contre.position.set(-3, 3, -4);
  sc.add(contre);
  const sol = new THREE.Mesh(new THREE.CircleGeometry(1.5, 48), new THREE.MeshStandardMaterial({ color: '#b9b4a8', roughness: 1 }));
  sol.rotation.x = -Math.PI / 2;
  sol.receiveShadow = true;
  sc.add(sol);
  return sc;
}

/**
 * spec = { largeur, hauteur, cols, rows, cellules: [{ url, urlAnim?, palette: [8 hex], lacet (deg), clip?, phase?,
 *          cible?: [x,y,z], champ?: hauteur visible en m, etiquette }] }
 */
window.rendrePlanche = async (spec) => {
  const { largeur, hauteur, cols, rows, cellules } = spec;
  const canvas = document.getElementById('c');
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(largeur, hauteur, false);
  canvas.style.width = largeur + 'px';
  canvas.style.height = hauteur + 'px';
  const racine = document.getElementById('etiquettes');
  racine.innerHTML = '';
  racine.style.width = largeur + 'px';
  racine.style.height = hauteur + 'px';
  const cw = largeur / cols;
  const chh = hauteur / rows;
  renderer.setScissorTest(true);
  const infos = [];
  for (let i = 0; i < cellules.length; i++) {
    const cel = cellules[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const sc = scene();
    const gltf = await charger(cel.url);
    const src = cel.urlAnim ? await charger(cel.urlAnim) : gltf;
    const obj = gltf.scene;
    const mat = new THREE.MeshStandardMaterial({ map: texturePalette(cel.palette), vertexColors: true, roughness: 0.85, metalness: 0 });
    let maillages = 0;
    obj.traverse((o) => {
      if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; maillages++; }
    });
    obj.rotation.set(0, 0, 0);
    const mixer = new THREE.AnimationMixer(obj);
    if (cel.clip) {
      const clip = src.animations.find((a) => a.name === cel.clip);
      if (!clip) throw new Error('clip absent : ' + cel.clip + ' dans ' + (cel.urlAnim || cel.url));
      const act = mixer.clipAction(clip);
      act.play();
      mixer.setTime(clip.duration * (cel.phase || 0) * 0.99999);
    }
    sc.add(obj);
    const champ = cel.champ || 2.1;
    const cible = new THREE.Vector3(...(cel.cible || [0, 0.93, 0]));
    const cam = new THREE.PerspectiveCamera(16, cw / chh, 0.1, 80);
    const dist = champ / 2 / Math.tan((16 * Math.PI) / 360);
    const a = ((cel.lacet || 0) * Math.PI) / 180;
    const el = ((cel.elevation ?? 8) * Math.PI) / 180;
    cam.position.set(cible.x + dist * Math.sin(a) * Math.cos(el), cible.y + dist * Math.sin(el), cible.z + dist * Math.cos(a) * Math.cos(el));
    cam.lookAt(cible);
    const x = col * cw;
    const y = hauteur - (row + 1) * chh;
    renderer.setViewport(x, y, cw, chh);
    renderer.setScissor(x, y, cw, chh);
    renderer.render(sc, cam);
    mixer.stopAllAction();
    mixer.uncacheRoot(obj);
    sc.remove(obj);
    mat.map.dispose();
    mat.dispose();
    const d = document.createElement('div');
    d.className = 'et';
    d.style.left = col * cw + 4 + 'px';
    d.style.top = row * chh + 3 + 'px';
    d.textContent = cel.etiquette || '';
    racine.appendChild(d);
    infos.push({ maillages });
  }
  renderer.setScissorTest(false);
  return infos;
};
window.pret = true;
