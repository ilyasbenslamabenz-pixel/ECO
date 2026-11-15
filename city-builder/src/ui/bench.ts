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

declare const __BUILD_COMMIT__: string | undefined;

export interface BenchOptions { short: boolean }

/** Lit `bench` dans la requête ou le fragment (#bench) de l'adresse ; null hors mode mesure. */
export function benchMode(loc: { search: string; hash: string } | undefined = globalThis.location): BenchOptions | null {
  if (!loc) return null;
  for (const raw of [loc.search, loc.hash.replace(/^#/, '?')]) {
    const p = new URLSearchParams(raw);
    if (p.has('bench')) return { short: p.get('bench') === 'court' || p.has('court') };
  }
  return null;
}

/* ------------------------------ Enregistreur d'images ------------------------------ */

/** Horodatages requestAnimationFrame depuis le démarrage (à-coups du chargement compris). */
const stamps: number[] = [];
const frameHooks: ((now: number) => void)[] = [];
let recording = false;
let hiddenSeen = false;

/** Démarre l'enregistrement des images (au tout début du démarrage, pour mesurer le chargement). */
export function startBenchRecorder(): void {
  if (recording || typeof requestAnimationFrame === 'undefined') return;
  recording = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenSeen = true; });
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
  safeMode: boolean;
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
}

export interface BenchResult {
  version: string; date: string; mode: 'complet' | 'court';
  env: Record<string, string | number | boolean>;
  load: { playableS: number; maxLoadFrameMs: number; maxFirstFramesMs: number; framesOver100Load: number; firstFramesOver100: number };
  scenes: SceneResult[];
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

/* ------------------------------ Parcours ------------------------------ */

/** Joue le parcours puis affiche les résultats. `readyAt` : instant (performance.now) où la ville est jouable. */
export async function runBench(h: BenchHost, opts: BenchOptions, readyAt: number): Promise<BenchResult> {
  const warmS = opts.short ? 1 : 5, preS = opts.short ? 0.5 : 3, measS = opts.short ? 2 : 15, cpuN = opts.short ? 3 : 20;
  const badge = progressBadge(h.quality);
  const warnings: string[] = [];
  const firstEnd = readyAt + 3000;
  badge(`Mesure : préchauffe (${warmS} s)…`);
  h.setCamera('demo-aerial');
  await wait(warmS * 1000);
  const loadIv = intervals(0, readyAt), firstIv = intervals(readyAt - 1500, firstEnd);
  const p0 = h.cameraPose();
  const home: Home = { x: p0.targetX, z: p0.targetZ, yaw: p0.yaw, pitch: p0.pitch };
  const scenes: SceneResult[] = [];
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
    const t0 = performance.now();
    measuring = true;
    await wait(measS * 1000);
    const t1 = performance.now();
    measuring = false;
    const iv = intervals(t0, t1);
    // Temps processeur : court échantillon séparé (attente de la carte graphique avant chaque image : gl.finish).
    let cpu: { updateMs: number; renderMs: number } | null = null;
    try { cpu = h.cpuFrames(cpuN, sc.cpuYaw); } catch { cpu = null; }
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
    });
  }
  await h.setSpeed(1).catch(() => undefined);
  h.setCamera('demo-aerial');
  badge(null);
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
      densitePixels: r2(devicePixelRatio || 1), qualite: h.quality, modeAllege: h.lite, modeSur: h.safeMode, lotsParMateriau: h.batched,
      carteOmbre: h.renderer.shadowMap.enabled && h.shadowSize() > 0 ? `${h.shadowSize()} px` : 'désactivée',
      coeursProcesseur: navigator.hardwareConcurrency ?? 0,
    },
    load: {
      playableS: r1(readyAt / 1000),
      maxLoadFrameMs: Math.round(Math.max(0, ...loadIv)), framesOver100Load: loadIv.filter((v) => v > 100).length,
      maxFirstFramesMs: Math.round(Math.max(0, ...firstIv)), firstFramesOver100: firstIv.filter((v) => v > 100).length,
    },
    scenes, warnings,
  };
  showResults(res);
  return res;
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
    `Écran ${e['ecran']} · fenêtre ${e['fenetre']} · densité ${e['densitePixels']} · qualité ${e['qualite']}${e['modeAllege'] ? ' (allégé)' : ''}${e['modeSur'] ? ' (mode sûr)' : ''} · lots par matériau ${e['lotsParMateriau'] ? 'oui' : 'non'} · ombres ${e['carteOmbre']}`,
    `Chargement : jouable en ${fmt(r.load.playableS)} s · plus longue image au chargement ${r.load.maxLoadFrameMs} ms (${r.load.framesOver100Load} > 100 ms) · premières images ${r.load.maxFirstFramesMs} ms (${r.load.firstFramesOver100} > 100 ms)`,
    '',
    'Scène | img/s méd. | img/s moy. | p95 ms | p99 ms | max ms | > 33 ms | CPU màj+rendu ms | appels | triangles | rendu px (ratio)',
  ];
  for (const s of r.scenes) {
    lines.push(`${s.label} | ${fmt(s.fpsMedian)} | ${fmt(s.fpsMean)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${fmt(s.maxMs)} | ${fmt(s.over33)} % | ${fmt(s.cpuUpdateMs)} + ${fmt(s.cpuRenderMs)} | ${fmtInt(s.calls)} | ${fmtTris(s.triangles)} | ${s.renderW}×${s.renderH} (${s.ratioMin === s.ratioMax ? fmt(s.ratioMin) : `${fmt(s.ratioMin)}–${fmt(s.ratioMax)}`})`);
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
    + `<td ${td}>${fmt(s.p95)}</td><td ${td}>${fmt(s.p99)}</td><td ${td}>${fmt(s.maxMs)}</td><td ${td}>${fmt(s.over33)} %</td>`
    + `<td ${td}>${fmt(s.cpuUpdateMs)} + ${fmt(s.cpuRenderMs)}</td><td ${td}>${fmtInt(s.calls)}</td><td ${td}>${fmtTris(s.triangles)}</td>`
    + `<td ${td}>${s.renderW}×${s.renderH}<br><small style="color:#93a4b8">×${s.ratioMin === s.ratioMax ? fmt(s.ratioMin) : `${fmt(s.ratioMin)}–${fmt(s.ratioMax)}`}</small></td></tr>`).join('');
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
      ${kv('Jouable après', `${fmt(r.load.playableS)} s`)}
      ${kv('Plus longue image au chargement', `${r.load.maxLoadFrameMs} ms (${r.load.framesOver100Load} > 100 ms)`)}
      ${kv('Premières images de jeu (3 s)', `max ${r.load.maxFirstFramesMs} ms (${r.load.firstFramesOver100} > 100 ms)`)}
    </div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:860px">
      <thead><tr><th ${th.replace('right', 'left')}>Scène</th><th ${th}>img/s<br>médiane</th><th ${th}>img/s<br>moyenne</th><th ${th}>p95<br>ms</th><th ${th}>p99<br>ms</th><th ${th}>plus longue<br>ms</th><th ${th}>images<br>&gt; 33 ms</th><th ${th}>CPU ms<br>màj + rendu</th><th ${th}>appels de<br>dessin</th><th ${th}>triangles</th><th ${th}>rendu px<br>(densité)</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${r.warnings.map((w) => `<p style="margin:10px 0 0;color:#f2c94c">⚠ ${esc(w)}</p>`).join('')}
    <p style="margin:10px 0 0;color:#93a4b8;font-size:12px">img/s plafonnées par la fréquence de l'écran (60, 120 Hz…). CPU : échantillon séparé de ${r.mode === 'court' ? 3 : 20} images, carte graphique attendue avant chaque image. Appels et triangles : moyenne par image, ombres comprises. Aucune donnée n'est envoyée sur le réseau.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
      <button type="button" id="bench-copy" ${btn.replace('#2a3646', '#4fd18b').replace('#e8eef5', '#0d1a12')}>Copier les résultats</button>
      ${link('Relancer', {})}${link('Relancer en Haute', { qualite: 'haute' })}${link('Relancer en Moyenne', { qualite: 'moyenne' })}${link('Relancer en Auto', { qualite: 'auto' })}
      ${link('Relancer sans lots (?lots=0)', { lots: '0' })}${link('Lots activés', { lots: null })}
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
