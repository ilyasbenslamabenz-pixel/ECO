/**
 * Rendu du réseau électrique (phase 2B, sous-étape 4) :
 *  - rotors des éoliennes (modèle `elec_eolienne_rotor`, instancié, 3 LOD) animés selon le vent et l'état de
 *    l'éolienne (arrêtée en panne ou sans vent) ; les mâts / nacelles sont des bâtiments du catalogue ;
 *  - lignes haute tension : pylônes treillis instanciés (`elec_pylone`, 3 LOD) tous les ~140 m, câbles tendus en
 *    chaînette (4 conducteurs + câble de garde) ;
 *  - calque « réseau électrique » : cellules colorées (alimenté / partiel / coupé / non raccordé), rayons de
 *    distribution des installations, charge des lignes.
 * Le rendu ne modifie jamais l'état du jeu.
 */
import * as THREE from 'three';
import { createGltfLoader } from '../gzip-assets';
import { GANTRY_HEIGHT, POWER_ELEMENT_FILES, PYLON, TURBINE } from '../../shared/power/render-spec';
import { dequantizeGeometry } from '../assets';
import { capModelTextures, imageLimits } from '../image-cap';
import { LINE_SPEC, windPowerShare } from '../../shared/power/model';
import { COVER_CUT, COVER_OK, COVER_PARTIAL, COVER_UNLINKED, type ElectriciteDelta, type FacilityView, type LineView } from '../../shared/power/types';
import { powerView } from '../../shared/power/view';
import type { RenderPluginContext } from '../plugins/types';

const LOD_DIST = [350, 1400];

interface LodSet { meshes: THREE.InstancedMesh[] }

/** Jeu d'InstancedMesh (une par sous-maillage) pour chaque LOD d'un modèle. */
class InstancedModel {
  readonly lods: LodSet[] = [];
  ready = false;
  constructor(private readonly group: THREE.Group, private readonly capacity: number, private readonly name: string) {}

  /** Charge les LOD (fichiers GLB relatifs au dossier assets, hors catalogue) et crée les InstancedMesh. */
  async load(ctx: RenderPluginContext, files: readonly string[]): Promise<void> {
    const loader = createGltfLoader();
    for (let l = 0; l < files.length; l++) {
      const gltf = await loader.loadAsync(ctx.lib.url(files[l]!));
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      // Hors bibliothèque de modèles : plafond des textures du mode allégé appliqué ici aussi (Safari iOS).
      capModelTextures(root, imageLimits.textureCap);
      const set: LodSet = { meshes: [] };
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        dequantizeGeometry(m.geometry);
        const geo = m.geometry.clone();
        geo.applyMatrix4(m.matrixWorld);
        const im = new THREE.InstancedMesh(geo, m.material, this.capacity);
        im.name = `${this.name}_lod${l}`;
        im.count = 0;
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(im);
        set.meshes.push(im);
      });
      this.lods.push(set);
    }
    this.ready = true;
  }

  /** Écrit les matrices (par LOD) ; `lodOf(i)` choisit le LOD de l'instance i. */
  write(mats: THREE.Matrix4[], lodOf: (i: number) => number): void {
    if (!this.ready) return;
    const counts = this.lods.map(() => 0);
    for (let i = 0; i < mats.length; i++) {
      const l = Math.min(this.lods.length - 1, lodOf(i));
      const k = counts[l]!;
      if (k >= this.capacity) continue;
      for (const im of this.lods[l]!.meshes) im.setMatrixAt(k, mats[i]!);
      counts[l] = k + 1;
    }
    for (let l = 0; l < this.lods.length; l++) {
      for (const im of this.lods[l]!.meshes) { im.count = counts[l]!; im.instanceMatrix.needsUpdate = true; }
    }
  }
}

/** Position monde d'un point local (lx, ly, lz) d'un bâtiment (rotation en quarts de tour, convention du protocole). */
function localToWorld(f: { x: number; y: number; z: number; rot: number }, lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
  const t = f.rot * Math.PI / 2;
  const c = Math.cos(t), s = Math.sin(t);
  return out.set(f.x + lx * c + lz * s, f.y + ly, f.z - lx * s + lz * c);
}

export class PowerRenderer {
  readonly group = new THREE.Group();
  private ctx!: RenderPluginContext;
  private rotors!: InstancedModel;
  private pylons!: InstancedModel;
  private cables: THREE.LineSegments | null = null;
  private overlayMesh: THREE.Mesh | null = null;
  private rings: THREE.LineSegments | null = null;
  private loadLines: THREE.LineSegments | null = null;
  private turbines: { f: FacilityView; angle: number; speed: number; hub: THREE.Vector3; yaw: number }[] = [];
  private pylonMats: THREE.Matrix4[] = [];
  private pylonPos: THREE.Vector3[] = [];
  private facilitiesKey = '';
  private linesKey = '';
  private coverageVersion = -1;
  private lodTimer = 0;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private unsub: (() => void) | null = null;
  /** Diagnostic (e2e). */
  stats = { turbines: 0, pylons: 0, cableSegments: 0, overlayCells: 0, lines: 0 };

  async init(ctx: RenderPluginContext): Promise<void> {
    this.ctx = ctx;
    this.group.name = 'electricite';
    ctx.scene.add(this.group);
    this.rotors = new InstancedModel(this.group, 256, 'elec_rotor');
    this.pylons = new InstancedModel(this.group, 4096, 'elec_pylone');
    this.unsub = powerView.on(() => this.applyOverlayVisibility());
    // Éléments chargés en arrière-plan : une erreur (fichier absent) laisse le reste du rendu fonctionnel.
    void this.rotors.load(ctx, POWER_ELEMENT_FILES.rotor).then(() => this.rebuildTurbines(true)).catch((e: unknown) => { console.error('[rendu electricite] rotor :', e); });
    void this.pylons.load(ctx, POWER_ELEMENT_FILES.pylone).then(() => this.rebuildLines(true)).catch((e: unknown) => { console.error('[rendu electricite] pylône :', e); });
    await Promise.resolve();
  }

  apply(state: ElectriciteDelta): void {
    this.rebuildTurbines(false);
    this.rebuildLines(false);
    if (state.coverage && state.coverage.version !== this.coverageVersion) this.rebuildOverlay();
    this.applyOverlayVisibility();
  }

  private facilities(): FacilityView[] { return powerView.state.facilities ?? []; }
  private lines(): LineView[] { return powerView.state.lines ?? []; }

  /* --------------------------------- Éoliennes --------------------------------- */

  private rebuildTurbines(force: boolean): void {
    const list = this.facilities().filter((f) => f.kind === 'eolien');
    const key = list.map((f) => `${f.id}:${f.x}:${f.z}:${f.rot}`).join('|');
    const wind = powerView.state.summary?.windMs ?? 0;
    const prev = new Map(this.turbines.map((t) => [t.f.id, t]));
    if (key !== this.facilitiesKey || force) {
      this.facilitiesKey = key;
      this.turbines = list.map((f) => {
        const hub = localToWorld(f, 0, TURBINE.hubHeight, TURBINE.hubForward, new THREE.Vector3());
        // Hauteur du sol rendu (le bâtiment est posé sur le terrain nivelé de la simulation).
        return { f, angle: prev.get(f.id)?.angle ?? (f.id * 1.7) % (Math.PI * 2), speed: 0, hub, yaw: f.rot * Math.PI / 2 };
      });
    } else {
      for (const t of this.turbines) { const nf = list.find((f) => f.id === t.f.id); if (nf) t.f = nf; }
    }
    for (const t of this.turbines) {
      const running = t.f.failedUntil === 0 && t.f.availableKw > 0;
      // ≈ 6 tr/min au démarrage, 15 tr/min à la puissance nominale.
      t.speed = running ? 0.6 + 1.0 * Math.min(1, Math.cbrt(windPowerShare(wind))) : 0;
    }
    this.stats.turbines = this.turbines.length;
  }

  /* ------------------------------ Lignes et pylônes ------------------------------ */

  private rebuildLines(force: boolean): void {
    const lines = this.lines();
    const facs = new Map(this.facilities().map((f) => [f.id, f]));
    const key = lines.map((l) => `${l.id}:${l.ax}:${l.az}:${l.bx}:${l.bz}`).join('|');
    if (key === this.linesKey && !force) { this.updateLoadColors(); return; }
    this.linesKey = key;
    this.pylonMats = [];
    this.pylonPos = [];
    const pts: number[] = [];
    const heightAt = (x: number, z: number): number => { const h = this.ctx.heightAt(x, z); return Number.isFinite(h) ? h : 0; };
    const attach = [...PYLON.attach, PYLON.earth];
    for (const l of lines) {
      const fa = facs.get(l.a), fb = facs.get(l.b);
      const dx = l.bx - l.ax, dz = l.bz - l.az;
      const L = Math.hypot(dx, dz);
      if (L < 1) continue;
      const ux = dx / L, uz = dz / L;
      const yaw = Math.atan2(dx, dz); // axe local +Z le long de la ligne, bras selon X
      const margin = 24;
      const usable = Math.max(1, L - 2 * margin);
      const n = Math.max(1, Math.round(usable / LINE_SPEC.pylonSpacingM));
      // Supports : portique de départ, pylônes, portique d'arrivée.
      const supports: { x: number; y: number; z: number; pylon: boolean }[] = [];
      supports.push({ x: l.ax, y: (fa?.y ?? heightAt(l.ax, l.az)), z: l.az, pylon: false });
      for (let k = 0; k <= n; k++) {
        const d = margin + (usable * k) / n;
        const x = l.ax + ux * d, z = l.az + uz * d;
        supports.push({ x, y: heightAt(x, z), z, pylon: true });
      }
      supports.push({ x: l.bx, y: (fb?.y ?? heightAt(l.bx, l.bz)), z: l.bz, pylon: false });
      this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      for (const s of supports) {
        if (!s.pylon) continue;
        this.pylonMats.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), this.tmpQ, this.one));
        this.pylonPos.push(new THREE.Vector3(s.x, s.y, s.z));
      }
      // Câbles : chaînette entre supports consécutifs (flèche ≈ 3 % de la portée).
      const px = uz, pz = -ux; // latéral (local +X après rotation yaw)
      for (let k = 0; k + 1 < supports.length; k++) {
        const A = supports[k]!, B = supports[k + 1]!;
        const span = Math.hypot(B.x - A.x, B.z - A.z);
        const sag = Math.min(9, 0.03 * span);
        for (const [ax, ay] of attach) {
          const ya = A.pylon ? A.y + ay : A.y + GANTRY_HEIGHT + ay * 0.12;
          const yb = B.pylon ? B.y + ay : B.y + GANTRY_HEIGHT + ay * 0.12;
          const ka = A.pylon ? ax : ax * 0.5, kb = B.pylon ? ax : ax * 0.5;
          const N = 10;
          let lx = A.x + px * ka, ly = ya, lz = A.z + pz * ka;
          for (let i = 1; i <= N; i++) {
            const t = i / N;
            const lat = ka + (kb - ka) * t;
            const x = A.x + (B.x - A.x) * t + px * lat;
            const z = A.z + (B.z - A.z) * t + pz * lat;
            const y = ya + (yb - ya) * t - sag * 4 * t * (1 - t);
            pts.push(lx, ly, lz, x, y, z);
            lx = x; ly = y; lz = z;
          }
        }
      }
    }
    if (this.cables) { this.group.remove(this.cables); this.cables.geometry.dispose(); (this.cables.material as THREE.Material).dispose(); this.cables = null; }
    if (pts.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.cables = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2b2f33, transparent: true, opacity: 0.9 }));
      this.cables.name = 'elec_cables';
      this.cables.frustumCulled = false;
      this.group.add(this.cables);
    }
    this.stats.pylons = this.pylonMats.length;
    this.stats.cableSegments = pts.length / 6;
    this.stats.lines = lines.length;
    this.writePylons();
    this.rebuildLoadLines();
  }

  private writePylons(): void {
    const cam = this.ctx.camera.position;
    this.pylons.write(this.pylonMats, (i) => {
      const d = this.pylonPos[i]!.distanceTo(cam);
      return d < LOD_DIST[0]! ? 0 : d < LOD_DIST[1]! ? 1 : 2;
    });
  }

  /** Calque : lignes colorées selon la charge (vert -> rouge), rouge vif en panne. */
  private rebuildLoadLines(): void {
    if (this.loadLines) { this.group.remove(this.loadLines); this.loadLines.geometry.dispose(); (this.loadLines.material as THREE.Material).dispose(); this.loadLines = null; }
    const lines = this.lines();
    if (!lines.length) return;
    const pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    for (const l of lines) {
      const ya = this.ctx.heightAt(l.ax, l.az) + 40, yb = this.ctx.heightAt(l.bx, l.bz) + 40;
      pos.push(l.ax, Number.isFinite(ya) ? ya : 40, l.az, l.bx, Number.isFinite(yb) ? yb : 40, l.bz);
      if (l.failedUntil > 0) c.set(0xff2020); else c.setHSL(0.33 * (1 - Math.min(1, l.load)), 0.85, 0.5);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.loadLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.loadLines.name = 'elec_charge_lignes';
    this.loadLines.renderOrder = 11;
    this.loadLines.frustumCulled = false;
    this.group.add(this.loadLines);
  }

  private updateLoadColors(): void { this.rebuildLoadLines(); this.applyOverlayVisibility(); }

  /* ----------------------------------- Calque ----------------------------------- */

  private rebuildOverlay(): void {
    const cov = powerView.state.coverage;
    if (this.overlayMesh) { this.group.remove(this.overlayMesh); this.overlayMesh.geometry.dispose(); (this.overlayMesh.material as THREE.Material).dispose(); this.overlayMesh = null; }
    if (this.rings) { this.group.remove(this.rings); this.rings.geometry.dispose(); (this.rings.material as THREE.Material).dispose(); this.rings = null; }
    if (!cov) return;
    this.coverageVersion = cov.version;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const colors: Record<number, THREE.Color> = {
      [COVER_OK]: new THREE.Color(0x2fd06a), [COVER_PARTIAL]: new THREE.Color(0xffa31a), [COVER_CUT]: new THREE.Color(0xff2a2a), [COVER_UNLINKED]: new THREE.Color(0x9a6cff),
    };
    const h = (x: number, z: number): number => { const v = this.ctx.heightAt(x, z); return (Number.isFinite(v) ? v : 0) + 2.5; };
    let cells = 0;
    for (let j = 0; j < cov.rows; j++) {
      for (let i = 0; i < cov.cols; i++) {
        const code = cov.cells[j * cov.cols + i]!;
        const c = colors[code];
        if (!c) continue;
        const x0 = cov.originX + i * cov.cellSize + 1, z0 = cov.originZ + j * cov.cellSize + 1;
        const x1 = x0 + cov.cellSize - 2, z1 = z0 + cov.cellSize - 2;
        const b = pos.length / 3;
        pos.push(x0, h(x0, z0), z0, x1, h(x1, z0), z0, x1, h(x1, z1), z1, x0, h(x0, z1), z1);
        for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
        cells++;
      }
    }
    this.stats.overlayCells = cells;
    if (cells) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
      this.overlayMesh = new THREE.Mesh(g, m);
      this.overlayMesh.name = 'elec_calque';
      this.overlayMesh.renderOrder = 10;
      this.overlayMesh.frustumCulled = false;
      this.group.add(this.overlayMesh);
    }
    // Rayons de distribution des installations (cercle vert si alimentée, rouge sinon).
    const rp: number[] = [], rc: number[] = [];
    const cOk = new THREE.Color(0x2fd06a), cKo = new THREE.Color(0xff2a2a);
    for (const f of this.facilities()) {
      const c = f.energized && f.failedUntil === 0 ? cOk : cKo;
      const N = 48;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
        const x0 = f.x + Math.cos(a0) * f.radius, z0 = f.z + Math.sin(a0) * f.radius;
        const x1 = f.x + Math.cos(a1) * f.radius, z1 = f.z + Math.sin(a1) * f.radius;
        rp.push(x0, h(x0, z0) + 1, z0, x1, h(x1, z1) + 1, z1);
        rc.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    if (rp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
      this.rings = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
      this.rings.name = 'elec_rayons';
      this.rings.renderOrder = 11;
      this.rings.frustumCulled = false;
      this.group.add(this.rings);
    }
  }

  private applyOverlayVisibility(): void {
    const v = powerView.overlay;
    if (v && powerView.state.coverage && powerView.state.coverage.version !== this.coverageVersion) this.rebuildOverlay();
    if (this.overlayMesh) this.overlayMesh.visible = v;
    if (this.rings) this.rings.visible = v;
    if (this.loadLines) this.loadLines.visible = v;
  }

  /* ----------------------------------- Image ----------------------------------- */

  frame(dt: number): void {
    if (!this.ctx) return;
    const step = Math.min(0.1, Math.max(0, dt));
    if (this.rotors.ready && this.turbines.length) {
      const mats: THREE.Matrix4[] = [];
      const cam = this.ctx.camera.position;
      const qYaw = new THREE.Quaternion(), qSpin = new THREE.Quaternion();
      const axisY = new THREE.Vector3(0, 1, 0), axisZ = new THREE.Vector3(0, 0, 1);
      for (const t of this.turbines) {
        t.angle = (t.angle + t.speed * step) % (Math.PI * 2);
        qYaw.setFromAxisAngle(axisY, t.yaw);
        qSpin.setFromAxisAngle(axisZ, -t.angle);
        this.tmpQ.copy(qYaw).multiply(qSpin);
        mats.push(new THREE.Matrix4().compose(t.hub, this.tmpQ, this.one));
      }
      this.rotors.write(mats, (i) => {
        const d = this.turbines[i]!.hub.distanceTo(cam);
        return d < LOD_DIST[0]! ? 0 : d < LOD_DIST[1]! * 1.5 ? 1 : 2;
      });
    }
    if ((this.lodTimer += step) > 0.5 && this.pylonMats.length) { this.lodTimer = 0; this.writePylons(); }
    void this.tmpM; void this.tmpV;
  }

  debug(): unknown {
    return { ...this.stats, overlay: powerView.overlay, overlayVisible: !!this.overlayMesh?.visible, rotorsReady: this.rotors?.ready ?? false, pylonsReady: this.pylons?.ready ?? false };
  }

  dispose(): void {
    this.unsub?.();
    this.ctx?.scene.remove(this.group);
  }
}
