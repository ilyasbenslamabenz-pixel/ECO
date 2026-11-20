/**
 * Rendu du quartier, léger : tout est instancié (un appel de dessin par famille d'objets), aucune texture chargée.
 * Fenêtres calculées dans le shader à partir de la position monde (étages de 3,2 m, travées de 2,6 m) ; vitrines,
 * auvents, enseignes, parc, arbres. Repérage des bâtiments (survol, sélection) par rayon. Dépend de three.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCK, FACE_N, PITCH, SIDEWALK_W, STREET_W, blockCenter, type Building, type District } from '../sim/district';
import { assets } from '../assets';
import { disposeOwn, textPlane } from './kit';

export const FLOOR_H = 3.2;
/** Distance caméra (m) au-delà de laquelle les repères ronds des locaux libres s'affichent. */
export const PIN_MIN_DIST = 45;

/** État affiché d'un bâtiment interactif : enseigne, couleur d'auvent, anneau devant la porte, repère au loin. */
export interface BuildingState { buildingId: number; sign: string | null; color: string; ring: string | null; pin: boolean; poster: string | null }

const FACADES = [0xd9c7a8, 0xe6dccb, 0xc9a98a, 0xb98b6e, 0xd7b48c, 0xe9e2d6, 0xbfc4c8, 0xa9b4bd, 0xd2a07a, 0xcfc0ad];
const OFFICES = [0x9fb3c4, 0x8ea2b3, 0xb7c3cc, 0x7e93a6];

/** Matériau des façades : fenêtres procédurales (étages, travées), rez-de-chaussée commercial vitré. */
function facadeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh): void => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;\nattribute float aShop;\nvarying float vShop;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec4 wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vWp = wp4.xyz;
  vWn = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
  vShop = aShop;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;\nvarying float vShop;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  // Façades verticales seulement (pas les toits).
  if (abs(vWn.y) < 0.5) {
    float along = abs(vWn.x) > 0.5 ? vWp.z : vWp.x;
    float fl = vWp.y / ${FLOOR_H.toFixed(2)};
    float fy = fract(fl);
    float fx = fract(along / 2.6);
    bool ground = vWp.y < ${FLOOR_H.toFixed(2)};
    if (ground && vShop > 0.5) {
      // Vitrine du rez-de-chaussée commercial (verre sombre légèrement bleuté, montants).
      if (vWp.y > 0.25 && vWp.y < 2.6 && fx > 0.06) diffuseColor.rgb = vec3(0.16, 0.2, 0.24);
    } else if (vWp.y > 0.6) {
      float win = step(0.22, fx) * step(fx, 0.78) * step(0.3, fy) * step(fy, 0.78);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.25, 0.31), win * 0.92);
      // Bandeau d'étage discret.
      diffuseColor.rgb *= 1.0 - 0.07 * step(fy, 0.05);
    }
  }`);
  };
  return m;
}

export interface Pickable { kind: 'building'; id: number }

export class DistrictView {
  readonly group = new THREE.Group();
  private readonly buildingMesh: THREE.InstancedMesh;
  private readonly baseColors: THREE.Color[] = [];
  private readonly instanceToBuilding: number[] = [];
  private readonly buildingToInstance = new Map<number, number>();
  private readonly signs = new Map<number, { key: string; obj: THREE.Group }>();
  /** Repères des locaux libres en vue éloignée. */
  private readonly pins = new Map<number, THREE.Sprite>();
  private readonly awnings: THREE.InstancedMesh;
  private readonly awningIndex = new Map<number, number>();
  private readonly rings: THREE.InstancedMesh;
  private readonly ringIndex = new Map<number, number>();
  private ringPhase = 0;
  private hovered = -1;
  private selected = -1;

  constructor(private readonly d: District) {
    this.group.name = 'quartier';
    const halfW = d.size.w / 2 + 40, halfD = d.size.d / 2 + 40;
    // Sol (herbe sombre au-delà du quartier) et chaussée (tout le quadrillage), puis îlots surélevés (trottoirs).
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 6, halfD * 6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f8f5a, roughness: 1 }));
    ground.position.y = -0.05; ground.receiveShadow = true; this.group.add(ground);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(d.size.w + STREET_W, d.size.d + STREET_W).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.95 }));
    road.receiveShadow = true; this.group.add(road);
    const blocks: THREE.Matrix4[] = [], parks: THREE.Matrix4[] = [];
    for (let i = 0; i < d.nx; i++) for (let j = 0; j < d.nz; j++) {
      const c = blockCenter(d, i, j);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0.08, c.z), new THREE.Quaternion(), new THREE.Vector3(BLOCK + 2 * SIDEWALK_W, 0.16, BLOCK + 2 * SIDEWALK_W));
      blocks.push(m);
      if (i === d.parkBlock.i && j === d.parkBlock.j) parks.push(new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0.17, c.z), new THREE.Quaternion(), new THREE.Vector3(BLOCK, 0.02, BLOCK)));
    }
    this.group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.9 }), blocks, 'trottoirs', false, true));
    this.group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x7fae5e, roughness: 1 }), parks, 'parc', false, true));
    this.group.add(this.markings());

    // Immeubles : boîte par bâtiment (hauteur = étages), toit en saillie, auvents des commerces.
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const shopAttr = new Float32Array(d.buildings.length);
    const mats: THREE.Matrix4[] = [];
    const roofs: THREE.Matrix4[] = [];
    d.buildings.forEach((b, k) => {
      const h = b.floors * FLOOR_H;
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0.16, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, h, b.d)));
      roofs.push(new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0.16 + h, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w + 0.3, 0.45, b.d + 0.3)));
      shopAttr[k] = b.premise || b.service ? 1 : 0;
      const pal = b.kind === 'bureaux' ? OFFICES : FACADES;
      this.baseColors.push(new THREE.Color(pal[Math.floor(b.tint * pal.length) % pal.length]!));
      this.instanceToBuilding.push(b.id);
      this.buildingToInstance.set(b.id, k);
    });
    geo.setAttribute('aShop', new THREE.InstancedBufferAttribute(shopAttr, 1));
    this.buildingMesh = instanced(geo, facadeMaterial(), mats, 'immeubles', true, true);
    this.baseColors.forEach((c, k) => this.buildingMesh.setColorAt(k, c));
    // Modèles du City Kit chargés : bâtiments instanciés par modèle ; sinon boîtes à fenêtres procédurales.
    const kit = this.kitBuildings();
    if (kit) this.group.add(kit);
    else {
      this.group.add(this.buildingMesh);
      this.group.add(instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x5d5b58, roughness: 0.9 }), roofs, 'toits', true, true));
    }

    // Auvents des commerces (couleur : type du commerce ; gris : local libre).
    const shops = d.buildings.filter((b) => b.premise || b.service);
    this.awnings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), shops.length);
    this.awnings.name = 'auvents';
    this.awnings.castShadow = true;
    shops.forEach((b, k) => {
      const n = FACE_N[b.face]!;
      const front = b.face % 2 === 0 ? b.w : b.d, depth = b.face % 2 === 0 ? b.d : b.w;
      const pos = new THREE.Vector3(b.x + n[0] * (depth / 2 + 0.7), 0.16 + 2.9, b.z + n[1] * (depth / 2 + 0.7));
      const size = b.face % 2 === 0 ? new THREE.Vector3(front * 0.9, 0.18, 1.4) : new THREE.Vector3(1.4, 0.18, front * 0.9);
      this.awnings.setMatrixAt(k, new THREE.Matrix4().compose(pos, new THREE.Quaternion(), size));
      this.awningIndex.set(b.id, k);
      this.awnings.setColorAt(k, new THREE.Color(0x8a8f96));
    });
    this.group.add(this.awnings);
    // Portes (cadre sombre sur la façade) et anneaux lumineux sur le trottoir des bâtiments où l'on peut entrer.
    const doors = d.buildings.filter((b) => b.premise || b.service || b.home);
    const frames: THREE.Matrix4[] = [], glass: THREE.Matrix4[] = [];
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.75, 1.0, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), doors.length);
    this.rings.name = 'anneaux';
    doors.forEach((b, k) => {
      const n = FACE_N[b.face]!, depth = b.face % 2 === 0 ? b.d : b.w;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(n[0], n[1]));
      const at = (out: number): THREE.Vector3 => new THREE.Vector3(b.x + n[0] * (depth / 2 + out), 0.16, b.z + n[1] * (depth / 2 + out));
      frames.push(new THREE.Matrix4().compose(at(0.02), q, new THREE.Vector3(1, 1, 1)));
      glass.push(new THREE.Matrix4().compose(at(0.0), q, new THREE.Vector3(1, 1, 1)));
      this.rings.setMatrixAt(k, new THREE.Matrix4().makeTranslation(b.doorX, 0.19, b.doorZ));
      this.rings.setColorAt(k, new THREE.Color(0xffffff));
      this.ringIndex.set(b.id, k);
    });
    // Vraie porte : chambranle, seuil, deux battants vitrés à montants, poignées ; derrière, un intérieur éclairé.
    const fg = mergeGeometries([
      new THREE.BoxGeometry(0.14, 2.5, 0.16).translate(-0.98, 1.25, 0.04), new THREE.BoxGeometry(0.14, 2.5, 0.16).translate(0.98, 1.25, 0.04),
      new THREE.BoxGeometry(2.1, 0.18, 0.16).translate(0, 2.45, 0.04), new THREE.BoxGeometry(2.1, 0.05, 0.3).translate(0, 0.025, 0.1),
      new THREE.BoxGeometry(0.06, 2.3, 0.08).translate(0, 1.18, 0.06), new THREE.BoxGeometry(1.86, 0.08, 0.08).translate(0, 0.12, 0.06),
      new THREE.BoxGeometry(1.86, 0.06, 0.08).translate(0, 2.32, 0.06),
      new THREE.BoxGeometry(0.04, 0.32, 0.06).translate(-0.12, 1.1, 0.12), new THREE.BoxGeometry(0.04, 0.32, 0.06).translate(0.12, 1.1, 0.12),
    ].map((g) => g.toNonIndexed()))!;
    this.group.add(instanced(fg, new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.35, metalness: 0.6 }), frames, 'portes', true, true));
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, emissive: 0xffd9a0, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.2 });
    this.group.add(instanced(new THREE.PlaneGeometry(1.84, 2.2).translate(0, 1.22, 0.02), glassMat, glass, 'portes-vitrees', false, false));
    this.group.add(this.rings);
    this.group.add(this.trees());
  }

  /**
   * Bâtiments du City Kit (Kenney) : pour chaque immeuble, le modèle dont les proportions (hauteur / largeur)
   * collent le mieux, avec une préférence selon l'usage et le loyer (tours pour les bureaux hauts, façades plus
   * riches pour les locaux chers). Un InstancedMesh par modèle, étiré à l'emprise et à la hauteur de l'immeuble,
   * façade tournée vers la rue. Null si aucun modèle n'est chargé.
   */
  private kitBuildings(): THREE.Group | null {
    const low = ['bat.a', 'bat.d', 'bat.h', 'bat.f', 'bat.l'].filter((k) => assets.has(k));
    const towers = ['bat.tour-a', 'bat.tour-b'].filter((k) => assets.has(k));
    if (!low.length) return null;
    const aspect = new Map([...low, ...towers].map((k) => [k, assets.aspect(k)]));
    const maxRent = Math.max(1, ...this.d.premises.map((p) => p.rent / p.area));
    const per = new Map<string, THREE.Matrix4[]>();
    for (const b of this.d.buildings) {
      const n = FACE_N[b.face]!;
      const front = b.face % 2 === 0 ? b.w : b.d, depth = b.face % 2 === 0 ? b.d : b.w, h = b.floors * FLOOR_H;
      const target = h / ((front + depth) / 2);
      const pool = b.kind === 'bureaux' && b.floors >= 6 && towers.length ? towers : low;
      // Loyer élevé : modèles plus riches (fin de liste).
      const lux = b.premise ? (b.premise.rent / b.premise.area) / maxRent : b.kind === 'bureaux' ? 0.7 : 0.3;
      let best = pool[0]!, bs = Infinity;
      pool.forEach((k, i) => {
        const sc = Math.abs(Math.log(aspect.get(k)! / target)) + Math.abs(i / Math.max(1, pool.length - 1) - lux) * 0.5 + ((b.tint * 7.3 + i * 0.37) % 1) * 0.35;
        if (sc < bs) { bs = sc; best = k; }
      });
      const m = new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0.16, b.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(n[0], n[1])), new THREE.Vector3(front, h, depth));
      if (!per.has(best)) per.set(best, []);
      per.get(best)!.push(m);
    }
    const g = new THREE.Group();
    g.name = 'immeubles-kit';
    for (const [k, ms] of per) {
      const mg = assets.merged(k);
      if (!mg) return null;
      g.add(instanced(mg.geo, mg.mat as THREE.Material, ms, `immeuble ${k}`, true, true));
    }
    return g;
  }

  /** Lignes blanches discontinues au milieu des rues. */
  private markings(): THREE.InstancedMesh {
    const d = this.d, out: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    for (let i = 0; i <= d.nx; i++) {
      const x = (i - d.nx / 2) * PITCH;
      for (let z = -d.size.d / 2; z < d.size.d / 2; z += 6) out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.02, z + 1.5), q, new THREE.Vector3(0.18, 0.01, 3)));
    }
    for (let j = 0; j <= d.nz; j++) {
      const z = (j - d.nz / 2) * PITCH;
      for (let x = -d.size.w / 2; x < d.size.w / 2; x += 6) out.push(new THREE.Matrix4().compose(new THREE.Vector3(x + 1.5, 0.02, z), q, new THREE.Vector3(3, 0.01, 0.18)));
    }
    return instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xd8d8d0 }), out, 'marquage', false, false);
  }

  /** Arbres : parc dense, alignements le long des trottoirs. */
  private trees(): THREE.Group {
    const d = this.d, g = new THREE.Group();
    const pts: [number, number][] = [];
    const pc = blockCenter(d, d.parkBlock.i, d.parkBlock.j);
    let seed = d.seed * 9301 + 49297;
    const rnd = (): number => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let k = 0; k < 40; k++) pts.push([pc.x + (rnd() - 0.5) * (BLOCK - 8), pc.z + (rnd() - 0.5) * (BLOCK - 8)]);
    for (let i = 0; i <= d.nx; i++) {
      const x = (i - d.nx / 2) * PITCH;
      for (let z = -d.size.d / 2 + 10; z < d.size.d / 2; z += 18) { pts.push([x - STREET_W / 2 + 1.2, z]); pts.push([x + STREET_W / 2 - 1.2, z + 9]); }
    }
    const trunks: THREE.Matrix4[] = [], crowns: THREE.Matrix4[] = [];
    // Aucun arbre devant une porte (bâtiments où l'on peut entrer).
    const doors = d.buildings.filter((b) => b.premise || b.service || b.home).map((b) => [b.doorX, b.doorZ] as const);
    for (const [x, z] of pts) {
      if (doors.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < 5.5)) continue;
      const s = 0.8 + rnd() * 0.5;
      trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.16, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
      crowns.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.16 + 3.2 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 1.1, s)));
    }
    g.add(instanced(new THREE.CylinderGeometry(0.18, 0.25, 2.4, 6).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0x6b4f3a }), trunks, 'troncs', true, false));
    g.add(instanced(new THREE.IcosahedronGeometry(1.7, 1), new THREE.MeshStandardMaterial({ color: 0x4f8a45, roughness: 0.9, flatShading: true }), crowns, 'feuillages', true, false));
    return g;
  }

  /** Enseignes, auvents, anneaux et repères selon l'état des bâtiments interactifs. */
  setStates(states: BuildingState[]): void {
    const c = new THREE.Color();
    for (const st of states) {
      const b = this.d.buildings.find((x) => x.id === st.buildingId)!;
      const n = FACE_N[b.face]!, depth = b.face % 2 === 0 ? b.d : b.w, front = b.face % 2 === 0 ? b.w : b.d;
      const ak = this.awningIndex.get(b.id);
      if (ak !== undefined) this.awnings.setColorAt(ak, c.set(st.color));
      const rk = this.ringIndex.get(b.id);
      if (rk !== undefined) {
        this.rings.setColorAt(rk, c.set(st.ring ?? '#000000'));
        const m = new THREE.Matrix4().makeTranslation(b.doorX, st.ring ? 0.19 : -5, b.doorZ);
        this.rings.setMatrixAt(rk, m);
      }
      // Enseigne au-dessus de l'auvent, affiche dans la vitrine.
      const key = `${st.sign}|${st.color}|${st.poster}`;
      const cur = this.signs.get(b.id);
      if (!cur || cur.key !== key) {
        if (cur) { this.group.remove(cur.obj); disposeOwn(cur.obj); }
        const g = new THREE.Group();
        g.position.set(b.x + n[0] * (depth / 2 + 0.08), 0.16, b.z + n[1] * (depth / 2 + 0.08));
        g.rotation.y = Math.atan2(n[0], n[1]);
        if (st.sign) { const p = textPlane(st.sign, 0.75, st.color, '#ffffff', front * 0.85); p.position.y = 3.65; g.add(p); }
        if (st.poster) { const p = textPlane(st.poster, 0.42, '#ffd166', '#2d3440', 2.6); p.position.set(front * 0.22, 1.55, 0.02); g.add(p); }
        this.group.add(g);
        this.signs.set(b.id, { key, obj: g });
      }
      let pin = this.pins.get(b.id);
      if (st.pin && !pin) {
        pin = new THREE.Sprite(pinMaterial());
        pin.scale.set(0.014, 0.014, 1);
        pin.renderOrder = 9;
        pin.position.set(b.x + n[0] * (depth / 2 + 1), b.floors * FLOOR_H + 4, b.z + n[1] * (depth / 2 + 1));
        this.pins.set(b.id, pin);
        this.group.add(pin);
      } else if (!st.pin && pin) { this.group.remove(pin); this.pins.delete(b.id); }
    }
    if (this.awnings.instanceColor) this.awnings.instanceColor.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
  }

  /** Repères des locaux libres seulement au loin ; anneaux qui pulsent. */
  updateLabels(camera: THREE.Camera, dt: number): void {
    for (const pin of this.pins.values()) pin.visible = camera.position.distanceTo(pin.position) > PIN_MIN_DIST;
    this.ringPhase += dt;
    (this.rings.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(this.ringPhase * 3);
  }

  /** Bâtiment sous un rayon (null : aucun). */
  pick(ray: THREE.Raycaster): Building | null {
    const hit = ray.intersectObject(this.buildingMesh, false)[0];
    if (!hit || hit.instanceId === undefined) return null;
    const id = this.instanceToBuilding[hit.instanceId]!;
    return this.d.buildings.find((b) => b.id === id) ?? null;
  }

  setHover(buildingId: number | null): void { this.hovered = buildingId === null ? -1 : this.buildingToInstance.get(buildingId) ?? -1; this.refreshTint(); }
  setSelected(buildingId: number | null): void { this.selected = buildingId === null ? -1 : this.buildingToInstance.get(buildingId) ?? -1; this.refreshTint(); }

  private lastTinted: number[] = [];
  private refreshTint(): void {
    const c = new THREE.Color();
    for (const k of this.lastTinted) this.buildingMesh.setColorAt(k, this.baseColors[k]!);
    this.lastTinted = [];
    if (this.hovered >= 0) { this.buildingMesh.setColorAt(this.hovered, c.copy(this.baseColors[this.hovered]!).lerp(new THREE.Color(0xffe08a), 0.35)); this.lastTinted.push(this.hovered); }
    if (this.selected >= 0) { this.buildingMesh.setColorAt(this.selected, c.copy(this.baseColors[this.selected]!).lerp(new THREE.Color(0x5fc3ff), 0.45)); this.lastTinted.push(this.selected); }
    if (this.buildingMesh.instanceColor) this.buildingMesh.instanceColor.needsUpdate = true;
  }
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[], name: string, cast: boolean, receive: boolean): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, ms.length));
  ms.forEach((x, k) => m.setMatrixAt(k, x));
  m.count = ms.length;
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.computeBoundingSphere();
  return m;
}

/** Repère rond (local à louer, vue éloignée) : matériau partagé. */
let pinMat: THREE.SpriteMaterial | null = null;
function pinMaterial(): THREE.SpriteMaterial {
  if (pinMat) return pinMat;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 48;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(24, 24, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2d3440'; g.beginPath(); g.arc(24, 24, 17, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffd166'; g.beginPath(); g.arc(24, 24, 7, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  pinMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false });
  return pinMat;
}

