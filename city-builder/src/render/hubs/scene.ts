/**
 * Rendu des pôles de transport (port, aéroport) : pièces du catalogue `transport` composées selon les gabarits
 * de src/shared/hubs/layout.ts (LOD automatiques), terre-plein portuaire, pièces animées (grues portiques et
 * mobile, radar, rampe roulière, passerelles), navires et avions en mouvement (trajectoires pures de
 * src/shared/hubs/paths.ts, temps physique extrapolé à partir des deltas : phys += dt × vitesse).
 * Le rendu ne modifie jamais l'état du jeu. Propriété de la branche p2c-port-aeroport.
 */
import * as THREE from 'three';
import { rotAngle } from '../../shared/footprint';
import { QUAY_DEPTH, hubLayout, hubToWorld, type HubPiece } from '../../shared/hubs/layout';
import { movementPose, type MovementPose } from '../../shared/hubs/paths';
import type { HubMovement, HubRecord } from '../../shared/hubs/types';
import type { RenderPluginContext } from '../plugins/types';

const DEG = Math.PI / 180;

interface AnimRig {
  piece: HubPiece;
  root: THREE.Object3D;
  nodes: Map<string, { obj: THREE.Object3D; pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3 }>;
  /** État lissé 0..1 (0 = repos, 1 = en service). */
  level: number;
}

interface HubView {
  rec: HubRecord;
  group: THREE.Group;
  rigs: AnimRig[];
}

interface Mover { mv: HubMovement; obj: THREE.Object3D | null; tug: THREE.Object3D | null; loading: boolean }

export interface HubsRenderStats { hubs: number; pieces: number; loading: number; errors: string[]; movers: number; visibleMovers: number; poses: { id: number; asset: string; phase: string; u: number; alt: number; x: number; z: number }[] }

export class HubsRenderer {
  readonly root = new THREE.Group();
  private views = new Map<number, HubView>();
  private movers = new Map<number, Mover>();
  private hubs: HubRecord[] = [];
  private phys = 0;
  private speed = 0;
  private time = 0;
  private loading = 0;
  private pieces = 0;
  readonly errors: string[] = [];
  private slabMaterial: Promise<THREE.Material> | null = null;

  constructor(private readonly ctx: RenderPluginContext) {
    this.root.name = 'hubs';
    ctx.scene.add(this.root);
  }

  /* ------------------------------------------------------------- état */

  setState(hubs: HubRecord[] | undefined, movements: HubMovement[] | undefined, phys: number | undefined, speed: number | undefined): void {
    if (hubs) this.syncHubs(hubs);
    if (movements) this.syncMovers(movements);
    if (phys !== undefined) {
      // Temps physique : resynchronisation douce (pas de retour en arrière visible).
      if (Math.abs(phys - this.phys) > 3 || phys > this.phys) this.phys = phys;
    }
    if (speed !== undefined) this.speed = speed;
  }

  clear(): void { this.syncHubs([]); this.syncMovers([]); }

  private syncHubs(hubs: HubRecord[]): void {
    this.hubs = hubs;
    const keep = new Set(hubs.map((h) => h.id));
    for (const [id, v] of this.views) if (!keep.has(id)) { this.root.remove(v.group); this.views.delete(id); }
    for (const h of hubs) if (!this.views.has(h.id)) this.views.set(h.id, this.buildHub(h));
  }

  private syncMovers(list: HubMovement[]): void {
    const keep = new Set(list.map((m) => m.id));
    for (const [id, m] of this.movers) {
      if (keep.has(id)) continue;
      if (m.obj) this.root.remove(m.obj);
      if (m.tug) this.root.remove(m.tug);
      this.movers.delete(id);
    }
    for (const mv of list) {
      if (this.movers.has(mv.id)) continue;
      const m: Mover = { mv, obj: null, tug: null, loading: true };
      this.movers.set(mv.id, m);
      this.loading++;
      this.ctx.lib.load(mv.asset, 0).then((g) => {
        if (!this.movers.has(mv.id)) return;
        m.obj = g.clone(true);
        m.obj.rotation.order = 'YXZ';
        m.obj.visible = false;
        this.root.add(m.obj);
      }).catch((e: unknown) => this.errors.push(`${mv.asset} : ${String(e)}`)).finally(() => { this.loading--; m.loading = false; });
      if (mv.role === 'cargo' || mv.role === 'vraquier') {
        this.ctx.lib.load('port_remorqueur', 0).then((g) => {
          if (!this.movers.has(mv.id)) return;
          m.tug = g.clone(true); m.tug.visible = false; this.root.add(m.tug);
        }).catch((e: unknown) => this.errors.push(`port_remorqueur : ${String(e)}`));
      }
    }
  }

  /* ------------------------------------------------------- construction */

  private buildHub(h: HubRecord): HubView {
    const group = new THREE.Group();
    group.name = `hub-${h.id}-${h.type}`;
    group.position.set(h.x, h.y, h.z);
    group.rotation.y = rotAngle(h.rot);
    this.root.add(group);
    const view: HubView = { rec: h, group, rigs: [] };
    const l = hubLayout(h.type);
    for (const p of l.pieces) {
      const holder = new THREE.Group();
      holder.position.set(p.x, p.y ?? 0, p.z);
      if (p.ground) {
        const [wx, wz] = hubToWorld(h, p.x, p.z);
        const gy = this.ctx.heightAt(wx, wz);
        if (Number.isFinite(gy)) holder.position.y = gy - h.y + (p.y ?? 0);
      }
      holder.rotation.y = p.rotY;
      group.add(holder);
      this.pieces++;
      if (p.anim) this.addRig(view, p, holder); else this.addLod(p.asset, holder);
    }
    if (h.type !== 'aeroport') this.addSlab(group, l.hx, l.hz);
    group.updateMatrixWorld(true);
    return view;
  }

  /** Pièce statique : THREE.LOD avec les niveaux du catalogue (chargés à la demande). */
  private addLod(assetId: string, holder: THREE.Object3D): void {
    const a = this.ctx.lib.get(assetId);
    if (!a) { this.errors.push(`asset absent du catalogue : ${assetId}`); return; }
    const lod = new THREE.LOD();
    lod.name = assetId;
    holder.add(lod);
    a.lods.forEach((_l, i) => {
      const from = i === 0 ? 0 : a.lods[i - 1]!.maxDistance;
      this.loading++;
      this.ctx.lib.load(assetId, i).then((g) => { lod.addLevel(g.clone(true), from); }).catch((e: unknown) => this.errors.push(`${assetId} LOD${i} : ${String(e)}`)).finally(() => { this.loading--; });
    });
  }

  /** Pièce animée : LOD0 cloné, nœuds animables repérés par nom (pose de repos mémorisée). */
  private addRig(view: HubView, p: HubPiece, holder: THREE.Object3D): void {
    this.loading++;
    this.ctx.lib.load(p.asset, 0).then((g) => {
      const root = g.clone(true);
      holder.add(root);
      const nodes: AnimRig['nodes'] = new Map();
      root.traverse((o) => {
        if (['fleche', 'chariot', 'cables', 'palonnier', 'tourelle', 'radar', 'rampe', 'tunnel', 'tunnel_ext', 'cabine'].includes(o.name)) {
          nodes.set(o.name, { obj: o, pos: o.position.clone(), rot: o.rotation.clone(), scale: o.scale.clone() });
        }
      });
      view.rigs.push({ piece: p, root, nodes, level: 0 });
    }).catch((e: unknown) => this.errors.push(`${p.asset} : ${String(e)}`)).finally(() => { this.loading--; });
  }

  /** Terre-plein portuaire (béton) : dalle au niveau des quais avec jupe jusqu'au terrain. */
  private addSlab(group: THREE.Group, hx: number, hz: number): void {
    const w = hx * 2, d = hz * 2 - QUAY_DEPTH + 0.6;
    if (!this.slabMaterial) {
      this.slabMaterial = this.ctx.lib.load('port_quai_droit', 0).then((g) => {
        let best: THREE.MeshStandardMaterial | null = null;
        g.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
          for (const mm of Array.isArray(m) ? m : m ? [m] : []) if (!best && mm.map && /beton|sol|quai/i.test(mm.name)) best = mm;
          if (!best && m && !Array.isArray(m) && m.map) best = m;
        });
        const src = best as THREE.MeshStandardMaterial | null;
        const mat = src ? src.clone() : new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.95 });
        if (mat.map) { mat.map = mat.map.clone(); mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; mat.map.repeat.set(w / 12, d / 12); mat.map.needsUpdate = true; }
        if (mat.normalMap) { mat.normalMap = mat.normalMap.clone(); mat.normalMap.wrapS = mat.normalMap.wrapT = THREE.RepeatWrapping; mat.normalMap.repeat.set(w / 12, d / 12); mat.normalMap.needsUpdate = true; }
        mat.name = 'terre_plein_portuaire';
        return mat as THREE.Material;
      });
    }
    void this.slabMaterial.then((mat) => {
      const skirt = 10;
      const geo = new THREE.BoxGeometry(w, skirt, d);
      geo.translate(0, -skirt / 2 - 0.02, -hz + d / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'terre-plein';
      mesh.receiveShadow = true;
      group.add(mesh);
    }).catch((e: unknown) => this.errors.push(`terre-plein : ${String(e)}`));
  }

  /* ---------------------------------------------------------- animation */

  private poseCache = new Map<number, MovementPose | null>();

  frame(dt: number): void {
    const step = Math.min(0.25, Math.max(0, dt));
    this.phys += step * this.speed;
    this.time += step;
    this.poseCache.clear();
    // Mouvements.
    for (const m of this.movers.values()) {
      const h = this.hubs.find((x) => x.id === m.mv.hub);
      const pose = h ? movementPose(h.type, m.mv, this.phys) : null;
      this.poseCache.set(m.mv.id, pose);
      if (!m.obj) continue;
      if (!h || !pose) { m.obj.visible = false; if (m.tug) m.tug.visible = false; continue; }
      const [wx, wz] = hubToWorld(h, pose.x, pose.z);
      const th = rotAngle(h.rot);
      let y: number;
      if (h.type === 'aeroport') {
        const gy = this.ctx.heightAt(wx, wz);
        y = (pose.alt > 0.5 ? h.y : Number.isFinite(gy) ? gy : h.y) + pose.alt;
      } else y = Number.isFinite(h.waterY) ? h.waterY : h.y - 2.5;
      m.obj.position.set(wx, y, wz);
      m.obj.rotation.set(pose.pitch, pose.heading + th, 0, 'YXZ');
      m.obj.visible = true;
      if (m.tug) {
        if (pose.tug) {
          const [tx, tz] = hubToWorld(h, pose.tug.x, pose.tug.z);
          m.tug.position.set(tx, y, tz);
          m.tug.rotation.y = pose.tug.heading + th;
          m.tug.visible = true;
        } else m.tug.visible = false;
      }
    }
    // Pièces animées.
    for (const v of this.views.values()) for (const r of v.rigs) this.animateRig(v, r, step);
  }

  /** Vrai si un mouvement occupe le poste `slot` du pôle dans la phase donnée. */
  private slotPhase(hubId: number, slot: number): MovementPose | null {
    for (const m of this.movers.values()) {
      if (m.mv.hub !== hubId || m.mv.slot !== slot) continue;
      const p = this.poseCache.get(m.mv.id);
      if (p) return p;
    }
    return null;
  }

  private animateRig(v: HubView, r: AnimRig, dt: number): void {
    const p = r.piece;
    const n = (k: string) => r.nodes.get(k);
    const pose = p.slot !== undefined ? this.slotPhase(v.rec.id, p.slot) : null;
    const active = !!pose && (pose.phase === 'a_quai' || pose.phase === 'stationne');
    r.level += ((active ? 1 : 0) - r.level) * Math.min(1, dt * 0.8);
    const t = this.phys + p.x * 0.37;
    switch (p.anim) {
      case 'grue_portique': {
        const f = n('fleche'), c = n('chariot'), cab = n('cables'), pal = n('palonnier');
        if (f) f.obj.rotation.x = f.rot.x + (-80 * DEG) * (1 - r.level);
        // Cycle de manutention (≈ 50 s) : chariot côté navire, descente, levage, retour côté terre-plein.
        const cyc = (t % 50) / 50;
        const along = cyc < 0.5 ? cyc * 2 : 2 - cyc * 2;
        const dip = Math.max(0, Math.sin(cyc * Math.PI * 4)) ** 2;
        if (c) c.obj.position.z = c.pos.z + (-14 + 64 * along) * r.level;
        const hang = 4 + (26 * dip + 2) * r.level;
        if (pal) pal.obj.position.y = -hang;
        if (cab) cab.obj.scale.y = hang;
        break;
      }
      case 'grue_mobile': {
        const tr = n('tourelle'), f = n('fleche');
        if (tr) tr.obj.rotation.y = tr.rot.y + Math.sin(t * 0.12) * 1.2 * r.level;
        if (f) f.obj.rotation.z = f.rot.z + (10 + 18 * Math.sin(t * 0.21)) * DEG * r.level - 20 * DEG * (1 - r.level);
        break;
      }
      case 'radar': {
        const rd = n('radar');
        if (rd) rd.obj.rotation.y = this.time * 1.6;
        break;
      }
      case 'rampe': {
        const rp = n('rampe');
        if (rp) rp.obj.rotation.x = rp.rot.x + (6 * DEG) * (1 - r.level) - 8 * DEG * r.level;
        break;
      }
      case 'passerelle': {
        const tu = n('tunnel'), ext = n('tunnel_ext'), cab = n('cabine');
        if (ext) ext.obj.position.z = ext.pos.z + 9 * r.level;
        if (tu) tu.obj.rotation.y = tu.rot.y + 12 * DEG * r.level * (p.x < 0 ? 1 : -1);
        if (cab) cab.obj.rotation.y = cab.rot.y - 20 * DEG * r.level * (p.x < 0 ? 1 : -1);
        break;
      }
      default: break;
    }
  }

  /* -------------------------------------------------------------- bilan */

  stats(): HubsRenderStats {
    const poses: HubsRenderStats['poses'] = [];
    let visible = 0;
    for (const m of this.movers.values()) {
      const p = this.poseCache.get(m.mv.id);
      if (m.obj?.visible) visible++;
      if (p) poses.push({ id: m.mv.id, asset: m.mv.asset, phase: p.phase, u: +p.u.toFixed(3), alt: +p.alt.toFixed(1), x: +p.x.toFixed(1), z: +p.z.toFixed(1) });
    }
    return { hubs: this.views.size, pieces: this.pieces, loading: this.loading, errors: [...this.errors], movers: this.movers.size, visibleMovers: visible, poses };
  }

  get physTime(): number { return this.phys; }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    this.views.clear();
    this.movers.clear();
  }
}
