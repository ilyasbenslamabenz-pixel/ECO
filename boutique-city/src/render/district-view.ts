/**
 * Rendu du quartier, léger : tout est instancié (un appel de dessin par famille d'objets), aucune texture chargée.
 * Fenêtres calculées dans le shader à partir de la position monde (étages de 3,2 m, travées de 2,6 m) ; vitrines,
 * auvents, enseignes, parc, arbres. Repérage des bâtiments (survol, sélection) par rayon. Dépend de three.
 */
import * as THREE from 'three';
import { SHOP_TYPE_BY_ID, type ShopType } from '../sim/catalog';
import { BLOCK, FACE_N, PITCH, SIDEWALK_W, STREET_W, blockCenter, type Building, type District } from '../sim/district';

export const FLOOR_H = 3.2;
/** Distance caméra (m) en deçà de laquelle les étiquettes « À louer » s'affichent. */
export const FREE_LABEL_DIST = 260;

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
  private readonly signs = new Map<number, THREE.Sprite>();
  /** Repères des locaux libres en vue éloignée. */
  private readonly pins = new Map<number, THREE.Sprite>();
  private readonly awnings: THREE.InstancedMesh;
  private readonly awningIndex = new Map<number, number>();
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
      shopAttr[k] = b.premise ? 1 : 0;
      const pal = b.kind === 'bureaux' ? OFFICES : FACADES;
      this.baseColors.push(new THREE.Color(pal[Math.floor(b.tint * pal.length) % pal.length]!));
      this.instanceToBuilding.push(b.id);
      this.buildingToInstance.set(b.id, k);
    });
    geo.setAttribute('aShop', new THREE.InstancedBufferAttribute(shopAttr, 1));
    this.buildingMesh = instanced(geo, facadeMaterial(), mats, 'immeubles', true, true);
    this.baseColors.forEach((c, k) => this.buildingMesh.setColorAt(k, c));
    this.group.add(this.buildingMesh);
    this.group.add(instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x5d5b58, roughness: 0.9 }), roofs, 'toits', true, true));

    // Auvents des commerces (couleur : type du commerce ; gris : local libre).
    const shops = d.buildings.filter((b) => b.premise);
    this.awnings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), shops.length);
    this.awnings.name = 'auvents';
    this.awnings.castShadow = true;
    shops.forEach((b, k) => {
      const n = FACE_N[b.face]!;
      const front = b.face % 2 === 0 ? b.w : b.d, depth = b.face % 2 === 0 ? b.d : b.w;
      const pos = new THREE.Vector3(b.x + n[0] * (depth / 2 + 0.7), 0.16 + 2.9, b.z + n[1] * (depth / 2 + 0.7));
      const size = b.face % 2 === 0 ? new THREE.Vector3(front * 0.9, 0.18, 1.4) : new THREE.Vector3(1.4, 0.18, front * 0.9);
      this.awnings.setMatrixAt(k, new THREE.Matrix4().compose(pos, new THREE.Quaternion(), size));
      this.awningIndex.set(b.premise!.id, k);
      this.awnings.setColorAt(k, new THREE.Color(0x8a8f96));
    });
    this.group.add(this.awnings);
    this.group.add(this.trees());
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
    for (const [x, z] of pts) {
      const s = 0.8 + rnd() * 0.5;
      trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.16, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
      crowns.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.16 + 3.2 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 1.1, s)));
    }
    g.add(instanced(new THREE.CylinderGeometry(0.18, 0.25, 2.4, 6).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0x6b4f3a }), trunks, 'troncs', true, false));
    g.add(instanced(new THREE.IcosahedronGeometry(1.7, 1), new THREE.MeshStandardMaterial({ color: 0x4f8a45, roughness: 0.9, flatShading: true }), crowns, 'feuillages', true, false));
    return g;
  }

  /**
   * État des locaux : auvent coloré (commerce du joueur : couleur vive du type ; concurrent : couleur atténuée ; libre :
   * gris) et étiquette au-dessus des locaux libres et des commerces du joueur.
   */
  setPremises(states: { premiseId: number; buildingId: number; kind: 'libre' | 'joueur' | 'concurrent'; type: ShopType | null; label: string }[]): void {
    const c = new THREE.Color();
    for (const s of states) {
      const k = this.awningIndex.get(s.premiseId);
      if (k !== undefined) {
        if (s.kind === 'libre') c.set(0x9aa0a6);
        else c.set(SHOP_TYPE_BY_ID.get(s.type!)!.color);
        if (s.kind === 'concurrent') c.lerp(new THREE.Color(0x777777), 0.45);
        this.awnings.setColorAt(k, c);
      }
      const want = s.kind !== 'concurrent';
      let pin = this.pins.get(s.premiseId);
      if (s.kind === 'libre' && !pin) {
        pin = new THREE.Sprite(pinMaterial());
        pin.scale.set(0.014, 0.014, 1);
        pin.renderOrder = 9;
        const bb = this.d.buildings.find((x) => x.id === s.buildingId)!;
        const nn = FACE_N[bb.face]!, dd = bb.face % 2 === 0 ? bb.d : bb.w;
        pin.position.set(bb.x + nn[0] * (dd / 2 + 1), bb.floors * FLOOR_H + 4, bb.z + nn[1] * (dd / 2 + 1));
        this.pins.set(s.premiseId, pin);
        this.group.add(pin);
      } else if (s.kind !== 'libre' && pin) { this.group.remove(pin); this.pins.delete(s.premiseId); }
      let sp = this.signs.get(s.premiseId);
      if (!want) { if (sp) { this.group.remove(sp); sp.material.map?.dispose(); sp.material.dispose(); this.signs.delete(s.premiseId); } continue; }
      const key = `${s.kind}|${s.label}`;
      if (sp && sp.userData['key'] === key) continue;
      if (sp) { this.group.remove(sp); sp.material.map?.dispose(); sp.material.dispose(); }
      sp = labelSprite(s.label, s.kind === 'joueur' ? SHOP_TYPE_BY_ID.get(s.type!)!.color : '#2d3440', s.kind === 'joueur');
      sp.userData['key'] = key;
      sp.userData['free'] = s.kind === 'libre';
      const b = this.d.buildings.find((x) => x.id === s.buildingId)!;
      const n = FACE_N[b.face]!, depth = b.face % 2 === 0 ? b.d : b.w;
      sp.position.set(b.x + n[0] * (depth / 2 + 1), b.floors * FLOOR_H + 5, b.z + n[1] * (depth / 2 + 1));
      this.signs.set(s.premiseId, sp);
      this.group.add(sp);
    }
    if (this.awnings.instanceColor) this.awnings.instanceColor.needsUpdate = true;
  }

  /**
   * Étiquettes « À louer » seulement à l'approche (moins de FREE_LABEL_DIST mètres de la caméra) : en vue d'ensemble,
   * elles recouvraient tout le quartier. Les enseignes du joueur restent toujours visibles.
   */
  updateLabels(camera: THREE.Camera): void {
    for (const [id, sp] of this.signs) {
      if (!sp.userData['free']) continue;
      const near = camera.position.distanceTo(sp.position) < FREE_LABEL_DIST;
      sp.visible = near;
      const pin = this.pins.get(id);
      if (pin) pin.visible = !near;
    }
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

/** Étiquette (canevas → sprite), taille constante à l'écran. */
function labelSprite(text: string, bg: string, strong: boolean): THREE.Sprite {
  const pad = 14, font = `${strong ? 700 : 600} 30px system-ui, sans-serif`;
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d')!;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  cv.width = w; cv.height = 52;
  g.font = font;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(0, 0, w, 52, 14); g.fill();
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.fillText(text, pad, 27);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  sp.renderOrder = 10;
  const h = 0.034;
  sp.scale.set((h * w) / 52, h, 1);
  return sp;
}
