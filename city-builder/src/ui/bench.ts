/**
 * Page de mesure de performance dans le navigateur (`index.html?bench`, `artifact.html?bench`, ou `#bench`).
 *
 * Charge la ville de démonstration (graine fixe), joue un parcours de caméra scripté et déterministe (positions
 * fonction du TEMPS écoulé, pas du nombre d'images), puis affiche un tableau lisible en capture d'écran avec un
 * bouton « Copier les résultats ». Aucune donnée n'est envoyée sur le réseau.
 *
 * Paramètres : `bench` (parcours complet ≈ 80 s) ou `bench=court` (≈ 15 s, tests e2e) ; `qualite=haute|moyenne|
 * basse|auto` (src/ui/options.ts, non mémorisé) et `lots=0` (src/render/index.ts) pour comparer.
 */
import * as THREE from 'three';
import { abSummary } from '../render/ab';

declare const __BUILD_COMMIT__: string | undefined;

export interface BenchOptions { short: boolean; /** Étape du mode comparaison (A B A B), null hors comparaison. */ compareStep?: number | null }

/** Lit `bench` dans la requête ou le fragment (#bench) de l'adresse ; null hors mode mesure. */
export function benchMode(loc: { search: string; hash: string } | undefined = globalThis.location): BenchOptions | null {
  if (!loc) return null;
  for (const raw of [loc.search, loc.hash.replace(/^#/, '?')]) {
    const p = new URLSearchParams(raw);
    if (p.has('bench')) {
      const step = p.has('comparer') && p.has('etape') ? Number(p.get('etape')) | 0 : null;
      return { short: p.get('bench') === 'court' || p.has('court') || step !== null, compareStep: step };
    }
  }
  return null;
}

/* ------------------------------ Enregistreur d'images ------------------------------ */

/** Horodatages requestAnimationFrame depuis le démarrage (à-coups du chargement compris). */
const stamps: number[] = [];
const frameHooks: ((now: number) => void)[] = [];
let recording = false;
let hiddenSeen = false;
/** Dernier retrait de l'écran de chargement (performance.now) : la ville devient visible et jouable. */
let revealAt = 0;
/** Rendu observé (compteurs de shaders, textures, géométries pendant les premières secondes de jeu). */
let watched: THREE.WebGLRenderer | null = null;
let firstCounts: { programs: number; textures: number; geometries: number } | null = null;
let revealSnap: { programs: number; textures: number; geometries: number } | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;
const snap = (r: THREE.WebGLRenderer): { programs: number; textures: number; geometries: number } => ({ programs: r.info.programs?.length ?? 0, textures: r.info.memory.textures, geometries: r.info.memory.geometries });

/** Durées processeur par phase (≥ 0,5 ms) : instant de fin, phase, durée. */
const traceT: number[] = [], traceMs: number[] = [], tracePh: string[] = [];
/** Collecteur branché sur `perf.trace` (src/render/scene.ts) et le traitement des messages du worker (src/main.ts). */
export function benchTrace(phase: string, ms: number): void {
  if (ms < 0.5) return;
  if (traceT.length > 200_000) { traceT.splice(0, 100_000); traceMs.splice(0, 100_000); tracePh.splice(0, 100_000); }
  traceT.push(performance.now()); traceMs.push(ms); tracePh.push(phase);
}
/** Ventilation processeur de l'intervalle ]a, b] : phases les plus longues, reste non attribué. */
function phasesBetween(a: number, b: number): string {
  const by = new Map<string, number>();
  let sum = 0;
  for (let i = 0; i < traceT.length; i++) { const t = traceT[i]!; if (t > a && t <= b) { by.set(tracePh[i]!, (by.get(tracePh[i]!) ?? 0) + traceMs[i]!); sum += traceMs[i]!; } }
  // Les mises à jour détaillées sont incluses dans « image : mises à jour » : on ne compte pas deux fois.
  let detail = 0; for (const [k, v] of by) if (k.startsWith('mise à jour')) detail += v;
  sum -= detail;
  const top = [...by].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k} ${Math.round(v)} ms`);
  return `${top.join(', ') || 'aucune phase tracée'} ; non attribué (ramasse-miettes, navigateur…) ${Math.max(0, Math.round(b - a - sum))} ms`;
}
/** Plus longue image de ]t0, t1] : durée, instant de fin, ventilation. */
function longestFrame(t0: number, t1: number): { ms: number; at: number; detail: string } | null {
  let best = -1, k = -1;
  for (let i = 1; i < stamps.length; i++) { const t = stamps[i]!; if (t > t0 && t <= t1 && t - stamps[i - 1]! > best) { best = t - stamps[i - 1]!; k = i; } }
  return k < 0 ? null : { ms: Math.round(best), at: stamps[k]!, detail: phasesBetween(stamps[k - 1]!, stamps[k]!) };
}

/** Compteurs du rendu relevés au retrait de l'écran de chargement puis 3 s après (page de mesure). */
export function benchWatchRenderer(r: THREE.WebGLRenderer): void { watched = r; }

/** Démarre l'enregistrement des images (au tout début du démarrage, pour mesurer le chargement). */
export function startBenchRecorder(): void {
  if (recording || typeof requestAnimationFrame === 'undefined') return;
  recording = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenSeen = true; });
  const loading = document.getElementById('loading');
  if (loading) new MutationObserver(() => {
    if (!loading.classList.contains('hidden')) return;
    revealAt = performance.now();
    if (!watched) return;
    const r = watched;
    revealSnap = snap(r);
    if (firstTimer) clearTimeout(firstTimer);
    firstTimer = setTimeout(() => { const b = revealSnap!, e = snap(r); firstCounts = { programs: e.programs - b.programs, textures: e.textures - b.textures, geometries: e.geometries - b.geometries }; }, 3000);
  }).observe(loading, { attributes: true, attributeFilter: ['class'] });
  const tick = (): void => {
    const now = performance.now();
    stamps.push(now);
    for (const h of frameHooks) h(now);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Durées d'image (ms) entre deux instants (intervalles entre images consécutives). */
function intervals(t0: number, t1: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < stamps.length; i++) {
    const t = stamps[i]!;
    if (t <= t0) continue;
    if (t > t1) break;
    out.push(t - stamps[i - 1]!);
  }
  return out;
}

/* ------------------------------ Hôte (fourni par main.ts) ------------------------------ */

export interface BenchHost {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  quality: string;
  lite: boolean;
  /** Raison du mode sûr s'il est actif (null sinon). */
  safeMode: string | null;
  /** Lots par matériau actifs (src/render/index.ts). */
  batched: boolean;
  renderStats: () => { calls: number; triangles: number; frameMs: number } | null;
  /** Temps processeur d'image, carte graphique attendue (src/main.ts, __aube.cpuFrames). */
  cpuFrames: (n: number, yawStep: number) => { updateMs: number; renderMs: number; calls: number; triangles: number };
  setCamera: (m: 'demo-aerial' | 'demo-street') => void;
  cameraPose: () => { targetX: number; targetZ: number; distance: number; yaw: number; pitch: number };
  lookAt: (x: number, z: number, distance: number, pitch?: number, yaw?: number) => void;
  setSpeed: (s: number) => Promise<unknown>;
  pixelRatio: () => number;
  /** Côté de la carte d'ombre du soleil (px, 0 : sans ombres). */
  shadowSize: () => number;
  /** Résolution dynamique : plage du rapport de pixels de la 3D (null : résolution fixe). */
  dynamicRange: () => { min: number; max: number } | null;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Suspend / reprend la boucle d'affichage du jeu. */
  pauseRender: (paused: boolean) => void;
}

export interface LayerCost { layer: string; ms: number; share: number }
export interface LayerBreakdown { view: string; method: string; totalMs: number; layers: LayerCost[] }

const LAYER_LABELS: Record<string, string> = {
  batiments: 'Bâtiments', vegetation: 'Végétation', pietons: 'Piétons', vehicules: 'Véhicules', roads: 'Routes et décor routier',
  eau: 'Eau', terrain: 'Terrain', ciel: 'Ciel', feux_tricolores: 'Feux tricolores', decor_urbain: 'Décor urbain',
  panneaux_carrefours: 'Panneaux de carrefour', 'dechets-camions': 'Camions de déchets', 'dechets-installations': 'Installations de déchets',
  'dechets-conteneurs': 'Conteneurs de déchets', 'selection-marker': 'Marqueur de sélection', hubs: 'Pôles d\'échanges', electricite: 'Réseau électrique',
  quais: 'Quais', chantiers: 'Chantiers', zonage: 'Zonage', meteo: 'Météo', 'reseau-eau': 'Réseau d\'eau',
};

/**
 * Coût GPU de l'image par calque (boucle du jeu suspendue) : temps de l'image complète, puis sans chaque calque
 * de premier niveau, et sans la passe d'ombre (carte gardée). EXT_disjoint_timer_query_webgl2 si exposé, sinon
 * temps de rendu attendu jusqu'à la fin du travail GPU (lecture d'un pixel).
 */
async function layerBreakdown(h: BenchHost, view: string, n: number, mainOnly = false): Promise<LayerBreakdown> {
  const r = h.renderer, gl = r.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const px = new Uint8Array(4);
  const frame = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => res()));
  const draw = (): void => r.render(h.scene, h.camera);
  const measure = async (): Promise<number> => {
    if (n > 1) draw(); // image de préparation (listes, uniformes)
    const vals: number[] = [];
    if (ext) {
      const qs: WebGLQuery[] = [];
      for (let i = 0; i < n; i++) {
        const q = gl.createQuery()!;
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q); draw(); gl.endQuery(ext.TIME_ELAPSED_EXT);
        qs.push(q);
      }
      for (let tries = 0; tries < 120 && !gl.getQueryParameter(qs[qs.length - 1]!, gl.QUERY_RESULT_AVAILABLE); tries++) await frame();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      for (const q of qs) { if (!disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) vals.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6); gl.deleteQuery(q); }
    }
    if (!vals.length) {
      for (let i = 0; i < n; i++) {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t0 = performance.now(); draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); vals.push(performance.now() - t0);
      }
    }
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)]!;
  };
  h.pauseRender(true);
  const sm = r.shadowMap, auto = sm.autoUpdate;
  // Écart image complète − image modifiée, mesurés EN ALTERNANCE (même état de cache, même dérive) et répétés :
  // médiane des écarts. Le témoin (rien de modifié) donne le bruit de la méthode, soustrait de chaque calque.
  const reps = Math.max(1, Math.min(3, n));
  const diff = async (apply: () => void, undo: () => void): Promise<number> => {
    const d: number[] = [];
    for (let k = 0; k < reps; k++) { const full = await measure(); apply(); try { d.push(full - (await measure())); } finally { undo(); } }
    d.sort((x, y) => x - y);
    return d[Math.floor(d.length / 2)]!;
  };
  try {
    sm.autoUpdate = true;
    const total = await measure();
    const floor = await diff(() => undefined, () => undefined);
    const layers: LayerCost[] = [];
    for (const o of h.scene.children) {
      const name = o.name;
      if (!name || !o.visible || (!LAYER_LABELS[name] && (mainOnly || !/^[a-z_-]+$/.test(name)))) continue;
      layers.push({ layer: LAYER_LABELS[name] ?? name, ms: (await diff(() => { o.visible = false; }, () => { o.visible = true; })) - floor, share: 0 });
    }
    layers.push({ layer: 'Passe d\'ombre (carte d\'ombre)', ms: (await diff(() => { sm.autoUpdate = false; sm.needsUpdate = false; }, () => { sm.autoUpdate = true; })) - floor, share: 0 });
    for (const l of layers) { l.ms = r2(Math.max(0, l.ms)); l.share = total > 0 ? Math.round((100 * l.ms) / total) : 0; }
    layers.sort((a, b) => b.ms - a.ms);
    return {
      view, method: `${ext ? 'requêtes de temps GPU (EXT_disjoint_timer_query_webgl2)' : 'temps de rendu attendu (lecture d\'un pixel)'}, ${reps} mesures alternées par calque, témoin ${fmt(r2(floor))} ms soustrait`,
      totalMs: r2(total), layers: layers.filter((l) => l.ms > 0.05).slice(0, 12),
    };
  } finally {
    sm.autoUpdate = auto; sm.needsUpdate = true;
    h.pauseRender(false);
  }
}

interface SceneDef {
  id: string;
  label: string;
  speed: number;
  /** Place la caméra ; renvoie éventuellement une fonction appelée à chaque image (t en secondes depuis le début). */
  setup: (h: BenchHost, home: Home) => ((t: number) => void) | void;
  /** Pas de rotation de la caméra pour l'échantillon de temps processeur. */
  cpuYaw: number;
}
interface Home { x: number; z: number; yaw: number; pitch: number }

const SCENES: SceneDef[] = [
  { id: 'aerien', label: 'Vue aérienne fixe', speed: 1, cpuYaw: 0, setup: (h) => { h.setCamera('demo-aerial'); } },
  {
    id: 'survol', label: 'Survol en mouvement', speed: 1, cpuYaw: 0.02,
    setup: (h, c) => (t: number) => {
      // Boucle complète en 15 s quelle que soit la cadence : cible sur un cercle de 160 m, distance et cap qui varient.
      const a = (2 * Math.PI * t) / 15;
      h.lookAt(c.x + 160 * Math.cos(a), c.z + 160 * Math.sin(a), 380 + 120 * Math.sin(a), 0.55, c.yaw + a * 0.5);
    },
  },
  { id: 'rue', label: 'Vue rapprochée (rue)', speed: 1, cpuYaw: 0, setup: (h) => { h.setCamera('demo-street'); } },
  {
    id: 'x16', label: 'Vue large, vitesse ×16', speed: 16, cpuYaw: 0,
    setup: (h, c) => { h.lookAt(c.x, c.z, 900, 0.7, c.yaw); },
  },
];

interface SceneResult {
  id: string; label: string; seconds: number; frames: number;
  fpsMedian: number; fpsMean: number; p95: number; p99: number; maxMs: number; over33: number;
  cpuUpdateMs: number | null; cpuRenderMs: number | null; updateEmaMs: number | null;
  calls: number; triangles: number; renderW: number; renderH: number; ratioMin: number; ratioMax: number;
  /** Pendant la mesure : shaders compilés, textures et géométries nouvellement envoyées (cause probable d'à-coups). */
  newPrograms: number; newTextures: number; newGeometries: number;
  /** Instant de la plus longue image (s depuis le début de la mesure). */
  maxAtS: number;
  /** Ventilation processeur de la plus longue image. */
  maxDetail: string | null;
}

export interface BenchResult {
  version: string; date: string; mode: 'complet' | 'court';
  env: Record<string, string | number | boolean>;
  load: { playableS: number; maxLoadFrameMs: number; maxFirstFramesMs: number; framesOver100Load: number; firstFramesOver100: number;
    /** Pendant les 3 premières secondes de jeu : shaders compilés, textures et géométries nouvellement envoyées. */
    firstPrograms: number | null; firstTextures: number | null; firstGeometries: number | null;
    /** Ventilation processeur de la plus longue des premières images. */
    firstDetail: string | null };
  scenes: SceneResult[];
  /** Coût GPU par calque (vues aérienne et rue). */
  breakdown: LayerBreakdown[];
  warnings: string[];
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function quantile(sorted: number[], p: number): number { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]! : 0; }

function browserName(): string {
  const ua = navigator.userAgent;
  const m = /(Edg|OPR|Firefox|Chrome|Version)\/([\d.]+)/g;
  const found: Record<string, string> = {};
  for (let x = m.exec(ua); x; x = m.exec(ua)) found[x[1]!] = x[2]!;
  if (found['Edg']) return `Edge ${found['Edg']}`;
  if (found['OPR']) return `Opera ${found['OPR']}`;
  if (found['Firefox']) return `Firefox ${found['Firefox']}`;
  if (found['Chrome']) return `Chrome ${found['Chrome']}`;
  if (/Safari/.test(ua) && found['Version']) return `Safari ${found['Version']}`;
  return ua.slice(0, 80);
}

function osName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS / iPadOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return '?';
}

function gpuInfo(r: THREE.WebGLRenderer): { gpu: string; vendor: string; webgl: string } {
  const gl = r.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
  return { gpu, vendor, webgl: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'WebGL 2' : 'WebGL 1' };
}

/* ------------------------------ Mode comparaison (A B A B) ------------------------------ */

/** A : tout à l'ancien (bascules de src/render/ab.ts) ; B : tout au nouveau. */
const COMPARE_PLAN = ['A', 'B', 'A', 'B'] as const;
const COMPARE_FLAGS: Record<'A' | 'B', Record<string, string | null>> = {
  A: { ordre: '0', terrain: '0', aniso: '8', trace: '0' },
  B: { ordre: null, terrain: null, aniso: null, trace: null },
};
const COMPARE_KEY = 'meknes:bench-comparaison';
interface CompareRun { label: 'A' | 'B'; playableS: number; maxFirstMs: number; scenes: { id: string; label: string; fps: number; mean: number; p95: number; over33: number; cpu: number | null; gpuHint: number }[] }

function compareUrl(step: number): string {
  const u = new URL(location.href);
  u.hash = '';
  for (const [k, v] of Object.entries(COMPARE_FLAGS[COMPARE_PLAN[step]!])) { if (v === null) u.searchParams.delete(k); else u.searchParams.set(k, v); }
  u.searchParams.set('comparer', '');
  u.searchParams.set('etape', String(step));
  return u.toString().replace(/([?&](?:bench|comparer))=(?=&|$)/g, '$1');
}
function compareLoad(): CompareRun[] { try { return JSON.parse(sessionStorage.getItem(COMPARE_KEY) ?? '[]') as CompareRun[]; } catch { return []; } }
function compareSave(runs: CompareRun[] | null): void { try { if (runs) sessionStorage.setItem(COMPARE_KEY, JSON.stringify(runs)); else sessionStorage.removeItem(COMPARE_KEY); } catch { /* stockage refusé */ } }

/** Au démarrage : `?bench&comparer` sans étape lance l'étape 0 (rien n'est chargé pour rien). */
export function benchCompareStart(): boolean {
  const p = new URLSearchParams(location.search);
  if (!p.has('bench') || !p.has('comparer') || p.has('etape')) return false;
  compareSave([]);
  location.replace(compareUrl(0));
  return true;
}

/* ------------------------------ Parcours ------------------------------ */

/**
 * Joue le parcours puis affiche les résultats. `doneAt` : fin du lancement de la démo (performance.now) ; « jouable »
 * est le dernier retrait de l'écran de chargement (repli : `doneAt`).
 */
export async function runBench(h: BenchHost, opts: BenchOptions, doneAt: number): Promise<BenchResult> {
  const readyAt = revealAt > 0 && revealAt <= doneAt ? revealAt : doneAt;
  const cmp = opts.compareStep ?? null;
  const warmS = cmp !== null ? 3 : opts.short ? 1 : 5, preS = cmp !== null ? 1 : opts.short ? 0.5 : 3, measS = cmp !== null ? 8 : opts.short ? 2 : 15, cpuN = cmp !== null ? 10 : opts.short ? 3 : 20;
  const badge = progressBadge(h.quality);
  const warnings: string[] = [];
  const firstEnd = readyAt + 3000;
  badge(`Mesure : préchauffe (${warmS} s)…`);
  h.setCamera('demo-aerial');
  await wait(warmS * 1000);
  // Premières images : à partir du retrait de l'écran de chargement (l'image rendue dessous n'est pas vue).
  const loadIv = intervals(0, readyAt), firstIv = intervals(readyAt, firstEnd);
  const p0 = h.cameraPose();
  const home: Home = { x: p0.targetX, z: p0.targetZ, yaw: p0.yaw, pitch: p0.pitch };
  const scenes: SceneResult[] = [];
  const breakdown: LayerBreakdown[] = [];
  const startHidden = hiddenSeen;
  for (let i = 0; i < SCENES.length; i++) {
    const sc = SCENES[i]!;
    badge(`Mesure : ${i + 1}/${SCENES.length} — ${sc.label}`);
    await h.setSpeed(sc.speed).catch(() => undefined);
    const anim = sc.setup(h, home) ?? null;
    const tStart = performance.now();
    let samples = 0, calls = 0, tris = 0, ratioMin = Infinity, ratioMax = 0;
    let measuring = false;
    const hook = (now: number): void => {
      if (anim) anim((now - tStart) / 1000);
      if (!measuring) return;
      const st = h.renderStats();
      if (st) { samples++; calls += st.calls; tris += st.triangles; }
      const pr = h.pixelRatio();
      ratioMin = Math.min(ratioMin, pr); ratioMax = Math.max(ratioMax, pr);
    };
    frameHooks.push(hook);
    await wait(preS * 1000);
    const info = h.renderer.info;
    const prog0 = info.programs?.length ?? 0, tex0 = info.memory.textures, geo0 = info.memory.geometries;
    const t0 = performance.now();
    measuring = true;
    await wait(measS * 1000);
    const t1 = performance.now();
    measuring = false;
    const iv = intervals(t0, t1);
    const newPrograms = (info.programs?.length ?? 0) - prog0, newTextures = info.memory.textures - tex0, newGeometries = info.memory.geometries - geo0;
    let maxAt = 0, maxIv = -1;
    for (let k = 1; k < stamps.length; k++) { const t = stamps[k]!; if (t > t0 && t <= t1 && t - stamps[k - 1]! > maxIv) { maxIv = t - stamps[k - 1]!; maxAt = t - t0; } }
    // Temps processeur : court échantillon séparé (attente de la carte graphique avant chaque image : gl.finish).
    let cpu: { updateMs: number; renderMs: number } | null = null;
    try { cpu = h.cpuFrames(cpuN, sc.cpuYaw); } catch { cpu = null; }
    // Parcours court (tests, rendu logiciel très lent) : vue rue seule, calques principaux, une mesure par calque.
    if (cmp === null && (sc.id === 'rue' || (sc.id === 'aerien' && !opts.short))) {
      badge(`Mesure : ${i + 1}/${SCENES.length} — coût par calque (${sc.label})`);
      try { breakdown.push(await layerBreakdown(h, sc.label, opts.short ? 1 : 4, opts.short)); } catch (e) { warnings.push(`Coût par calque indisponible : ${String(e)}`); }
    }
    frameHooks.splice(frameHooks.indexOf(hook), 1);
    const s = [...iv].sort((a, b) => a - b);
    const total = iv.reduce((a, b) => a + b, 0);
    const buf = h.renderer.getDrawingBufferSize(new THREE.Vector2());
    scenes.push({
      id: sc.id, label: sc.label, seconds: r1((t1 - t0) / 1000), frames: iv.length,
      fpsMedian: s.length ? r1(1000 / quantile(s, 0.5)) : 0,
      fpsMean: total > 0 ? r1((1000 * iv.length) / total) : 0,
      p95: r1(quantile(s, 0.95)), p99: r1(quantile(s, 0.99)), maxMs: r1(s[s.length - 1] ?? 0),
      over33: iv.length ? r1((100 * iv.filter((v) => v > 33.4).length) / iv.length) : 0,
      cpuUpdateMs: cpu ? r2(cpu.updateMs) : null, cpuRenderMs: cpu ? r2(cpu.renderMs) : null,
      updateEmaMs: h.renderStats() ? r2(h.renderStats()!.frameMs) : null,
      calls: samples ? Math.round(calls / samples) : 0, triangles: samples ? Math.round(tris / samples) : 0,
      renderW: buf.x, renderH: buf.y,
      ratioMin: Number.isFinite(ratioMin) ? r2(ratioMin) : r2(h.pixelRatio()), ratioMax: ratioMax > 0 ? r2(ratioMax) : r2(h.pixelRatio()),
      newPrograms, newTextures, newGeometries, maxAtS: r1(maxAt / 1000), maxDetail: longestFrame(t0, t1)?.detail ?? null,
    });
  }
  await h.setSpeed(1).catch(() => undefined);
  h.setCamera('demo-aerial');
  badge(null);
  if (h.safeMode) warnings.push(`Mode sûr actif (affichage allégé, qualité basse) : ${h.safeMode}. Les liens « Relancer en … » ci-dessous le retirent.`);
  for (const s of scenes) if (s.maxMs > 100) warnings.push(`${s.label} : image de ${fmt(s.maxMs)} ms à ${fmt(s.maxAtS)} s ; pendant la scène, ${s.newPrograms} shader(s) compilé(s), ${s.newTextures} texture(s) et ${s.newGeometries} géométrie(s) envoyées. Processeur pendant cette image : ${s.maxDetail ?? '—'}.`);
  if (hiddenSeen && !startHidden) warnings.push('Onglet masqué pendant la mesure : résultats faussés (le navigateur ralentit les onglets cachés).');
  if (scenes.some((s) => s.ratioMin !== s.ratioMax)) warnings.push('Résolution adaptative (qualité « auto ») : la résolution de rendu a changé pendant au moins une scène.');
  const g = gpuInfo(h.renderer);
  if (/swiftshader|llvmpipe|software|basic render/i.test(g.gpu)) warnings.push('Rendu logiciel détecté (pas de carte graphique utilisée) : accélération matérielle désactivée ?');
  const vv = window.visualViewport;
  const res: BenchResult = {
    version: typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ ? __BUILD_COMMIT__ : 'inconnue',
    date: (() => { const d = new Date(), z = (n: number): string => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; })(),
    mode: opts.short ? 'court' : 'complet',
    env: {
      carteGraphique: g.gpu, fabricant: g.vendor, webgl: g.webgl, multiDraw: h.renderer.extensions.has('WEBGL_multi_draw'),
      navigateur: browserName(), systeme: osName(),
      ecran: `${screen.width}×${screen.height}`, fenetre: `${Math.round(vv?.width ?? innerWidth)}×${Math.round(vv?.height ?? innerHeight)}`,
      densitePixels: r2(devicePixelRatio || 1), qualite: h.quality, modeAllege: h.lite, modeSur: h.safeMode ?? false, lotsParMateriau: h.batched,
      carteOmbre: h.renderer.shadowMap.enabled && h.shadowSize() > 0 ? `${h.shadowSize()} px` : 'désactivée',
      coeursProcesseur: navigator.hardwareConcurrency ?? 0,
      antialiasing: h.renderer.getContext().getContextAttributes()?.antialias ? `MSAA ×${(h.renderer.getContext().getParameter(h.renderer.getContext().SAMPLES) as number) || '?'}` : 'désactivé',
      bascules: abSummary(),
      resolutionDynamique: (() => { const d = h.dynamicRange(); return d ? `activée (×${fmt(d.min)}–×${fmt(d.max)})` : 'désactivée'; })(),
    },
    load: {
      playableS: r1(readyAt / 1000),
      maxLoadFrameMs: Math.round(Math.max(0, ...loadIv)), framesOver100Load: loadIv.filter((v) => v > 100).length,
      maxFirstFramesMs: Math.round(Math.max(0, ...firstIv)), firstFramesOver100: firstIv.filter((v) => v > 100).length,
      firstPrograms: firstCounts?.programs ?? null, firstTextures: firstCounts?.textures ?? null, firstGeometries: firstCounts?.geometries ?? null,
      firstDetail: longestFrame(readyAt, firstEnd)?.detail ?? null,
    },
    scenes, breakdown, warnings,
  };
  if (cmp !== null) { finishCompareStep(res, cmp); return res; }
  showResults(res);
  return res;
}

function finishCompareStep(res: BenchResult, step: number): void {
  const runs = compareLoad().slice(0, step);
  runs.push({
    label: COMPARE_PLAN[step]!, playableS: res.load.playableS, maxFirstMs: res.load.maxFirstFramesMs,
    scenes: res.scenes.map((s) => ({ id: s.id, label: s.label, fps: s.fpsMedian, mean: s.fpsMean, p95: s.p95, over33: s.over33, cpu: s.cpuUpdateMs !== null && s.cpuRenderMs !== null ? r2(s.cpuUpdateMs + s.cpuRenderMs) : null, gpuHint: 0 })),
  });
  compareSave(runs);
  if (step + 1 < COMPARE_PLAN.length) {
    const b = progressBadge('');
    b(`Comparaison : étape ${step + 2}/${COMPARE_PLAN.length} (${COMPARE_PLAN[step + 1] === 'A' ? 'ancien rendu' : 'nouveau rendu'}), rechargement…`);
    setTimeout(() => location.replace(compareUrl(step + 1)), 800);
    return;
  }
  showComparison(runs, res);
}

/** Tableau de la comparaison : moyenne des passages A et B, écart B / A. */
export function compareText(runs: CompareRun[], res: BenchResult): string {
  const avg = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x !== null); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const pct = (a: number | null, b: number | null): string => (a && b !== null ? `${b >= a ? '+' : ''}${Math.round((100 * (b - a)) / a)} %` : '—');
  const A = runs.filter((r) => r.label === 'A'), B = runs.filter((r) => r.label === 'B');
  const lines = [
    `Meknes City — comparaison ancien (A) / nouveau (B) rendu, ${runs.length} passages ${runs.map((r) => r.label).join(' ')} — version ${res.version} — ${res.date}`,
    `Carte graphique : ${res.env['carteGraphique']} · ${res.env['navigateur']} · fenêtre ${res.env['fenetre']} · densité ${res.env['densitePixels']} · qualité ${res.env['qualite']}`,
    'A = ordre=0, terrain=0, aniso=8, trace=0 ; B = valeurs actuelles',
    'Scène | img/s méd. A → B | écart | p95 ms A → B | > 33 ms A → B | CPU ms A → B',
  ];
  for (const sc of runs[0]?.scenes ?? []) {
    const g = (rs: CompareRun[], k: 'fps' | 'p95' | 'over33' | 'cpu'): number | null => avg(rs.map((r) => r.scenes.find((x) => x.id === sc.id)?.[k] ?? null));
    lines.push(`${sc.label} | ${fmt(g(A, 'fps'))} → ${fmt(g(B, 'fps'))} | ${pct(g(A, 'fps'), g(B, 'fps'))} | ${fmt(g(A, 'p95'))} → ${fmt(g(B, 'p95'))} | ${fmt(g(A, 'over33'))} % → ${fmt(g(B, 'over33'))} % | ${fmt(g(A, 'cpu'))} → ${fmt(g(B, 'cpu'))}`);
  }
  lines.push(`Jouable (s) : ${fmt(avg(A.map((r) => r.playableS)))} → ${fmt(avg(B.map((r) => r.playableS)))} · premières images max (ms) : ${fmt(avg(A.map((r) => r.maxFirstMs)))} → ${fmt(avg(B.map((r) => r.maxFirstMs)))}`);
  lines.push('Détail par passage (img/s médianes) :');
  for (const r of runs) lines.push(`  ${r.label} : ${r.scenes.map((x) => `${x.label} ${fmt(x.fps)}`).join(' · ')} · jouable ${fmt(r.playableS)} s`);
  return lines.join('\n');
}

function showComparison(runs: CompareRun[], res: BenchResult): void {
  const text = compareText(runs, res);
  const box = document.createElement('div');
  box.id = 'bench-results';
  box.setAttribute('role', 'dialog');
  box.style.cssText = 'position:fixed;inset:16px;z-index:10002;overflow:auto;box-sizing:border-box;padding:18px 20px;border-radius:12px;'
    + 'background:rgba(12,17,24,.97);color:#e8eef5;font:14px/1.45 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5)';
  const h = document.createElement('h2'); h.style.cssText = 'margin:0 0 10px;font-size:20px'; h.textContent = 'Meknes City — comparaison ancien / nouveau rendu';
  const pre = document.createElement('pre'); pre.style.cssText = 'margin:0;white-space:pre-wrap;font:14px/1.5 ui-monospace,Consolas,monospace'; pre.textContent = text;
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:14px';
  const mk = (label: string, fn: () => void): void => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.style.cssText = 'min-height:40px;padding:0 14px;border:0;border-radius:8px;font:600 14px system-ui,sans-serif;cursor:pointer;background:#2a3646;color:#e8eef5'; b.addEventListener('click', () => fn.call(b)); bar.appendChild(b); };
  mk('Copier les résultats', function (this: unknown) {
    const btn = bar.firstElementChild as HTMLButtonElement;
    const done = (): void => { btn.textContent = 'Copié ✓'; };
    const fallback = (): void => { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); btn.textContent = 'Texte sélectionné : Ctrl+C / ⌘C'; };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(`${text}\n\nJSON :\n${JSON.stringify(runs)}`).then(done, fallback); else fallback();
  });
  mk('Relancer la comparaison', () => { compareSave([]); location.replace(compareUrl(0)); });
  mk('Fermer', () => box.remove());
  box.append(h, pre, bar);
  document.body.appendChild(box);
  (window as unknown as { __benchCompare?: unknown }).__benchCompare = { runs, text };
}

/* ------------------------------ Affichage ------------------------------ */

function progressBadge(quality: string): (text: string | null) => void {
  const el = document.createElement('div');
  el.id = 'bench-progress';
  el.dataset['qualite'] = quality;
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:10001;padding:8px 14px;border-radius:8px;'
    + 'background:rgba(10,14,20,.85);color:#e8eef5;font:600 14px system-ui,sans-serif;pointer-events:none;max-width:calc(100vw - 32px)';
  document.body.appendChild(el);
  return (text) => { if (text === null) el.remove(); else el.textContent = text; };
}

const fmtInt = (n: number): string => n.toLocaleString('fr-FR');
const fmtTris = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));
const fmt = (n: number | null): string => (n === null ? '—' : String(n).replace('.', ','));

/** Résumé texte (copie) : lisible tel quel dans un message. */
export function resultsText(r: BenchResult): string {
  const e = r.env;
  const lines = [
    `Meknes City — mesure de performance (${r.mode}) — version ${r.version} — ${r.date}`,
    `Carte graphique : ${e['carteGraphique']} (${e['fabricant']}, ${e['webgl']}, multi_draw ${e['multiDraw'] ? 'oui' : 'non'})`,
    `Navigateur : ${e['navigateur']} sur ${e['systeme']} · ${e['coeursProcesseur']} cœurs`,
    `Écran ${e['ecran']} · fenêtre ${e['fenetre']} · densité ${e['densitePixels']} · qualité ${e['qualite']}${e['modeAllege'] ? ' (allégé)' : ''}${e['modeSur'] ? ' (mode sûr)' : ''} · lots par matériau ${e['lotsParMateriau'] ? 'oui' : 'non'} · ombres ${e['carteOmbre']} · résolution dynamique ${e['resolutionDynamique']} · antialiasing ${e['antialiasing']}`,
    `Bascules A/B : ${e['bascules']}`,
    `Chargement : jouable en ${fmt(r.load.playableS)} s · plus longue image au chargement ${r.load.maxLoadFrameMs} ms (${r.load.framesOver100Load} > 100 ms) · premières images ${r.load.maxFirstFramesMs} ms (${r.load.firstFramesOver100} > 100 ms ; ${fmt(r.load.firstPrograms)} shaders / ${fmt(r.load.firstTextures)} textures / ${fmt(r.load.firstGeometries)} géométries)`,
    `Plus longue des premières images, processeur : ${r.load.firstDetail ?? '—'}`,
    '',
    'Scène | img/s méd. | img/s moy. | p95 ms | p99 ms | max ms (à s) | > 33 ms | CPU màj+rendu ms | appels | triangles | rendu px (ratio) | nouveaux shaders/textures/géom.',
  ];
  for (const s of r.scenes) {
    lines.push(`${s.label} | ${fmt(s.fpsMedian)} | ${fmt(s.fpsMean)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${fmt(s.maxMs)} (${fmt(s.maxAtS)}) | ${fmt(s.over33)} % | ${fmt(s.cpuUpdateMs)} + ${fmt(s.cpuRenderMs)} | ${fmtInt(s.calls)} | ${fmtTris(s.triangles)} | ${s.renderW}×${s.renderH} (${s.ratioMin === s.ratioMax ? fmt(s.ratioMin) : `${fmt(s.ratioMin)}–${fmt(s.ratioMax)}`}) | ${s.newPrograms}/${s.newTextures}/${s.newGeometries}`);
  }
  for (const b of r.breakdown) {
    lines.push('', `Coût GPU par calque — ${b.view} : image ${fmt(b.totalMs)} ms (${b.method})`);
    for (const l of b.layers) lines.push(`  ${l.layer} : ${fmt(l.ms)} ms (${l.share} %)`);
  }
  for (const w of r.warnings) lines.push(`Attention : ${w}`);
  return lines.join('\n');
}

function relaunchUrl(change: Record<string, string | null>): string {
  const u = new URL(location.href);
  // Paramètres du mode mesure portés par la requête (le fragment #bench est retiré : un seul format).
  if (u.hash.includes('bench')) {
    const hp = new URLSearchParams(u.hash.slice(1));
    hp.forEach((v, k) => { if (!u.searchParams.has(k)) u.searchParams.set(k, v); });
    u.hash = '';
  }
  for (const [k, v] of Object.entries(change)) { if (v === null) u.searchParams.delete(k); else u.searchParams.set(k, v); }
  // `bench` sans valeur : « ?bench » plutôt que « ?bench= ».
  return u.toString().replace(/([?&]bench)=(?=&|$)/, '$1');
}

function showResults(r: BenchResult): void {
  document.getElementById('bench-results')?.remove();
  const box = document.createElement('div');
  box.id = 'bench-results';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Résultats de la mesure de performance');
  box.style.cssText = 'position:fixed;inset:16px;z-index:10002;overflow:auto;box-sizing:border-box;padding:18px 20px;border-radius:12px;'
    + 'background:rgba(12,17,24,.96);color:#e8eef5;font:14px/1.4 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5)';
  const e = r.env;
  const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const kv = (k: string, v: unknown): string => `<div><span style="color:#93a4b8">${esc(k)}</span> <b>${esc(v)}</b></div>`;
  const th = 'style="text-align:right;padding:6px 8px;border-bottom:1px solid #2c3a4a;color:#93a4b8;font-weight:600;white-space:nowrap"';
  const td = 'style="text-align:right;padding:6px 8px;border-bottom:1px solid #1e2a36;white-space:nowrap;font-variant-numeric:tabular-nums"';
  const fpsColor = (f: number): string => (f >= 55 ? '#4fd18b' : f >= 30 ? '#f2c94c' : '#ff6b6b');
  const rows = r.scenes.map((s) => `<tr><td ${td.replace('right', 'left')}>${esc(s.label)}</td>`
    + `<td ${td}><b style="color:${fpsColor(s.fpsMedian)}">${fmt(s.fpsMedian)}</b></td><td ${td}>${fmt(s.fpsMean)}</td>`
    + `<td ${td}>${fmt(s.p95)}</td><td ${td}>${fmt(s.p99)}</td><td ${td}>${fmt(s.maxMs)}<br><small style="color:#93a4b8">à ${fmt(s.maxAtS)} s</small></td><td ${td}>${fmt(s.over33)} %</td>`
    + `<td ${td}>${fmt(s.cpuUpdateMs)} + ${fmt(s.cpuRenderMs)}</td><td ${td}>${fmtInt(s.calls)}</td><td ${td}>${fmtTris(s.triangles)}</td>`
    + `<td ${td}>${s.renderW}×${s.renderH}<br><small style="color:#93a4b8">×${s.ratioMin === s.ratioMax ? fmt(s.ratioMin) : `${fmt(s.ratioMin)}–${fmt(s.ratioMax)}`}</small></td><td ${td}>${s.newPrograms} / ${s.newTextures} / ${s.newGeometries}</td></tr>`).join('');
  const btn = 'style="min-height:40px;padding:0 14px;border:0;border-radius:8px;font:600 14px system-ui,sans-serif;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;background:#2a3646;color:#e8eef5"';
  const short = r.mode === 'court' ? 'court' : '';
  const link = (label: string, change: Record<string, string | null>): string => `<a ${btn} href="${esc(relaunchUrl({ bench: short, ...change }))}">${esc(label)}</a>`;
  box.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between">
      <h2 style="margin:0;font-size:20px">Meknes City — mesure de performance</h2>
      <div style="color:#93a4b8">version <b style="color:#e8eef5">${esc(r.version)}</b> · ${esc(r.date)} · parcours ${esc(r.mode)}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:4px 18px;margin:12px 0">
      ${kv('Carte graphique', e['carteGraphique'])}${kv('Fabricant', `${e['fabricant']} · ${e['webgl']} · multi_draw ${e['multiDraw'] ? 'oui' : 'non'}`)}
      ${kv('Navigateur', `${e['navigateur']} · ${e['systeme']} · ${e['coeursProcesseur']} cœurs`)}${kv('Écran / fenêtre', `${e['ecran']} / ${e['fenetre']} · densité ${fmt(e['densitePixels'] as number)}`)}
      ${kv('Qualité', `${e['qualite']}${e['modeAllege'] ? ' (allégé)' : ''}${e['modeSur'] ? ' (mode sûr)' : ''} · lots par matériau ${e['lotsParMateriau'] ? 'oui' : 'non'} · ombres ${e['carteOmbre']}`)}
      ${kv('Résolution dynamique', e['resolutionDynamique'])}${kv('Bascules A/B', e['bascules'])}${kv('Antialiasing', e['antialiasing'])}
      ${kv('Jouable après', `${fmt(r.load.playableS)} s`)}
      ${kv('Plus longue image au chargement', `${r.load.maxLoadFrameMs} ms (${r.load.framesOver100Load} > 100 ms)`)}
      ${kv('Premières images de jeu (3 s)', `max ${r.load.maxFirstFramesMs} ms (${r.load.firstFramesOver100} > 100 ms) · ${fmt(r.load.firstPrograms)} shaders / ${fmt(r.load.firstTextures)} tex. / ${fmt(r.load.firstGeometries)} géom.`)}
      ${kv('Plus longue des premières images, processeur', r.load.firstDetail ?? '—')}
    </div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:960px">
      <thead><tr><th ${th.replace('right', 'left')}>Scène</th><th ${th}>img/s<br>médiane</th><th ${th}>img/s<br>moyenne</th><th ${th}>p95<br>ms</th><th ${th}>p99<br>ms</th><th ${th}>plus longue<br>ms</th><th ${th}>images<br>&gt; 33 ms</th><th ${th}>CPU ms<br>màj + rendu</th><th ${th}>appels de<br>dessin</th><th ${th}>triangles</th><th ${th}>rendu px<br>(densité)</th><th ${th}>nouveaux<br>shaders / tex. / géom.</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div style="display:flex;flex-wrap:wrap;gap:12px 28px;margin-top:12px">${r.breakdown.map((b) => `<div style="min-width:280px"><div style="font-weight:600">Coût GPU par calque — ${esc(b.view)} <span style="color:#93a4b8;font-weight:400">(image ${fmt(b.totalMs)} ms)</span></div>
      <table style="border-collapse:collapse;margin-top:4px">${b.layers.map((l) => `<tr><td style="padding:2px 10px 2px 0">${esc(l.layer)}</td><td ${td}>${fmt(l.ms)} ms</td><td ${td}><span style="display:inline-block;height:8px;width:${Math.min(120, l.share * 1.2)}px;background:#4fd18b;border-radius:2px"></span> ${l.share} %</td></tr>`).join('')}</table>
      <div style="color:#93a4b8;font-size:12px">${esc(b.method)} ; chaque calque compte aussi son ombre.</div></div>`).join('')}</div>
    ${r.warnings.map((w) => `<p style="margin:10px 0 0;color:#f2c94c">⚠ ${esc(w)}</p>`).join('')}
    <p style="margin:10px 0 0;color:#93a4b8;font-size:12px">img/s plafonnées par la fréquence de l'écran (60, 120 Hz…). CPU : échantillon séparé de ${r.mode === 'court' ? 3 : 20} images, carte graphique attendue avant chaque image. Appels et triangles : moyenne par image, ombres comprises. Aucune donnée n'est envoyée sur le réseau.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
      <button type="button" id="bench-copy" ${btn.replace('#2a3646', '#4fd18b').replace('#e8eef5', '#0d1a12')}>Copier les résultats</button>
      ${link('Relancer', {})}${link('Relancer en Haute', { qualite: 'haute' })}${link('Relancer en Moyenne', { qualite: 'moyenne' })}${link('Relancer en Auto', { qualite: 'auto' })}
      ${link('Relancer sans lots (?lots=0)', { lots: '0' })}${link('Lots activés', { lots: null })}${link('Résolution dynamique activée', { dyn: '1' })}${link('Résolution fixe', { dyn: '0' })}${link('Sans MSAA', { msaa: '0' })}${link('MSAA ×4', { msaa: '1' })}${link('Anticrénelage auto', { msaa: null })}${link('Ombres 1K', { ombres: 'low' })}${link('Sans ombres', { ombres: 'off' })}${link('Ombres du réglage', { ombres: null })}${link('Comparer ancien / nouveau (A B A B)', { comparer: '', etape: null })}${link('Ancien rendu (A)', { ordre: '0', terrain: '0', aniso: '8', trace: '0' })}${link('Nouveau rendu (B)', { ordre: null, terrain: null, aniso: null, trace: null })}
      <button type="button" id="bench-close" ${btn}>Fermer</button>
    </div>
    <textarea id="bench-text" readonly style="display:none;width:100%;box-sizing:border-box;margin-top:10px;min-height:180px;background:#0b1016;color:#e8eef5;border:1px solid #2c3a4a;border-radius:8px;font:12px ui-monospace,monospace"></textarea>`;
  document.body.appendChild(box);
  const text = `${resultsText(r)}\n\nJSON :\n${JSON.stringify(r)}`;
  const ta = box.querySelector('#bench-text') as HTMLTextAreaElement;
  ta.value = text;
  const copyBtn = box.querySelector('#bench-copy') as HTMLButtonElement;
  const fallback = (): void => {
    ta.style.display = 'block';
    ta.focus(); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    copyBtn.textContent = ok ? 'Copié ✓' : 'Texte sélectionné : Ctrl+C / ⌘C';
  };
  copyBtn.addEventListener('click', () => {
    // Appel direct dans le gestionnaire de clic (geste de l'utilisateur exigé par le presse-papiers).
    const cb = navigator.clipboard;
    if (!cb?.writeText) { fallback(); return; }
    cb.writeText(text).then(() => { copyBtn.textContent = 'Copié ✓'; }, fallback);
  });
  (box.querySelector('#bench-close') as HTMLButtonElement).addEventListener('click', () => box.remove());
  (window as unknown as { __benchResult?: BenchResult }).__benchResult = r;
}

/** Lien discret « Mesurer les performances » sous le menu principal (utile dans l'artifact, adresse non modifiable). */
export function installBenchLink(): void {
  const foot = document.getElementById('menu-foot');
  if (!foot || document.getElementById('bench-link')) return;
  const a = document.createElement('a');
  a.id = 'bench-link';
  a.href = relaunchUrl({ bench: '' });
  a.textContent = 'Mesurer les performances (≈ 1 min 30)';
  a.style.cssText = 'display:inline-block;margin-top:4px;font-size:12px;color:var(--muted);text-decoration:underline';
  foot.insertAdjacentElement('afterend', a);
}
