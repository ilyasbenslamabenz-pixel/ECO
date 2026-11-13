/**
 * Mini-carte (bas gauche) : VRAIE carte rendue en canvas 2D depuis le terrain (relief ombré, eau, forêts),
 * le réseau routier et les bâtiments du miroir de la simulation. Le fond est recalculé rarement
 * (nouvel instantané, modification de bâtiments / routes, au plus toutes les 1,5 s) ; seule l'emprise de
 * la caméra est redessinée (≈ 5 fois/s, calque séparé).
 * Clic / glisser sur la carte : la caméra s'y rend (setPose). Boutons : vue rue/aérienne, zoom, nord, survol.
 * Propriétaire : agent UI (refonte).
 */
import type { WorldMirror } from '../client/tools/mirror';
import type { CameraController } from '../input/camera';
import { terrainBounds } from '../shared/terrain-gen';
import { $ } from './dom';

const NO_WATER = -10000;

interface WorldLike { waterSurface?: Float32Array; forest?: Uint8Array }

/** Couleur d'un bâtiment selon sa catégorie (lisible sur fond de terrain). */
const CAT_COLOR: Record<string, string> = {
  house: '#f2e3c6', townhouse: '#efd6b0', apartment_low: '#e9c79a', apartment_mid: '#e3b985', apartment_high: '#d9a46c', skyscraper: '#cfd8e6',
  commercial: '#7cc4ff', industrial: '#ffcc5c', public: '#ff8f8f',
};

export interface MinimapDeps {
  camera: CameraController;
  mirror: WorldMirror;
  heightAt: (x: number, z: number) => number;
}

export class Minimap {
  private base = $<HTMLCanvasElement>('mm-canvas');
  private view = $<HTMLCanvasElement>('mm-view');
  private wrap = $('mm-map');
  private terrainImg: HTMLCanvasElement | null = null;
  private lastTerrain: unknown = null;
  private dirty = true;
  private lastBase = 0;
  private timer = 0;
  private bounds = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
  /** Nombre de rendus du fond (diagnostic e2e). */
  renders = 0;

  constructor(private d: MinimapDeps) {
    d.mirror.onChange(() => { this.dirty = true; });
    const go = (e: PointerEvent): void => {
      const r = this.base.getBoundingClientRect();
      const p = this.toWorld((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      if (!p) return;
      const cam = this.d.camera;
      if (cam.mode === 'street') cam.setMode('aerial');
      cam.stopCinematic();
      cam.setPose({ targetX: p.x, targetZ: p.z, targetY: this.d.heightAt(p.x, p.z) });
      this.drawView();
    };
    let dragging = false;
    this.wrap.addEventListener('pointerdown', (e) => { dragging = true; this.wrap.setPointerCapture(e.pointerId); go(e); e.preventDefault(); });
    this.wrap.addEventListener('pointermove', (e) => { if (dragging) go(e); });
    const end = (): void => { dragging = false; };
    this.wrap.addEventListener('pointerup', end);
    this.wrap.addEventListener('pointercancel', end);

    const zoom = (f: number): void => {
      const cam = d.camera;
      if (cam.mode === 'street') cam.setMode('aerial');
      cam.stopCinematic();
      cam.flyTo({ distance: cam.getPose().distance * f });
    };
    $('mm-zoom-in').addEventListener('click', () => zoom(0.7));
    $('mm-zoom-out').addEventListener('click', () => zoom(1 / 0.7));
    $('mm-north').addEventListener('click', () => d.camera.setView('north'));
    const cine = $('btn-cinematic');
    cine.addEventListener('click', () => d.camera.toggleCinematic());
    d.camera.setCinematicListener((on) => { cine.setAttribute('aria-pressed', String(on)); cine.classList.toggle('active', on); });
    const tog = $('mm-toggle');
    tog.addEventListener('click', () => {
      const hidden = $('minimap').classList.toggle('map-off');
      tog.setAttribute('aria-pressed', String(!hidden));
      tog.classList.toggle('active', !hidden);
      if (!hidden) { this.dirty = true; this.tick(); }
    });
    // Sur téléphone, la carte est repliée par défaut (place réservée à la ville).
    if (window.matchMedia('(max-width: 760px), (max-height: 500px) and (orientation: landscape)').matches) { $('minimap').classList.add('map-off'); tog.setAttribute('aria-pressed', 'false'); } else tog.classList.add('active');
    this.timer = window.setInterval(() => this.tick(), 200);
  }

  dispose(): void { clearInterval(this.timer); }

  /** Force un nouveau rendu du fond (nouvel instantané, terrain modifié). */
  invalidate(): void { this.dirty = true; this.dirtyTerrain = true; }

  private visible(): boolean {
    return !document.hidden && !$('bottom').classList.contains('hidden') && !$('minimap').classList.contains('map-off') && this.base.offsetParent !== null;
  }

  tick(): void {
    // Boussole : l'aiguille indique le nord vu depuis la caméra.
    const yaw = this.d.camera.getPose().yaw;
    const comp = document.getElementById('mm-compass');
    if (comp) comp.style.transform = `rotate(${(yaw * 180) / Math.PI}deg)`;
    if (!this.visible()) return;
    const now = performance.now();
    if (this.dirty && now - this.lastBase > 1500) { this.drawBase(); this.lastBase = now; }
    this.drawView();
  }

  /** Coordonnées normalisées (0..1) de la carte → monde. */
  private toWorld(u: number, v: number): { x: number; z: number } | null {
    const b = this.bounds;
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
    return { x: b.minX + u * (b.maxX - b.minX), z: b.minZ + v * (b.maxZ - b.minZ) };
  }

  private size(c: HTMLCanvasElement): { w: number; h: number; dpr: number } {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(40, Math.round(c.clientWidth || 180));
    const h = Math.max(40, Math.round(c.clientHeight || 180));
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); this.dirty = true; }
    return { w, h, dpr };
  }

  /** Relief ombré + eau + forêts, échantillonné une fois par instantané et par taille. */
  private terrainLayer(W: number, H: number): HTMLCanvasElement | null {
    const t = this.d.mirror.terrain;
    if (!t) return null;
    if (t !== this.lastTerrain) { this.lastTerrain = t; this.dirtyTerrain = true; }
    if (this.terrainImg && !this.dirtyTerrain && this.terrainImg.width === W && this.terrainImg.height === H) return this.terrainImg;
    this.dirtyTerrain = false;
    const c = this.terrainImg ?? document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (!g) return null;
    const img = g.createImageData(W, H);
    const b = this.bounds;
    const w = t as unknown as WorldLike;
    const n = t.samplesX * t.samplesZ;
    const ws = w.waterSurface && w.waterSurface.length === n ? w.waterSurface : null;
    const forest = w.forest && w.forest.length === n ? w.forest : null;
    const hs = new Float32Array(W * H);
    let hmin = Infinity; let hmax = -Infinity;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = b.minX + ((i + 0.5) / W) * (b.maxX - b.minX);
        const z = b.minZ + ((j + 0.5) / H) * (b.maxZ - b.minZ);
        const y = this.d.heightAt(x, z);
        hs[j * W + i] = y;
        if (y < hmin) hmin = y; if (y > hmax) hmax = y;
      }
    }
    const span = Math.max(1, hmax - Math.max(hmin, t.waterLevel));
    const cell = (b.maxX - b.minX) / W;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const y = hs[k]!;
        const x = b.minX + ((i + 0.5) / W) * (b.maxX - b.minX);
        const z = b.minZ + ((j + 0.5) / H) * (b.maxZ - b.minZ);
        const si = Math.max(0, Math.min(t.samplesX - 1, Math.round((x - t.originX) / t.spacing)));
        const sj = Math.max(0, Math.min(t.samplesZ - 1, Math.round((z - t.originZ) / t.spacing)));
        const s = sj * t.samplesX + si;
        const wsurf = ws ? ws[s]! : (y < t.waterLevel ? t.waterLevel : NO_WATER);
        let r: number; let gg: number; let bb: number;
        if (wsurf > NO_WATER / 2 && wsurf > y + 0.05) {
          const depth = Math.min(1, (wsurf - y) / 12);
          r = 46 - depth * 22; gg = 104 - depth * 36; bb = 150 - depth * 30;
        } else {
          const e = Math.max(0, Math.min(1, (y - t.waterLevel) / span));
          // Plaine verte → collines olive → roche claire.
          r = 92 + e * 90; gg = 128 + e * 40; bb = 72 + e * 70;
          if (y - t.waterLevel < 1.2) { r = 196; gg = 184; bb = 140; } // plage
          const f = forest ? forest[s]! / 255 : 0;
          if (f > 0.15) { const a = Math.min(0.75, f); r = r * (1 - a) + 38 * a; gg = gg * (1 - a) + 84 * a; bb = bb * (1 - a) + 44 * a; }
          // Ombrage (lumière du nord-ouest).
          const yl = hs[j * W + Math.max(0, i - 1)]!; const yu = hs[Math.max(0, j - 1) * W + i]!;
          const shade = Math.max(-0.35, Math.min(0.35, ((y - yl) + (y - yu)) / (cell * 0.9)));
          r *= 1 + shade; gg *= 1 + shade; bb *= 1 + shade;
        }
        const o = k * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.terrainImg = c;
    return c;
  }

  private dirtyTerrain = true;

  /** Recalcule le relief au prochain rendu (terrain modifié : nouvel instantané, nivellement). */
  terrainChanged(): void { this.dirtyTerrain = true; this.dirty = true; }

  drawBase(): void {
    const m = this.d.mirror;
    const t = m.terrain;
    if (!t) return;
    this.bounds = terrainBounds(t);
    const { w, h, dpr } = this.size(this.base);
    const W = Math.round(w * dpr); const H = Math.round(h * dpr);
    const g = this.base.getContext('2d');
    if (!g) return;
    const layer = this.terrainLayer(Math.min(W, 260), Math.min(H, 260));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    g.clearRect(0, 0, W, H);
    if (layer) g.drawImage(layer, 0, 0, W, H);
    const b = this.bounds;
    const sx = W / (b.maxX - b.minX); const sz = H / (b.maxZ - b.minZ);
    const X = (x: number): number => (x - b.minX) * sx;
    const Z = (z: number): number => (z - b.minZ) * sz;
    // Routes : polylignes du miroir, largeur proportionnelle (minimum lisible).
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const e of m.edges.values()) {
        const v = m.edgeView(e);
        if (!v) continue;
        const kind = v.kindId;
        const wide = kind === 'highway' ? 2.4 : kind === 'boulevard' || kind === 'avenue' ? 1.8 : 1.2;
        g.strokeStyle = pass === 0 ? 'rgba(20,24,28,0.55)' : kind === 'highway' ? '#ffd27a' : kind === 'pedestrian' ? '#d9c7a6' : '#f4f6f8';
        g.lineWidth = (pass === 0 ? wide + 1.4 : wide) * dpr;
        g.beginPath();
        const p = v.poly;
        g.moveTo(X(p[0]!), Z(p[1]!));
        for (let i = 2; i < p.length; i += 2) g.lineTo(X(p[i]!), Z(p[i + 1]!));
        g.stroke();
      }
    }
    // Bâtiments : emprise réelle (au moins 2 px).
    for (const bd of m.buildings.values()) {
      const a = m.asset(bd.assetId);
      const r = m.buildingRect(bd);
      g.fillStyle = CAT_COLOR[a?.category ?? ''] ?? '#e8e2d6';
      if (r) {
        const x0 = X(r.minX); const z0 = Z(r.minZ);
        g.fillRect(x0, z0, Math.max(2 * dpr, X(r.maxX) - x0), Math.max(2 * dpr, Z(r.maxZ) - z0));
      } else g.fillRect(X(bd.x) - dpr, Z(bd.z) - dpr, 2 * dpr, 2 * dpr);
    }
    this.dirty = false;
    this.renders++;
  }

  /** Emprise au sol de la caméra (trapèze) + point visé. */
  drawView(): void {
    const { w, h, dpr } = this.size(this.view);
    const g = this.view.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const b = this.bounds;
    const X = (x: number): number => ((x - b.minX) / (b.maxX - b.minX)) * w;
    const Z = (z: number): number => ((z - b.minZ) / (b.maxZ - b.minZ)) * h;
    const cam = this.d.camera;
    const pose = cam.getPose();
    const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
    const cw = canvas?.clientWidth ?? 1; const ch = canvas?.clientHeight ?? 1;
    const pts = [[0, ch * 0.3], [cw, ch * 0.3], [cw, ch], [0, ch]].map(([sx, sy]) => cam.groundAt(sx!, sy!));
    g.lineWidth = 1.5;
    if (cam.mode === 'aerial' && pts.every((p) => p)) {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(X(p!.x), Z(p!.z)) : g.moveTo(X(p!.x), Z(p!.z))));
      g.closePath();
      g.fillStyle = 'rgba(61,220,132,0.16)'; g.fill();
      g.strokeStyle = '#3ddc84'; g.stroke();
    } else {
      // Repli (vue rue / horizon) : cône de vision orienté.
      const fx = -Math.sin(pose.yaw); const fz = -Math.cos(pose.yaw);
      const len = Math.max(12, Math.min(w, h) * 0.18);
      const cx = X(pose.targetX); const cz = Z(pose.targetZ);
      g.beginPath();
      g.moveTo(cx, cz);
      const a = 0.6;
      g.lineTo(cx + (fx * Math.cos(a) - fz * Math.sin(a)) * len, cz + (fz * Math.cos(a) + fx * Math.sin(a)) * len);
      g.lineTo(cx + (fx * Math.cos(-a) - fz * Math.sin(-a)) * len, cz + (fz * Math.cos(-a) + fx * Math.sin(-a)) * len);
      g.closePath();
      g.fillStyle = 'rgba(61,220,132,0.22)'; g.fill(); g.strokeStyle = '#3ddc84'; g.stroke();
    }
    g.fillStyle = '#ffffff'; g.strokeStyle = '#0d1014'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(X(pose.targetX), Z(pose.targetZ), 3, 0, Math.PI * 2); g.fill(); g.stroke();
  }
}
