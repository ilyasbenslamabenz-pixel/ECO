/**
 * Rendu du quartier, léger : tout est instancié (un appel de dessin par famille d'objets), aucune texture chargée.
 * Fenêtres calculées dans le shader à partir de la position monde (étages de 3,2 m, travées de 2,6 m) ; vitrines,
 * auvents, enseignes, parc, arbres. Repérage des bâtiments (survol, sélection) par rayon. Dépend de three.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCK, FACE_N, PITCH, SIDEWALK_W, STREET_W, blockCenter, type Building, type District } from '../sim/district';
import { assets, filesMatching, keysWith } from '../assets';
import { parkZones } from './life';
import type { Rect } from '../world/collide';
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
    this.doorGlass.push(glassMat);
    this.group.add(instanced(new THREE.PlaneGeometry(1.84, 2.2).translate(0, 1.22, 0.02), glassMat, glass, 'portes-vitrees', false, false));
    this.group.add(this.rings);
    this.group.add(this.trees());
    this.group.add(this.streetLights());
    this.group.add(this.streetProps());
    this.group.add(this.parkedCars());
    this.group.add(this.outskirts());
  }

  /**
   * Bâtiments du City Kit (Kenney) : pour chaque immeuble, le modèle dont les proportions (hauteur / largeur)
   * collent le mieux, avec une préférence selon l'usage et le loyer (tours pour les bureaux hauts, façades plus
   * riches pour les locaux chers). Un InstancedMesh par modèle, étiré à l'emprise et à la hauteur de l'immeuble,
   * façade tournée vers la rue. Null si aucun modèle n'est chargé.
   */
  private kitBuildings(): THREE.Group | null {
    const low = keysWith('bat.').filter((k) => !k.startsWith('bat.tour') && assets.has(k));
    const towers = filesMatching(/^building-skyscraper-/).filter((k) => assets.has(k));
    const houses = filesMatching(/^house-/).filter((k) => assets.has(k));
    // Entrepôts (City Kit Industrial) pour le grossiste et le garage.
    const depots = filesMatching(/^ind-building-/).filter((k) => assets.has(k));
    if (!low.length) return null;
    const aspect = new Map([...low, ...towers, ...houses, ...depots].map((k) => [k, assets.aspect(k)]));
    const maxRent = Math.max(1, ...this.d.premises.map((p) => p.rent / p.area));
    const per = new Map<string, THREE.Matrix4[]>();
    for (const b of this.d.buildings) {
      const n = FACE_N[b.face]!;
      const front = b.face % 2 === 0 ? b.w : b.d, depth = b.face % 2 === 0 ? b.d : b.w, h = b.floors * FLOOR_H;
      const target = h / ((front + depth) / 2);
      const pool = (b.service === 'grossiste' || b.service === 'garage') && b.floors <= 3 && depots.length ? depots
        : b.kind === 'bureaux' && b.floors >= 6 && towers.length ? towers
        : b.kind === 'logement' && b.floors <= 3 && houses.length && !b.home ? houses : low;
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
      const im = instanced(mg.geo, mg.mat as THREE.Material, ms, `immeuble ${k}`, true, true);
      // Six tons de façade (teinte douce multipliée à la texture du modèle).
      const tones = [0xffffff, 0xffe8d2, 0xdfeaff, 0xfff1c4, 0xffdcdc, 0xdcf2e2].map((c) => new THREE.Color(c));
      ms.forEach((m, i) => { const e = m.elements; im.setColorAt(i, tones[Math.abs(Math.floor(e[12]! * 7.3 + e[14]! * 3.1)) % tones.length]!); });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      g.add(im);
    }
    return g;
  }

  /** Matériau des globes des lampadaires (allumés la nuit, voir setNight). */
  private readonly lampMat = new THREE.MeshBasicMaterial({ color: 0x8a8f96 });
  private readonly doorGlass: THREE.MeshStandardMaterial[] = [];

  /**
   * Lampadaires (City Kit Roads, ou mât fait en code) au bord des trottoirs, tous les 26 m, jamais devant une porte ;
   * globes lumineux la nuit.
   */
  private streetLights(): THREE.Group {
    const d = this.d, g = new THREE.Group();
    g.name = 'lampadaires';
    const doors = d.buildings.filter((b) => b.premise || b.service || b.home).map((b) => [b.doorX, b.doorZ] as const);
    const poles: THREE.Matrix4[] = [], bulbs: THREE.Matrix4[] = [];
    // (rx, rz) : direction de la chaussée. La crosse du modèle est vers −z : rotation pour la tourner vers la rue.
    const add = (x: number, z: number, rx: number, rz: number): void => {
      if (doors.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < 4)) return;
      poles.push(new THREE.Matrix4().makeRotationY(Math.atan2(-rx, -rz)).setPosition(x, 0.16, z));
      bulbs.push(new THREE.Matrix4().makeTranslation(x + rx * 1.2, 4.42, z + rz * 1.2));
    };
    const off = STREET_W / 2 - 0.5;
    for (let i = 0; i <= d.nx; i++) {
      const x = (i - d.nx / 2) * PITCH;
      for (let z = -d.size.d / 2 + 18; z < d.size.d / 2; z += 26) { add(x - off, z, 1, 0); add(x + off, z + 13, -1, 0); }
    }
    for (let j = 0; j <= d.nz; j++) {
      const z = (j - d.nz / 2) * PITCH;
      for (let x = -d.size.w / 2 + 22; x < d.size.w / 2; x += 26) { add(x, z - off, 0, 1); add(x + 13, z + off, 0, -1); }
    }
    const kit = assets.instances('rue.lampadaire', poles, 1.6, 5.4, 1.6);
    if (kit) { kit.castShadow = true; kit.name = 'lampadaires-kit'; g.add(kit); }
    else g.add(instanced(new THREE.CylinderGeometry(0.08, 0.12, 5.2, 8).translate(0, 2.6, 0), new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.5, roughness: 0.4 }), poles, 'mâts', true, false));
    g.add(instanced(new THREE.SphereGeometry(0.15, 10, 8), this.lampMat, bulbs, 'globes', false, false));
    this.lightPoints = bulbs.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
    return g;
  }
  /** Positions des globes (pour éclairer les abords du joueur la nuit). */
  lightPoints: THREE.Vector3[] = [];

  /** Nuit (0 = jour, 1 = nuit noire) : globes et portes vitrées plus lumineux. */
  setNight(k: number): void {
    this.lampMat.color.setRGB(0.54 + 0.46 * k, 0.56 + 0.4 * k, 0.59 + 0.2 * k);
    for (const m of this.doorGlass) m.emissiveIntensity = 0.55 + 1.4 * k;
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
    // Passages piétons (bandes) de part et d'autre de chaque carrefour.
    const half = STREET_W / 2;
    for (let i = 0; i <= d.nx; i++) for (let j = 0; j <= d.nz; j++) {
      const x = (i - d.nx / 2) * PITCH, z = (j - d.nz / 2) * PITCH;
      for (let k = -5; k <= 5; k++) {
        const t = k * 1.2;
        for (const sgn of [-1, 1]) {
          out.push(new THREE.Matrix4().compose(new THREE.Vector3(x + t, 0.025, z + sgn * (half + 2.2)), q, new THREE.Vector3(0.6, 0.01, 3)));
          out.push(new THREE.Matrix4().compose(new THREE.Vector3(x + sgn * (half + 2.2), 0.025, z + t), q, new THREE.Vector3(3, 0.01, 0.6)));
        }
      }
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
    const zones = parkZones(d);
    const inZone = (x: number, z: number): boolean => [zones.zoo, zones.skate].some((q) => x > q.x0 - 2 && x < q.x1 + 2 && z > q.z0 - 2 && z < q.z1 + 2);
    for (let k = 0; k < 70; k++) { const x = pc.x + (rnd() - 0.5) * (BLOCK - 8), z = pc.z + (rnd() - 0.5) * (BLOCK - 8); if (!inZone(x, z)) pts.push([x, z]); }
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
    // Modèles d'arbres (City Kit Suburban, Nature Kit) répartis au hasard, un InstancedMesh par modèle.
    // Tous les arbres du Nature Kit et du City Kit Suburban (feuillus, pins, palmiers, automne).
    const kinds = ['rue.arbre-grand', 'rue.arbre-petit', ...filesMatching(/^nat-tree_/)].filter((k) => assets.has(k));
    if (kinds.length) {
      const per = new Map<string, THREE.Matrix4[]>();
      trunks.forEach((m, i) => {
        const k = kinds[(i * 7 + Math.floor(rnd() * 3)) % kinds.length]!;
        if (!per.has(k)) per.set(k, []);
        per.get(k)!.push(m.clone().multiply(new THREE.Matrix4().makeRotationY(rnd() * 6.28)));
      });
      for (const [k, ms] of per) { const im = assets.instances(k, ms, 4.2, 6.5, 4.2); if (im) { im.castShadow = true; im.name = `arbres ${k}`; g.add(im); } }
      if (g.children.length) return g;
    }
    g.add(instanced(new THREE.CylinderGeometry(0.18, 0.25, 2.4, 6).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0x6b4f3a }), trunks, 'troncs', true, false));
    g.add(instanced(new THREE.IcosahedronGeometry(1.7, 1), new THREE.MeshStandardMaterial({ color: 0x4f8a45, roughness: 0.9, flatShading: true }), crowns, 'feuillages', true, false));
    return g;
  }

  /**
   * Mobilier urbain et décor (modèles Kenney ; rien si un modèle manque) : feux aux carrefours, bancs, poubelles,
   * jardinières, bennes, parc (bancs, parasols, massifs de fleurs), abords du grossiste (palettes,
   * cartons, citerne), terrasses des snacks et un petit chantier. Jamais devant une porte.
   */
  private streetProps(): THREE.Group {
    const d = this.d, g = new THREE.Group();
    g.name = 'mobilier-urbain';
    const doors = d.buildings.filter((b) => b.premise || b.service || b.home).map((b) => [b.doorX, b.doorZ] as const);
    const free = (x: number, z: number, r = 3.2): boolean => !doors.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < r);
    const per = new Map<string, THREE.Matrix4[]>();
    const put = (key: string, x: number, z: number, ry = 0, r = 3.2): void => {
      if (!free(x, z, r)) return;
      if (!per.has(key)) per.set(key, []);
      per.get(key)!.push(new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0.16, z));
    };
    let seed = d.seed * 7919 + 17;
    const rnd = (): number => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const curb = STREET_W / 2 - 0.9, half = STREET_W / 2;
    // Feux tricolores aux coins des carrefours, tournés vers la chaussée.
    for (let i = 0; i <= d.nx; i++) for (let j = 0; j <= d.nz; j++) {
      const x = (i - d.nx / 2) * PITCH, z = (j - d.nz / 2) * PITCH;
      if ((i + j) % 2 === 0) { put('rue.feu', x - half - 0.6, z - half - 0.6, Math.PI / 4); put('rue.feu', x + half + 0.6, z + half + 0.6, -3 * Math.PI / 4); }
    }
    // Le long des trottoirs : bancs, poubelles, jardinières, en alternance, entre les arbres.
    const along: [number, number, number][] = [];
    for (let i = 0; i <= d.nx; i++) {
      const x = (i - d.nx / 2) * PITCH;
      for (let z = -d.size.d / 2 + 14; z < d.size.d / 2 - 8; z += 18) { along.push([x - curb, z + 2, Math.PI / 2]); along.push([x + curb, z + 11, -Math.PI / 2]); }
    }
    for (let j = 0; j <= d.nz; j++) {
      const z = (j - d.nz / 2) * PITCH;
      for (let x = -d.size.w / 2 + 16; x < d.size.w / 2 - 8; x += 18) { along.push([x + 2, z - curb, 0]); along.push([x + 11, z + curb, Math.PI]); }
    }
    along.forEach(([x, z, ry], k) => {
      const r = rnd();
      if (Math.abs(x) > d.size.w / 2 || Math.abs(z) > d.size.d / 2) return;
      if (r < 0.28) put('rue.banc', x, z, ry);
      else if (r < 0.48) put('meuble.poubelle', x, z, ry, 2.5);
      else if (r < 0.62) put('rue.jardiniere', x, z, ry);
      else if (r < 0.7 && k % 3 === 0) put('rue.benne', x, z, ry, 5);
    });
    // Parc : bancs autour, massifs de fleurs et buissons, parasols et tables, clôture basse.
    const pc = blockCenter(d, d.parkBlock.i, d.parkBlock.j), ph = BLOCK / 2 - 3;
    for (let k = -2; k <= 2; k++) {
      put('rue.banc', pc.x + k * 9, pc.z - ph + 4, 0); put('rue.banc', pc.x + k * 9, pc.z + ph - 4, Math.PI);
      put('rue.banc', pc.x - ph + 4, pc.z + k * 9, Math.PI / 2); put('rue.banc', pc.x + ph - 4, pc.z + k * 9, -Math.PI / 2);
    }
    // Massifs : toutes les fleurs, plantes, herbes, champignons, pierres, souches et rondins du Nature Kit.
    const zones = parkZones(d);
    const inZone = (x: number, z: number): boolean => [zones.zoo, zones.skate].some((q) => x > q.x0 - 1.5 && x < q.x1 + 1.5 && z > q.z0 - 1.5 && z < q.z1 + 1.5);
    const flowers = filesMatching(/^nat-(flower_|plant_bush|grass_large|grass_leafsLarge|mushroom_redGroup|mushroom_tanGroup)/).filter((k) => assets.has(k));
    for (let k = 0; k < 130 && flowers.length; k++) {
      const a = rnd() * Math.PI * 2, rr = 6 + rnd() * (ph - 8);
      const x = pc.x + Math.cos(a) * rr, z = pc.z + Math.sin(a) * rr;
      if (!inZone(x, z)) put(flowers[k % flowers.length]!, x, z, rnd() * 6.28, 0);
    }
    // Statues et gros rochers au centre et aux entrées du parc.
    const statues = filesMatching(/^nat-statue_/).filter((k) => assets.has(k));
    statues.forEach((k, i) => { const a = (i / Math.max(1, statues.length)) * Math.PI * 2; put(k, pc.x + Math.cos(a) * 5, pc.z - 12 + Math.sin(a) * 3, -a, 0); });
    filesMatching(/^nat-(rock_large|stump_old|log_stack)/).filter((k) => assets.has(k)).forEach((k, i) => {
      const x = pc.x - ph + 4 + (i % 4) * 12, z = pc.z - 20 + Math.floor(i / 4) * 9;
      if (!inZone(x, z)) put(k, x, z, rnd() * 6, 0);
    });
    for (let k = 0; k < 3; k++) {
      const x = pc.x - 6 + k * 6, z = pc.z;
      put(k % 2 ? 'rue.parasol-a' : 'rue.parasol-b', x, z, rnd(), 0);
      put('f:table', x + 1.2, z + 0.4, 0, 0); put('f:chairModernCushion', x + 1.2, z + 1.3, Math.PI, 0);
    }
    // Abords des services : palettes et cartons devant le grossiste, parasols devant les snacks.
    for (const b of d.buildings) {
      if (!b.service) continue;
      const n = FACE_N[b.face]!, t = [n[1], -n[0]] as const, depth = b.face % 2 === 0 ? b.d : b.w;
      const at = (side: number, out: number): [number, number] => [b.x + n[0] * (depth / 2 + out) + t[0] * side, b.z + n[1] * (depth / 2 + out) + t[1] * side];
      const ry = Math.atan2(n[0], n[1]);
      if (b.service === 'grossiste') {
        for (const s of [-5, -3.6, 4, 5.4]) { const [x, z] = at(s, 0.9); put('rue.palette', x, z, ry, 2.2); }
        for (const s of [-4.3, 4.7]) { const [x, z] = at(s, 0.9); put('rue.carton', x, z, ry + 0.3, 2.2); }
        // Tonneaux, caisses et seaux (Survival Kit), cartons du Furniture Kit.
        const srv = filesMatching(/^srv-(barrel|box|bucket|chest|bottle)/).filter((k) => assets.has(k));
        srv.forEach((k, i) => { const [x, z] = at((i % 2 ? 1 : -1) * (6.5 + Math.floor(i / 2) * 0.9), 0.8); put(k, x, z, rnd() * 6, 2.2); });
        for (const [s2, k] of [[-6.2, 'f:cardboardBoxClosed'], [6.4, 'f:cardboardBoxOpen']] as const) { const [x, z] = at(s2, 2.2); put(k, x, z, rnd(), 2.2); }
      } else if (b.service === 'snack') {
        for (const s of [-4.5, 4.5]) { const [x, z] = at(s, 1.6); put(s < 0 ? 'rue.parasol-a' : 'rue.parasol-b', x, z, ry, 2.5); }
      } else if (b.service === 'garage') {
        for (const s of [-4, -3, 4.2]) { const [x, z] = at(s, 0.8); put('rue.cone', x, z, rnd(), 2.2); }
        // Vitrine du garage : voitures de course et karts exposés sur le trottoir.
        const show = filesMatching(/^car-(race|kart)/).filter((k) => assets.has(k));
        show.forEach((k, i) => { const [x, z] = at((i % 2 ? 1 : -1) * (5.5 + Math.floor(i / 2) * 2.4), 1.6); put(k, x, z, ry + Math.PI / 2, 2.6); });
      } else if (b.service === 'meubles') {
        for (const [s2, k] of [[-4.5, 'f:loungeChair'], [4.5, 'f:loungeSofa'], [-5.8, 'f:lampSquareFloor']] as const) { const [x, z] = at(s2, 1.2); put(k, x, z, ry, 2.2); }
      }
    }
    // Petit chantier sur un trottoir (barrières, cônes, lampe de chantier).
    {
      const x = (1 - d.nx / 2) * PITCH + curb - 0.4, z0 = -d.size.d / 2 + PITCH / 2 + 20;
      if (free(x, z0, 7)) {
        put('rue.chantier-barriere', x, z0 - 3, Math.PI / 2); put('rue.chantier-barriere', x, z0 + 3, Math.PI / 2);
        put('rue.chantier-cone', x - 0.2, z0 - 1.5); put('rue.chantier-cone', x - 0.2, z0); put('rue.chantier-cone', x - 0.2, z0 + 1.5);
        put('rue.chantier-lampe', x + 0.6, z0 + 4.2, Math.PI / 2);
        put('f:urb-scaffolding-structure', x + 2.2, z0, 0, 0); put('f:urb-scaffolding-poles', x + 2.2, z0 + 2.4, 0, 0);
        put('f:urb-planks', x + 0.4, z0 - 4.6, 0.3); put('f:urb-detail-barrier-strong-type-a', x - 0.2, z0 - 6, Math.PI / 2);
      }
    }
    // Tailles (largeur, hauteur, profondeur) maximales de chaque modèle dans la rue (m).
    const size: Record<string, [number, number, number]> = {
      'rue.feu': [1.2, 4.2, 1.2], 'rue.banc': [1.9, 1.0, 0.8], 'meuble.poubelle': [0.55, 0.95, 0.55], 'rue.jardiniere': [1.6, 1.3, 1.6],
      'rue.benne': [2.2, 1.6, 1.4], 'rue.parasol-a': [3, 2.7, 3], 'rue.parasol-b': [3, 2.7, 3], 'rue.cloture': [4, 0.8, 0.4],
      'rue.palette': [1.2, 0.3, 1.0], 'rue.carton': [0.8, 0.7, 0.8], 'rue.cone': [0.45, 0.6, 0.45], 'rue.chantier-barriere': [2.4, 1.1, 0.6],
      'rue.chantier-cone': [0.5, 0.75, 0.5], 'rue.chantier-lampe': [1, 2.2, 1], 'nat.buisson': [1.1, 0.9, 1.1], 'nat.buisson-grand': [1.6, 1.3, 1.6],
      'nat.buisson-fin': [1.2, 1, 1.2], 'f:table': [0.9, 0.75, 0.9], 'f:chairModernCushion': [0.45, 0.9, 0.45],
      'f:cardboardBoxClosed': [0.7, 0.6, 0.7], 'f:cardboardBoxOpen': [0.7, 0.6, 0.7], 'f:loungeChair': [0.9, 0.9, 0.9],
      'f:loungeSofa': [2, 0.9, 0.9], 'f:lampSquareFloor': [0.5, 1.7, 0.5], 'f:urb-scaffolding-structure': [2.4, 4, 2.4],
      'f:urb-scaffolding-poles': [2.4, 4, 2.4], 'f:urb-planks': [2, 0.3, 1], 'f:urb-detail-barrier-strong-type-a': [2.4, 1.1, 0.6],
    };
    for (const k of per.keys()) {
      if (size[k]) continue;
      if (/^f:car-/.test(k)) size[k] = [1.9, 1.6, 4.2];
      else if (/^f:srv-/.test(k)) size[k] = [0.8, 0.9, 0.8];
      else if (/^f:nat-statue/.test(k)) size[k] = [1.6, 2.6, 1.6];
      else if (/^f:nat-(rock|stone)_(large|tall)/.test(k)) size[k] = [1.8, 1.8, 1.8];
      else if (/^f:nat-(log|stump)/.test(k)) size[k] = [1.2, 0.7, 1.2];
      else if (/^f:nat-/.test(k)) size[k] = [0.8, 0.8, 0.8];
    }
    for (const [k, ms] of per) {
      const [w, h, dd] = size[k] ?? [0.7, 0.6, 0.7];
      const im = assets.instances(k, ms, w, h, dd);
      if (im) { im.castShadow = h > 1.8; im.name = `décor ${k}`; g.add(im); }
    }
    return g;
  }

  /** Rectangles des voitures garées (ajoutés aux collisions de la rue). */
  readonly parkedRects: Rect[] = [];

  /**
   * Voitures garées le long des trottoirs (tous les véhicules du Car Kit et du Retro Urban Kit sauf course et karts),
   * jamais devant une porte ni dans un carrefour. Chacune devient un obstacle.
   */
  private parkedCars(): THREE.Group {
    const d = this.d, g = new THREE.Group();
    g.name = 'voitures-garees';
    const keys = [...filesMatching(/^car-/).filter((k) => !/race|kart|cone|box|tractor/.test(k)), ...filesMatching(/^urb-truck/)].filter((k) => assets.has(k));
    if (!keys.length) return g;
    let seed = d.seed * 977 + 3;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const doors = d.buildings.filter((b) => b.premise || b.service || b.home).map((b) => [b.doorX, b.doorZ] as const);
    const per = new Map<string, THREE.Matrix4[]>();
    const off = STREET_W / 2 - 1.5;
    const add = (x: number, z: number, along: 'x' | 'z'): void => {
      if (rnd() > 0.42) return;
      if (doors.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < 6)) return;
      // Hors des carrefours.
      const nearCross = (v: number, n: number): boolean => { for (let i = 0; i <= n; i++) if (Math.abs(v - (i - n / 2) * PITCH) < STREET_W / 2 + 5) return true; return false; };
      if (along === 'z' ? nearCross(z, d.nz) : nearCross(x, d.nx)) return;
      const k = keys[Math.floor(rnd() * keys.length)]!;
      const ry = along === 'z' ? (rnd() < 0.5 ? 0 : Math.PI) : (rnd() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      if (!per.has(k)) per.set(k, []);
      per.get(k)!.push(new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z));
      const hw = along === 'z' ? 1.05 : 2.3, hd = along === 'z' ? 2.3 : 1.05;
      this.parkedRects.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, h: 1.7 });
    };
    for (let i = 0; i <= d.nx; i++) {
      const x = (i - d.nx / 2) * PITCH;
      for (let z = -d.size.d / 2 + 6; z < d.size.d / 2 - 4; z += 6.5) { add(x - off, z, 'z'); add(x + off, z + 3, 'z'); }
    }
    for (let j = 0; j <= d.nz; j++) {
      const z = (j - d.nz / 2) * PITCH;
      for (let x = -d.size.w / 2 + 6; x < d.size.w / 2 - 4; x += 6.5) { add(x, z - off, 'x'); add(x + 3, z + off, 'x'); }
    }
    for (const [k, ms] of per) {
      const sz = assets.size(k);
      const wide = /truck|garbage|firetruck|ambulance|delivery|van/.test(k) ? 2.3 : 1.9;
      const im = sz ? assets.instances(k, ms, wide, 4, 6.5) : null;
      if (im) { im.castShadow = false; im.name = `garée ${k}`; g.add(im); }
    }
    return g;
  }

  /**
   * Horizon autour du quartier (au-delà des limites où l'on marche) : gratte-ciel et immeubles (City Kit Commercial,
   * versions « low detail » comprises) au nord et à l'ouest, zone industrielle (entrepôts, cheminées, citernes) à
   * l'est, quartier pavillonnaire (maisons, allées, clôtures, haies, arbres) au sud.
   */
  private outskirts(): THREE.Group {
    const d = this.d, g = new THREE.Group();
    g.name = 'horizon';
    let seed = d.seed * 613 + 1;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const per = new Map<string, { m: THREE.Matrix4[]; w: number; h: number }>();
    const put = (k: string, x: number, z: number, ry: number, w: number, h: number): void => {
      if (!assets.has(k)) return;
      if (!per.has(k)) per.set(k, { m: [], w, h });
      per.get(k)!.m.push(new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z));
    };
    const hw = d.size.w / 2 + STREET_W / 2, hd = d.size.d / 2 + STREET_W / 2;
    const city = [...filesMatching(/^building-[a-n]$/), ...filesMatching(/^building-skyscraper-/), ...filesMatching(/^com-low-detail-building/)];
    const ind = filesMatching(/^ind-(building|chimney|detail-tank)/);
    const sub = filesMatching(/^house-/);
    // Nord (z < 0) et ouest (x < 0) : ville dense sur trois rangées.
    for (let row = 0; row < 3; row++) {
      const dist = 34 + row * 30;
      for (let x = -hw - 60; x < hw + 60; x += 22 + rnd() * 8) {
        const k = city[Math.floor(rnd() * city.length)]!;
        const tall = /skyscraper/.test(k);
        put(k, x, -hd - dist, 0, 20, tall ? 70 + rnd() * 30 : 18 + rnd() * 26);
      }
      for (let z = -hd - 30; z < hd + 10; z += 22 + rnd() * 8) {
        const k = city[Math.floor(rnd() * city.length)]!;
        put(k, -hw - dist, z, Math.PI / 2, 20, /skyscraper/.test(k) ? 60 + rnd() * 30 : 16 + rnd() * 22);
      }
    }
    // Est : zone industrielle.
    for (let row = 0; row < 3; row++) for (let z = -hd - 20; z < hd + 40; z += 24 + rnd() * 6) {
      const k = ind[Math.floor(rnd() * ind.length)]!;
      const small = /chimney|tank/.test(k);
      put(k, hw + 36 + row * 30 + rnd() * 6, z, -Math.PI / 2, small ? 8 : 22, small ? 22 : 16);
    }
    // Sud : pavillons alignés le long d'une petite rue, avec haies, clôtures et arbres.
    const extras = [...filesMatching(/^sub-(tree|planter|fence|driveway|path)/)];
    for (let row = 0; row < 3; row++) for (let x = -hw - 20; x < hw + 60; x += 13 + rnd() * 3) {
      const z = hd + 30 + row * 24;
      put(sub[Math.floor(rnd() * sub.length)]!, x, z, Math.PI, 10, 12);
      const e = extras[Math.floor(rnd() * extras.length)];
      if (e) put(e, x + 5.5, z - 6, Math.PI, 3, 4);
    }
    for (const [k, v] of per) {
      const im = assets.instances(k, v.m, v.w, v.h, v.w);
      if (im) { im.name = `horizon ${k}`; im.castShadow = false; g.add(im); }
    }
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

