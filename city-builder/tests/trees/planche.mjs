// Planche de contrôle des arbres générés, rendue avec Three.js (celui du projet, en lecture seule) dans Chromium.
// Éclairage proche du jeu (src/render/scene.ts + environment.ts) : ciel Sky + PMREM (intensité 0,35),
// hémisphère 0xcfdcf0/0x4a4436 0,45, soleil 0xfff1dc 2,2 (élévation 38°, azimut 140°), ACES exposition 0,8,
// ombres PCF douces. Les vues « rangée » et « parc » utilisent InstancedMesh + instanceColor comme vegetation.ts.
// Usage : node planche.mjs [dossierModeles] [sortie.png]
import pw from '/opt/node-tools/node_modules/playwright/index.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const MODELS = process.argv[2] ?? ICI;
const OUT = process.argv[3] ?? join(ICI, 'planche_arbres.png');
const THREE_DIR = '/home/user/ECO/city-builder/node_modules/three';
const SPECIES = (process.env.SPECIES ?? 'arbre_feuillu_rond,arbre_feuillu_jeune,arbre_peuplier,arbre_platane')
  .split(',').filter((s) => existsSync(join(MODELS, `${s}_lod0.glb`)));

const W = 1500;
const CELL = 500;
const ROWH = 620;
const H = SPECIES.length * CELL + ROWH * 2;

const page_html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#222;font:600 17px system-ui,sans-serif;color:#fff}
#c{position:absolute;left:0;top:0}
.l{position:absolute;padding:3px 8px;background:rgba(0,0,0,.55);border-radius:4px;white-space:pre}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body><canvas id="c" width="${W}" height="${H}" style="width:${W}px;height:${H}px"></canvas>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
const SPECIES = ${JSON.stringify(SPECIES)};
const W = ${W}, H = ${H}, CELL = ${CELL}, ROWH = ${ROWH};
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
// ciel + carte d'environnement (comme environment.ts)
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(140));
const sky = new Sky(); sky.scale.setScalar(10000);
const u = sky.material.uniforms;
u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.85;
u.sunPosition.value.copy(sunDir);
scene.add(sky);
const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(1000);
for (const k of ['turbidity','rayleigh','mieCoefficient','mieDirectionalG']) envSky.material.uniforms[k].value = u[k].value;
envSky.material.uniforms.sunPosition.value.copy(sunDir); envScene.add(envSky);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(envScene).texture;
scene.environmentIntensity = 0.35;
scene.fog = new THREE.Fog(0xa9bccd, 1400, 4200);
const hemi = new THREE.HemisphereLight(0xcfdcf0, 0x4a4436, 0.45); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
function aimSun(x, z, r) {
  sun.target.position.set(x, 0, z); sun.position.set(x, 0, z).addScaledVector(sunDir, 300);
  const sc = sun.shadow.camera; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 50; sc.far = 700;
  sc.updateProjectionMatrix(); sun.target.updateMatrixWorld();
}
// sol : herbe + allée
const grass = new THREE.MeshStandardMaterial({ color: 0x55663a, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), grass);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const loader = new GLTFLoader();
const load = (f) => new Promise((res, rej) => loader.load('/m/' + f, res, undefined, rej));
const label = (txt, x, y) => { const d = document.createElement('div'); d.className = 'l'; d.textContent = txt; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); };
const info = {};
const models = {};
for (const s of SPECIES) {
  models[s] = [];
  for (let l = 0; l < 3; l++) {
    const g = await load(s + '_lod' + l + '.glb');
    let tri = 0; const parts = [];
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; tri += o.geometry.index.count / 3; parts.push({ geometry: o.geometry, material: o.material }); } });
    const box = new THREE.Box3().setFromObject(g.scene);
    models[s].push({ root: g.scene, parts, tri, box });
  }
}
// --- 1. grille espèces x LOD (un arbre par case, cadrage identique pour les 3 LOD d'une espèce)
renderer.setScissorTest(true);
renderer.setClearColor(0x000000);
const cells = [];
SPECIES.forEach((s, i) => {
  const b0 = models[s][0].box; const hgt = b0.max.y; const wid = Math.max(b0.max.x - b0.min.x, b0.max.z - b0.min.z);
  for (let l = 0; l < 3; l++) {
    const x0 = (i * 3 + l) * 200; const z0 = 0;
    const r = models[s][l].root; r.position.set(x0, 0, z0); scene.add(r);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.5, 3000);
    const dist = Math.max(hgt, wid) * 0.5 / Math.tan(THREE.MathUtils.degToRad(16)) * 1.12;
    cam.position.set(x0 + dist * 0.25, hgt * 0.42 + dist * 0.12, z0 + dist * 0.97);
    cam.lookAt(x0, hgt * 0.47, z0);
    cells.push({ cam, x: l * CELL, y: i * CELL, x0, z0, r: Math.max(hgt, wid) });
    label(s + '  LOD' + l + '\\n' + models[s][l].tri + ' triangles', l * CELL + 8, i * CELL + 8);
  }
});
for (const c of cells) {
  aimSun(c.x0, c.z0, c.r);
  renderer.setViewport(c.x, H - c.y - CELL, CELL, CELL); renderer.setScissor(c.x, H - c.y - CELL, CELL, CELL);
  renderer.render(scene, c.cam);
}
for (const s of SPECIES) for (const m of models[s]) scene.remove(m.root);
// --- instanciation façon vegetation.ts
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function instancedScene(items, cam) {
  // items: {s, x, z, rot, scale}; LOD choisi selon la distance (50 / 120 m comme le jeu)
  const groups = new Map();
  for (const it of items) {
    const d = Math.hypot(it.x - cam.position.x, it.z - cam.position.z, cam.position.y);
    const lod = d < 50 ? 0 : d < 120 ? 1 : 2;
    const k = it.s + ':' + lod; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it);
  }
  const added = []; const counts = [0, 0, 0];
  for (const [k, list] of groups) {
    const [s, lod] = k.split(':'); counts[+lod] += list.length;
    for (const p of models[s][+lod].parts) {
      const im = new THREE.InstancedMesh(p.geometry, p.material, list.length);
      list.forEach((it, i) => {
        _p.set(it.x, 0, it.z); _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot); _s.setScalar(it.scale);
        im.setMatrixAt(i, _m.compose(_p, _q, _s));
        const b = 0.89 + it.tint * 0.22, warm = (it.warm - 0.4) * 0.12; // même variation que vegetation.ts
        im.setColorAt(i, _c.setRGB(b * (1 + warm), b, b * (1 - warm * 0.8)));
      });
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false; scene.add(im); added.push(im);
    }
  }
  return { added, counts };
}
// --- 2. rangée d'arbres à hauteur d'homme
const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 900), new THREE.MeshStandardMaterial({ color: 0x5a5a5c, roughness: 0.95 }));
road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, -440); road.receiveShadow = true; scene.add(road);
const walkL = road.clone(); walkL.material = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 }); walkL.scale.x = 0.33; walkL.position.x = -6.2; scene.add(walkL);
const walkR = walkL.clone(); walkR.position.x = 6.2; scene.add(walkR);
{
  const cam = new THREE.PerspectiveCamera(55, W / ROWH, 0.3, 3000);
  cam.position.set(-1.5, 1.7, 6); cam.lookAt(0.5, 4.2, -60);
  const L = SPECIES.length > 3 ? [SPECIES[0], SPECIES[3]] : [SPECIES[0], SPECIES[1] ?? SPECIES[0]];
  const R = SPECIES.length > 2 ? [SPECIES[2], SPECIES[1]] : [SPECIES[1] ?? SPECIES[0], SPECIES[0]];
  const items = [];
  for (let i = 0; i < 40; i++) {
    const z = -2 - i * 9;
    items.push({ s: L[Math.floor(i / 4) % 2], x: -8.5 + rnd() * 0.6, z, rot: rnd() * 6.28, scale: 0.92 + rnd() * 0.16, tint: rnd(), warm: rnd() });
    items.push({ s: R[Math.floor(i / 5) % 2], x: 8.5 + rnd() * 0.6, z: z - 4, rot: rnd() * 6.28, scale: 0.92 + rnd() * 0.16, tint: rnd(), warm: rnd() });
  }
  const { added, counts } = instancedScene(items, cam);
  aimSun(0, -40, 90);
  const y = SPECIES.length * CELL;
  renderer.setViewport(0, H - y - ROWH, W, ROWH); renderer.setScissor(0, H - y - ROWH, W, ROWH);
  renderer.render(scene, cam);
  info.row = counts;
  label('Rangée à hauteur d’homme (1,7 m) — LOD0 < 50 m, LOD1 < 120 m, LOD2 au-delà — instances LOD0/1/2 : ' + counts.join(' / '), 8, y + 8);
  for (const a of added) scene.remove(a);
}
scene.remove(road, walkL, walkR);
// --- 3. parc vu en oblique (caméra de jeu rapprochée)
{
  const cam = new THREE.PerspectiveCamera(50, W / ROWH, 1, 3000);
  cam.position.set(0, 38, 62); cam.lookAt(0, 0, -25);
  const items = [];
  for (let i = 0; i < 260; i++) {
    const x = (rnd() - 0.5) * 160, z = -rnd() * 150 + 20;
    if (Math.abs(x) < 7 && z > -30) continue;
    items.push({ s: SPECIES[i % SPECIES.length], x, z, rot: rnd() * 6.28, scale: 0.88 + rnd() * 0.25, tint: rnd(), warm: rnd() });
  }
  const { added, counts } = instancedScene(items, cam);
  aimSun(0, -40, 110);
  const y = SPECIES.length * CELL + ROWH;
  renderer.setViewport(0, H - y - ROWH, W, ROWH); renderer.setScissor(0, H - y - ROWH, W, ROWH);
  renderer.render(scene, cam);
  info.park = counts;
  label('Parc, caméra oblique (38 m de haut) — instances LOD0/1/2 : ' + counts.join(' / '), 8, y + 8);
  for (const a of added) scene.remove(a);
}
info.renderer = renderer.getContext().getParameter(renderer.getContext().VERSION);
window.__done = info;
</script></body></html>`;

const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const MIME = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };
await page.route('http://arbres.local/**', async (route) => {
  const url = new URL(route.request().url());
  let file = null;
  if (url.pathname === '/') return route.fulfill({ body: page_html, contentType: 'text/html' });
  if (url.pathname.startsWith('/three/')) file = join(THREE_DIR, url.pathname.slice(7));
  else if (url.pathname.startsWith('/m/')) file = join(MODELS, url.pathname.slice(3));
  if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: 'absent' });
  return route.fulfill({ body: readFileSync(file), contentType: MIME[extname(file)] ?? 'application/octet-stream' });
});
const t0 = Date.now();
await page.goto('http://arbres.local/');
await page.waitForFunction(() => window.__done, null, { timeout: 600000, polling: 500 });
const info = await page.evaluate(() => window.__done);
await page.screenshot({ path: OUT, fullPage: true });
console.log(JSON.stringify(info), `rendu ${(Date.now() - t0) / 1000} s ->`, OUT);
await browser.close();
