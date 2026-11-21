/**
 * Véhicules : modèles du joueur (scooter, camionnette) et circulation d'ambiance (voitures instanciées qui suivent
 * les voies des rues et s'arrêtent devant le personnage). Avant des modèles vers −z (cap 0). Dépend de three.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VEHICLE_BY_ID, type VehicleType } from '../sim/catalog';
import { PITCH, type District } from '../sim/district';
import type { Vehicle } from '../sim/game';
import { assets } from '../assets';
import { box, cyl, mat } from './kit';

export function buildVehicle(type: VehicleType): THREE.Group {
  // Modèles du Car Kit à l'échelle (largeur réelle), avant vers −z ; sinon modèle fait en code.
  const kit: Partial<Record<VehicleType, [string, number]>> = { citadine: ['auto.citadine', 1.8], sportive: ['auto.sport', 1.9], suv: ['auto.suv-luxe', 2.0], camionnette: ['auto.camionnette', 2.1], camion: ['auto.camion', 2.4] };
  const km = kit[type];
  if (km) {
    const sz = assets.size(km[0]);
    if (sz) { const k = km[1] / sz.x; const o = assets.fitted(km[0], sz.x * k, sz.y * k, sz.z * k); if (o) { const g = new THREE.Group(); g.add(o); return g; } }
  }
  const g = new THREE.Group();
  const paint = mat(VEHICLE_BY_ID.get(type)!.color, { rough: 0.35, metal: 0.2 });
  const dark = mat('#1d2126', { rough: 0.6 }), glass = mat('#2a3a4a', { rough: 0.1, metal: 0.4 }), tire = mat('#151515', { rough: 0.9 });
  const wheel = (x: number, z: number, dia: number, wdt: number): void => { const w = cyl(g, dia, wdt, x, dia / 2, z, tire); w.rotation.z = Math.PI / 2; w.position.y = dia / 2; };
  if (type !== 'scooter') {
    box(g, 2.0, 1.95, 3.4, 0, 0.45, 0.65, paint);
    box(g, 2.0, 1.25, 1.5, 0, 0.45, -1.7, paint);
    box(g, 1.9, 0.6, 0.05, 0, 1.1, -2.46, glass);
    box(g, 2.02, 0.5, 1.2, 0, 1.15, -1.6, glass);
    box(g, 2.04, 0.25, 4.95, 0, 0.35, -0.1, dark);
    box(g, 0.25, 0.12, 0.05, -0.75, 0.75, -2.47, mat('#fff6d0', { emissive: 0.6 }), false);
    box(g, 0.25, 0.12, 0.05, 0.75, 0.75, -2.47, mat('#fff6d0', { emissive: 0.6 }), false);
    box(g, 1.8, 0.4, 0.04, 0, 1.4, 2.36, mat('#2a7fd4'));
    for (const [x, z] of [[-0.95, -1.6], [0.95, -1.6], [-0.95, 1.5], [0.95, 1.5]] as const) wheel(x, z, 0.72, 0.28);
  } else {
    box(g, 0.5, 0.35, 1.3, 0, 0.35, 0, paint);
    box(g, 0.45, 0.5, 0.35, 0, 0.55, -0.55, paint);
    box(g, 0.6, 0.12, 0.25, 0, 1.05, -0.6, dark);
    box(g, 0.55, 0.45, 0.5, 0, 0.75, 0.45, mat('#c8c2b0'));
    box(g, 0.32, 0.1, 0.55, 0, 0.72, -0.05, dark);
    wheel(0, -0.62, 0.5, 0.14);
    wheel(0, 0.6, 0.5, 0.14);
  }
  return g;
}

/** Véhicules du joueur, synchronisés avec la partie. */
export class PlayerVehicles {
  readonly group = new THREE.Group();
  private readonly objs = new Map<number, THREE.Group>();

  sync(list: readonly Vehicle[], drivingPose?: { id: number; x: number; z: number; heading: number }): void {
    const ids = new Set(list.map((v) => v.id));
    for (const [id, o] of this.objs) if (!ids.has(id)) { this.group.remove(o); this.objs.delete(id); }
    for (const v of list) {
      let o = this.objs.get(v.id);
      if (!o) { o = buildVehicle(v.type); this.objs.set(v.id, o); this.group.add(o); }
      const p = drivingPose && drivingPose.id === v.id ? drivingPose : v;
      o.position.set(p.x, 0.16, p.z);
      o.rotation.y = p.heading;
    }
  }
}

interface Car { axis: 'x' | 'z'; line: number; dir: 1 | -1; s: number; v: number; color: THREE.Color; variant: number; slot: number }

/** Modèles de la circulation (fréquence = répétitions) ; largeur réelle de chacun (m). */
const CAR_KEYS = ['auto.berline', 'auto.taxi', 'auto.suv', 'auto.citadine', 'auto.livraison', 'auto.berline', 'auto.sport', 'auto.suv-luxe',
  'auto.camionnette', 'auto.taxi', 'auto.police', 'auto.camion', 'auto.citadine', 'auto.ambulance', 'auto.poubelles', 'auto.livraison-plateau',
  'auto.berline', 'auto.camion-vert', 'auto.plateau', 'auto.pompiers', 'auto.suv', 'auto.camion-gris', 'auto.taxi',
  'f:car-tractor', 'auto.sedan', 'f:car-tractor-police', 'auto.citadine', 'f:car-tractor-shovel', 'auto.suv-luxe'].filter((k) => k !== 'auto.sedan');
const CAR_WIDTH: Record<string, number> = { 'auto.camion': 2.4, 'auto.pompiers': 2.5, 'auto.poubelles': 2.5, 'auto.plateau': 2.4, 'auto.camion-vert': 2.4,
  'auto.camion-gris': 2.4, 'auto.ambulance': 2.2, 'auto.livraison-plateau': 2.1, 'auto.citadine': 1.8 };

/** Circulation d'ambiance : voitures sur les voies de droite, en boucle d'un bout à l'autre du quartier. */
export class Traffic {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly top: THREE.InstancedMesh;
  /** Modèles du Car Kit : un InstancedMesh par modèle, et l'échelle de chacun (largeur 1,9 m). */
  private readonly kit: { mesh: THREE.InstancedMesh; scale: THREE.Vector3 }[] = [];
  private readonly cars: Car[] = [];
  private readonly half: { w: number; d: number };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(d: District, n = 46) {
    this.half = { w: d.size.w / 2 + 25, d: d.size.d / 2 + 25 };
    const b1 = new THREE.BoxGeometry(1.8, 0.7, 4.2).translate(0, 0.55, 0);
    const b2 = new THREE.BoxGeometry(1.6, 0.55, 2.2).translate(0, 1.15, 0.2);
    const wheels = [[-0.85, -1.3], [0.85, -1.3], [-0.85, 1.3], [0.85, 1.3]].map(([x, z]) => new THREE.CylinderGeometry(0.33, 0.33, 0.22, 10).rotateZ(Math.PI / 2).translate(x!, 0.33, z!));
    this.body = new THREE.InstancedMesh(b1, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.25 }), n);
    this.top = new THREE.InstancedMesh(mergeGeometries([b2, ...wheels])!, new THREE.MeshStandardMaterial({ color: 0x1e2731, roughness: 0.25, metalness: 0.3 }), n);
    for (const m of [this.body, this.top]) { m.castShadow = true; m.frustumCulled = false; this.group.add(m); }
    const palette = [0xd8d8d8, 0x222222, 0x8a1f24, 0x2a4f8a, 0x9aa3ad, 0xe0c040, 0x3f6f4a, 0xf2f2f2, 0x5a3a2a];
    let seed = d.seed * 31 + 7;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < n; k++) {
      const axis = rnd() < 0.5 ? 'x' : 'z';
      const count = axis === 'x' ? d.nz : d.nx;
      const idx = Math.floor(rnd() * (count + 1));
      const line = (idx - count / 2) * PITCH;
      const len = axis === 'x' ? this.half.w : this.half.d;
      this.cars.push({ axis, line, dir: rnd() < 0.5 ? 1 : -1, s: (rnd() * 2 - 1) * len, v: 8 + rnd() * 4, color: new THREE.Color(palette[Math.floor(rnd() * palette.length)]!), variant: k % CAR_KEYS.length, slot: 0 });
      this.body.setColorAt(k, this.cars[k]!.color);
    }
    // Voitures du Car Kit si chargées (variées), sinon voitures faites en code.
    const keys = [...new Set(CAR_KEYS)].filter((k) => assets.has(k));
    if (keys.length) {
      for (const key of keys) {
        const mg = assets.merged(key)!, sz = assets.size(key)!;
        const k = (CAR_WIDTH[key] ?? 1.9) / sz.x;
        const count = this.cars.filter((c) => keys[c.variant % keys.length] === key).length;
        const mesh = new THREE.InstancedMesh(mg.geo, mg.mat as THREE.Material, Math.max(1, count));
        // Découpé hors champ : sphère englobante recalculée à chaque image (quelques voitures par modèle).
        mesh.castShadow = true; mesh.name = `voitures ${key}`;
        this.kit.push({ mesh, scale: new THREE.Vector3(sz.x * k, sz.y * k, sz.z * k) });
        this.group.add(mesh);
      }
      const used = new Array<number>(keys.length).fill(0);
      for (const c of this.cars) { c.variant %= keys.length; c.slot = used[c.variant]!++; }
      this.body.visible = this.top.visible = false;
    }
  }

  /** Position monde d'une voiture (voie de droite, à 2,6 m de l'axe). */
  private pos(c: Car): [number, number] {
    const off = 2.6 * c.dir;
    return c.axis === 'x' ? [c.s, c.line + off] : [c.line - off, c.s];
  }

  update(dt: number, obstacles: [number, number][]): void {
    this.cars.forEach((c, k) => {
      const [x, z] = this.pos(c);
      const fx = c.axis === 'x' ? c.dir : 0, fz = c.axis === 'z' ? c.dir : 0;
      // S'arrête si un obstacle (personnage, véhicule du joueur) est juste devant.
      let blocked = false;
      for (const [ox, oz] of obstacles) {
        const ahead = (ox - x) * fx + (oz - z) * fz, side = Math.abs((ox - x) * fz - (oz - z) * fx);
        if (ahead > 0 && ahead < 7 && side < 1.8) { blocked = true; break; }
      }
      if (!blocked) c.s += c.v * c.dir * dt;
      const len = c.axis === 'x' ? this.half.w : this.half.d;
      if (c.s > len) c.s = -len; else if (c.s < -len) c.s = len;
      const [nx, nz] = this.pos(c);
      this.q.setFromAxisAngle(this.up, Math.atan2(-fx, -fz));
      if (this.kit.length) {
        const kv = this.kit[c.variant]!;
        this.m.compose(new THREE.Vector3(nx, 0.0, nz), this.q, kv.scale);
        kv.mesh.setMatrixAt(c.slot, this.m);
        return;
      }
      this.m.compose(new THREE.Vector3(nx, 0.0, nz), this.q, new THREE.Vector3(1, 1, 1));
      this.body.setMatrixAt(k, this.m);
      this.top.setMatrixAt(k, this.m);
    });
    for (const kv of this.kit) { kv.mesh.instanceMatrix.needsUpdate = true; kv.mesh.computeBoundingSphere(); }
    this.body.instanceMatrix.needsUpdate = true;
    this.top.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}
