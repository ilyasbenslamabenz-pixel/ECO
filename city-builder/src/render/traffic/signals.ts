/**
 * Feux tricolores du jeu (rendu) : un ensemble poteau + tête(s) de feu par bras régulé d'un carrefour à feux,
 * placé et orienté d'après la disposition envoyée par la simulation (`SignalFrame.layout`, voir
 * SIGNAL_HEAD_STRIDE dans src/shared/protocol.ts) ; la lentille allumée suit l'état simulé (`SignalFrame.states`).
 *
 * - Grand carrefour (voies d'arrivée multiples ou carrefour large) : mât haut avec potence au-dessus des voies,
 *   tête suspendue au droit du faisceau de voies + répétiteur à hauteur des yeux sur le mât.
 * - Petit carrefour (une voie d'arrivée) : poteau simple, une tête à 2,8 m.
 * - Tête détaillée : caisson à angles arrondis, plaque de contraste à liseré, trois visières, trois lentilles
 *   (rouge en haut, orange, vert en bas) ; lentilles non éclairées par la scène (couleur directe hors tone mapping)
 *   donc lisibles de jour comme de nuit, plus un halo additif renforcé la nuit.
 * - Tout est instancié : 7 maillages instanciés au total (mâts hauts, poteaux, potences, caissons, plaques,
 *   lentilles, halos), quel que soit le nombre de carrefours ; les couleurs par instance changent à chaque
 *   changement d'état (rare : quelques fois par minute et par carrefour).
 * Aucun état de jeu ici : tout vient de la simulation.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SIGNAL_HEAD_STRIDE, type SignalFrame, type SignalLayoutMsg } from '../../shared/protocol';

/** Hauteur de la potence (m) et du centre de la tête suspendue. */
const MAST_H = 6.1;
const HANG_Y = MAST_H - 0.62;
/** Hauteur du centre de la tête sur poteau simple / du répétiteur. */
const POLE_HEAD_Y = 2.85;
/** Écart vertical entre lentilles et position avant des lentilles (repère de la tête). */
const LENS_DY = 0.31;
const LENS_Z = 0.137;

/** Couleurs allumées (hors tone mapping : valeurs > 1 = saturées, lisibles en plein jour) et éteintes. */
const ON = [new THREE.Color(2.6, 0.12, 0.06), new THREE.Color(2.4, 1.15, 0.04), new THREE.Color(0.1, 2.3, 0.75)];
const OFF = [new THREE.Color(0.16, 0.025, 0.02), new THREE.Color(0.16, 0.1, 0.02), new THREE.Color(0.02, 0.12, 0.06)];
const HALO = [new THREE.Color(1, 0.12, 0.05), new THREE.Color(1, 0.55, 0.05), new THREE.Color(0.1, 1, 0.45)];
const BLACK = new THREE.Color(0, 0, 0);

/** Fusionne des géométries (non indexées, position + normale seulement). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    return n;
  });
  const m = mergeGeometries(norm, false);
  if (!m) throw new Error('feux : fusion de géométries impossible');
  m.computeBoundingSphere();
  return m;
}

/** Mât / poteau : socle, fût conique, bague, chapeau. */
function poleGeometry(h: number, r: number): THREE.BufferGeometry {
  return merge([
    new THREE.CylinderGeometry(r * 2.3, r * 2.6, 0.32, 12).translate(0, 0.16, 0),
    new THREE.CylinderGeometry(r * 1.6, r * 2.1, 0.12, 12).translate(0, 0.38, 0),
    new THREE.CylinderGeometry(r * 0.8, r, h - 0.4, 12).translate(0, 0.4 + (h - 0.4) / 2, 0),
    new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.08, 12).translate(0, h * 0.62, 0),
    new THREE.SphereGeometry(r * 0.95, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, h, 0),
  ]);
}

/** Potence de longueur 1 vers −X (étirée par instance), avec tirant oblique et embout. */
function armGeometry(): THREE.BufferGeometry {
  const tube = new THREE.CylinderGeometry(0.065, 0.075, 1, 10).rotateZ(Math.PI / 2).translate(-0.5, MAST_H - 0.1, 0);
  const brace = new THREE.CylinderGeometry(0.03, 0.03, 1, 6);
  // tirant : du mât (−0,9 m) jusqu'à 45 % de la potence
  const p0 = new THREE.Vector3(0, MAST_H - 1.0, 0), p1 = new THREE.Vector3(-0.45, MAST_H - 0.1, 0);
  const d = p1.clone().sub(p0);
  brace.scale(1, d.length(), 1);
  brace.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  brace.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, 0);
  const cap = new THREE.CylinderGeometry(0.085, 0.085, 0.05, 10).rotateZ(Math.PI / 2).translate(-1, MAST_H - 0.1, 0);
  return merge([tube, brace, cap]);
}

/** Caisson de la tête (repère : centre de la tête, +Z vers les conducteurs) : corps arrondi, 3 visières, attaches. */
function housingGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new RoundedBoxGeometry(0.34, 1.0, 0.25, 3, 0.05)];
  for (let k = 0; k < 3; k++) {
    // visière : demi-cylindre ouvert au-dessus de la lentille, en saillie vers l'avant
    // (θ ∈ [π/2, 3π/2] puis axe Y -> Z : la moitié supérieure, y > 0)
    const v = new THREE.CylinderGeometry(0.128, 0.128, 0.2, 14, 1, true, Math.PI / 2, Math.PI);
    v.rotateX(Math.PI / 2);
    v.translate(0, LENS_DY * (1 - k) + 0.005, LENS_Z + 0.09);
    parts.push(v);
    // bague de lentille
    parts.push(new THREE.TorusGeometry(0.112, 0.014, 6, 16).translate(0, LENS_DY * (1 - k), LENS_Z - 0.005));
  }
  parts.push(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8).translate(0, 0.57, 0)); // tige de suspension
  parts.push(new THREE.BoxGeometry(0.1, 0.5, 0.12).translate(0, 0, -0.17)); // étrier côté poteau
  return merge(parts);
}

/** Plaque de contraste (fond noir à liseré clair) derrière le caisson. */
function plateGeometry(): THREE.BufferGeometry {
  return merge([new THREE.BoxGeometry(0.56, 1.22, 0.02).translate(0, 0, -0.135)]);
}

interface HeadRef { arm: number }

export interface SignalDebugArm { node: number; x: number; y: number; z: number; heading: number; reach: number; lanes: number; mast: boolean; state: number }

export class TrafficSignalRenderer {
  readonly group = new THREE.Group();
  private readonly geo = {
    mast: poleGeometry(MAST_H, 0.11),
    pole: poleGeometry(POLE_HEAD_Y + 0.75, 0.07),
    arm: armGeometry(),
    housing: housingGeometry(),
    plate: plateGeometry(),
    lens: new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.32).rotateX(Math.PI / 2).translate(0, 0, -0.07),
    halo: new THREE.CircleGeometry(0.3, 20),
  };
  private readonly mat = {
    metal: new THREE.MeshStandardMaterial({ color: 0x3b4146, roughness: 0.45, metalness: 0.7 }),
    housing: new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide }),
    plate: new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.8, metalness: 0.1, emissive: 0x000000 }),
    lens: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    halo: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
  };
  private meshes: THREE.InstancedMesh[] = [];
  private lenses: THREE.InstancedMesh | null = null;
  private halos: THREE.InstancedMesh | null = null;
  private heads: HeadRef[] = [];
  private arms: SignalDebugArm[] = [];
  private version = -1;
  private states = new Uint8Array(0);
  /** Nombre de changements d'état appliqués (diagnostic). */
  updates = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = 'feux_tricolores';
    scene.add(this.group);
  }

  get count(): number { return this.arms.length; }

  /** Applique une trame de feux venant de la simulation (disposition et/ou états). */
  apply(f: SignalFrame): void {
    if (f.layout) this.build(f.layout);
    if (f.version !== this.version || f.states.length !== this.arms.length) return;
    this.setStates(f.states);
  }

  /** Après un instantané : plus aucun feu jusqu'à la prochaine disposition. */
  clear(): void {
    for (const m of this.meshes) { m.dispose(); this.group.remove(m); }
    this.meshes = [];
    this.lenses = this.halos = null;
    this.heads = [];
    this.arms = [];
    this.states = new Uint8Array(0);
    this.version = -1;
  }

  /** 0 = jour, 1 = nuit : halos plus présents la nuit (les lentilles restent pleinement lisibles de jour). */
  setNight(n: number): void {
    this.mat.halo.opacity = 0.18 + 0.62 * n;
  }

  private build(l: SignalLayoutMsg): void {
    this.clear();
    this.version = l.version;
    const n = l.nodeIds.length;
    if (n === 0) return;
    const h = l.heads;
    const S = SIGNAL_HEAD_STRIDE;
    // mât à potence pour les bras à plusieurs voies ou les grands carrefours
    const isMast = (i: number): boolean => h[i * S + 5]! >= 2 || h[i * S + 6]! >= 13;
    let masts = 0;
    for (let i = 0; i < n; i++) if (isMast(i)) masts++;
    const headCount = n + masts; // tête suspendue + répétiteur pour chaque mât
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, count: number, shadow: boolean, name: string): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(g, m, Math.max(1, count));
      im.count = count;
      im.name = name;
      im.castShadow = shadow;
      im.receiveShadow = shadow;
      this.meshes.push(im);
      this.group.add(im);
      return im;
    };
    const mastM = mk(this.geo.mast, this.mat.metal, masts, true, 'feux_mats');
    const poleM = mk(this.geo.pole, this.mat.metal, n - masts, true, 'feux_poteaux');
    const armM = mk(this.geo.arm, this.mat.metal, masts, true, 'feux_potences');
    const housingM = mk(this.geo.housing, this.mat.housing, headCount, true, 'feux_caissons');
    const plateM = mk(this.geo.plate, this.mat.plate, headCount, false, 'feux_plaques');
    const lensM = mk(this.geo.lens, this.mat.lens, headCount * 3, false, 'feux_lentilles');
    const haloM = mk(this.geo.halo, this.mat.halo, headCount * 3, false, 'feux_halos');
    haloM.renderOrder = 4;
    this.lenses = lensM; this.halos = haloM;

    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const base = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const off = new THREE.Vector3();
    let iMast = 0, iPole = 0, iHead = 0;
    const addHead = (arm: number, lx: number, ly: number, lz: number): void => {
      off.set(lx, ly, lz).applyQuaternion(q).add(base);
      m.compose(off, q, one);
      housingM.setMatrixAt(iHead, m);
      plateM.setMatrixAt(iHead, m);
      for (let k = 0; k < 3; k++) {
        local.makeTranslation(0, LENS_DY * (1 - k), LENS_Z);
        lensM.setMatrixAt(iHead * 3 + k, m.clone().multiply(local));
        local.makeTranslation(0, LENS_DY * (1 - k), LENS_Z + 0.035);
        haloM.setMatrixAt(iHead * 3 + k, m.clone().multiply(local));
      }
      this.heads.push({ arm });
      iHead++;
    };
    for (let i = 0; i < n; i++) {
      const o = i * S;
      const x = h[o]!, y = h[o + 1]!, z = h[o + 2]!, hd = h[o + 3]!, reach = h[o + 4]!;
      // +Z local vers les conducteurs qui arrivent ; −X local = vers le centre de la chaussée (à leur gauche)
      q.setFromAxisAngle(up, hd + Math.PI);
      base.set(x, y + 0.15, z); // sur le trottoir (bordure)
      const mast = isMast(i);
      m.compose(base, q, one);
      if (mast) {
        mastM.setMatrixAt(iMast, m);
        const len = Math.max(1.5, reach + 0.35);
        armM.setMatrixAt(iMast, m.clone().multiply(local.makeScale(len, 1, 1)));
        iMast++;
        addHead(i, -reach, HANG_Y, 0);
        addHead(i, 0, POLE_HEAD_Y, 0.26);
      } else {
        poleM.setMatrixAt(iPole++, m);
        addHead(i, 0, POLE_HEAD_Y, 0.21);
      }
      this.arms.push({ node: l.nodeIds[i]!, x, y, z, heading: hd, reach, lanes: h[o + 5]!, mast, state: 2 });
    }
    for (const im of this.meshes) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.computeBoundingBox(); }
    this.states = new Uint8Array(n).fill(255);
    this.setStates(new Uint8Array(n).fill(2));
  }

  private setStates(s: Uint8Array): void {
    const lens = this.lenses, halo = this.halos;
    if (!lens || !halo) return;
    let changed = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === this.states[i]) continue;
      this.states[i] = s[i]!;
      this.arms[i]!.state = s[i]!;
      changed = true;
    }
    if (!changed) return;
    for (let k = 0; k < this.heads.length; k++) {
      const st = this.states[this.heads[k]!.arm]!; // 0 vert, 1 orange, 2 rouge
      const lit = st === 0 ? 2 : st === 1 ? 1 : 0; // lentille allumée : 0 rouge (haut), 1 orange, 2 vert (bas)
      for (let j = 0; j < 3; j++) {
        lens.setColorAt(k * 3 + j, j === lit ? ON[j]! : OFF[j]!);
        halo.setColorAt(k * 3 + j, j === lit ? HALO[j]! : BLACK);
      }
    }
    lens.instanceColor!.needsUpdate = true;
    halo.instanceColor!.needsUpdate = true;
    this.updates++;
  }

  /** Diagnostic (tests e2e) : bras, positions, états et nombre d'instances. */
  debug(): { version: number; arms: SignalDebugArm[]; heads: number; meshes: { name: string; count: number }[]; updates: number } {
    return { version: this.version, arms: this.arms.map((a) => ({ ...a })), heads: this.heads.length, meshes: this.meshes.map((m) => ({ name: m.name, count: m.count })), updates: this.updates };
  }

  dispose(): void {
    this.clear();
    for (const g of Object.values(this.geo)) g.dispose();
    for (const m of Object.values(this.mat)) m.dispose();
    this.group.removeFromParent();
  }
}
